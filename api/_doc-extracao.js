/**
 * CACHE DE EXTRAÇÃO POR DOCUMENTO + PRIOR DE PAGAMENTO POR LEILOEIRO.
 * "Leia 1 vez, use em todo lugar" (pedido do dono, 05/08): a leitura de edital/
 * matrícula — determinística (grátis) ou por IA (paga) — grava o resultado em
 * `doc_extracoes` chaveado pelo CONTEÚDO; mercadológico, documental e laudo
 * consultam o cache antes de qualquer download ou chamada paga. Regenerar um
 * relatório, ou gerar o 2º/3º do mesmo lote, custa zero.
 *
 * Cascata de custo (mesmo padrão do geocode): regex/pdf-parse primeiro (custo
 * zero), IA só quando o campo crítico não saiu no grátis, visão só onde o
 * documental já a usa. Cada camada grava por cima apenas com confiança >= a
 * existente no campo — o barato nunca apaga o preciso.
 *
 * O "agente que aprende" (leiloeiro_pagamento_prior): cada extração de forma de
 * pagamento VOTA no padrão do leiloeiro × modalidade; lote cujo edital não abre
 * (escaneado/judicial) herda o CONSENSO (moda com ≥2 amostras), sempre rotulado
 * `origem: 'padrao_leiloeiro'` — estimado com base declarada, nunca inventado.
 */
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  signal: init.signal || AbortSignal.timeout(10000),
});

export const chaveConteudo = (texto) => 'h:' + createHash('md5').update(String(texto || '')).digest('hex');
// URL canônica: sem querystring (signed URLs trocam o token a cada assinatura — o
// documento é o mesmo) e limitada — chave estável entre gerações de relatório.
export const chaveUrl = (url) => 'u:' + String(url || '').split(/[?#]/)[0].slice(0, 500);

/** Lê o cache. Chave 'h:' (conteúdo) vale para sempre; 'u:' expira em maxDias. */
export async function cacheLer(chave, { maxDias = 30 } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY || !chave) return null;
  try {
    const r = await sb(`doc_extracoes?chave=eq.${encodeURIComponent(chave)}&select=campos,extrator,atualizado_em&limit=1`);
    if (!r.ok) return null;
    const [row] = await r.json();
    if (!row) return null;
    if (chave.startsWith('u:') && Date.now() - new Date(row.atualizado_em).getTime() > maxDias * 864e5) return null;
    return row;
  } catch { return null; }
}

/**
 * Grava campos no cache com MERGE por confiança: um campo existente só é
 * sobrescrito se a confiança nova for >= à registrada para ele. Best-effort.
 */
export async function cacheGravar(chave, { url = null, imovelId = null, tipoDoc = null, campos = {}, via = 'regex', confianca = 60 } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY || !chave) return;
  const uteis = {};
  for (const [k, v] of Object.entries(campos || {})) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
    uteis[k] = v;
  }
  if (!Object.keys(uteis).length) return;
  try {
    const atual = await cacheLer(chave, { maxDias: 36500 });
    const camposFinal = { ...(atual?.campos || {}) };
    const extratorFinal = { ...(atual?.extrator || {}) };
    for (const [k, v] of Object.entries(uteis)) {
      const confAtual = Number(extratorFinal?.[k]?.confianca) || 0;
      if (confianca >= confAtual) { camposFinal[k] = v; extratorFinal[k] = { via, confianca }; }
    }
    await sb('doc_extracoes?on_conflict=chave', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ chave, url, imovel_id: imovelId ? String(imovelId) : null, tipo_doc: tipoDoc, campos: camposFinal, extrator: extratorFinal, atualizado_em: new Date().toISOString() }),
    });
  } catch { /* cache é acelerador, nunca bloqueia */ }
}

