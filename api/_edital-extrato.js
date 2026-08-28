/**
 * EXTRATO DO EDITAL (determinístico, custo zero) — praças (nº, valor, data), forma de
 * pagamento e avaliação, lidos do edital/regras do LOTE para o relatório MERCADOLÓGICO
 * usar o DOCUMENTO como fonte de verdade da melhor praça e das condições (pedido do
 * dono 30/07). Sem IA e sem Bright Data: fetch direto + pdf-parse + regex. PDF
 * escaneado (sem camada de texto) não é lido aqui — fica para o laudo documental
 * (leitura por visão). Best-effort por contrato: QUALQUER falha devolve null e o
 * relatório segue exatamente como antes.
 */
import { hostExternoSeguro, fetchExternoSeguro } from './_allowed-hosts.js';
import { carregarPDFParse } from './_pdf-safe.js';
import { extrairDatasLeilao } from './enriquecer-lote.js';
import { cacheLer, cacheGravar, chaveUrl, chaveConteudo, extrairMatriculaTexto, extrairPagamentoTexto, extrairCustosTexto, extrairIdentidadeTexto, extrairNumeroProcessoTexto } from './_doc-extracao.js';
import { anthropicFetch } from './_claude.js';
import { classificarDocumento, blocoParaIA, temTextoUtil } from './_doc-leitura.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * PUBLICA NA FICHA DO IMÓVEL o que a leitura do documento apurou (pedido do dono, 06/08:
 * "que também apareça na tela do imóvel — isso gera mais credibilidade"). Fica aqui, e não
 * no chamador, porque TODO caminho que lê edital/matrícula passa por este módulo: o
 * mercadológico, o laudo e qualquer rotina futura enriquecem a ficha só de rodar.
 *
 * `registrar_doc_fatos` faz MERGE atômico por chave de topo — a leitura da matrícula não
 * apaga o que o edital apurou, e duas gerações simultâneas do mesmo lote não se atropelam.
 * Best-effort por contrato: falhar aqui nunca afeta o relatório em curso.
 */
