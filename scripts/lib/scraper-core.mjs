/**
 * FASE 1 — Núcleo de scraping escalável
 * ────────────────────────────────────────────────────────────────────────────
 * Componentes:
 *  1. fetchViaProxy()    — wrapper único (ScraperAPI | Bright Data | direto)
 *                          com limitador de cota e alerta de custo
 *  2. extrairGenerico()  — extrator heurístico (schema.org, og:tags, padrões)
 *  3. extrairComIA()     — fallback Claude quando a heurística falha
 *  4. checarQualidade()  — valida campos-base (matrícula/foto/valor/descrição)
 *
 * Sem chave de proxy configurada, fetchViaProxy() cai para fetch direto
 * (útil em ambientes liberados). A chave decide o provedor — nada de hardcode.
 */

// ── Configuração via variáveis de ambiente ──────────────────────────────────
const PROXY_PROVIDER   = process.env.PROXY_PROVIDER || '';          // 'scraperapi' | 'brightdata' | ''
const SCRAPERAPI_KEY   = process.env.SCRAPERAPI_KEY || '';
const BRIGHTDATA_URL   = process.env.BRIGHTDATA_PROXY_URL || '';     // ex.: http://user:pass@zproxy.lum-superproxy.io:22225
const MAX_REQ_MES      = parseInt(process.env.PROXY_MAX_REQ_MES || '15000', 10);
const TETO_USD         = parseFloat(process.env.PROXY_TETO_USD || '40');
const CUSTO_POR_MIL    = parseFloat(process.env.PROXY_CUSTO_POR_MIL || '1.5');
const ALERTA_PCT       = parseInt(process.env.PROXY_ALERTA_PCT || '80', 10);
const CLAUDE_KEY       = process.env.CLAUDE_KEY || '';
const RESEND_API_KEY   = process.env.RESEND_API_KEY || '';
const FROM_EMAIL       = process.env.APP_FROM_EMAIL || 'alertas@bidprobrasil.com.br';
const ADMIN_EMAIL      = process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br';

const mesAtual = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'

// ── 1. LIMITADOR + ALERTA ───────────────────────────────────────────────────
// Estado em memória do processo; persistido no Supabase ao final via flushUso().
let _uso = { requisicoes: 0, falhas: 0, travado: false };

export function usoAtual() {
  return { ..._uso, custo_usd: +(_uso.requisicoes / 1000 * CUSTO_POR_MIL).toFixed(2) };
}

async function carregarUso(supabase) {
  const { data } = await supabase.from('proxy_uso').select('*').eq('mes', mesAtual()).maybeSingle();
  if (data) {
    _uso.requisicoes = data.requisicoes || 0;
    _uso.falhas = data.requisicoes_falha || 0;
    _uso._alerta80 = data.alerta_80_enviado;
    _uso._alerta100 = data.alerta_100_enviado;
  }
  return _uso;
}

function dentroDoLimite() {
  const custo = _uso.requisicoes / 1000 * CUSTO_POR_MIL;
  return _uso.requisicoes < MAX_REQ_MES && custo < TETO_USD;
}

async function enviarAlerta(assunto, corpo) {
  if (!RESEND_API_KEY) { console.log(`[ALERTA] ${assunto}`); return; }
  // Regra de segurança: e-mail do admin recebe apenas notificações de sistema.
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL, to: ADMIN_EMAIL, subject: assunto,
        html: `<div style="font-family:sans-serif;max-width:560px">
          <h2 style="color:#0D63DB">⚙️ Proxy de scraping</h2><p>${corpo}</p>
          <p style="color:#64748b;font-size:12px">Mês ${mesAtual()} — ${_uso.requisicoes} req · ~US$ ${(_uso.requisicoes/1000*CUSTO_POR_MIL).toFixed(2)}</p></div>`,
      }),
    });
  } catch (e) { console.log('[ALERTA] falha envio:', e.message); }
}

