/**
 * /api/radar-editais-cron — Radar de Editais (CNJ). Monitora editais de leilão de imóvel
 * publicados no DJEN (Diário de Justiça Eletrônico Nacional) via a API pública "Comunica"
 * do CNJ, para TJSP e TRT-15 (SP). Popula public.editais_leilao (dedup por djen_id).
 *
 * Objetivo: saber o quanto antes quando sai um edital novo e a QUAL LEILOEIRO foi designado
 * (amplia acervo + controle). Ver docs/RADAR_EDITAIS_CNJ.md.
 *
 * Fonte: GET https://comunicaapi.pje.jus.br/api/v1/comunicacao (pública, sem token, diária).
 * ROBUSTO/ADITIVO: se o endpoint bloquear/mudar (o CNJ pode impor rate-limit/auth sem aviso),
 * loga o erro em monitor_runs e retorna 200 sem quebrar nada. Autorizado por CRON_SECRET.
 *
 * ⚠️ VALIDAÇÃO: o proxy do ambiente de dev bloqueia *.pje.jus.br (403); em produção (Vercel)
 * o egresso é aberto. Conferir o 1º run em monitor_runs (itens_vistos > 0).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { fetchViaBrightData, brightDataDisponivel } from './_brightdata.js';
import { iaGeminiPrimary } from './_claude.js';

const DJEN_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
// Tribunais monitorados — CONFIGURÁVEL por env RADAR_TRIBUNAIS (Item 5: "todos os estados").
// Default = SP (validar primeiro). Para abrir p/ o Brasil, setar a env, ex.:
//   TJSP,TJRJ,TJMG,TJRS,TJPR,TJSC,TJBA,TJGO,TJDFT,TJPE,TJCE,TJES,TJMT,TJMS,TJPA,TJMA,TJPB,
//   TJRN,TJAL,TJSE,TJPI,TJAM,TJRO,TJAC,TJAP,TJRR,TJTO,TRT1,TRT2,TRT15 ... (DJEN é nacional).
const TRIBUNAIS = (process.env.RADAR_TRIBUNAIS || 'TJSP,TRT15').split(',').map(s => s.trim()).filter(Boolean);
// Termos jurídicos que referenciam LEILÃO/VENDA de imóvel no DJEN. CONFIGURÁVEL por env
// RADAR_TERMOS (o agente de captura/monitor APRENDE o rendimento de cada termo — quantos viram
// edital REAL vs ruído — e liga/desliga termos sem deploy; ver docs/RADAR_EDITAIS_CNJ.md).
// Mais termos = mais recall; o filtro duro (ehEditalReal) + a IA (nao_edital) cortam o ruído.
// 'alienação judicial' = termo moderno do CPC art.879; 'alvará de venda' = venda em inventário.
const TERMOS = (process.env.RADAR_TERMOS ||
  'edital de leilão,leilão judicial,leilão eletrônico,hasta pública,alienação judicial,alvará de venda')
  .split(',').map((s) => s.trim()).filter(Boolean);
// O WAF do DJEN devolve 403 p/ UA de bot vindo de datacenter (Vercel). O frontend público
// comunica.pje.jus.br consome ESTA MESMA API — então imitamos o navegador dele (UA real +
// Origin/Referer do frontend oficial + Accept-Language) p/ passar pela proteção sem custo.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DJEN_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Referer': 'https://comunica.pje.jus.br/',
  'Origin': 'https://comunica.pje.jus.br',
};
const MAX_PAGINAS = 8;           // teto por (tribunal×termo): 8×100 = 800 itens
const HARD_MS = 200000;          // teto do PULL (~200s) — garante fatia p/ a IA depois
const BD_RETRIES = 2;            // re-tentativas do Bright Data qdo o DJEN dá 403/5xx (instável)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function ymd(d) { return d.toISOString().slice(0, 10); }
function parseBRL(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}
function parseDataBR(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const ano = yy.length === 2 ? '20' + yy : yy;
  const iso = `${ano}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const dt = new Date(iso + 'T12:00:00Z');
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Extrai o que der do texto do edital (regex conservador; o texto integral fica guardado
// p/ refinar/plugar IA depois). Falha de parse NÃO descarta o edital (status='erro_parse').
function parseEdital(texto) {
  const t = String(texto || '');
  const pega = (re) => { const m = t.match(re); return m ? (m[1] || '').replace(/\s+/g, ' ').trim() : null; };
  const leiloeiro = pega(/leiloeir[ao]\s*(?:oficial|p[uú]blic[ao])?\s*[:\-]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ.\s]{4,60}?)(?:,|\.|\s+JUCESP|\s+inscrit|\s+matr[íi]cula|\n)/i);
  const jucesp = pega(/JUCESP[^\dA-Za-z]{0,6}(?:n[ºo.]?\s*)?([\d./-]{2,12})/i);
  const av = pega(/avalia[çc][ãa]o[^\dR]{0,25}R\$\s*([\d.]+,\d{2})/i);
  const lance = pega(/(?:lance|valor)\s+m[íi]nimo[^\dR]{0,25}R\$\s*([\d.]+,\d{2})/i);
  const praca1 = pega(/(?:1[ªa]?|primeir[ao])\s*(?:pra[çc]a|leil[ãa]o|data)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const praca2 = pega(/(?:2[ªa]?|segund[ao])\s*(?:pra[çc]a|leil[ãa]o|data)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const matricula = pega(/matr[íi]cula\s*(?:n[ºo.]?\s*)?([\d.\-]{3,15})/i);
  const plataforma = pega(/https?:\/\/([a-z0-9.\-]+\.(?:com|net|br)[^\s"'<>)]*)/i);
  // Info ADICIONAL do edital (o DJEN não traz a certidão da matrícula, mas o edital descreve
  // o imóvel/ônus): área, ocupação, cartório (CRI), débitos, endereço, cidade/UF.
  const area = pega(/[áa]rea\s*(?:total|constru[íi]da|privativa|do\s+terreno|de)?\s*[:\-]?\s*([\d.]+,\d{2})\s*m/i);
  const ocupacao = /desocupad|livre\s+de\s+ocupa|n[ãa]o\s+ocupad/i.test(t) ? 'desocupado' : (/ocupad/i.test(t) ? 'ocupado' : null);
  const cartorio = pega(/(\d{0,2}[ºoª°]?\s*(?:cart[óo]rio|of[íi]cio)\s+de\s+registro\s+de\s+im[óo]veis[^,.\n]{0,35})/i);
  const debitos = /d[ée]bito|IPTU|condom[íi]ni|ônus|onus|hipotec|penhora/i.test(t) ? 'edital menciona débitos/ônus (IPTU/condomínio/hipoteca/penhora) — conferir no texto' : null;
  const endereco = pega(/(?:situad[oa]|localizad[oa])\s+(?:[àa]|na|no|em)\s+([A-ZÀ-Ý0-9][^,\n]{6,90})/i);
  const cidadeUf = t.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ.'\s]{2,40})\s*[\/\-]\s*([A-Z]{2})\b/);
  const parsedAlgo = !!(leiloeiro || jucesp || av || lance || praca1);
  return {
    leiloeiro_nome: leiloeiro, leiloeiro_jucesp: jucesp,
    valor_avaliacao: parseBRL(av), lance_minimo: parseBRL(lance),
    data_praca_1: parseDataBR(praca1), data_praca_2: parseDataBR(praca2),
    imovel_matricula: matricula, leilao_plataforma_url: plataforma ? ('https://' + plataforma) : null,
    imovel_area_m2: area ? (parseFloat(area.replace(/\./g, '').replace(',', '.')) || null) : null,
    ocupacao, cartorio, debitos,
    imovel_endereco: endereco ? endereco.replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    imovel_cidade: cidadeUf ? cidadeUf[1].replace(/\s+/g, ' ').trim().slice(0, 80) : null,
    imovel_uf: cidadeUf ? cidadeUf[2] : null,
    status: parsedAlgo ? 'processado' : 'erro_parse',
  };
}

// FILTRO DURO: a busca por texto no DJEN traz MUITO despacho/decisão que só CITA "leilão"
// (validação: de 612 comunicações, só ~14-30 eram editais reais). Só entra o que é EDITAL DE
// LEILÃO de verdade: tipoDocumento=Edital OU (estrutura de praça/hasta + um valor em R$). A IA
// depois confirma (marca 'nao_edital' o que passar por engano). Corta ~97% do ruído na origem.
function ehEditalReal(texto, tipoDoc) {
  const t = String(texto || '');
  if (/edital/i.test(String(tipoDoc || ''))) return true; // tipoDocumento é o sinal autoritativo
  const temEstrutura = /(1[ªa]|primeir|2[ªa]|segund)[^.\n]{0,25}(pra[çc]a|leil[ãa]o|hasta)/i.test(t)
                    || /hasta\s+p[úu]blica/i.test(t)
                    || /leil[ãa]o\s+(?:p[úu]blico|judicial|eletr[ôo]nico|extrajudicial)/i.test(t);
  const temValor = /(lance|valor)\s+(?:m[íi]nim|inicial)[^\dR]{0,25}R\$\s*[\d.]+,\d{2}/i.test(t)
                || /avalia(?:d[oa]|[çc][ãa]o)[^\dR]{0,25}R\$\s*[\d.]+,\d{2}/i.test(t);
  return temEstrutura && temValor;
}

// Extração por IA (Gemini-primário / Claude-Haiku fallback — barato, não-crítico) do texto do
// edital: robusta onde a regex falha (leiloeiro, avaliação). Só nos editais REAIS e poucos por
// run (economia). Devolve o objeto ou null.
async function extrairEditalIA(texto) {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return null;
  const prompt = `Abaixo há uma COMUNICAÇÃO JUDICIAL sobre LEILÃO/HASTA de IMÓVEL (pode ser o edital, ou uma intimação/despacho que designa ou relata o leilão). Extraia os campos e responda APENAS um JSON válido (sem markdown, sem comentários) com estas chaves (use null quando não houver):
{"leiloeiro_nome":string|null,"valor_avaliacao":number|null,"lance_minimo":number|null,"data_praca_1":"YYYY-MM-DD"|null,"data_praca_2":"YYYY-MM-DD"|null,"imovel_matricula":string|null,"imovel_endereco":string|null,"imovel_cidade":string|null,"imovel_uf":string|null,"ocupacao":"ocupado"|"desocupado"|null,"area_m2":number|null}
Regras: valores como número puro (ex: 150000.50, sem "R$" nem pontos de milhar). leiloeiro_nome = o NOME PRÓPRIO da pessoa/empresa leiloeira (ex: "João da Silva Leilões"); se o texto só disser "leiloeiro oficial"/"cadastrado no Portal dos Auxiliares" SEM nomear, use null (nunca o juiz, as partes ou advogados). Se o texto NÃO tratar de leilão/hasta pública de um IMÓVEL, responda exatamente {"nao_edital":true}.

TEXTO:
${String(texto || '').slice(0, 8000)}`;
  const res = await iaGeminiPrimary({
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json().catch(() => null);
  const txt = String(data?.content?.[0]?.text || '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const IA_LOTE = 10;        // teto de editais por run (economia; drena a fila em poucos runs)
const IA_HARD_MS = 285000; // corte da IA (~285s do início) — o log do monitor_runs já ocorreu antes

// Enriquece por IA os editais ainda não extraídos (fila via flag ia_extraido). Best-effort:
// roda MESMO quando o pull do dia foi pulado (auto-ajuste), então a fila drena a cada 4h.
async function enriquecerEditaisComIA(supabase, ehIntegrado, t0) {
  if (!process.env.CLAUDE_KEY) return 0;
  let feitos = 0;
  let pend;
  try {
    ({ data: pend } = await supabase.from('editais_leilao')
      .select('id, texto_integral').eq('ia_extraido', false)
      .order('data_disponibilizacao', { ascending: false }).limit(IA_LOTE));
  } catch { return 0; }
  const numOk = (v) => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? new Date(s + 'T12:00:00Z').toISOString() : null;
  for (const e of pend || []) {
    if (Date.now() - t0 > IA_HARD_MS) break;
    let out = null;
    try { out = await extrairEditalIA(e.texto_integral); } catch { /* segue */ }
    const upd = { ia_extraido: true };
    if (out && out.nao_edital) {
      upd.status = 'nao_edital'; // IA confirmou que é despacho/decisão, não edital → telas ignoram
    } else if (out) {
      // Só NOME PRÓPRIO (≥2 palavras, sem fragmento genérico): muitas intimações referenciam
      // "leiloeiro oficial cadastrado no Portal dos Auxiliares" SEM nomear ninguém. Sobrescreve
      // sempre (assim limpa também o lixo herdado da regex: "oficial", "cadastrado no portal"...).
      const bruto = String(out.leiloeiro_nome || '').trim();
      const nomeReal = (bruto && /\s/.test(bruto)
        && !/^(oficial|cadastrad|leiloeir|nomead|portal|auxiliar|s[rn]a?\.?\s*$)/i.test(bruto)) ? bruto.slice(0, 120) : null;
      upd.leiloeiro_nome = nomeReal;
      upd.leiloeiro_nome_norm = nomeReal ? norm(nomeReal) : null;
      upd.leiloeiro_integrado = nomeReal ? ehIntegrado(nomeReal) : false;
      if (numOk(out.valor_avaliacao)) upd.valor_avaliacao = out.valor_avaliacao;
      if (numOk(out.lance_minimo)) upd.lance_minimo = out.lance_minimo;
      if (numOk(out.area_m2)) upd.imovel_area_m2 = out.area_m2;
      if (dataOk(out.data_praca_1)) upd.data_praca_1 = dataOk(out.data_praca_1);
      if (dataOk(out.data_praca_2)) upd.data_praca_2 = dataOk(out.data_praca_2);
      if (out.imovel_matricula) upd.imovel_matricula = String(out.imovel_matricula).slice(0, 40);
      if (out.imovel_endereco) upd.imovel_endereco = String(out.imovel_endereco).slice(0, 200);
      if (out.imovel_cidade) upd.imovel_cidade = String(out.imovel_cidade).slice(0, 80);
      if (out.imovel_uf && /^[A-Za-z]{2}$/.test(out.imovel_uf)) upd.imovel_uf = String(out.imovel_uf).toUpperCase();
      if (out.ocupacao === 'ocupado' || out.ocupacao === 'desocupado') upd.ocupacao = out.ocupacao;
      upd.status = 'processado';
    }
    try { await supabase.from('editais_leilao').update(upd).eq('id', e.id); feitos++; } catch { /* segue */ }
  }
  return feitos;
}

