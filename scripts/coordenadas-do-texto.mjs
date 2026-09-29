/**
 * COORDENADA DO IMÓVEL A PARTIR DOS VÉRTICES NO TEXTO — 29/09 (passo 3 da localização, 2ª parte).
 * Terrenos/rurais com pino no CENTRO DA CIDADE cujo texto traz vértices do georreferenciamento
 * (GMS ou decimal) — ver scripts/lib/coordenadas-do-texto.mjs. Grava lat/lng com
 * geocod_nivel='endereco' (o ponto é do próprio imóvel) e zera as proximidades (dependem do ponto).
 * Trava: o ponto tem de cair a até 80 km do pino atual (centro da cidade do lote) — mais longe é
 * outro imóvel ou vértice mal transcrito. EM SECO por padrão; COORD_APLICAR=1 grava.
 */
import { coordenadasDoTexto, distanciaKm } from './lib/coordenadas-do-texto.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.COORD_APLICAR === '1';
const RAIO_KM = 80;
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function todas(path) {
  const out = [];
  for (let de = 0; ; de += 1000) { const pag = await sb(`${path}&limit=1000&offset=${de}`); out.push(...pag); if (pag.length < 1000) return out; }
}

const alvo = await todas('imoveis_leilao?ativo=eq.true&tipo=in.(terreno,rural)&geocod_nivel=in.(cidade,refazer)&select=id,fonte,tipo,cidade,estado,latitude,longitude,titulo,descricao&order=id');
const motivos = {}; let achou = 0, gravou = 0;
const conta = (m) => { motivos[m] = (motivos[m] || 0) + 1; };
for (const im of alvo) {
  const c = coordenadasDoTexto(`${im.titulo || ''} ${im.descricao || ''}`);
  if (!c) { conta('sem_coordenada'); continue; }
  const pino = { lat: Number(im.latitude), lng: Number(im.longitude) };
  if (!pino.lat || !pino.lng) { conta('sem_pino_para_conferir'); continue; }
  const km = distanciaKm(pino, c);
  if (km > RAIO_KM) { conta('longe_do_municipio'); if (!APLICAR) console.log(`  [recusa] ${im.fonte} ${im.cidade}/${im.estado}: ${c.lat}, ${c.lng} a ${km.toFixed(0)} km do centro`); continue; }
  achou++;
  if (!APLICAR) { if (achou <= 40) console.log(`  [seco] ${im.fonte}/${im.tipo} ${im.cidade}/${im.estado} → ${c.lat}, ${c.lng} (${c.vertices} vértice(s), ${km.toFixed(1)} km do centro)`); continue; }
  const up = await sb(`imoveis_leilao?id=eq.${im.id}&geocod_nivel=in.(cidade,refazer)`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ latitude: c.lat, longitude: c.lng, geocod_nivel: 'endereco', pontos_proximos: null, proximidades_em: null }) })
    .catch((e) => { console.error(`  falhou ${im.id}: ${e.message}`); return null; });
  if (Array.isArray(up) && up.length === 1) gravou++;
}
console.log(`[coordenadas-do-texto] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${alvo.length} terrenos/rurais com pino na cidade · ${achou} com coordenada válida no texto · gravados ${gravou} · recusas ${JSON.stringify(motivos)}`);