async function publicarDocFatos(imovelId, fatos) {
  if (!SUPABASE_URL || !SERVICE_KEY || !imovelId || !fatos) return;
  const uteis = Object.fromEntries(Object.entries(fatos).filter(([, v]) => v && (typeof v !== 'object' || Object.values(v).some((x) => x !== null && x !== ''))));
  if (!Object.keys(uteis).length) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_doc_fatos`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ p_imovel_id: String(imovelId), p_fatos: { ...uteis, em: new Date().toISOString() } }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* enriquecer a ficha nunca bloqueia a geração */ }
}

const parseValor = (s) => {
  const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) && v >= 1000 && v < 100000000 ? v : 0;
};

// Extrai praças/pagamento/avaliação de TEXTO plano (PDF com camada de texto ou HTML).
// Exportada para teste isolado (scripts) e reuso.
export function extrairCondicoes(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 300) return null;
  const out = { pracas: [], formaPagamento: '', avaliacao: 0 };
  // Avaliação: maior valor ANCORADO na palavra (não pega débito/lance solto).
  for (const m of t.matchAll(/avalia[çc][ãa]o[^R$\d]{0,40}R?\$?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/gi)) {
    const v = parseValor(m[1]);
    if (v > out.avaliacao) out.avaliacao = v;
  }
  // Praças/leilões: nº + data/valor na JANELA logo após a menção — janela FIXA de 240
  // chars cortada na próxima menção de praça (lookahead lazy falhava quando a última
  // praça ia até o fim do texto). 1ª ocorrência de cada nº vence.
  //
  // ⚠️ TODAS AS DATAS DA JANELA, NÃO A PRIMEIRA (28/08). Era `jan.match(/dd\/mm\/aaaa/)`,
  // que devolve a PRIMEIRA — e o edital publica um INTERVALO por praça: "o 2º Leilão terá
  // início no dia 20/08/2026 às 14:31 e se encerrará no dia 10/09/2026 às 14:30". A primeira
  // data é sempre o INÍCIO, e o início é justamente a data que NÃO responde a pergunta que o
  // sistema inteiro faz ("ainda dá para dar lance?"). No lote de Guarulhos isso gravou 20/08
  // como prazo de uma praça aberta até 10/09: o gate recusou o relatório, o cron desativou o
  // lote, e o cliente viu "leilão encerrado" faltando 13 dias de pregão.
  //
  // `data` continua sendo o INÍCIO (é o que a ficha mostra como "data da praça") e `fim`
  // passa a carregar o encerramento. Separados de propósito: são duas perguntas diferentes,
  // e foi juntá-las num campo só que produziu o defeito.
  const vistos = new Set();
  const reMencao = /([12])\s*[ºªo°.]{0,2}\s*(?:leil[ãa]o|pra[çc]a|hasta)/gi;
  let m;
  while ((m = reMencao.exec(t))) {
    const n = Number(m[1]);
    if (vistos.has(n)) continue;
    let jan = t.slice(m.index + m[0].length, m.index + m[0].length + 240);
    const prox = jan.search(/[12]\s*[ºªo°.]{0,2}\s*(?:leil[ãa]o|pra[çc]a|hasta)/i);
    if (prox > 0) jan = jan.slice(0, prox);
    const datas = [...jan.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(d => `${d[3]}-${d[2]}-${d[1]}`);
    const data = datas[0] || null;
    // Só chama de "fim" o que o texto ANCORA como encerramento. Duas datas soltas na janela
    // podem ser outra coisa (data de publicação, prazo de pagamento); inventar um prazo maior
    // do que o edital dá é pior que não ter prazo nenhum — mantém no ar um lote já encerrado.
    const ancoraFim = /(encerrar|encerramento|t[ée]rmino|terminar|at[ée]\s+o?\s*dia)/i.test(jan);
    const fim = (datas.length > 1 && ancoraFim && datas[datas.length - 1] > data)
      ? datas[datas.length - 1] : null;
    const vm = jan.match(/R\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/);
    let valor = vm ? parseValor(vm[1]) : 0;
    // PERCENTUAL DECLARADO VENCE O R$ SOLTO (28/08). O edital diz a REGRA — "lances com no
    // mínimo 60% (sessenta por cento) do valor da avaliação" — e é ela que define o lance
    // mínimo da praça. O primeiro "R$" da janela pode ser qualquer coisa (débito, avaliação
    // de outro lote): no lote de Guarulhos entrou R$ 136.999,99, que é 60% de R$ 228.333,33,
    // um valor que não é a avaliação deste imóvel (R$ 267.052,71). Como o preço do site é
    // `least()` entre as praças, um valor errado PARA BAIXO sempre vira a manchete — o erro
    // é enviesado para aparecer.
    const pm = jan.match(/(\d{1,3})\s*%[^.;]{0,40}?d[oae]s?\s+(?:valor\s+d[ae]\s+)?avalia[çc][ãa]o/i);
    const pct = pm ? Number(pm[1]) : 0;
    if (pct > 0 && pct <= 100 && out.avaliacao > 0) {
      const doPercentual = Math.round(out.avaliacao * pct) / 100;
      // Diverge do R$ lido em mais de 2%? A regra do edital manda — ela é texto normativo,
      // o R$ é um número solto que pode pertencer a outra frase.
      if (!(valor > 0) || Math.abs(valor - doPercentual) / doPercentual > 0.02) valor = doPercentual;
    }
    if (valor > 0 || data) { vistos.add(n); out.pracas.push({ n, valor, data, fim }); }
  }
  out.pracas.sort((a, b) => a.n - b.n);
  // Forma de pagamento: FRASES ORIGINAIS do edital com termos de condição (fiel, sem
  // IA) — o parecer e o front citam o texto, nunca uma paráfrase.
  const reKw = /(à\s*vista|a\s*vista|parcelad|parcelas?\b|sinal\b|entrada\s+de|cau[çc][ãa]o|fgts|financiament|itbi|comiss[ãa]o\s+d[oe]\s+leiloeiro|comiss[ãa]o\s+de\s+\d|carta\s+de\s+arremata|prazo\s+de\s+pagamento)/i;
  const frases = [];
  for (const fr of t.split(/(?<=[.;])\s+/)) {
    if (frases.length >= 4) break;
    const s = fr.trim();
    if (s.length >= 25 && s.length <= 400 && reKw.test(s)) frases.push(s.slice(0, 240));
  }
  out.formaPagamento = frases.join(' ').slice(0, 800);
  if (!out.pracas.length && !out.formaPagamento && !(out.avaliacao > 0)) return null;
  return out;
}

// Baixa e devolve o TEXTO de um candidato (PDF → pdf-parse; HTML → sem tags), ou null.
export async function lerTexto(url, deadline) {
  if (!hostExternoSeguro(url)) return null;
  const budget = deadline - Date.now();
  if (budget < 3000) return null;
  try {
    const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(Math.min(12000, budget - 500)) });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 12_000_000) return null;
    // O tipo vem do CONTEÚDO, não da URL — ~2.100 matrículas do acervo são servidas por
    // endpoint de API sem extensão nenhuma. E o que não é texto de verdade volta `null`
    // em vez de virar uma tira de bytes com cara de documento lido (ver `_doc-leitura.js`).
    const doc = classificarDocumento(buf, { url, contentType: ct, maxBytes: 12_000_000, semBase64: true });
    if (doc.kind === 'pdf') {
      const PDFParse = await carregarPDFParse();
      const parser = new PDFParse({ data: buf });
      try {
        const res = await parser.getText();
        return String(res?.text || '').slice(0, 120000);
      } finally { await parser.destroy().catch(() => {}); }
    }
    if (doc.kind === 'texto') return doc.texto.slice(0, 120000);
    return null; // imagem/desconhecido: quem resolve é a visão, não o parser de texto
  } catch { return null; }
}

/**
 * PDFs LINKADOS DENTRO DA PÁGINA DO LOTE (15/08, pedido do dono: "resolva o edital em HTML").
 *
 * O `link_edital` de 5.601 lotes ativos aponta para a PÁGINA do lote, não para o PDF —
 * SUPERBID (1.514), PESTANA (1.029), MEGA (659), ZUK (510), GRUPOLANCE (478), BIASI (458)
 * e mais. Essas páginas eram excluídas dos candidatos de propósito ("o valor não está no
 * HTML cru"), o que é verdade para o VALOR mas jogou fora o resto: o edital em PDF quase
 * sempre está LINKADO ali dentro. Foi por esse caminho que a condição de pagamento do lote
 * de Morada dos Pinheiros se perdeu — `condicoesEdital: null` num lote cujo edital existe.
 *
 * Genérico de propósito: nada de regra por leiloeiro. Baixa a página, colhe os `href` que
 * terminam em .pdf (resolvendo relativo contra a base) e ORDENA por quão provável é ser o
 * edital — href/texto com "edital" primeiro, depois "regras/condições", depois o resto.
 * Devolve no máximo 3, porque o chamador tem orçamento de tempo.
 */
async function pdfsNaPagina(url, fim) {
  if (!hostExternoSeguro(url) || fim - Date.now() < 4000) return [];
  let html = '';
  try {
    const r = await fetchExternoSeguro(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(Math.min(12000, fim - Date.now() - 1500)),
    });
    if (!r.ok) return [];
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 8_000_000) return [];
    // Se a própria URL já devolveu um PDF (servidor sem extensão no caminho), não há
    // página para varrer — quem trata isso é o `lerTexto`, que classifica por conteúdo.
    if (buf.slice(0, 5).toString('latin1') === '%PDF-') return [];
    html = buf.toString('utf8');
  } catch { return []; }
  const achados = new Map(); // url → pontuação
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && achados.size < 24) {
    let href = m[1];
    try { href = new URL(href, url).href; } catch { continue; }
    if (!/^https?:\/\//i.test(href) || !hostExternoSeguro(href)) continue;
    const contexto = `${href} ${String(m[2] || '').replace(/<[^>]+>/g, ' ')}`.toLowerCase();
    // Peso pelo que o link diz ser. `matricula` entra NEGATIVO: é documento útil, mas
    // quem o procura é o `extratoMatricula` — aqui ele só tomaria a vaga do edital.
    let peso = 0;
    if (/edital/.test(contexto)) peso += 10;
    if (/regras|condi[çc]|venda\s*online|leil[ãa]o/.test(contexto)) peso += 5;
    if (/matr[íi]cula|certid|laudo|foto/.test(contexto)) peso -= 8;
    achados.set(href, Math.max(achados.get(href) ?? -99, peso));
  }
  return [...achados.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u]) => u);
}

/**
 * Lê o edital/regras do lote e devolve { pracas, formaPagamento, avaliacao, pagamento, custos,
 * identidade, datas, fonteUrl, pertenceAoLote } ou null. `pertenceAoLote:false` = o documento lido NÃO bate com os
 * valores do lote (edital de outro lote anexado por engano) — o chamador descarta e
 * registra anomalia; dado errado com selo de "confirmado no edital" é pior que ausente.
 *
 * `datas` = { inicio, fim } lidos do TEXTO do edital com âncora estrita. É a rede de
 * segurança pedida pelo dono em 03/08: há lote cujo LEILOEIRO não publica data na página
 * (ex.: `vegas_7588`) mas cujo edital publica. Enquanto ninguém pede relatório, ficamos de
 * acordo com o leiloeiro (sem data); ao gerar o relatório, o edital preenche a lacuna.
 */
/**
 * Grava o nº do processo no lote e o inscreve no monitor do CNJ — best-effort, custo zero.
 *
 * NÃO SOBRESCREVE o que já existe: o número vindo do scraper ou lido pela IA do documental
 * tem procedência melhor que um regex sobre o PDF inteiro. Aqui a regra é preencher buraco.
 *
 * O `on_conflict` no monitor é o que permite chamar isto a cada leitura de edital sem
 * duplicar inscrição — e sem ele o mesmo processo entraria uma vez por lote do mesmo leilão.
 */
async function gravarProcessoDoLote(imovelId, numero) {
  try {
    const sel = await fetch(
      `${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=numero_processo,estado,modalidade&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!sel.ok) return;                                    // `.ok` ANTES do corpo
    const [im] = await sel.json();
    if (!im || String(im.numero_processo || '').trim()) return;
    const up = await fetch(`${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ numero_processo: numero }),
    });
    // `return=representation` de propósito: um PATCH que a RLS filtra devolve 200 com lista
    // VAZIA e nenhum erro. Sem olhar o que voltou, "gravei" seria uma suposição.
    const linhas = up.ok ? await up.json().catch(() => []) : [];
    if (!Array.isArray(linhas) || !linhas.length) {
      console.error('[edital-processo] NÃO gravado', JSON.stringify({ imovel: String(imovelId), http: up.status }));
      return;
    }
    await fetch(`${SUPABASE_URL}/rest/v1/processos_monitorados?on_conflict=numero_processo`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ numero_processo: numero, uf: im.estado || null, imovel_id: String(imovelId), rotulo: `Lote ${imovelId}`, ativo: true }),
    });
    console.log('[edital-processo]', JSON.stringify({ imovel: String(imovelId), processo: numero, monitorado: true }));
  } catch (e) {
    console.error('[edital-processo] exceção', String(e?.message || e).slice(0, 120));
  }
}

/**
 * EDITAL POR VISÃO — o caminho que a matrícula tinha e o edital não (17/08).
 *
 * POR QUE EXISTE. `doc_extracoes` tinha 18 linhas de matrícula (via 'visao', confiança 85) e
 * **ZERO de edital**, em toda a história do sistema. Não era azar: a matrícula tem
 * `matriculaPorVisao` e o edital só tinha o caminho de TEXTO. Edital de leiloeiro é quase
 * sempre PDF ESCANEADO — sem texto embutido, `lerTexto` volta vazio, o laço faz `continue` e
 * a leitura morre calada. O cliente então lê na ficha "consulte o documento no site", que é
 * verdade, mas por um motivo que ninguém enxergava.
 *
 * O CASO QUE ESCANCAROU (lote J126858, Sorocaba). Nosso acervo dizia "Apartamento 45 m²",
 * `descricao` era só o título repetido, sem endereço nem bairro, e a praça saiu como única —
 * enquanto a própria linha dizia "2 Praças" e o dono, lendo a descrição no site do leiloeiro,
 * viu uma CASA de ~200 m² construídos. Tudo o que faltava estava no edital, que nunca foi
 * aberto.
 *
 * CUSTO — por que sob demanda é seguro. `extratoEdital` tem UM chamador: `gerar-analise.js`,
 * a geração de relatório. Nenhum cron o invoca. Então a visão só roda quando um cliente pede
 * um relatório daquele lote — o gasto é proporcional à receita, e não há varredura de acervo.
 * NÃO chame esta função de cron sem antes rediscutir orçamento: são 13.939 lotes com edital.
 *
 * `max_tokens` é maior que o da matrícula porque aqui se pede a descrição do imóvel e as
 * praças, não um punhado de números.
 */
async function editalPorVisao(url, imovelId, fim) {
  const diag = (motivo, extra = {}) => console.log('[edital-visao]', JSON.stringify({ imovel: String(imovelId), motivo, ...extra }));
  // Toda desistência REGISTRADA — foi a ausência disso que deixou o edital não-lido invisível
  // por meses. `CLAUDE_KEY` é o nome usado no projeto inteiro; ver a nota em matriculaPorVisao
  // sobre a versão que leu `CLAUDE_API_KEY` e nunca rodou.
  if (!process.env.CLAUDE_KEY) { diag('sem CLAUDE_KEY'); return null; }
  if (!hostExternoSeguro(url)) { diag('host bloqueado', { url }); return null; }
  const sobra = fim - Date.now();
  if (sobra < 15000) { diag('sem tempo hábil', { sobraMs: sobra }); return null; }
  let bloco = null;
  try {
    const r = await fetchExternoSeguro(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(Math.min(15000, fim - Date.now() - 5000)),
    });
    if (!r.ok) { diag('download falhou', { http: r.status }); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    const doc = classificarDocumento(buf, { url, contentType: r.headers.get('content-type') || '' });
    bloco = blocoParaIA(doc, 'edital');
    if (!bloco) { diag('formato não legível', { kind: doc.kind, detalhe: doc.motivo || null }); return null; }
  } catch (e) { diag('erro no download', { erro: String(e?.message || e).slice(0, 120) }); return null; }
  try {
    const resp = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': process.env.CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 900,
        system: 'Você é um EXTRATOR de dados de edital de leilão de imóvel. Leia com máxima atenção, INCLUSIVE páginas escaneadas/em imagem. Retorne SOMENTE JSON.',
        messages: [{ role: 'user', content: [
          bloco,
          { type: 'text', text: 'Extraia do edital, SOBRE O IMÓVEL DESTE LOTE:\n'
            + '• "descricaoImovel": a descrição do bem como o edital a redige (texto corrido, até 600 caracteres). É o campo mais importante.\n'
            + '• "tipoImovel": um de casa, apartamento, terreno, comercial, rural, galpao, outro.\n'
            + '• "areaConstruidaM2": área construída/edificada/privativa, em m². NÃO é a do terreno.\n'
            + '• "areaTerrenoM2": área do terreno/lote, em m².\n'
            + '• "enderecoCompleto": logradouro, número, bairro, cidade/UF, se constarem.\n'
            // A PRAÇA É UM INTERVALO (28/08). O prompt pedia uma "data" por praça e não dizia
            // QUAL — e o edital publica duas ("terá início no dia 20/08 e se encerrará no dia
            // 10/09"). Um modelo melhor não resolvia isso: não havia onde escrever a resposta,
            // e a data que ele devolvia era a que qualquer leitor chamaria de "a data do 2º
            // leilão" — o início, justamente a que não responde "ainda dá para dar lance?".
            + '• "pracas": lista das praças/leilões, cada uma {"ordem":1,"inicio":"AAAA-MM-DD","fim":"AAAA-MM-DD","hora":"HH:MM","valor":0}.\n'
            + '  - "inicio": quando a praça ABRE para lances. "fim": quando ela SE ENCERRA (a data-limite para dar lance).\n'
            + '  - O edital costuma dizer as duas na mesma frase ("terá início no dia X e se encerrará no dia Y"). Nesse caso preencha as duas.\n'
            + '  - Se o edital der uma data só para a praça, ponha em "inicio" e deixe "fim" vazio. NÃO deduza o encerramento.\n'
            + '  - "valor": o lance mínimo da praça. Se o edital der uma REGRA em vez de um número ("no mínimo 60% do valor da avaliação"), calcule sobre a avaliação DESTE lote.\n'
            + '  - Se houver 2ª praça, INCLUA as duas.\n'
            + 'NÃO invente: campo que o edital não afirma vai "" (texto), 0 (número) ou [] (lista). Use ponto decimal.\n'
            + 'Retorne SOMENTE: {"descricaoImovel":"","tipoImovel":"","areaConstruidaM2":0,"areaTerrenoM2":0,"enderecoCompleto":"","pracas":[]}' },
        ] }],
      }),
    }, { retries: 1, timeoutMs: Math.max(15000, Math.min(60000, fim - Date.now())), noFallback: true });
    if (!resp.ok) { diag('IA respondeu erro', { http: resp.status }); return null; } // `.ok` ANTES do corpo
    const data = await resp.json().catch(() => null);
    const texto = (data?.content || []).map((b) => b?.text || '').join('').trim();
    const bruto = texto.match(/\{[\s\S]*\}/);
    if (!bruto) { diag('resposta sem JSON', { amostra: texto.slice(0, 80) }); return null; }
    const j = JSON.parse(bruto[0]);
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 1000000 ? n : null; };
    // `data` aceita o nome antigo por compatibilidade com resposta que ainda venha no formato
    // anterior; `inicio` é o campo pedido hoje. `fim` só é aceito se for DEPOIS do início —
    // encerramento anterior à abertura é leitura errada, e gravá-lo daria o lote por vencido.
    const pracas = Array.isArray(j.pracas) ? j.pracas
      .map((p) => {
        const inicio = String(p?.inicio || p?.data || '').slice(0, 10) || null;
        const bruto = String(p?.fim || '').slice(0, 10) || null;
        return {
          ordem: Number(p?.ordem) || null,
          data: inicio,
          fim: (bruto && inicio && bruto > inicio) ? bruto : null,
          hora: String(p?.hora || '').slice(0, 5) || null,
          valor: num(p?.valor),
        };
      })
      .filter((p) => p.data || p.valor) : [];
    const out = {
      descricaoImovel: String(j.descricaoImovel || '').slice(0, 600) || null,
      tipoImovel: String(j.tipoImovel || '').toLowerCase().slice(0, 20) || null,
      areaConstruidaM2: num(j.areaConstruidaM2),
      areaTerrenoM2: num(j.areaTerrenoM2),
      enderecoCompleto: String(j.enderecoCompleto || '').slice(0, 240) || null,
      pracas,
    };
    // VAZIO NÃO É LEITURA. Se nada de substantivo veio, isto é uma falha — não um edital sem
    // conteúdo. Registrar `null` aqui evita gravar um "li e não achei nada" que o chamador
    // trataria como fato.
    if (!out.descricaoImovel && !out.areaConstruidaM2 && !out.areaTerrenoM2 && !pracas.length) {
      diag('IA não achou nada de substantivo'); return null;
    }
    diag('ok', { area: out.areaConstruidaM2, tipo: out.tipoImovel, pracas: pracas.length });
    return { ...out, fonteUrl: url, via: 'visao' };
  } catch (e) { diag('erro na IA', { erro: String(e?.message || e).slice(0, 120) }); return null; }
}

export async function extratoEdital(imovelId, { deadline } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const fim = Number(deadline) || (Date.now() + 45000);
  let im = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=link_edital,link_regras_venda,anexos,valor_minimo,valor_avaliacao&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    [im] = await r.json();
  } catch { return null; }
  if (!im) return null;
  const anexos = Array.isArray(im.anexos) ? im.anexos : [];
  const ehPdfUrl = (u) => /\.pdf(\?|#|$)/i.test(u || '');
  // Candidatos do mais provável ao menos: edital-PDF dos anexos → link_edital-arquivo →
  // regras-PDF → edital sem extensão. Página SPA do lote fica de fora (valor não está
  // no HTML cru — comprovado no garantirValores).
  const cands = [...new Set([
    ...anexos.filter(a => a?.tipo === 'edital' && ehPdfUrl(a.url)).map(a => a.url),
    ehPdfUrl(im.link_edital) ? im.link_edital : null,
    ...anexos.filter(a => a?.tipo === 'regras' && ehPdfUrl(a.url)).map(a => a.url),
    ...anexos.filter(a => a?.tipo === 'edital' && !ehPdfUrl(a.url)).map(a => a.url),
  ].filter(u => u && /^https?:\/\//i.test(u)))].slice(0, 3);
  // EDITAL ATRÁS DA PÁGINA DO LOTE (15/08). Quando nenhum candidato é PDF, o `link_edital`
  // é a página do lote — e o edital costuma estar LINKADO nela. 5.601 lotes ativos estão
  // nessa situação. Só entra quando não há PDF direto: a página custa um download a mais e
  // não deve competir com o documento que já temos em mãos.
  if (!cands.some(ehPdfUrl)) {
    const paginas = [im.link_edital, ...anexos.filter(a => a?.tipo === 'edital').map(a => a.url)]
      .filter(u => u && /^https?:\/\//i.test(u) && !ehPdfUrl(u));
    for (const pag of paginas.slice(0, 2)) {
      if (Date.now() > fim) break;
      const achados = await pdfsNaPagina(pag, fim);
      if (achados.length) {
        console.log('[edital-html]', JSON.stringify({ imovel: String(imovelId), pagina: pag.slice(0, 110), pdfs: achados.length }));
        for (const u of achados) if (!cands.includes(u)) cands.push(u);
        break;
      }
    }
  }
  for (const url of cands) {
    if (Date.now() > fim) break;
    // CACHE-FIRST por URL canônica (querystring de signed URL fora): outro relatório
    // — ou a regeneração deste — já leu este edital → pula download+parse inteiros.
    // Só os FATOS do documento vêm do cache; `pertenceAoLote` é POR LOTE (o mesmo
    // edital cobre vários) e é sempre recalculado abaixo contra os valores DESTE lote.
    let cond = null, datas = null, pagamento = null, custos = null, identidade = null, processo = null, deCache = false, pracasVisao = null;
    const hit = await cacheLer(chaveUrl(url));
    if (hit?.campos?.condicoes) {
      cond = hit.campos.condicoes; datas = hit.campos.datas || null;
      pagamento = hit.campos.pagamento || null; deCache = true;
      custos = hit.campos.custos || null; identidade = hit.campos.identidade || null;
      processo = hit.campos.processo || null;
    } else {
      const txt = await lerTexto(url, fim);
      // PDF ESCANEADO NÃO É EDITAL AUSENTE (17/08). Sem texto embutido, `lerTexto` volta vazio
      // e este laço fazia `continue` — descartando o documento sem registrar nada. Era a razão
      // de `doc_extracoes` não ter UMA linha de edital em toda a história, enquanto a matrícula
      // tinha 18 pela via de visão. Agora o edital ganha a mesma segunda chance.
      if (!txt) {
        const vis = await editalPorVisao(url, imovelId, fim);
        if (!vis) continue;
        identidade = {
          ...(vis.enderecoCompleto ? { endereco: vis.enderecoCompleto } : {}),
          ...(vis.descricaoImovel ? { descricao: vis.descricaoImovel } : {}),
          ...(vis.tipoImovel ? { tipo: vis.tipoImovel } : {}),
          ...(vis.areaConstruidaM2 ? { areaConstruidaM2: vis.areaConstruidaM2 } : {}),
          ...(vis.areaTerrenoM2 ? { areaTerrenoM2: vis.areaTerrenoM2 } : {}),
        };
        if (vis.pracas?.length) {
          const comData = vis.pracas.filter((p) => p.data).sort((a, b) => String(a.data).localeCompare(String(b.data)));
          if (comData.length) datas = { inicio: comData[0].data, fim: comData[comData.length - 1].data, pracas: vis.pracas };
          else datas = { pracas: vis.pracas };
        }
        // AS PRAÇAS DA VISÃO PRECISAM CHEGAR NO FORMATO QUE O CHAMADOR LÊ. `extrairCondicoes`
        // devolve {n, valor, data}; a visão devolve {ordem, data, hora, valor}. Sem esta
        // normalização o dado era extraído, gravado no cache e DESCARTADO na hora de usar —
        // e `gerar-analise.js:2238` fazia `.find()` sobre `undefined`, derrubando o relatório
        // inteiro (erro real em 17/08: "Cannot read properties of undefined (reading 'find')"
        // no lote de Copacabana, cujo edital escaneado tinha 2ª praça em 18/08 por R$ 505.173,65).
        // `fim` entra aqui junto (28/08): o caminho de VISÃO lê o mesmo edital escaneado e
        // passou a devolver o encerramento. Esquecer de normalizá-lo faria o lote com edital
        // em imagem continuar sem prazo real — o defeito consertado só no caminho de texto.
        pracasVisao = (vis.pracas || [])
          .map((p) => ({ n: Number(p.ordem) || null, valor: Number(p.valor) || 0, data: p.data || null, fim: p.fim || null }))
          .filter((p) => p.n && (p.valor > 0 || p.data));
        const metaVis = { url, imovelId, tipoDoc: 'edital', campos: { identidade, ...(datas ? { datas } : {}), ...(pracasVisao.length ? { pracasVisao } : {}) }, via: 'visao', confianca: 80 };
        await cacheGravar(chaveUrl(url), metaVis);
        // `cond` segue null de propósito: condições de arremate NÃO foram lidas, e fabricá-las
        // para "completar o registro" seria exatamente o defeito que este arquivo combate.
      } else {
      cond = extrairCondicoes(txt);
      if (!cond) continue;
      // Datas do ATO (início/encerramento) direto do texto — só têm valor quando as
      // praças não trouxeram data; vão à parte, sem interferir no que já existia.
      try { const d = extrairDatasLeilao(txt, { estrito: true }); if (d.inicio || d.fim) datas = d; } catch { /* best-effort */ }
      // Pagamento ESTRUTURADO (fluxo de caixa) e metragem que o EDITAL às vezes traz —
      // grátis, no mesmo texto já baixado. Grava no cache pelas DUAS chaves: URL
      // (lookup pré-download) e conteúdo (idempotência entre URLs do mesmo PDF).
      pagamento = extrairPagamentoTexto(txt);
      // CUSTOS declarados (taxa administrativa, IPTU, condomínio — comissão vem no
      // `pagamento`) e IDENTIDADE (condomínio/logradouro/bairro). Os custos entram na
      // PROJEÇÃO; a identidade ancora a BUSCA e a classificação de tipo/padrão.
      custos = extrairCustosTexto(txt);
      identidade = extrairIdentidadeTexto(txt);
      // NÚMERO DO PROCESSO (CNJ) — grátis, no texto que já está em mãos. É a chave que abre a
      // consulta de movimentação e responde "este processo anda rápido?". Até 15/08 só a IA do
      // relatório documental o lia, e por isso 1.782 lotes judiciais tinham 3 números.
      processo = extrairNumeroProcessoTexto(txt);
      const mat = extrairMatriculaTexto(txt);
      const campos = { condicoes: cond, datas, pagamento, custos, identidade, ...(processo ? { processo } : {}), ...(mat ? { matricula: mat } : {}) };
      const meta = { url, imovelId, tipoDoc: 'edital', campos, via: 'regex', confianca: 60 };
      await cacheGravar(chaveUrl(url), meta);
      await cacheGravar(chaveConteudo(txt), meta);
      }
    }
    const vmin = Number(im.valor_minimo) || 0;
    const aval = Number(im.valor_avaliacao) || 0;
    let pertence = true;
    // `cond` é NULL no caminho de visão (o edital escaneado deu identidade/praças, mas as
    // condições de arremate não foram lidas). Sem esta guarda, `cond.pracas` estouraria — e o
    // catch do chamador transformaria a leitura bem-sucedida em "sem edital", reintroduzindo
    // pela porta dos fundos o silêncio que esta mudança veio eliminar.
    if (vmin > 0 && cond?.pracas?.some(p => p.valor > 0)) {
      // Alguma praça do documento plausível vs o lance do lote (1ª praça ≈ avaliação
      // pode chegar a ~3,4x o lance da 2ª; abaixo de 0,3x ou acima disso = outro lote).
      pertence = cond.pracas.some(p => p.valor > 0 && p.valor >= vmin * 0.3 && p.valor <= vmin * 3.4);
    }
    if (pertence && aval > 0 && cond?.avaliacao > 0) {
      const razao = cond.avaliacao / aval;
      if (razao < 0.5 || razao > 2) pertence = false;
    }
    // Ficha do imóvel: só publica o que PERTENCE ao lote (edital de outro lote anexado por
    // engano vira anomalia no chamador e não pode virar "informação confirmada" na tela).
    if (pertence) {
      await publicarDocFatos(imovelId, { identidade, custos, pagamento, fonteEdital: url });
      // Só grava o processo do edital que PERTENCE a este lote. Edital de outro lote anexado
      // por engano gravaria o processo errado — e processo errado no monitor não erra alto:
      // devolve a movimentação de um feito alheio com toda a cara de certa.
      if (processo?.numeroProcesso) await gravarProcessoDoLote(imovelId, processo.numeroProcesso);
    }
    // `pracas` SEMPRE array: o chamador itera sem guarda, e no caminho de visão `cond` é null
    // de propósito. Vem depois do spread para não ser sobrescrito por um `cond` sem praças.
    return { ...(cond || {}), pracas: (cond?.pracas?.length ? cond.pracas : (pracasVisao || [])),
             pagamento, custos, identidade, datas, processo, fonteUrl: url,
             pertenceAoLote: pertence, deCache, condicoesLidas: !!cond };
  }
  return null;
}

/**
 * METRAGEM/Nº DA MATRÍCULA para o mercadológico — determinística e com cache, SEM
 * depender do laudo documental (que continua sendo quem lê matrícula escaneada por
 * visão). Casos documentados de divergência de metragem anúncio×matrícula pedem a
 * área REAL antes do R$/m². Candidatos: anexos tipo matrícula → link_matricula →
 * anexo do acervo (imovel_anexos). Best-effort: null nunca degrada o relatório.
 */
/**
 * ÚLTIMO DEGRAU DA CASCATA: metragem da matrícula por VISÃO (15/08).
 *
 * POR QUE EXISTE. O regex só enxerga PDF com camada de texto — matrícula escaneada, que é a
 * maioria, sai vazia e o mercadológico seguia com a área do ANÚNCIO, que costuma ser a do
 * terreno. Medido no acervo em 15/08: **28.355 lotes ativos com matrícula disponível e 5 com
 * a área lida**, e ZERO relatório com `metodologia.area.fonte = 'matricula'`. O caminho
 * "confirmar a metragem antes de pesquisar" existia desde 06/08 e nunca chegou a rodar.
 *
 * O caso que trouxe isto à tona (Morada dos Pinheiros): lote de 396 m² anunciado, casa de
 * 236 m² na matrícula. Sem leitura, o relatório usou 396, viu que os comparáveis não fechavam
 * e IMPRIMIU "cerca de 129 m² privativos" — que é `avaliação ÷ R$/m²`, uma conta, não uma
 * medida. Área derivada exibida em m² é lida como leitura de documento: é a forma clássica
 * deste projeto, resposta calculada entregue como informação.
 *
 * CUSTO × BENEFÍCIO. Uma chamada curta (só as três áreas + o número), `max_tokens: 300`, e
 * o resultado é gravado em `doc_extracoes` chaveado por IMÓVEL — paga-se UMA vez por lote e
 * o mercadológico, o documental e o laudo herdam. Confiança 85: acima do regex (60), abaixo
 * da visão completa do documental (90), que lê o conjunto dos documentos e continua mandando.
 * Só roda quando o grátis falhou E existe documento, respeitando a cascata do arquivo.
 */
async function matriculaPorVisao(url, imovelId, fim) {
  const diag = (motivo, extra = {}) => console.log('[matricula-visao]', JSON.stringify({ imovel: String(imovelId), motivo, ...extra }));
  // Toda desistência é REGISTRADA. A versão de 15/08 (manhã) saía calada em três pontos
  // distintos, e o efeito foi uma correção que não corrigia nada sem deixar rastro: o
  // relatório saiu com a área do anúncio e o log não tinha uma linha sobre o assunto.
  // `CLAUDE_KEY` é o nome usado no projeto inteiro (gerar-analise, gerar-documental). A
  // primeira versão desta função leu `CLAUDE_API_KEY`, que não existe em lugar nenhum: a
  // guarda batia SEMPRE, a função devolvia `null` na primeira linha e a leitura por visão
  // nunca rodou uma única vez em produção — com a aparência de "o documento não tem a área".
  // Um erro de nome de variável produzindo exatamente o defeito que a função vinha corrigir.
  if (!process.env.CLAUDE_KEY) { diag('sem CLAUDE_KEY'); return null; }
  if (!hostExternoSeguro(url)) { diag('host bloqueado', { url }); return null; }
  const sobra = fim - Date.now();
  if (sobra < 12000) { diag('sem tempo hábil', { sobraMs: sobra }); return null; }
  let bloco = null;
  try {
    const r = await fetchExternoSeguro(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(Math.min(15000, fim - Date.now() - 4000)),
    });
    if (!r.ok) { diag('download falhou', { http: r.status }); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    // Classificação pelo CONTEÚDO: serve PDF (inclusive escaneado) e matrícula fotografada
    // /digitalizada como JPEG ou PNG — a IA lê os dois. HTML de bloqueio e formato que não
    // dá para ler voltam `desconhecido` e param aqui, em vez de virar prompt sobre nada.
    const doc = classificarDocumento(buf, { url, contentType: r.headers.get('content-type') || '' });
    bloco = blocoParaIA(doc, 'matricula');
    if (!bloco) { diag('formato não legível', { kind: doc.kind, detalhe: doc.motivo || null }); return null; }
  } catch (e) { diag('erro no download', { erro: String(e?.message || e).slice(0, 120) }); return null; }
  try {
    const resp = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': process.env.CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 300,
        system: 'Você é um EXTRATOR de metragem de matrícula de imóvel. Leia com máxima atenção, INCLUSIVE páginas escaneadas/em imagem. Retorne SOMENTE JSON.',
        messages: [{ role: 'user', content: [
          bloco,
          { type: 'text', text: 'Extraia as metragens da DESCRIÇÃO DO IMÓVEL nesta matrícula.\n'
            + '• "areaPrivativaM2": área PRIVATIVA (apartamento/sala) ou CONSTRUÍDA/EDIFICADA (casa) — a área da EDIFICAÇÃO. NÃO é a do terreno/lote, NÃO é a área comum, NÃO é a fração ideal.\n'
            + '• "areaTerrenoM2": área do TERRENO/lote.\n'
            + '• "areaTotalM2": área TOTAL (privativa + comum), só se a matrícula disser "área total".\n'
            + '• "numeroMatricula": o número da matrícula.\n'
            + 'Se o imóvel for terreno sem construção, areaPrivativaM2 = 0. Use ponto decimal. NÃO invente: campo que a matrícula não afirma vai 0 (ou "" no número).\n'
            + 'Retorne SOMENTE: {"areaPrivativaM2":0,"areaTerrenoM2":0,"areaTotalM2":0,"numeroMatricula":""}' },
        ] }],
      }),
    }, { retries: 1, timeoutMs: Math.max(15000, Math.min(60000, fim - Date.now())), noFallback: true });
    if (!resp.ok) { diag('IA respondeu erro', { http: resp.status }); return null; } // `.ok` ANTES do corpo
    const data = await resp.json().catch(() => null);
    const texto = (data?.content || []).map((b) => b?.text || '').join('').trim();
    const bruto = texto.match(/\{[\s\S]*\}/);
    if (!bruto) { diag('resposta sem JSON', { amostra: texto.slice(0, 80) }); return null; }
    const j = JSON.parse(bruto[0]);
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 5 && n <= 1000000 ? n : null; };
    const mat = {
      areaPrivativaM2: num(j.areaPrivativaM2),
      areaTerrenoM2: num(j.areaTerrenoM2),
      areaTotalM2: num(j.areaTotalM2),
      numeroMatricula: String(j.numeroMatricula || '').replace(/\D/g, '').slice(0, 40) || null,
    };
    if (!mat.areaPrivativaM2 && !mat.areaTerrenoM2 && !mat.areaTotalM2) { diag('IA não achou metragem'); return null; }
    const meta = { url, imovelId: String(imovelId), tipoDoc: 'matricula', campos: { matricula: mat }, via: 'visao', confianca: 85 };
    await cacheGravar(chaveUrl(url), meta);
    await cacheGravar(`i:${String(imovelId)}`, meta);
    await publicarDocFatos(imovelId, { matricula: mat, fonteMatricula: url });
    diag('ok', mat);
    return { ...mat, fonteUrl: url, deCache: false, via: 'visao' };
  } catch (e) { diag('erro na chamada à IA', { erro: String(e?.message || e).slice(0, 120) }); return null; }
}

export async function extratoMatricula(imovelId, { deadline } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const fim = Number(deadline) || (Date.now() + 30000);
  let im = null, anexoAcervo = null;
  try {
    const hdr = { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=link_matricula,anexos&limit=1`, hdr);
    [im] = await r.json();
    const ra = await fetch(`${SUPABASE_URL}/rest/v1/imovel_anexos?imovel_id=eq.${encodeURIComponent(imovelId)}&tipo=eq.matricula&select=url&limit=1`, hdr);
    [anexoAcervo] = await ra.json().catch(() => []);
  } catch { return null; }
  if (!im) return null;
  // 1º: leitura por VISÃO do documental (confiança 90), publicada por imóvel. É a mais
  // precisa e já foi paga — se existe, nada é baixado nem re-lido.
  const porImovel = await cacheLer(`i:${String(imovelId)}`, { maxDias: 36500 });
  if (Number(porImovel?.campos?.matricula?.areaPrivativaM2) > 0) {
    await publicarDocFatos(imovelId, { matricula: porImovel.campos.matricula });
    return { ...porImovel.campos.matricula, fonteUrl: null, deCache: true, via: 'visao' };
  }
  const anexos = Array.isArray(im.anexos) ? im.anexos : [];
  const cands = [...new Set([
    ...anexos.filter(a => a?.tipo === 'matricula').map(a => a.url),
    im.link_matricula,
    anexoAcervo?.url,
  ].filter(u => u && /^https?:\/\//i.test(u) && !/matricula\.asp|detalhe-imovel\.asp/i.test(u)))].slice(0, 3);
  // Alvo da visão: começa no 1º candidato e é refinado pelo loop. Começar JÁ preenchido
  // cobre o caso em que o laço nem chega a rodar — o `break` por fim de orçamento logo
  // abaixo deixava `urlParaVisao` nulo e a visão simplesmente não era tentada, sem rastro.
  let urlParaVisao = cands[0] || null, regexParcial = null;
  for (const url of cands) {
    if (Date.now() > fim) break;
    const hit = await cacheLer(chaveUrl(url));
    if (hit?.campos?.matricula) {
      await publicarDocFatos(imovelId, { matricula: hit.campos.matricula, identidade: hit.campos.identidade || null, fonteMatricula: url });
      return { ...hit.campos.matricula, fonteUrl: url, deCache: true };
    }
    const txt = await lerTexto(url, fim);
    // Texto ausente OU insuficiente = página em IMAGEM. São coisas diferentes de "a
    // matrícula não diz a área", e tratá-las igual foi o que fez 28.355 documentos
    // disponíveis renderem 5 áreas lidas: o PDF escaneado devolve um punhado de
    // caracteres de cabeçalho, o regex não acha nada, e ninguém escalava para a visão.
    if (!txt || !temTextoUtil(txt)) { if (!urlParaVisao) urlParaVisao = url; continue; }
    const mat = extrairMatriculaTexto(txt);
    // PDF escaneado ou redação fora das âncoras: o regex não resolve. NÃO é "não há área" —
    // é "o barato não deu conta", e a diferença é justamente o que fazia o relatório seguir
    // com a área do anúncio. Guarda para a visão tentar depois de esgotados os candidatos.
    if (!mat || !mat.areaPrivativaM2) { if (!urlParaVisao) urlParaVisao = url; }
    if (!mat) continue;
    // A MATRÍCULA descreve o imóvel melhor que o edital (é dela que sai o nome do
    // empreendimento e o logradouro na forma registral) — lê a identidade no mesmo texto.
    const idm = extrairIdentidadeTexto(txt);
    const meta = { url, imovelId, tipoDoc: 'matricula', campos: { matricula: mat, ...(idm ? { identidade: idm } : {}) }, via: 'regex', confianca: 60 };
    await cacheGravar(chaveUrl(url), meta);
    await cacheGravar(chaveConteudo(txt), meta);
    await publicarDocFatos(imovelId, { matricula: mat, identidade: idm, fonteMatricula: url });
    // Só encerra aqui se o regex entregou o campo que o mercadológico precisa. Ter lido
    // APENAS o terreno é o pior desfecho possível para retornar satisfeito: é exatamente o
    // número que o anúncio já trazia, e devolvê-lo faz o relatório seguir com a área do
    // lote achando que confirmou a do imóvel. Sem a privativa, a visão ainda tenta.
    if (mat.areaPrivativaM2) return { ...mat, fonteUrl: url, deCache: false };
    regexParcial = { ...mat, fonteUrl: url, deCache: false };
  }
  // Esgotados os candidatos sem a área da edificação: último degrau da cascata (pago, uma
  // vez por lote, cacheado). Ver o cabeçalho de `matriculaPorVisao`.
  if (urlParaVisao) {
    const porVisao = await matriculaPorVisao(urlParaVisao, imovelId, fim);
    if (porVisao?.areaPrivativaM2) return porVisao;
    if (porVisao && !regexParcial) regexParcial = porVisao;
  } else {
    console.log('[matricula-extrato]', JSON.stringify({ imovel: String(imovelId), motivo: 'nenhum candidato de matrícula', candidatos: cands.length }));
  }
  console.log('[matricula-extrato]', JSON.stringify({
    imovel: String(imovelId), candidatos: cands.length,
    desfecho: regexParcial ? 'parcial_sem_privativa' : 'nada',
    privativa: Number(regexParcial?.areaPrivativaM2) || null,
    terreno: Number(regexParcial?.areaTerrenoM2) || null,
    sobraMs: fim - Date.now(),
  }));
  return regexParcial;
}
