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
/**
 * ENDEREÇO DO BEM — a segunda tentativa, com âncora e três guardas (item 9, 29/08).
 *
 * A PRIMEIRA TENTATIVA FOI MEDIDA E REPROVADA: `extrairIdentidadeTexto` pega o PRIMEIRO
 * logradouro do texto, e num edital o primeiro logradouro é o de quem PUBLICA. A validação em
 * seco mostrou 22 de 23 lotes recebendo endereço — e seis imóveis distintos, em São Paulo,
 * Porto Alegre, Santos e Penha de França, recebendo TODOS "Avenida Fagundes Filho", que é o
 * escritório do leiloeiro. Teria movido o pino do mapa de 22 lotes para o mesmo lugar errado.
 *
 * As três guardas, e cada uma barra um caso real visto naquele teste:
 *
 *  1. ÂNCORA NO BEM — só procura DEPOIS de "descrição do imóvel", "do imóvel:", "matrícula nº"
 *     ou "imóvel objeto". O cabeçalho, onde mora o endereço do leiloeiro e o da vara, fica fora
 *     da janela por construção.
 *
 *  2. NÃO PODE ESTAR NO CABEÇALHO — se o mesmo logradouro também aparece antes da primeira
 *     âncora, é do documento e não do bem. Foi exatamente o caso da "Avenida Fagundes Filho",
 *     que aparecia no topo de todos os seis editais.
 *
 *  3. TEM DE CASAR COM A CIDADE QUE O ACERVO JÁ CONHECE — a cidade do lote precisa aparecer na
 *     janela do bem. Um imóvel em Santos cujo trecho só fala de São Paulo não teve o endereço
 *     lido: teve o endereço de outro lote do mesmo edital (edital com vários bens é a regra,
 *     não a exceção).
 *
 * Sem cidade no acervo, devolve null: não há como aplicar a guarda 3, e endereço sem validação
 * é o que este módulo existe para não gravar. Melhor sem endereço que com endereço de outro.
 */
const RE_ANCORA_BEM = /descri[çc][ãa]o\s+do\s+(?:im[óo]vel|bem|lote)|do\s+im[óo]vel\s*:|im[óo]vel\s+objeto|matr[íi]cula\s*n?[º°]?\s*[\d.]{2,}/i;
const RE_LOGRADOURO = /\b((?:Rua|Avenida|Av\.|Travessa|Alameda|Rodovia|Estrada|Pra[çc]a)\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9'.\- ]{2,48}?)(?=\s*[,;.\n]|\s+n[º°]|\s+\d)/;

/**
 * ⚠️ DEVOLVE O MOTIVO DA RECUSA, e isso não é conforto: a 1ª medição das guardas deu
 * **0 de 31**. Zero falso positivo e zero cobertura — e sem saber QUAL guarda barrou, o
 * próximo passo seria afrouxar no escuro. Cada recusa tem nome, e a validação conta por nome.
 */
export function extrairEnderecoDoBem(texto, { cidade } = {}) {
  const nao = (motivo) => ({ logradouro: null, bairro: null, motivo });
  const t = String(texto || '').replace(/\s+/g, ' ');
  const cid = String(cidade || '').trim();
  if (t.length < 200) return nao('texto_curto');
  if (cid.length < 3) return nao('sem_cidade_no_acervo');   // guarda 3 fica sem referência

  const m = RE_ANCORA_BEM.exec(t);
  if (!m) return nao('sem_ancora_do_bem');
  const cabecalho = t.slice(0, m.index);                   // tudo antes da 1ª âncora
  const janela = t.slice(m.index, m.index + 1400);         // o trecho que descreve o bem

  // Guarda 3: a cidade do acervo tem de estar na janela do bem. Comparação sem acento e sem
  // caixa — edital escreve "SAO PAULO", o acervo guarda "São Paulo".
  const norm = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!norm(janela).includes(norm(cid))) return nao('cidade_fora_da_janela');

  const lg = RE_LOGRADOURO.exec(janela);
  if (!lg) return nao('sem_logradouro_na_janela');
  const logradouro = lg[1].replace(/\s+/g, ' ').trim();
  if (logradouro.length < 8) return nao('logradouro_curto');

  // Guarda 2: se o mesmo logradouro está no cabeçalho, é do documento — não do bem.
  if (norm(cabecalho).includes(norm(logradouro))) return nao('logradouro_no_cabecalho');

  const bai = janela.match(/bairro\s+(?:d[eoa]s?\s+)?([A-Za-zÀ-ÿ'’ -]{3,40}?)\s*(?:[,.;]|\bna\b|\bem\b|\bcidade\b|$)/i);
  return { logradouro: logradouro.slice(0, 200), bairro: bai ? bai[1].trim().slice(0, 60) : null, motivo: null };
}

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

    // ENDEREÇO ANCORADO — APROVADO PELA MEDIÇÃO (29/08) e agora gravado.
    //
    //   4 de 31 lidos (13%) · 4 logradouros DISTINTOS · REPETIDOS: nenhum
    //   GRUPOLANCE/Mairiporã → Rua Canela e Rua Cajarana · WEBLEILOES/Jundiaí → Rua Pará ·
    //   WEBLEILOES/Bauru → Av. José Vicente Aiello · WEBLEILOES/São Vicente → Rua Frei Gaspar
    //
    // Cobertura BAIXA e precisão ALTA — e é essa a troca certa aqui. A 1ª tentativa teve 96% de
    // cobertura com o mesmo logradouro em 6 lotes distintos: cobertura alta é o SINTOMA de
    // estar lendo o cabeçalho, não um mérito. Endereço errado move o pino do mapa e o cliente
    // descobre no dia da visita; endereço ausente só deixa a ficha como já estava.
    //
    // As recusas confirmam que as guardas estão trabalhando, não travando à toa:
    // `cidade_fora_da_janela` 19 (edital de vários bens — o trecho lido descreve OUTRO lote),
    // `sem_ancora_do_bem` 7, `sem_logradouro_na_janela` 1.
    const enderecoBem = extrairEnderecoDoBem(texto, { cidade: atual.cidade });
    // SÓ COMPLEMENTA: nunca sobrescreve o que a coleta trouxe. A coleta vem da página do lote,
    // que é a fonte mais direta; o documento entra onde ela não chegou.
    if (enderecoBem?.logradouro && !String(atual.endereco || '').trim()) {
      patch.endereco = enderecoBem.logradouro;
    }
    if (enderecoBem?.bairro && !String(atual.bairro || '').trim()) {
      patch.bairro = enderecoBem.bairro;
    }

    // ⚠️ A DESCRIÇÃO CONTINUA FORA. O trecho inicial do edital é cabeçalho jurídico (comarca,
    // processo, partes), não descrição do bem — e a ficha do cliente já mostra o título da
    // coleta, que é mais limpo. Voltaria só com âncora própria, e o ganho não paga o risco.

    return { lido: true, achou: Object.keys(patch).length > 0, tipo: a.tipo, patch, enderecoBem, motivo: null };
  }
  return vazio(ultimoMotivo);
}