async function checarAlertas(supabase) {
  const custo = _uso.requisicoes / 1000 * CUSTO_POR_MIL;
  const pct = (_uso.requisicoes / MAX_REQ_MES) * 100;
  if (!dentroDoLimite() && !_uso._alerta100) {
    _uso._alerta100 = true; _uso.travado = true;
    await enviarAlerta('🛑 Proxy pausado — teto atingido',
      `Cota mensal atingida (${_uso.requisicoes}/${MAX_REQ_MES} req · US$ ${custo.toFixed(2)}/${TETO_USD}). Scraping de leiloeiros pausado até o próximo mês. A CEF (CSV grátis) continua ativa.`);
    await flushUso(supabase);
  } else if ((pct >= ALERTA_PCT || custo >= TETO_USD * (ALERTA_PCT/100)) && !_uso._alerta80) {
    _uso._alerta80 = true;
    await enviarAlerta(`⚠️ Proxy em ${Math.round(pct)}% da cota`,
      `Uso do proxy chegou a ${_uso.requisicoes}/${MAX_REQ_MES} req (~US$ ${custo.toFixed(2)}). Acompanhe para não exceder o teto de US$ ${TETO_USD}.`);
    await flushUso(supabase);
  }
}

export async function flushUso(supabase) {
  const custo = +(_uso.requisicoes / 1000 * CUSTO_POR_MIL).toFixed(2);
  await supabase.from('proxy_uso').upsert({
    mes: mesAtual(),
    requisicoes: _uso.requisicoes,
    requisicoes_falha: _uso.falhas,
    custo_estimado_usd: custo,
    alerta_80_enviado: !!_uso._alerta80,
    alerta_100_enviado: !!_uso._alerta100,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'mes' });
}

// ── 1b. WRAPPER DE FETCH ────────────────────────────────────────────────────
function montarUrlProxy(url) {
  if (PROXY_PROVIDER === 'scraperapi' && SCRAPERAPI_KEY) {
    return `https://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&country_code=br&url=${encodeURIComponent(url)}`;
  }
  return url; // direto ou Brigth Data (via agente HTTP — ver opts abaixo)
}

/**
 * Busca uma URL respeitando o limitador. Retorna { ok, html, status }.
 * @param {object} supabase  cliente Supabase (para contabilizar uso)
 */