const numBr = (s) => {
  const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

/**
 * METRAGEM + Nº DA MATRÍCULA por regex (custo zero) — o dado que os casos
 * documentados de divergência pedem. Âncoras estritas: só aceita área COM a
 * qualificação (privativa/construída/total/terreno) para nunca confundir
 * fração ideal/área comum com a área que baliza o R$/m².
 */
export function extrairMatriculaTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 120) return null;
  const area = (re) => {
    let best = 0;
    for (const m of t.matchAll(re)) {
      const v = numBr(m[1]);
      if (v >= 5 && v <= 1000000 && v > best) best = v;
    }
    return best || null;
  };
  // NÚMERO + unidade, reusado nos padrões abaixo.
  const N = '(\\d{1,3}(?:\\.\\d{3})*,\\d{1,4}|\\d{1,7}(?:,\\d{1,4})?)';
  const UN = '(?:m²|m2|mts?2|metros?\\s+quadrados?)';
  // Qualificadores que designam a área EDIFICADA/PRIVATIVA — a que baliza o R$/m².
  // `comum` e `fração ideal` continuam de fora de propósito.
  const Q = '(?:privativ|[úu]til|constru[íi]d|edificad)';
  // 15/08: a redação da matrícula varia muito mais do que o padrão único cobria, e o
  // custo disso não era um número faltando — era o relatório seguir com a área do
  // ANÚNCIO (que costuma ser a do terreno) achando que não havia nada a ler. Medido no
  // acervo: 28.355 lotes ativos com matrícula disponível e 5 com a área lida.
  // Três formas que escapavam, todas comuns em matrícula de casa:
  //   • "área construída: 236,00 m²"  → o `\s+` era obrigatório ANTES do separador, e
  //     não há espaço entre a palavra e os dois-pontos;
  //   • "área EDIFICADA de 236,00 m²" → o qualificador não estava na lista;
  //   • "casa com 236,00 m² de área construída" → número ANTES do qualificador.
  // Também entram "área construída TOTAL de …" e "área TOTAL construída de …", que o
  // padrão antigo perdia porque exigia o número logo depois do qualificador.
  const privDireto = new RegExp(`[áa]rea\\s+(?:real\\s+)?(?:total\\s+)?${Q}[a-zíúà-ú]*\\s*(?:total\\s*)?(?:de\\s+|com\\s+|:\\s*|=\\s*)?${N}\\s*${UN}`, 'gi');
  const privInvertido = new RegExp(`${N}\\s*${UN}\\s+(?:de\\s+|em\\s+)?[áa]rea\\s+(?:real\\s+)?(?:total\\s+)?${Q}`, 'gi');
  const out = {
    areaPrivativaM2: area(privDireto) || area(privInvertido),
    areaTotalM2: area(new RegExp(`[áa]rea\\s+total\\s*(?:de\\s+|com\\s+|:\\s*)?${N}\\s*${UN}`, 'gi')),
    areaTerrenoM2: area(new RegExp(`(?:[áa]rea\\s+d[oe]\\s+terreno|terreno\\s+(?:medindo|com\\s+[áa]rea))\\s*(?:de\\s+|:\\s*)?${N}\\s*${UN}`, 'gi')),
    numeroMatricula: (t.match(/matr[íi]cula\s*(?:n[ºo°.]?\s*)?[:.]?\s*(\d{1,3}(?:\.\d{3})+|\d{2,7})\b/i)?.[1] || '').replace(/\./g, '') || null,
  };
  return (out.areaPrivativaM2 || out.areaTotalM2 || out.areaTerrenoM2 || out.numeroMatricula) ? out : null;
}

/**
 * FORMA DE PAGAMENTO ESTRUTURADA (custo zero) — alimenta a projeção de fluxo de
 * caixa por modalidade. null em campo que o texto não afirma; nunca inventa.
 */
