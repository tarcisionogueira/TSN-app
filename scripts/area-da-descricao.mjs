/**
 * ÁREA A PARTIR DA DESCRIÇÃO JÁ GRAVADA — 24/09 (pedido do dono).
 * 799 imóveis ativos sem área e sem matrícula; ~180 DIZEM a área na própria descrição e a
 * coleta não extraiu. Custo zero: não baixa página nenhuma — relê `titulo + descricao` do banco
 * com o MESMO extrator da coleta (`extrairAreaM2`, api/_texto-imovel.js).
 * Só preenche quem está SEM área (nunca sobrescreve) e só aceita valor plausível (10 m² a 50 mil ha).
 * EM SECO por padrão (forma nº 10: conferir em dado real antes de gravar); AREA_APLICAR=1 grava.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; AREA_APLICAR=1; AREA_LIMITE (padrão 2000).
 */
import { extrairAreaM2 } from '../api/_texto-imovel.js';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.AREA_APLICAR === '1';
const LIMITE = Number(process.env.AREA_LIMITE || 2000);
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const rows = [];
for (let de = 0; rows.length < LIMITE; de += 500) {
  const pag = await sb(`imoveis_leilao?ativo=eq.true&or=(area_m2.is.null,area_m2.eq.0)&descricao=not.is.null&select=id,fonte,titulo,descricao&order=id&limit=500&offset=${de}`);
  rows.push(...pag);
  if (pag.length < 500) break;
}
const porFonte = {};
let achou = 0, gravou = 0, falhou = 0;
for (const r of rows.slice(0, LIMITE)) {
  const area = extrairAreaM2(`${r.titulo || ''}. ${r.descricao || ''}`);
  const f = (porFonte[r.fonte] ||= { lidos: 0, com_area: 0 });
  f.lidos++;
  if (!(area >= 10 && area <= 500_000_000)) continue;
  achou++; f.com_area++;
  if (!APLICAR) { if (achou <= 40) console.log(`  [seco] ${r.fonte} ${area} m²  ←  ${String(r.descricao).replace(/\s+/g, ' ').slice(0, 110)}`); continue; }
  // Só quem continua sem área; return=representation prova que gravou (forma nº 3).
  const up = await sb(`imoveis_leilao?id=eq.${r.id}&or=(area_m2.is.null,area_m2.eq.0)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ area_m2: area }) })
    .catch(e => { console.error(`  falhou ${r.id}: ${e.message}`); return null; });
  if (Array.isArray(up) && up.length === 1) gravou++; else falhou++;
}
console.log(`[area-da-descricao] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${rows.length} sem área com descrição · ${achou} com área na descrição · gravados ${gravou} · falhas ${falhou}`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(porFonte).filter(([, v]) => v.com_area).sort((a, b) => b[1].com_area - a[1].com_area))));