export async function fetchViaProxy(url, supabase, { timeoutMs = 20000 } = {}) {
  if (supabase && _uso.requisicoes === 0 && !_uso._carregado) {
    _uso._carregado = true; await carregarUso(supabase);
  }
  if (_uso.travado || !dentroDoLimite()) {
    _uso.travado = true;
    return { ok: false, html: '', status: 0, motivo: 'limite_atingido' };
  }

  const usandoProxy = PROXY_PROVIDER === 'scraperapi' && SCRAPERAPI_KEY;
  const alvo = montarUrlProxy(url);

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(alvo, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    clearTimeout(t);

    // Só contabiliza quando passou pelo proxy pago
    if (usandoProxy) { _uso.requisicoes++; if (supabase) await checarAlertas(supabase); }

    if (!resp.ok) { _uso.falhas++; return { ok: false, html: '', status: resp.status }; }
    const html = await resp.text();
    return { ok: true, html, status: resp.status };
  } catch (e) {
    _uso.falhas++;
    return { ok: false, html: '', status: 0, motivo: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

// ── 2. EXTRATOR HEURÍSTICO ──────────────────────────────────────────────────
const _abs = (href, base) => {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return href; }
};

/** Normaliza data para 'YYYY-MM-DD'. Aceita ISO ou 'DD/MM/YYYY'. */
export function normalizarData(s) {
  if (!s) return null;
  const dmy = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const iso = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** Procura a data do leilão priorizando proximidade de palavras-âncora. */
export function extrairData(html) {
  if (!html) return null;
  const texto = html.replace(/<[^>]+>/g, ' ');
  // Prioriza datas próximas de "leilão", "praça", "data" — evita pegar data de cadastro
  const ancora = texto.match(/(?:leil[ãa]o|pra[çc]a|encerr|data\s+do\s+leil)[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i);
  if (ancora) return normalizarData(ancora[1]);
  // Fallback: primeira data futura plausível no texto
  const todas = [...texto.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map(m => m[1]);
  for (const d of todas) {
    const iso = normalizarData(d);
    if (iso && iso >= new Date().toISOString().slice(0, 10)) return iso;
  }
  return null;
}

/** Extrai campos de uma página de detalhe usando padrões comuns. */
export function extrairGenerico(html, urlBase) {
  if (!html) return null;
  const out = { titulo: null, valor_minimo: 0, valor_avaliacao: 0, link_foto: null,
                link_edital: null, link_matricula: null, descricao: null, numero_matricula: null,
                data_leilao: null };

  // schema.org / Open Graph (mais confiável)
  const og = (p) => (html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)["']`, 'i')) || [])[1];
  const jsonLd = (() => {
    const m = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try { return JSON.parse(m[1].trim()); } catch { return null; }
  })();

  out.titulo = (jsonLd?.name) || og('title') ||
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '').trim() || null;

  out.link_foto = _abs((jsonLd?.image?.url || jsonLd?.image || og('image')), urlBase) || null;

  // valores: "R$ 123.456,78"
  const valores = [...html.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(m => parseFloat(m[1].replace(/\./g, '').replace(',', '.')));
  if (valores.length) {
    out.valor_minimo = Math.min(...valores.filter(v => v > 0)) || 0;
    out.valor_avaliacao = Math.max(...valores) || 0;
  }

  // links de documentos por contexto (texto âncora ou href)
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const txt = (m[2] || '').replace(/<[^>]+>/g, '').toLowerCase();
    const low = href.toLowerCase();
    if (!out.link_edital && (txt.includes('edital') || low.includes('edital'))) out.link_edital = _abs(href, urlBase);
    if (!out.link_matricula && (txt.includes('matr') || low.includes('matricula'))) out.link_matricula = _abs(href, urlBase);
  }

  // número da matrícula no corpo: "Matrícula nº 12.345"
  const mat = html.match(/matr[ií]cula[^\d]{0,20}(\d[\d.\-\/]{2,})/i);
  if (mat) out.numero_matricula = mat[1];

  // data do leilão/praça: "leilão ... 12/07/2026" ou "1ª praça: 12/07/2026"
  out.data_leilao = jsonLd?.startDate ? normalizarData(jsonLd.startDate) : extrairData(html);

  out.descricao = og('description') || jsonLd?.description ||
    (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1] || null;

  return out;
}

// ── 3. FALLBACK COM IA (Claude) ─────────────────────────────────────────────
/** Usa Claude para extrair campos quando a heurística falha. Custa ~US$ 0,005-0,012/página. */
export async function extrairComIA(html, url) {
  if (!CLAUDE_KEY || !html) return null;
  // Reduz o HTML para baixar custo de tokens (remove script/style/svg)
  const limpo = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 18000);

  const prompt = `Extraia os dados deste imóvel de leilão do HTML abaixo. Responda APENAS com JSON válido, sem texto extra, no formato:
{"titulo":string|null,"valor_minimo":number,"valor_avaliacao":number,"link_foto":string|null,"link_edital":string|null,"link_matricula":string|null,"numero_matricula":string|null,"descricao":string|null,"data_leilao":"YYYY-MM-DD"|null}
A data do leilão é o campo mais importante: procure por "leilão", "praça", "data" e converta para YYYY-MM-DD.
URL base para resolver links relativos: ${url}
HTML:\n${limpo}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const txt = data?.content?.[0]?.text || '';
    const jm = txt.match(/\{[\s\S]*\}/);
    if (!jm) return null;
    const parsed = JSON.parse(jm[0]);
    if (parsed.link_foto)      parsed.link_foto = _abs(parsed.link_foto, url);
    if (parsed.link_edital)    parsed.link_edital = _abs(parsed.link_edital, url);
    if (parsed.link_matricula) parsed.link_matricula = _abs(parsed.link_matricula, url);
    if (parsed.data_leilao)    parsed.data_leilao = normalizarData(parsed.data_leilao);
    return parsed;
  } catch { return null; }
}

// ── 4. CHECAGEM DE QUALIDADE ────────────────────────────────────────────────
/**
 * Valida os campos obrigatórios. Sem DATA o imóvel é DESCARTADO (descartar=true) —
 * sem data não há análise nem agendamento de refresh.
 * Modo estrito (padrão): exige data + valor + foto + edital + matrícula.
 * Retorna { ok, faltando:[], descartar }.
 */
export function checarQualidade(imovel, { estrito = true } = {}) {
  const faltando = [];
  // Venda direta não tem data de leilão — pode ser arrematada a qualquer momento.
  // Não exige nem descarta por data; deve sempre aparecer.
  const ehVendaDireta = imovel?.modalidade === 'venda_direta';
  const semData = !ehVendaDireta && !imovel?.data_leilao;
  if (semData)                                      faltando.push('data');
  if (!imovel?.valor_minimo || imovel.valor_minimo <= 0) faltando.push('valor');
  if (!imovel?.link_foto)                           faltando.push('foto');
  if (estrito) {
    if (!imovel?.link_edital)    faltando.push('edital');
    if (!imovel?.link_matricula) faltando.push('matricula');
  } else if (!imovel?.link_edital && !imovel?.link_matricula) {
    faltando.push('documentos');
  }
  // Descarta quando falta o que inviabiliza o fluxo: sem valor sempre; sem data
  // só descarta se NÃO for venda direta (venda direta entra sem data).
  const descartar = (semData && !ehVendaDireta) || !imovel?.valor_minimo;
  return { ok: faltando.length === 0, faltando, descartar };
}

// ── 4b. DEDUPLICAÇÃO ────────────────────────────────────────────────────────
const _norm = (s) => (s || '').toString().toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Chave de deduplicação determinística. Prioridade:
 *  1) matrícula (identifica o imóvel de forma única no cartório)
 *  2) CEP + valor mínimo
 *  3) endereço normalizado + cidade
 * Imóveis com a mesma chave são o mesmo bem em fontes diferentes.
 */
export function chaveDedup(imovel) {
  const mat = _norm(imovel?.numero_matricula);
  if (mat && mat.length >= 3) return `mat:${mat}`;
  const cep = _norm(imovel?.cep);
  if (cep && cep.length === 8 && imovel?.valor_minimo) return `cep:${cep}:${Math.round(imovel.valor_minimo)}`;
  const end = _norm(imovel?.endereco), cid = _norm(imovel?.cidade);
  if (end && cid) return `end:${cid}:${end}`.slice(0, 80);
  return null; // sem chave confiável → não deduplica (evita falso positivo)
}

/**
 * Orquestra a extração: heurística → se reprovar na qualidade, tenta IA.
 * Retorna { imovel, fonte_extracao: 'heuristica'|'ia'|'incompleto', qualidade }.
 */
export async function extrairImovel(html, url, { permitirIA = true } = {}) {
  let imovel = extrairGenerico(html, url) || {};
  let q = checarQualidade(imovel);
  let fonte = 'heuristica';

  if (!q.ok && permitirIA && CLAUDE_KEY) {
    const viaIA = await extrairComIA(html, url);
    if (viaIA) {
      // Mescla: heurística como base, IA preenche o que faltou
      imovel = { ...imovel, ...Object.fromEntries(Object.entries(viaIA).filter(([, v]) => v != null && v !== '')) };
      q = checarQualidade(imovel);
      fonte = q.ok ? 'ia' : 'incompleto';
    } else {
      fonte = 'incompleto';
    }
  } else if (!q.ok) {
    fonte = 'incompleto';
  }

  // Sem data (ou sem valor) não entra no fluxo — análise e refresh dependem disso.
  if (q.descartar) fonte = 'descartado';
  return { imovel, fonte_extracao: fonte, qualidade: q, descartar: q.descartar };
}