// Campos do item DJEN vêm com nomes variados entre versões — pega o 1º que existir.
const g = (o, ...ks) => { for (const k of ks) { if (o && o[k] != null && o[k] !== '') return o[k]; } return null; };

async function buscarDJEN(tribunal, termo, ini, fim, t0) {
  const out = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = `${DJEN_BASE}?siglaTribunal=${encodeURIComponent(tribunal)}&texto=${encodeURIComponent(termo)}`
      + `&dataDisponibilizacaoInicio=${ini}&dataDisponibilizacaoFim=${fim}&itensPorPagina=100&pagina=${pagina}`;
    // O DJEN bloqueia o IP de datacenter da Vercel (403 PERSISTENTE — validado: nem UA nem
    // Origin/Referer de navegador resolvem). Então vai DIRETO no Bright Data (IP residencial),
    // sem gastar ~23s/página em tentativas diretas fadadas ao 403 (economia de tempo E de
    // requests). A tentativa direta fica só como ÚLTIMO recurso (ex.: cota do BD estourada).
    let json, ultimoStatus = 0;
    if (brightDataDisponivel()) {
      // O DJEN é instável: alguns combos tribunal×termo devolvem 403/5xx MESMO via Bright Data
      // (IP residencial) — mas voltam no retry segundos depois. Então re-tenta com backoff curto
      // (1,5s→3s) antes de desistir da página. 200/404/etc. NÃO re-tenta (resposta definitiva).
      for (let tent = 0; tent <= BD_RETRIES; tent++) {
        const resp = await fetchViaBrightData(url, { headers: DJEN_HEADERS, proposito: 'radar', timeoutMs: 30000 });
        if (resp && resp.ok) { try { json = JSON.parse(await resp.text()); } catch { /* corpo não-JSON */ } break; }
        if (resp) ultimoStatus = resp.status;
        const transiente = !resp || resp.status === 403 || resp.status === 429 || resp.status >= 500;
        if (!transiente || tent === BD_RETRIES || Date.now() - t0 > HARD_MS) break;
        await sleep(1500 * (tent + 1)); // 1,5s, depois 3s
      }
    }
    if (!json) { // ÚLTIMO recurso: tenta direto (normalmente 403, mas cobre BD indisponível/cota)
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 20000);
      try {
        const resp = await fetch(url, { headers: DJEN_HEADERS, signal: ctrl.signal });
        if (resp.ok) json = await resp.json(); else ultimoStatus = resp.status;
      } catch { /* rede/timeout */ } finally { clearTimeout(to); }
    }
    if (!json) throw new Error(`HTTP ${ultimoStatus || 'sem resposta'}`);
    const items = json?.items || json?.content || json?.comunicacoes || [];
    if (!items.length) break;
    out.push(...items);
    const count = Number(json?.count ?? json?.totalElements ?? 0);
    if (count && pagina * 100 >= count) break;
  }
  return out;
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const t0 = Date.now();
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── AUTO-AJUSTE + RESILIÊNCIA (o DJEN cai com frequência) ──────────────────────────────
  // O cron roda a cada 4h, mas SÓ trabalha até obter um pull BEM-SUCEDIDO do DJEN no dia. Se o
  // DJEN estiver fora do ar, o run grava o erro e o PRÓXIMO (4h depois) TENTA de novo, até
  // conseguir; após um sucesso no dia, os runs seguintes SAEM CEDO (quase de graça) → economia
  // + garantia de captura. "Sucesso" = o DJEN respondeu sem erro (mesmo com 0 editais no dia).
  // Bypass manual com ?forcar=1.
  const forcar = /[?&]forcar=1/.test(req.url || '');
  let pulouPull = false; // pull do DJEN já feito hoje → pula a captura, mas a IA ainda enriquece
  if (!forcar) {
    try {
      const { data: ok } = await supabase.from('monitor_runs')
        .select('id').eq('fonte', 'radar-editais-djen').is('erro', null)
        .gte('ran_at', ymd(new Date()) + 'T00:00:00Z').limit(1);
      if (ok && ok.length) pulouPull = true;
    } catch { /* se a checagem falhar, roda o pull normalmente */ }
  }

  // Janela deslizante de 3 dias (pega itens carregados com atraso; dedup resolve repetição).
  const hoje = new Date();
  const ini = ymd(new Date(hoje.getTime() - 3 * 86400000));
  const fim = ymd(hoje);

  // Leiloeiros que JÁ raspamos (nome normalizado) → marca leiloeiro_integrado.
  const integrados = new Set();
  try {
    const { data } = await supabase.from('imoveis_leilao').select('leiloeiro').eq('ativo', true).not('leiloeiro', 'is', null).limit(5000);
    for (const r of data || []) { const n = norm(r.leiloeiro); if (n.length >= 4) integrados.add(n); }
  } catch { /* aditivo */ }
  const ehIntegrado = (nome) => {
    const n = norm(nome);
    if (n.length < 4) return false;
    for (const i of integrados) { if (i.includes(n) || n.includes(i)) return true; }
    return false;
  };

  let vistos = 0, novos = 0, descartados = 0, erroGeral = null, enriquecidos = 0;
  if (!pulouPull) {
   try {
    for (const tribunal of TRIBUNAIS) {
      for (const termo of TERMOS) {
        if (Date.now() - t0 > HARD_MS) break;
        let items = [];
        try { items = await buscarDJEN(tribunal, termo, ini, fim, t0); }
        catch (e) { erroGeral = `${tribunal}/${termo}: ${String(e.message).slice(0, 80)}`; continue; }
        vistos += items.length;
        if (!items.length) continue;

        // Monta linhas; dedup por djen_id (só insere as inéditas).
        const linhas = items.map((it) => {
          const djenId = String(g(it, 'id', 'numeroComunicacao', 'hash', 'idComunicacao') || '');
          const texto = String(g(it, 'texto', 'inteiroTeor', 'teor', 'conteudo') || '');
          const tipoDoc = g(it, 'tipoDocumento', 'tipoComunicacao', 'tipo');
          if (!ehEditalReal(texto, tipoDoc)) return null; // FILTRO DURO: fora despacho/decisão que só cita "leilão"
          const p = parseEdital(texto);
          const orgao = g(it, 'nomeOrgao', 'orgao', 'nomeVara');
          const nomeLeiloeiro = p.leiloeiro_nome;
          return {
            djen_id: djenId || null,
            fonte: 'djen',
            tribunal: g(it, 'siglaTribunal', 'tribunal') || tribunal,
            numero_processo: g(it, 'numeroProcesso', 'numero_processo', 'numeroprocessocommascara'),
            orgao, comarca: orgao, uf: 'SP',
            classe: g(it, 'nomeClasse', 'classe'),
            tipo_documento: tipoDoc,
            data_disponibilizacao: (String(g(it, 'data_disponibilizacao', 'dataDisponibilizacao', 'datadisponibilizacao') || fim)).slice(0, 10),
            data_praca_1: p.data_praca_1, data_praca_2: p.data_praca_2,
            leiloeiro_nome: nomeLeiloeiro, leiloeiro_nome_norm: nomeLeiloeiro ? norm(nomeLeiloeiro) : null,
            leiloeiro_jucesp: p.leiloeiro_jucesp, leilao_plataforma_url: p.leilao_plataforma_url,
            leiloeiro_integrado: nomeLeiloeiro ? ehIntegrado(nomeLeiloeiro) : false,
            valor_avaliacao: p.valor_avaliacao, lance_minimo: p.lance_minimo,
            imovel_matricula: p.imovel_matricula, imovel_area_m2: p.imovel_area_m2,
            imovel_cidade: p.imovel_cidade, imovel_uf: p.imovel_uf || 'SP', imovel_endereco: p.imovel_endereco,
            debitos: p.debitos, ocupacao: p.ocupacao, cartorio: p.cartorio,
            texto_integral: texto.slice(0, 20000),
            hash_dedup: djenId ? null : norm(`${tribunal}|${g(it, 'numeroProcesso') || ''}|${texto.slice(0, 200)}`),
            payload: it,
            status: p.status,
          };
        }).filter((r) => r && (r.djen_id || r.hash_dedup));
        descartados += items.length - linhas.length;

        // Só as inéditas (evita reprocessar): confere djen_id já existentes.
        const ids = linhas.map((r) => r.djen_id).filter(Boolean);
        const existentes = new Set();
        for (let i = 0; i < ids.length; i += 200) {
          try {
            const { data } = await supabase.from('editais_leilao').select('djen_id').in('djen_id', ids.slice(i, i + 200));
            for (const r of data || []) existentes.add(r.djen_id);
          } catch { /* aditivo */ }
        }
        const inserir = linhas.filter((r) => !r.djen_id || !existentes.has(r.djen_id));
        if (inserir.length) {
          const { error } = await supabase.from('editais_leilao').upsert(inserir, { onConflict: 'djen_id', ignoreDuplicates: true });
          if (!error) novos += inserir.length;
          else erroGeral = `upsert: ${String(error.message).slice(0, 80)}`;
        }
      }
    }
   } catch (e) {
    erroGeral = String(e.message).slice(0, 120);
   }

    // INGESTÃO: usa os editais p/ preencher avaliação faltante do acervo (chave forte: lance ==
    // valor mínimo do lote). Conservador; nunca sobrescreve avaliação existente. Aditivo.
    try { const { data } = await supabase.rpc('editais_enriquecer_acervo'); enriquecidos = Number(data) || 0; } catch { /* aditivo */ }

    try {
      await supabase.from('monitor_runs').insert({
        fonte: 'radar-editais-djen', janela_inicio: ini, janela_fim: fim,
        itens_vistos: vistos, itens_novos: novos, duracao_ms: Date.now() - t0, erro: erroGeral,
      });
    } catch { /* nunca quebra por causa do log */ }
  }

  // ENRIQUECIMENTO POR IA — roda SEMPRE (mesmo com o pull pulado), best-effort, capado e
  // time-boxed: drena a fila de editais reais ainda não extraídos, a cada 4h, barato.
  let iaExtraidos = 0;
  try { iaExtraidos = await enriquecerEditaisComIA(supabase, ehIntegrado, t0); } catch { /* best-effort */ }

  return new Response(JSON.stringify({ ok: true, pull: pulouPull ? 'pulado (já obtido hoje)' : 'executado', vistos, novos, descartados, enriquecidos, iaExtraidos, erro: erroGeral, janela: [ini, fim], tribunais: TRIBUNAIS }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
