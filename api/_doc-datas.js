/**
 * O DOCUMENTO QUE JÁ É NOSSO RESPONDE ANTES DE PAGAR PARA PERGUNTAR DE NOVO (29/08).
 *
 * PEDIDO DO DONO: "salve os documentos no nosso armazenamento e leia os documentos para
 * extrair datas e endereço e descrição… assim economizamos e aumentamos a eficiência".
 *
 * O QUE JÁ EXISTIA, e por isso este arquivo é pequeno:
 *   · `scripts/captura-documentos.mjs` já baixa edital/matrícula/laudo para o bucket
 *     `documentos` e registra em `imovel_anexos.storage_path`;
 *   · `extrairDatasLeilao` (enriquecer-lote) já lê praças de TEXTO;
 *   · `extrairIdentidadeTexto` (_doc-extracao) já lê logradouro, bairro e condomínio.
 * O que faltava era LIGAR as duas pontas fora da geração de relatório: até hoje o edital só
 * era lido quando um cliente pedia uma análise. Para o ACERVO, o `enriquecer-datas-cron` ia
 * buscar a PÁGINA DO LOTE via Bright Data — pagando por uma informação que já estava no
 * nosso bucket.
 *
 * O TAMANHO DO DESPERDÍCIO, medido em 29/08: **~2.900 lotes ativos sem data completa JÁ TÊM
 * edital ou matrícula no nosso storage** (LJUD 1.040 · PESTANA 633 · GRUPOLANCE 338 ·
 * MEGA 233 · SUPERBID 176 · BIASI 122 · TORRES3 86 · ZUK 63 …). Cada um deles era uma
 * requisição paga por semana, para ler o que já tínhamos.
 *
 * ⚠️ SEM CAMADA DE TEXTO NÃO É "SEM DATA". PDF escaneado devolve texto vazio — isso é
 * "não consegui ler", e quem chama precisa distinguir para cair no caminho pago em vez de
 * carimbar o lote como visitado. Por isso o retorno separa `lido` de `achou`: fundir os dois
 * faria o lote sair da fila sem nunca ter sido lido, que é o defeito que o próprio
 * `enriquecer-datas-cron` levou 23/08 para descobrir na versão dele.
 */
import { carregarPDFParse } from './_pdf-safe.js';
import { extrairDatasLeilao } from './enriquecer-lote.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'documentos';
// Edital primeiro: é o documento que traz praça, data e condições. A matrícula tem endereço
// e ônus, mas raramente a data do leilão; o laudo, a descrição física.
const PRIORIDADE = ['edital', 'regras_venda', 'regras', 'laudo', 'matricula', 'outro'];
const MAX_BYTES = Number(process.env.DOC_DATAS_MAX_BYTES || 12 * 1024 * 1024);

const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  signal: AbortSignal.timeout(15000),
});

/** Baixa um objeto do nosso bucket. Custo zero — é o nosso Storage, não a internet. */
async function baixar(storagePath) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(30000),
  });
  // `.ok` checado: o Storage devolve JSON de erro com 400/404, e um `arrayBuffer()` direto
  // viraria um "PDF" de 60 bytes que o pdf-parse rejeita — indistinguível de PDF corrompido.
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > 0 && buf.length <= MAX_BYTES ? buf : null;
}

/**
 * Lê o melhor documento que temos deste imóvel e extrai o que dá.
 * Devolve sempre um objeto, nunca lança:
 *   { lido:boolean, achou:boolean, tipo, patch:{...}, motivo }
 * `lido:false` = não havia documento OU o PDF não tem camada de texto → quem chama pode
 * tentar o caminho pago. `lido:true, achou:false` = o documento existe, foi lido e não diz
 * a data; insistir no pago por este lote costuma ser dinheiro jogado fora.
 */