export function extrairPagamentoTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 40) return null;
  const pct = (re) => { const m = t.match(re); const v = m ? numBr(m[1]) : 0; return v > 0 && v <= 100 ? v : null; };
  const out = {
    aVista: /(?:pagamento|arremata[çc][ãa]o|lance)[^.;]{0,60}[àa]\s*vista|[àa]\s*vista[^.;]{0,40}(?:pagamento|arremata)/i.test(t) || null,
    // Duas redações. A primeira é a do EDITAL ("em até 60 parcelas"). A segunda é a do
    // TÍTULO DO LOTE, e faltava: o leiloeiro anuncia "Entrada 30% + 240x" na própria
    // chamada da oferta. Medido em 15/08: 132 lotes ativos têm entrada/parcelamento no
    // título e estão gravados como `a_vista` no acervo — e é o `a_vista` que desabilita o
    // cenário financiado na tela, então o investidor via "sem parcela, à vista" num lote
    // anunciado em 240 vezes. O `+` ou o `em` antes do número é o que separa "240x" de
    // qualquer outro número seguido de x (área, medida, quantidade).
    parcelas: (() => {
      const m = t.match(/(?:em\s+at[ée]|parcelad[oa]\s+em|at[ée])\s+(\d{1,3})\s*(?:parcelas|vezes|x)\b/i)
             || t.match(/(?:\+|em)\s*(\d{1,3})\s*x\b/i);
      const n = m ? Number(m[1]) : 0;
      return n >= 2 && n <= 420 ? n : null;
    })(),
    sinalPct: pct(/(?:sinal|entrada)\s+(?:de\s+|m[íi]nim[oa]\s+de\s+)?(\d{1,2}(?:,\d{1,2})?)\s*%/i),
    caucaoPct: pct(/cau[çc][ãa]o\s+(?:de\s+)?(\d{1,2}(?:,\d{1,2})?)\s*%/i),
    // Comissão: o vão entre a palavra e o percentual muda muito de edital para edital —
    // "comissão de 5%", "comissão do(a) leiloeiro(a) a título de 5%", "Arbitro a comissão
    // da Leiloeira em 6%" (os dois últimos são a forma padrão dos editais JUDICIAIS e não
    // casavam com o padrão fechado anterior). Teto de 20%: comissão real é 5–10%; sem o
    // teto, um "100% da avaliação" na mesma frase entraria como comissão.
    comissaoPct: (() => {
      const m = t.match(/comiss[ãa]o[^.;%]{0,70}?(\d{1,2}(?:,\d{1,2})?)\s*%/i);
      const v = m ? numBr(m[1]) : 0;
      return v >= 0.5 && v <= 20 ? v : null;
    })(),
    prazoDias: (() => { const m = t.match(/prazo\s+(?:de|para)\s+(?:pagamento|dep[óo]sito|quita[çc][ãa]o)[^.;]{0,30}?(\d{1,3})\s*(?:dias?|horas?)/i); if (!m) return null; const n = Number(m[1]); const horas = /horas?/i.test(m[0]); return n > 0 ? (horas ? Math.max(1, Math.round(n / 24)) : n) : null; })(),
    financiavel: /financiamento\s+(?:habitacional|banc[áa]rio|imobili[áa]rio)|aceita\s+financiamento|pode\s+ser\s+financiad/i.test(t) || null,
    fgts: /\bfgts\b/i.test(t) || null,
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/**
 * CUSTOS DECLARADOS NO DOCUMENTO (custo zero) — o que faltava para a PROJEÇÃO usar
 * número do EDITAL em vez de premissa (pedido do dono, 06/08: "caso a comissão mude,
 * caso haja taxa administrativa, caso haja informe de IPTU/condomínio, tudo isso dá
 * pra incluir no relatório e auxiliar nas projeções"). A comissão do leiloeiro já sai
 * em extrairPagamentoTexto (comissaoPct); aqui vêm taxa administrativa (% e valor
 * fixo), IPTU e condomínio — separando CUSTO RECORRENTE (carrego mensal/anual) de
 * DÉBITO EM ABERTO (entra como débito assumido, não como carrego).
 *
 * Conservador por desenho: a janela entre a âncora e o valor não atravessa ponto nem
 * ponto-e-vírgula, para nunca colar num "R$" de outra frase. Campo que o texto não
 * afirma volta null — a projeção segue com a premissa da tela, nunca com invenção.
 */
export function extrairCustosTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 120) return null;
  const faixa = (v, min, max) => (Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : null);
  const VAL = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d{1,9},\\d{2})';
  const ehDebito = (ctx) => /d[ée]bit|d[íi]vid|em\s+aberto|atrasad|inadimpl|pendent|exerc[íi]cios?\s+anterior|vencid/i.test(ctx);
  const out = {
    taxaAdmPct: null, despesasAdm: null,
    iptuMensal: null, iptuAnual: null, iptuDebito: null,
    condominioMensal: null, condominioDebito: null,
  };
  // Taxa administrativa do leilão (% sobre a arrematação — comum na Superbid — ou valor fixo).
  for (const m of t.matchAll(new RegExp(`taxa\\s+(?:administrativa|de\\s+administra[çc][ãa]o)[^.;]{0,80}?(?:(\\d{1,2}(?:,\\d{1,2})?)\\s*%|R\\$\\s*${VAL})`, 'gi'))) {
    if (m[1] && out.taxaAdmPct == null) out.taxaAdmPct = faixa(numBr(m[1]), 0.1, 20);
    if (m[2] && out.despesasAdm == null) out.despesasAdm = faixa(numBr(m[2]), 50, 500000);
  }
  // IPTU e condomínio: DÉBITO em aberto × CARREGO (mensal/anual). Sem a distinção, um
  // débito de R$ 30 mil viraria "IPTU mensal" e destruiria o fluxo de caixa do relatório.
  // O que qualifica o valor pode vir ANTES da âncora ("débito de IPTU no valor de R$ X")
  // ou DEPOIS ("IPTU em aberto: R$ X"), então as duas janelas são lidas. O corte da frase
  // ignora o ponto do separador de milhar (senão "R$ 23.000,00" era cortado em "R$ 23").
  const FIM_FRASE = /;|\.(?!\d)/;
  const janela = (m) => {
    const dep = t.slice(m.index + m[0].length, m.index + m[0].length + 140);
    const corte = dep.search(FIM_FRASE);
    // As DUAS janelas param na fronteira da frase. Sem cortar a de trás, a frase anterior
    // ("...exercícios anteriores.") contaminava a seguinte e o IPTU corrente virava débito.
    const ant = t.slice(Math.max(0, m.index - 70), m.index);
    const ini = [...ant.matchAll(/;|\.(?!\d)/g)].pop()?.index;
    return { antes: ini >= 0 ? ant.slice(ini + 1) : ant, depois: corte >= 0 ? dep.slice(0, corte) : dep };
  };
  // O TRECHO entre a âncora e o R$ diz de que valor se trata. Se ele fala de avaliação,
  // lance ou venda, o número é do IMÓVEL e não do encargo ("Casa no Condomínio Village,
  // avaliada em R$ 80.000,00" não é cota condominial de R$ 80 mil).
  const RUIDO = /avalia|arremat|lance|hasta|pra[çc]a|venda|aquisi|adjudica|pre[çc]o|financiament/i;
  const valorDoEncargo = (depois) => {
    const vm = depois.match(new RegExp(`R\\$\\s*${VAL}`));
    if (!vm) return null;
    return RUIDO.test(depois.slice(0, vm.index)) ? null : vm;
  };
  for (const m of t.matchAll(/\biptu\b/gi)) {
    const { antes, depois } = janela(m);
    const vm = valorDoEncargo(depois);
    if (!vm) continue;
    const ctx = `${antes} ${depois}`, v = numBr(vm[1]);
    if (ehDebito(ctx)) { if (out.iptuDebito == null) out.iptuDebito = faixa(v, 50, 50000000); }
    else if (/mensal|por\s+m[êe]s|ao\s+m[êe]s/i.test(ctx)) { if (out.iptuMensal == null) out.iptuMensal = faixa(v, 10, 50000); }
    else if (out.iptuAnual == null) out.iptuAnual = faixa(v, 50, 2000000);
  }
  // Fora do contexto de débito, cota condominial é mensal por convenção.
  for (const m of t.matchAll(/condom[íi]ni/gi)) { // condomínio · condominial · condominiais
    const { antes, depois } = janela(m);
    const vm = valorDoEncargo(depois);
    if (!vm) continue;
    const v = numBr(vm[1]);
    if (ehDebito(`${antes} ${depois}`)) { if (out.condominioDebito == null) out.condominioDebito = faixa(v, 50, 50000000); }
    else if (out.condominioMensal == null) out.condominioMensal = faixa(v, 30, 100000);
  }
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/**
 * NÚMERO DO PROCESSO (padrão CNJ) NO TEXTO — custo zero, sem IA.
 *
 * POR QUE EXISTE (15/08). Todo edital de leilão JUDICIAL traz o número do processo; é ele que
 * abre a consulta de movimentação no DataJud do CNJ e responde "este processo anda rápido?".
 * Medido no acervo: **1.782 lotes judiciais ativos e apenas 3 com `numero_processo`** — 0,17%.
 * O número não estava faltando na fonte: estava sendo lido só pela IA, dentro do relatório
 * DOCUMENTAL, que só roda quando um cliente paga por ele. Como foram gerados 17 documentais
 * na história do sistema, o acervo inteiro ficou sem a chave. É o padrão da casa outra vez —
 * a informação já estava publicada, faltava lê-la.
 *
 * O DÍGITO VERIFICADOR NÃO É ENFEITE. Sem conferi-lo, qualquer sequência de 20 dígitos no
 * edital (e editais são cheios de números longos: CNPJ concatenado, protocolo, conta) viraria
 * "processo", e o monitor sairia consultando o CNJ com lixo — errando em silêncio, que é
 * exatamente o que não se quer aqui. A conferência é o MOD 97-10 da norma CNJ 65/2008:
 * remove-se o DV, concatena-se o resto na ordem NNNNNNN+AAAA+J+TR+OOOO, acrescenta-se '00',
 * e o DV correto é 98 menos o resto da divisão por 97.
 */
