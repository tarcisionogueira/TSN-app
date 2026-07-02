/**
 * GET /api/enriquecer-lote?imovel_id=...   (logado)
 * On-demand: ao abrir a tela de um imóvel de leiloeiro, vasculha a PÁGINA DO LOTE
 * atrás de matrícula, edital, regras de venda, demais anexos e foto — e grava no
 * imóvel. Cada leiloeiro guarda esses arquivos em lugares diferentes, então
 * varremos o HTML/JSON inteiro (ver _doc-scan.js) em vez de seletor por site.
 *
 * Fonte CEF (Caixa) é ignorada: lá os links são determinísticos (caixa.js) e o
 * IP do servidor é bloqueado. Fontes de leiloeiro que barram o servidor caem no
 * Bright Data (sob teto semanal). Só revisita se ainda não enriquecido (ou ?forcar=1).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { fetchViaBrightData } from './_brightdata.js';
import { vasculharDocumentos } from './_doc-scan.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// fetch direto; se 403/erro → Bright Data (desbloqueia fontes que barram o servidor).
async function fetchLote(url) {
  const h = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9' };
  let resp = null;
  try { resp = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(9000) }); } catch { resp = null; }
  if (resp && resp.ok) {
    const text = await resp.text().catch(() => '');
    if (text && text.length > 500) return { html: text, finalUrl: resp.url || url, via: 'direct' };
  }
  const bd = await fetchViaBrightData(url);
  if (bd && bd.ok) {
    const text = await bd.text().catch(() => '');
    if (text) return { html: text, finalUrl: url, via: 'brightdata' };
  }
  return { html: '', finalUrl: url, via: 'fail' };
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const id = params.get('imovel_id');
  const forcar = params.get('forcar') === '1';
  if (!id) { res.status(400).json({ error: 'imovel_id obrigatório' }); return; }

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=id,fonte,url_lote,link_edital,link_matricula,link_regras_venda,link_foto,anexos,enriquecido_em&limit=1`)).json();
  if (!im) { res.status(404).json({ error: 'Imóvel não encontrado' }); return; }

  // CEF: links determinísticos (caixa.js) — não precisa vasculhar.
  if (im.fonte === 'CEF' || im.fonte === 'caixa') {
    res.status(200).json({ ok: true, pulado: 'cef', alterado: false }); return;
  }
  // Revisita se o imóvel AINDA não tem documentos. Antes, uma tentativa que falhava
  // (fonte bloqueava o fetch) marcava enriquecido_em e o imóvel ficava travado SEM
  // matrícula/edital/regras PARA SEMPRE. Agora: só pula de vez quando já achou algo;
  // se ainda não tem doc, tenta de novo após 12h (throttle p/ não martelar a fonte).
  const temDocs = !!(im.link_matricula || im.link_regras_venda || (Array.isArray(im.anexos) && im.anexos.length));
  const enriqRecente = im.enriquecido_em && (Date.now() - new Date(im.enriquecido_em).getTime() < 12 * 3600 * 1000);
  if (!forcar && (temDocs || enriqRecente)) {
    res.status(200).json({ ok: true, pulado: temDocs ? 'ja_tem_docs' : 'tentado_recente', alterado: false, anexos: im.anexos || [] }); return;
  }

  const alvo = im.url_lote || im.link_edital;
  if (!alvo || !/^https?:\/\//.test(alvo)) {
    res.status(200).json({ ok: true, pulado: 'sem_url', alterado: false }); return;
  }

  const { html, finalUrl, via } = await fetchLote(alvo);
  if (!html) {
    // Marca a tentativa para não martelar a fonte a cada abertura.
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ enriquecido_em: new Date().toISOString() }) }).catch(() => {});
    res.status(200).json({ ok: false, via, alterado: false, motivo: 'sem_conteudo' }); return;
  }

  const achado = vasculharDocumentos(html, finalUrl, im.link_foto);

  // Monta o patch: só preenche o que faltava (não sobrescreve dado já bom).
  const patch = { enriquecido_em: new Date().toISOString() };
  if (achado.anexos.length) patch.anexos = achado.anexos;
  if (achado.matricula && !im.link_matricula) patch.link_matricula = achado.matricula;
  if (achado.edital && !im.link_edital) patch.link_edital = achado.edital;
  if (achado.regras && !im.link_regras_venda) patch.link_regras_venda = achado.regras;
  if (achado.foto && !im.link_foto) patch.link_foto = achado.foto;

  const up = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });

  res.status(200).json({
    ok: up.ok, via, alterado: up.ok,
    encontrados: achado.anexos.length,
    matricula: patch.link_matricula || im.link_matricula || null,
    edital: patch.link_edital || im.link_edital || null,
    regras: patch.link_regras_venda || im.link_regras_venda || null,
    foto: patch.link_foto || im.link_foto || null,
    anexos: achado.anexos,
  });
}
