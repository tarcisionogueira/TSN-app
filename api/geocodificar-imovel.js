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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

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

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=id,endereco,bairro,cidade,estado,latitude,longitude,geocod_nivel&limit=1`)).json();
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

  res.status(200).json({ ok: true, nivel: nivelAtual, alterado: false });
}