const mod97 = (digitos) => {
  let r = 0;
  for (const c of digitos) r = (r * 10 + (c.charCodeAt(0) - 48)) % 97;
  return r;
};
export function numeroProcessoValido(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return false;
  const dv = Number(d.slice(7, 9));
  const base = d.slice(0, 7) + d.slice(9) + '00';
  return 98 - mod97(base) === dv;
}
export function extrairNumeroProcessoTexto(texto) {
  const t = String(texto || '');
  if (t.length < 40) return null;
  const achados = new Map();
  // Formatado (NNNNNNN-DD.AAAA.J.TR.OOOO) e cru (20 dígitos seguidos). O cru só entra se
  // passar no DV — é ele que separa processo de protocolo.
  for (const re of [/\b(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})\b/g, /\b(\d{20})\b/g]) {
    for (const m of t.matchAll(re)) {
      const cru = m.slice(1).join('').replace(/\D/g, '');
      if (cru.length !== 20 || !numeroProcessoValido(cru)) continue;
      const fmt = `${cru.slice(0, 7)}-${cru.slice(7, 9)}.${cru.slice(9, 13)}.${cru.slice(13, 14)}.${cru.slice(14, 16)}.${cru.slice(16)}`;
      // Peso pelo CONTEXTO: "processo nº X" vale mais que um número solto no rodapé.
      const ctx = t.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
      const peso = /(processo|autos|execu[çc][ãa]o|a[çc][ãa]o)\D{0,20}$/.test(ctx) ? 2 : 1;
      achados.set(fmt, (achados.get(fmt) || 0) + peso);
    }
  }
  if (!achados.size) return null;
  const [numero] = [...achados.entries()].sort((a, b) => b[1] - a[1])[0];
  return { numeroProcesso: numero, candidatos: achados.size };
}

