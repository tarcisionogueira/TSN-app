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
      comprovanteHtml: txt, // certidão bruta → o laudo salva e linka como comprovante
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
const diligenciaCNIB = () => ({ ok: false, instavel: false, diligencia: true, erro: 'Indisponibilidade de bens: consulta pública sem retorno automático conclusivo agora — a verificação entra na validação do analista e do jurídico antes do lance.' });
export async function consultarCNIB(doc) {
  const d = soDigitos(doc);
  if (d.length !== 11 && d.length !== 14) return { ok: false, instavel: false, erro: 'documento inválido' };
  // CNIB (indisponibilidade.org.br): SPA com reCAPTCHA. O Bright Data Web Unlocker
  // renderiza o JS e resolve o captcha; a página busca pelo ?documento= e mostra o
  // resultado. Logamos a resposta crua para calibrar o parser (e caímos em
  // diligência honesta se não reconhecer). Roda como fonte 'certidao'.
  const url = `https://www.indisponibilidade.org.br/consulta?documento=${d}`;
  try {
    const bd = await fetchViaBrightData(url, { proposito: 'certidao', headers: { Accept: 'text/html,application/json', Referer: 'https://www.indisponibilidade.org.br/' } });
    if (!bd || !bd.ok) { console.log(`[CNIB] unlocker sem resposta ok=${bd?.ok}`); return diligenciaCNIB(); }
    const txt = await bd.text().catch(() => '');
    console.log(`[CNIB] unlocker status=${bd.status} len=${txt.length} amostra="${txt.slice(0, 400).replace(/\s+/g, ' ')}"`);
    if (!txt) return diligenciaCNIB();
    let qtd = null;
    try { const j = JSON.parse(txt); const arr = j?.ordens || j?.indisponibilidades || j?.registros || j?.data || j?.result || []; qtd = Array.isArray(arr) ? arr.length : (typeof j?.total === 'number' ? j.total : null); } catch { /* HTML */ }
    if (qtd == null) {
      if (/nenhuma\s+indisponibilidade|n[ãa]o\s+(constam?|foram\s+encontrad|h[áa])\b[^.]{0,40}indisponibil|sem\s+(registro|indisponibil)|nada\s+consta|nenhum\s+registro\s+encontrad/i.test(txt)) qtd = 0;
      else if (/ordem\s+de\s+indisponibilidade|indisponibilidade\s+ativa|bens?\s+indispon[íi]ve|constam?\s+indisponibil/i.test(txt)) qtd = 1;
    }
    if (qtd == null) return diligenciaCNIB();
    return {
      ok: true, instavel: false,
      resumo: qtd > 0 ? `⚠️ Indisponibilidade de bens ENCONTRADA (${qtd} registro(s)) — bloqueia/atrasa o registro; checar antes de arrematar` : 'Sem indisponibilidade de bens (CNIB)',
      dados: { total: qtd, tem_indisponibilidade: qtd > 0 },
      comprovanteHtml: txt,
    };
  } catch (e) { console.warn(`[CNIB] erro ${e?.message}`); return diligenciaCNIB(); }
}

// ── CENPROT — Protestos em cartório (nacional) ─────────────────────────────────
// Protestos no CPF/CNPJ do vendedor → solvência. Portal com captcha/login →
// tentativa via Bright Data; senão, pendência 48h.
const diligenciaCENPROT = () => ({ ok: false, instavel: false, diligencia: true, erro: 'Protestos em cartório: consulta pública sem retorno automático conclusivo agora — a verificação entra na validação do analista e do jurídico antes do lance.' });
export async function consultarProtestos(doc) {
  const d = soDigitos(doc);
  if (d.length !== 11 && d.length !== 14) return { ok: false, instavel: false, erro: 'documento inválido' };
  // CENPROT (resolve.cenprot.org.br): SPA com captcha. Via Web Unlocker (JS+captcha).
  // A API interna costuma responder JSON com a lista de cartórios/protestos. Logamos
  // a resposta crua para calibrar; diligência honesta se não reconhecer.
  const url = `https://resolve.cenprot.org.br/app/public/search?documento=${d}`;
  try {
    const bd = await fetchViaBrightData(url, { proposito: 'certidao', headers: { Accept: 'application/json,text/html', Referer: 'https://resolve.cenprot.org.br/' } });
    if (!bd || !bd.ok) { console.log(`[CENPROT] unlocker sem resposta ok=${bd?.ok}`); return diligenciaCENPROT(); }
    const txt = await bd.text().catch(() => '');
    console.log(`[CENPROT] unlocker status=${bd.status} len=${txt.length} amostra="${txt.slice(0, 400).replace(/\s+/g, ' ')}"`);
    if (!txt) return diligenciaCENPROT();
    let qtd = null;
    try { const j = JSON.parse(txt); const arr = j?.cartorios || j?.protestos || j?.data || j?.result || j?.items || []; qtd = Array.isArray(arr) ? arr.length : (typeof j?.total === 'number' ? j.total : (typeof j?.qtdTitulos === 'number' ? j.qtdTitulos : null)); } catch { /* HTML */ }
    if (qtd == null) {
      if (/nenhum\s+protesto|n[ãa]o\s+(constam?|foram\s+encontrad)|sem\s+protesto|nada\s+consta|0\s+protesto/i.test(txt)) qtd = 0;
      else if (/protesto\(s\)\s+encontrad|constam?\s+protesto|t[íi]tulo\(s\)\s+protestad/i.test(txt)) qtd = 1;
    }
    if (qtd == null) return diligenciaCENPROT();
    return {
      ok: true, instavel: false,
      resumo: qtd > 0 ? `⚠️ ${qtd} protesto(s) encontrado(s)` : 'Sem protestos (CENPROT)',
      dados: { total: qtd },
      comprovanteHtml: txt,
    };
  } catch (e) { console.warn(`[CENPROT] erro ${e?.message}`); return diligenciaCENPROT(); }
}
