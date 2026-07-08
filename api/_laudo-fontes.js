/**
 * Fontes públicas GRATUITAS que aprofundam o laudo documental/jurídico.
 * Cada função retorna um shape consistente:
 *   { ok, instavel, resumo, dados, erro }
 * - ok=true            → dado obtido.
 * - instavel=true      → fonte fora do ar/captcha não resolvido → cai na fila 48h.
 * - ok=false !instavel → consultou e não achou nada relevante (sem pendência).
 *
 * DJEN/Comunica (CNJ) é API pública → alta confiança. CNDT (TST) e CENPROT
 * (protestos) têm captcha → tentativa via Bright Data (fingerprint de navegador);
 * se não passar, viram pendência de 48h (retry pelo cron).
 */
import { fetchViaBrightData } from './_brightdata.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// ── DJEN / Comunica CNJ — intimações e andamentos nacionais (API pública) ──────
// Doc: comunica.pje.jus.br — retorna as comunicações processuais (publicações,
// intimações, editais) do processo em todos os tribunais. Deixa o monitoramento
// do processo (e datas de praça) vivo, sem captcha.
export async function consultarComunicaDJEN(numeroProcesso) {
  const num = soDigitos(numeroProcesso);
  if (num.length < 15) return { ok: false, instavel: false, erro: 'sem número de processo' };
  const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroProcesso=${num}&pagina=1&itensPorPagina=50`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { ok: false, instavel: r.status >= 500 || r.status === 429, erro: `HTTP ${r.status}` };
    const j = await r.json().catch(() => null);
    const itens = j?.items || j?.content || (Array.isArray(j) ? j : []) || [];
    const coms = itens.map(c => ({
      data: c.data_disponibilizacao || c.dataDisponibilizacao || c.data || null,
      tipo: c.tipoComunicacao || c.tipo || c.tipoDocumento || null,
      tribunal: c.siglaTribunal || c.tribunal || null,
      orgao: c.nomeOrgao || c.orgao || null,
      teor: String(c.texto || c.teor || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) || null,
    })).filter(c => c.data || c.teor);
    return { ok: true, instavel: false, resumo: `${coms.length} comunicação(ões) no DJEN`, dados: { total: coms.length, comunicacoes: coms.slice(0, 25) } };
  } catch (e) {
    return { ok: false, instavel: true, erro: String(e.message).slice(0, 120) };
  }
}

// ── CNDT — Certidão Negativa de Débitos Trabalhistas (TST/BNDT) ────────────────
// Débito trabalhista do executado/vendedor pode gerar penhora. O portal exige
// captcha → tentativa via Bright Data. Se não passar, pendência 48h.
export async function consultarCNDT(doc) {
  const d = soDigitos(doc);
  if (d.length !== 11 && d.length !== 14) return { ok: false, instavel: false, erro: 'documento inválido' };
  const url = `https://cndt-certidao.tst.jus.br/gerarCertidao.faces?cpfCnpj=${d}`;
  try {
    const bd = await fetchViaBrightData(url, { headers: { 'User-Agent': UA, Referer: 'https://cndt-certidao.tst.jus.br/inicio.faces' } });
    if (!bd) return { ok: false, instavel: true, erro: 'Bright Data indisponível/teto' };
    const txt = await bd.text().catch(() => '');
    if (!txt || /captcha|recaptcha|preencha os campos/i.test(txt) && !/certid/i.test(txt)) {
      return { ok: false, instavel: true, erro: 'captcha não resolvido' };
    }
    // "NÃO CONSTA" = negativa (sem débito) · "CONSTA" = positiva (com débito)
    const positiva = /consta\s+registro|certid[ãa]o\s+positiva|possui\s+d[ée]bito/i.test(txt);
    const negativa = /nada\s+consta|n[ãa]o\s+consta|certid[ãa]o\s+negativa/i.test(txt);
    if (!positiva && !negativa) return { ok: false, instavel: true, erro: 'resposta não reconhecida' };
    return {
      ok: true, instavel: false,
      resumo: positiva ? '⚠️ CNDT POSITIVA — há débito trabalhista' : 'CNDT negativa (sem débito trabalhista)',
      dados: { situacao: positiva ? 'positiva' : 'negativa', tem_debito: positiva },
    };
  } catch (e) {
    return { ok: false, instavel: true, erro: String(e.message).slice(0, 120) };
  }
}

// ── CNIB — Central Nacional de Indisponibilidade de Bens ───────────────────────
// Indisponibilidade decretada sobre bens do executado (aparece como AV na
// matrícula, ex.: AV-9/AV-16). CRÍTICO antes de arrematar — pode bloquear o
// registro. Portal com captcha → tentativa via Bright Data; resposta não
// reconhecida vira pendência 48h (NUNCA afirma "livre" no escuro).
export async function consultarCNIB(doc) {
  const d = soDigitos(doc);
  if (d.length !== 11 && d.length !== 14) return { ok: false, instavel: false, erro: 'documento inválido' };
  // O portal da CNIB (indisponibilidade.org.br) é uma SPA protegida por reCAPTCHA:
  // exige o token do captcha + POST. Um GET simples nunca traz o resultado (só o
  // "esqueleto" da página). Em vez de gastar requisição do Bright Data e prometer
  // um retry que não resolve, marcamos como DILIGÊNCIA e o arrematante confirma na
  // fonte oficial. Automação real exige Bright Data Web Unlocker (JS+captcha) ou
  // uma API paga de certidões (ver roadmap) — plugável aqui quando decidido.
  return { ok: false, instavel: false, diligencia: true, erro: 'Consulta automática indisponível nesta fonte (portal com captcha). Confirme em indisponibilidade.org.br com o CPF/CNPJ do executado.' };
}

// ── CENPROT — Protestos em cartório (nacional) ─────────────────────────────────
// Protestos no CPF/CNPJ do vendedor → solvência. Portal com captcha/login →
// tentativa via Bright Data; senão, pendência 48h.
export async function consultarProtestos(doc) {
  const d = soDigitos(doc);
  if (d.length !== 11 && d.length !== 14) return { ok: false, instavel: false, erro: 'documento inválido' };
  // O CENPROT (resolve.cenprot.org.br) é uma SPA com captcha: o GET público só
  // devolve o app, não a lista de protestos. Mesma decisão da CNIB: marcamos como
  // DILIGÊNCIA em vez de fingir tentativa. (Automação real: Bright Data Web
  // Unlocker ou API paga de certidões — plugável aqui.)
  return { ok: false, instavel: false, diligencia: true, erro: 'Consulta automática indisponível nesta fonte (portal com captcha). Confirme no CENPROT (resolve.cenprot.org.br) com o CPF/CNPJ do executado.' };
}