/**
 * IDENTIDADE DO IMÓVEL NO DOCUMENTO (custo zero): nome do CONDOMÍNIO/empreendimento,
 * logradouro e bairro. Serve à BUSCA (âncora Nível 1: comparáveis do MESMO
 * condomínio/rua valem mais que qualquer média de bairro) e à CLASSIFICAÇÃO de tipo e
 * padrão — pedido do dono 06/08: "permite pegar o nome do condomínio, ou do imóvel de
 * rua, e consultar o bairro para classificar o tipo e padrão".
 */
export function extrairIdentidadeTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 120) return null;
  // O que segue a âncora sem ser NOME. Duas listas, porque a régua é diferente:
  //  • PREFIXO casa o começo da palavra (cobre flexão: "edilício/edilícia", "localizado/a");
  //  • EXATA casa a palavra INTEIRA — se "do|da|de" fosse prefixo, "Dona Otília" seria
  //    descartada por começar com "Do" (defeito real, pego no teste do Alphaville).
  const NAO_NOME_PREFIXO = /^(edil[íi]ci|ordin|extraordin|localizad|situad|referid|mencionad|vencid|atrasad|pendent|respons|constitu[íi]d|integr|conven|assembl|administrador|s[íi]ndic|d[ée]bit|d[íi]vid|matr[íi]cul|apartament|im[óo]ve|unidade|artigo)/i;
  const NAO_NOME_EXATA = /^(geral|em|no|na|do|da|de|com|sem|ser|ser[áa]|fica|dever|dever[áa]|est[áa]|s[ãa]o|que|cujo|acima|objeto|atual|deste|desta|desse|dessa|este|esta|os|as|o|a|n[ºo°]|bloco|torre|lote|quadra|forma|taxa|cota|conforme|nos|art|lei|leil[ãa]o|hasta|pra[çc]a)$/i;
  const naoNome = (s) => NAO_NOME_PREFIXO.test(s) || NAO_NOME_EXATA.test(s);
  const ehTokenNome = (s) => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9'’.-]*$/.test(s) || /^\d{1,4}[ºª°]?$/.test(s);
  const ehLigacao = (s) => /^(de|da|do|das|dos|e)$/i.test(s);
  /**
   * Colhe o NOME PRÓPRIO que vem logo depois de uma âncora. Um `[^.;,]{4,70}` solto
   * colhia lixo do próprio edital — "Edital de Praça no (https://comunica" virou
   * logradouro num edital judicial REAL. Aqui cada token tem de parecer nome; ligação
   * ("das", "de") entra no meio e é permitida também na 1ª posição quando um nome vem
   * atrás dela ("Rua das Acácias"), mas nunca sobra na ponta.
   */
  const nomeApos = (pos, maxToks, maxLen) => {
    const toks = t.slice(pos, pos + 90).trim().split(/\s+/);
    if (!toks.length || naoNome(toks[0].replace(/[,;:.].*$/, ''))) return null;
    const nome = [];
    for (const bruto of toks.slice(0, maxToks)) {
      const tok = bruto.replace(/[,;:)].*$/, '');
      if (!tok || /https?:|www\.|[(@]/i.test(tok)) break;
      if (ehTokenNome(tok)) nome.push(tok);
      else if (ehLigacao(tok)) nome.push(tok.toLowerCase());
      else break;
      if (/[,;:)]/.test(bruto)) break;
    }
    while (nome.length && ehLigacao(nome[nome.length - 1])) nome.pop();
    if (nome.length && ehLigacao(nome[0]) && nome.length < 2) return null;
    const cand = nome.join(' ').replace(/[.\s]+$/, '').slice(0, maxLen);
    return cand.length >= 3 && /[A-Za-zÀ-ÿ]{3}/.test(cand) ? cand : null;
  };
  const primeiroNome = (ancoras, maxToks, maxLen) => {
    for (const [re, rotulo] of ancoras) {
      for (const m of t.matchAll(re)) {
        const cand = nomeApos(m.index + m[0].length, maxToks, maxLen);
        if (cand) return `${rotulo} ${cand}`;
      }
    }
    return null;
  };
  const nomeCondominio = primeiroNome([
    [/condom[íi]nio/gi, 'Condomínio'], [/edif[íi]cio/gi, 'Edifício'],
    [/residencial/gi, 'Residencial'], [/empreendimento/gi, 'Empreendimento'],
  ], 5, 60);
  const logradouro = primeiroNome([
    [/\brua\b/gi, 'Rua'], [/\bavenida\b|\bav\./gi, 'Avenida'], [/\btravessa\b/gi, 'Travessa'],
    [/\balameda\b/gi, 'Alameda'], [/\brodovia\b/gi, 'Rodovia'], [/\bestrada\b/gi, 'Estrada'], [/\bpra[çc]a\b/gi, 'Praça'],
  ], 6, 70);
  const bai = t.match(/bairro\s+(?:d[eoa]s?\s+)?([A-Za-zÀ-ÿ'’ -]{3,40}?)\s*(?:[,.;]|\bna\b|\bem\b|\bcidade\b|$)/i);
  const out = {
    nomeCondominio,
    logradouro,
    bairro: bai ? bai[1].trim().replace(/\s+/g, ' ').slice(0, 60) : null,
  };
  return Object.values(out).some((v) => v) ? out : null;
}

// ── PRIOR POR LEILOEIRO × MODALIDADE (o agente que aprende) ──────────────────

/** Consenso aprendido: moda por campo, exigindo ≥2 amostras. null = sem consenso. */
export async function pagamentoPrior(fonte, modalidade) {
  if (!fonte) return null;
  try {
    const r = await sb(`leiloeiro_pagamento_prior?fonte=eq.${encodeURIComponent(fonte)}&modalidade=eq.${encodeURIComponent(modalidade || '')}&select=freq,amostras&limit=1`);
    if (!r.ok) return null;
    const [row] = await r.json();
    if (!row || Number(row.amostras) < 2) return null;
    const consenso = {};
    for (const [campo, votos] of Object.entries(row.freq || {})) {
      let melhor = null, n = 0;
      for (const [valor, cont] of Object.entries(votos || {})) if (cont > n) { n = cont; melhor = valor; }
      if (melhor === null || n < 2) continue;
      consenso[campo] = melhor === 'true' ? true : melhor === 'false' ? false : (Number.isFinite(Number(melhor)) ? Number(melhor) : melhor);
    }
    return Object.keys(consenso).length ? { ...consenso, amostras: Number(row.amostras) } : null;
  } catch { return null; }
}

/** Vota o padrão observado (read-modify-write; volume baixo). Best-effort. */
export async function pagamentoAprender(fonte, modalidade, regras) {
  if (!fonte || !regras) return;
  const votos = Object.entries(regras).filter(([, v]) => v !== null && v !== undefined);
  if (!votos.length) return;
  try {
    const r = await sb(`leiloeiro_pagamento_prior?fonte=eq.${encodeURIComponent(fonte)}&modalidade=eq.${encodeURIComponent(modalidade || '')}&select=freq,amostras&limit=1`);
    const [atual] = r.ok ? await r.json() : [];
    const freq = { ...(atual?.freq || {}) };
    for (const [campo, valor] of votos) {
      const chaveV = String(typeof valor === 'number' ? Math.round(valor * 100) / 100 : valor);
      freq[campo] = { ...(freq[campo] || {}) };
      freq[campo][chaveV] = (Number(freq[campo][chaveV]) || 0) + 1;
    }
    await sb('leiloeiro_pagamento_prior?on_conflict=fonte,modalidade', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ fonte, modalidade: modalidade || '', freq, amostras: (Number(atual?.amostras) || 0) + 1, atualizado_em: new Date().toISOString() }),
    });
  } catch { /* aprendizado nunca bloqueia */ }
}