export async function enriquecerPeloDocumento(imovelId, atual = {}) {
  const vazio = (motivo) => ({ lido: false, achou: false, tipo: null, patch: {}, motivo });
  if (!SUPABASE_URL || !SERVICE_KEY || !imovelId) return vazio('sem_config');

  let anexos = [];
  try {
    const r = await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(imovelId)}&storage_path=not.is.null&select=tipo,storage_path&limit=12`);
    if (!r.ok) return vazio('anexos_erro');
    anexos = await r.json();
    if (!Array.isArray(anexos)) return vazio('anexos_corpo');
  } catch { return vazio('anexos_excecao'); }
  if (!anexos.length) return vazio('sem_anexo');

  anexos.sort((a, b) => {
    const ia = PRIORIDADE.indexOf(a.tipo); const ib = PRIORIDADE.indexOf(b.tipo);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const PDFParse = await carregarPDFParse();
  if (!PDFParse) return vazio('sem_pdf_parse');

  let ultimoMotivo = 'sem_camada_de_texto';
  for (const a of anexos.slice(0, 3)) {
    let texto = '';
    let parser = null;
    try {
      const buf = await baixar(a.storage_path);
      if (!buf) { ultimoMotivo = 'download_falhou'; continue; }
      // `carregarPDFParse` devolve a CLASSE `PDFParse`, não uma função — instanciar com `new`
      // e chamar `getText()` é a única forma. Chamá-la direto lança "Class constructor cannot
      // be invoked without 'new'", e como isso cai no catch, TODO documento virava "sem camada
      // de texto". Foi o que a validação em seco mediu: 23 de 23 lotes com documento, zero
      // lidos. O erro estava no meu código, não nos PDFs.
      parser = new PDFParse({ data: buf });
      const res = await parser.getText();
      texto = String(res?.text || '');
    } catch (e) {
      // Engolir a exceção é o que fez o defeito acima passar por "PDF escaneado". O motivo
      // sobe para quem chama e aparece no log.
      ultimoMotivo = `erro_parse:${String(e?.message || e).slice(0, 60)}`;
      continue;
    } finally { if (parser) await parser.destroy().catch(() => {}); }
    // Menos de 200 caracteres é PDF escaneado (só imagem). NÃO é "documento sem data".
    if (texto.replace(/\s+/g, '').length < 200) { ultimoMotivo = 'sem_camada_de_texto'; continue; }

    const patch = {};
    const { inicio, fim, encerradaEm } = extrairDatasLeilao(texto);
    if (inicio && !atual.data_leilao) patch.data_leilao = inicio;
    if (fim && !atual.data_leilao_2) patch.data_leilao_2 = fim;
    if (encerradaEm && !atual.data_leilao && !atual.data_leilao_2) patch.data_leilao = encerradaEm;

    // ⚠️ ENDEREÇO E DESCRIÇÃO **NÃO** SÃO GRAVADOS, e isto é uma decisão MEDIDA, não cautela
    // teórica. A validação em seco de 29/08 mostrou o extrator acertando 22 de 23 lotes… com o
    // endereço ERRADO: seis imóveis diferentes — em São Paulo, Porto Alegre, Santos e Penha de
    // França — receberiam todos "Avenida Fagundes Filho", que é o endereço do ESCRITÓRIO DO
    // LEILOEIRO no cabeçalho do edital. `extrairIdentidadeTexto` pega o primeiro logradouro do
    // texto, e num edital o primeiro logradouro é quase sempre o de quem publica, não o do bem.
    //
    // Gravar isso teria movido o pino do mapa de 22 dos 23 lotes para o mesmo lugar errado —
    // um estrago silencioso, exatamente do tipo que o cliente descobre no dia da visita. O
    // pedido do dono (extrair endereço do documento) só volta com um extrator que ancore o
    // logradouro no TRECHO DO BEM (após "descrição do imóvel", "matrícula nº"), e validado
    // contra a cidade que o acervo já conhece.
    //
    // A DATA fica, porque a validação a mediu certa: 6 de 23 (26%) — e data errada não passa
    // pelo filtro de plausibilidade de `extrairDatasLeilao` do mesmo jeito que endereço passa.

    return { lido: true, achou: Object.keys(patch).length > 0, tipo: a.tipo, patch, motivo: null };
  }
  return vazio(ultimoMotivo);
}
