#!/usr/bin/env node
/**
 * DIAGNÓSTICO PONTUAL — reproduz a cascata de geocodificação (api/_geo.js) para UM
 * imóvel, imprimindo o que CADA nível da cascata devolveu (não só o resultado final),
 * para achar em qual passo o pino saiu do lugar certo.
 *
 * Roda com permitirPago:false (sem GOOGLE_MAPS_API_KEY/GEOCODER_KEY no ambiente do
 * GitHub Actions) — isola o comportamento das rotas GRATUITAS (Nominatim/IBGE/
 * BrasilAPI), que é o que qualquer imóvel sem geocode em cache usa por padrão no
 * cron em lote (api/geocodificar.js roda com o mesmo permitirPago condicional).
 *
 * Uso: DIAG_IMOVEL_ID=<uuid> node scripts/diagnostico-geocode-lote.mjs
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, DIAG_IMOVEL_ID.
 */
import {
  parseLogradouro, nominatimEstruturado, nominatimTextoLivre, brasilapiCep,
  coordValida, centroideIBGE, UFS, sanearLocalizacao,
} from '../api/_geo.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const ID = process.env.DIAG_IMOVEL_ID;
if (!SB || !KEY || !ID) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY / DIAG_IMOVEL_ID'); process.exit(1); }

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text().catch(() => '')).slice(0, 150)}`);
  return r.json();
}

async function main() {
  const [imBruto] = await sbGet(`imoveis_leilao?id=eq.${ID}&select=titulo,endereco,bairro,cidade,estado,cep,latitude,longitude,geocod_nivel,nomecondominio&limit=1`);
  if (!imBruto) { console.error('Imóvel não encontrado'); process.exit(1); }
  console.log('── DADO BRUTO NO BANCO ──');
  console.log(JSON.stringify(imBruto, null, 2));

  const im = sanearLocalizacao(imBruto);
  console.log('\n── APÓS sanearLocalizacao ──');
  console.log(`  endereco: ${JSON.stringify(im.endereco)}`);
  console.log(`  bairro:   ${JSON.stringify(im.bairro)}`);

  const { via, numero } = parseLogradouro(im.endereco);
  console.log('\n── parseLogradouro ──');
  console.log(`  via:    ${JSON.stringify(via)}`);
  console.log(`  numero: ${JSON.stringify(numero)}  ${numero ? '' : '⚠️  NÚMERO PERDIDO'}`);

  const { cidade, estado, bairro, cep } = im;
  const ufNome = UFS[String(estado || '').trim().toUpperCase()]?.nome || estado;
  const cen = centroideIBGE(cidade, estado);
  console.log(`\n── Centróide IBGE (${cidade}/${estado}) ──`);
  console.log(`  ${cen ? `${cen.lat}, ${cen.lng}` : 'não encontrado'}`);

  const rotas = [];
  if (via) {
    rotas.push(['1 — Nominatim estruturado (street=via+numero)', () => nominatimEstruturado({ street: [via, numero].filter(Boolean).join(' '), city: cidade, state: ufNome })]);
    rotas.push(['1.2 — Nominatim texto livre (via+numero, bairro, cidade)', () => nominatimTextoLivre([[via, numero].filter(Boolean).join(' '), bairro, cidade, ufNome, 'Brasil'].filter(Boolean).join(', '))]);
  }
  if (cep) rotas.push([`1.5 — BrasilAPI CEP (${cep})`, () => brasilapiCep(cep)]);
  if (bairro) rotas.push(['2 — Nominatim estruturado (street=bairro) ← SUSPEITO', () => nominatimEstruturado({ street: bairro, city: cidade, state: ufNome })]);

  console.log('\n── CADA ROTA DA CASCATA, ISOLADA (sem parar na 1ª que acertar) ──');
  for (const [nome, fn] of rotas) {
    try {
      const r = await fn();
      if (!r) { console.log(`  [${nome}] → sem resultado`); continue; }
      const valida = r.lat != null ? coordValida(r.lat, r.lng, estado, cidade, 80) : null;
      const distCen = (cen && r.lat != null) ? haversineAprox(r.lat, r.lng, cen.lat, cen.lng).toFixed(1) : '?';
      console.log(`  [${nome}]`);
      console.log(`      lat/lng: ${r.lat}, ${r.lng} | nivelMatch: ${r.nivelMatch || r.nivel || '(n/a)'} | válida(UF/80km): ${valida} | dist. centróide cidade: ${distCen} km`);
    } catch (e) {
      console.log(`  [${nome}] → ERRO: ${String(e?.message || e).slice(0, 150)}`);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  console.log('\n✅ Diagnóstico concluído — compare cada lat/lng acima com o endereço real no Google Maps.');
}

function haversineAprox(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

main().catch((e) => { console.error('Diagnóstico falhou:', e?.message || e); process.exit(1); });
