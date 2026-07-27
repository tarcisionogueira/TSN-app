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
import { hostExternoSeguro } from './_allowed-hosts.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Localiza no documento/página do imóvel (edital/matrícula) QUALQUER informação
// que ajude a geolocalizar: logradouro + número (leva a nível 'endereço', o mais
// preciso), bairro e CEP. fetch direto primeiro; se bloquear (Cloudflare), BD.
async function infoDoDocumento(url) {
  // Anti-SSRF: a URL vem do banco (link_edital) e é buscada pelo servidor — bloqueia
  // destinos internos/metadados de nuvem, permitindo qualquer leiloeiro/CDN público.
  if (!hostExternoSeguro(url)) return null;
  let txt = '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (r.ok) txt = await r.text().catch(() => '');
  } catch { /* segue p/ Bright Data */ }
  if (!txt || txt.length < 200) {
    try { const bd = await fetchViaBrightData(url); if (bd) txt = await bd.text().catch(() => '') || txt; } catch { /* */ }
  }
  if (!txt) return null;
  // Texto limpo (sem tags/scripts) para os padrões de endereço.
  const plano = txt
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ');
  // Logradouro + número: "Rua X, nº 123" / "Avenida Y, 456"
  const mVia = plano.match(/((?:rua|avenida|av\.?|travessa|tv\.?|alameda|al\.?|estrada|estr\.?|rodovia|rod\.?|pra[çc]a|largo|viela|quadra|rma)\s+[^,;.:()\d]{3,60}?)[,\s]+(?:n[º°.]?\s*|num(?:ero)?\.?\s*)?(\d{1,6})\b/i);
  const bairroM = plano.match(/bairro[:\s]+([^,;.:()\n]{3,40})/i);
  const cepM = plano.match(/cep[:\s]*?(\d{5})-?(\d{3})/i) || plano.match(/\b(\d{5})-?(\d{3})\b/);
  const endereco = mVia ? `${mVia[1].replace(/\s+/g, ' ').trim()}, ${mVia[2]}` : null;
  const bairro = bairroM ? bairroM[1].trim() : null;
  const cep = cepM ? `${cepM[1]}${cepM[2]}` : null;
  // Data do leilão / prazo de propostas (perto de palavra-chave, p/ não pegar
  // qualquer data solta do documento). Serve p/ preencher imóveis sem data.
  const dataM = plano.match(/(?:leil[ãa]o|1[ªa]?\s*pra[çc]a|2[ªa]?\s*pra[çc]a|pra[çc]a|propostas?|encerr\w*|abertura|realizar[- ]?se[- ]?[áa]?)[^\d]{0,40}(\d{2})\/(\d{2})\/(\d{4})/i);
  const dataLeilao = dataM ? `${dataM[3]}-${dataM[2]}-${dataM[1]}` : null;
  return (endereco || cep || bairro || dataLeilao) ? { endereco, bairro, cep, dataLeilao } : null;
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

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=id,endereco,bairro,cidade,estado,latitude,longitude,geocod_nivel,cep,condominio:nomecondominio,link_edital,data_leilao&limit=1`)).json();
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
  const semEndPreciso = !(im.endereco && /\d/.test(im.endereco));
  if (rankNivel(melhorAtual) < rankNivel('rua') && !im.cep && semEndPreciso && im.link_edital) {
    let info = null;
    try { info = await infoDoDocumento(im.link_edital); } catch { /* */ }
    if (info && (info.endereco || info.cep)) {
      // Re-geocodifica com o que o documento revelou (endereço completo > CEP > bairro).
      const imEnriquecido = {
        ...im,
        endereco: info.endereco || im.endereco,
        bairro: im.bairro || info.bairro || '',
        cep: info.cep || im.cep,
      };
      let coords2 = null;
      try { coords2 = await geocodificarCascata(imEnriquecido, { sleepMs: 0, deadline: Date.now() + 12000 }); } catch { /* */ }
      const melhora = coords2 && rankNivel(coords2.nivel) > rankNivel(melhorAtual) && coordValida(coords2.lat, coords2.lng, im.estado, im.cidade);
      // Grava o que achou (endereço/CEP) mesmo sem melhorar a coord — enriquece o
      // registro e evita repetir a busca do documento nas próximas aberturas.
      const body = {
        ...(info.cep ? { cep: info.cep } : {}),
        ...(info.endereco && semEndPreciso ? { endereco: info.endereco } : {}),
        // Data do leilão/propostas do edital, se o imóvel estiver sem — mantém fiel à fonte.
        ...(info.dataLeilao && !im.data_leilao ? { data_leilao: info.dataLeilao } : {}),
        ...(melhora ? { latitude: coords2.lat, longitude: coords2.lng, geocod_nivel: coords2.nivel, pontos_proximos: null, proximidades_em: null } : {}),
      };
      if (Object.keys(body).length) {
        const up = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) });
        if (melhora) { res.status(200).json({ ok: up.ok, nivel: coords2.nivel, anterior: nivelAtual, alterado: up.ok, lat: coords2.lat, lng: coords2.lng, via: 'documento' }); return; }
      }
    }
  }

  res.status(200).json({ ok: true, nivel: nivelAtual, alterado: false });
}
