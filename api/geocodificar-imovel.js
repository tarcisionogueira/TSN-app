/**
 * GET /api/geocodificar-imovel?imovel_id=...   (logado)
 * On-demand: ao abrir a tela de um imóvel, melhora a precisão da localização
 * dele NA HORA (cruzando IBGE + Correios + Nominatim estruturado), sem depender
 * do cron. Só GRAVA se o resultado for de nível melhor que o atual OU se a
 * coordenada atual estiver inválida (fora da UF). Nunca rebaixa a precisão.
 *
 * Ao melhorar a coordenada, zera pontos_proximos/proximidades_em para que as
 * proximidades sejam recalculadas no local certo (pelo /api/proximidades-imovel).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { geocodificarCascata, coordValida, rankNivel } from './_geo.js';
import { fetchViaBrightData } from './_brightdata.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Extrai o CEP do documento/página do imóvel (edital/matrícula). Prioriza um CEP
// ROTULADO ("CEP: 01234-567") — o do imóvel — sobre um CEP solto (rodapé do
// leiloeiro). fetch direto primeiro; se bloquear (Cloudflare), Bright Data.
async function cepDoDocumento(url) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  let txt = '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (r.ok) txt = await r.text().catch(() => '');
  } catch { /* segue p/ Bright Data */ }
  if (!txt || !/\d{5}-?\d{3}/.test(txt)) {
    try { const bd = await fetchViaBrightData(url); if (bd) txt = await bd.text().catch(() => '') || txt; } catch { /* */ }
  }
  if (!txt) return null;
  const rot = txt.match(/cep[:\s]*?(\d{5})-?(\d{3})/i);      // "CEP: 01234-567"
  const m = rot || txt.match(/\b(\d{5})-?(\d{3})\b/);         // fallback: 1º CEP
  return m ? `${m[1]}${m[2]}` : null;
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }

  const id = new URL(req.url, 'http://localhost').searchParams.get('imovel_id');
  if (!id) { res.status(400).json({ error: 'imovel_id obrigatório' }); return; }

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=id,endereco,bairro,cidade,estado,latitude,longitude,geocod_nivel,cep,link_edital&limit=1`)).json();
  if (!im) { res.status(404).json({ error: 'Imóvel não encontrado' }); return; }

  const nivelAtual = im.geocod_nivel || (im.latitude ? 'cidade' : null);
  const atualValida = im.latitude != null && coordValida(Number(im.latitude), Number(im.longitude), im.estado, im.cidade);

  // Já está no melhor nível e válido → nada a fazer.
  if (atualValida && rankNivel(nivelAtual) >= rankNivel('endereco')) {
    res.status(200).json({ ok: true, nivel: nivelAtual, alterado: false }); return;
  }

  let coords = null;
  try {
    // sleepMs:0 — é um único imóvel; sem necessidade das pausas de rate-limit.
    coords = await geocodificarCascata(im, { sleepMs: 0, deadline: Date.now() + 22000 });
  } catch { /* tolerante: devolve o estado atual */ }

  // Grava só se subir de nível, ou se a coordenada atual era inválida.
  if (coords && (!atualValida || rankNivel(coords.nivel) > rankNivel(nivelAtual))) {
    const body = {
      latitude: coords.lat, longitude: coords.lng, geocod_nivel: coords.nivel,
      pontos_proximos: null, proximidades_em: null,
      ...(coords.cep ? { cep: coords.cep } : {}),
    };
    const up = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
    res.status(200).json({ ok: up.ok, nivel: coords.nivel, anterior: nivelAtual, alterado: up.ok, lat: coords.lat, lng: coords.lng });
    return;
  }

  // ── Fallback DOCUMENTO (on-demand, one-shot) ──────────────────────────────
  // Ainda impreciso (bairro/cidade) e sem CEP conhecido: tenta extrair o CEP do
  // edital/matrícula e re-geocodificar por CEP. Grava o CEP achado mesmo sem
  // melhorar a coordenada — assim não repete a busca do documento nas próximas
  // aberturas (o guard !im.cep passa a barrar).
  const melhorAtual = coords && rankNivel(coords.nivel) > rankNivel(nivelAtual) ? coords.nivel : nivelAtual;
  if (rankNivel(melhorAtual) < rankNivel('rua') && !im.cep && im.link_edital) {
    let cepDoc = null;
    try { cepDoc = await cepDoDocumento(im.link_edital); } catch { /* */ }
    if (cepDoc) {
      let coords2 = null;
      try { coords2 = await geocodificarCascata({ ...im, cep: cepDoc }, { sleepMs: 0, deadline: Date.now() + 12000 }); } catch { /* */ }
      const melhora = coords2 && rankNivel(coords2.nivel) > rankNivel(melhorAtual) && coordValida(coords2.lat, coords2.lng, im.estado, im.cidade);
      const body = { cep: cepDoc, ...(melhora ? { latitude: coords2.lat, longitude: coords2.lng, geocod_nivel: coords2.nivel, pontos_proximos: null, proximidades_em: null } : {}) };
      const up = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
      if (melhora) { res.status(200).json({ ok: up.ok, nivel: coords2.nivel, anterior: nivelAtual, alterado: up.ok, lat: coords2.lat, lng: coords2.lng, via: 'documento' }); return; }
    }
  }

  res.status(200).json({ ok: true, nivel: nivelAtual, alterado: false });
}
