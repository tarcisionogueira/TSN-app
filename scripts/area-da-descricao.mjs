/**
 * ÁREA A PARTIR DA DESCRIÇÃO JÁ GRAVADA — 24/09 (pedido do dono).
 * 799 imóveis ativos sem área e sem matrícula; ~180 DIZEM a área na própria descrição e a
 * coleta não extraiu. Custo zero: não baixa página nenhuma — relê `titulo + descricao` do banco
 * com o MESMO extrator da coleta (`extrairAreaM2`, api/_texto-imovel.js).
 * Só preenche quem está SEM área (nunca sobrescreve) e só aceita valor plausível (10 m² a 50 mil ha).
 * EM SECO por padrão (forma nº 10: conferir em dado real antes de gravar); AREA_APLICAR=1 grava.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; AREA_APLICAR=1; AREA_LIMITE (padrão 2000).
 *
 * O primeiro seco (24/09) mostrou três leituras plausíveis e erradas, daí as travas abaixo:
 * - PESTANA publica a ficha da CAIXA em colunas SEM rótulo ("· 90,43 · 90,43 · 168,47 ·" =
 *   total · privativa · terreno). O extrator via o último número com "m2" e gravava o TERRENO de
 *   casa. Aqui a leitura é POSICIONAL, na convenção da CEF: privativa (senão total) para
 *   casa/apartamento, terreno para terreno.
 * - "102,00 alqueires" virava 208 m² (outra área solta no texto): texto em alqueire/hectare só
 *   aceita área grande.
 * - Apartamento/sala com 6.600 m² é a área do CONDOMÍNIO: recusado acima de 1.000 m².
 * - EDITAL_DJEN é publicação de diário (acórdão, intimação) — a área citada nem sempre é do bem.
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

const FONTES_FORA = new Set(['EDITAL_DJEN']);
const numBR = (x) => { const m = String(x || '').trim().match(/^\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^\d+(?:,\d+)?$/); return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : 0; };

// Ficha CAIXA do PESTANA: "Tipo - Cidade - UF — Ocupação · 4 campos · TOTAL · PRIVATIVA · TERRENO · …"
function areaPestana(desc, tipo) {
  const c = String(desc || '').split(' · ');
  if (c.length < 8 || !/ — /.test(c[0])) return 0;
  const [total, priv, terr] = [numBR(c[5]), numBR(c[6]), numBR(c[7])];
  const ehTerreno = /^terreno/i.test(c[0]) || tipo === 'terreno';
  return ehTerreno ? (terr || total) : (priv || total);
}

function areaDe(r) {
  if (FONTES_FORA.has(r.fonte)) return { area: 0, motivo: 'fonte_fora' };
  const texto = `${r.titulo || ''}. ${r.descricao || ''}`;
  const area = r.fonte === 'PESTANA' ? areaPestana(r.descricao, r.tipo) : extrairAreaM2(texto);
  if (!(area >= 10 && area <= 500_000_000)) return { area: 0, motivo: 'sem_area' };
  if (/alqueire|hectare|\d\s*ha\b/i.test(texto) && area < 10_000) return { area: 0, motivo: 'rural_area_pequena' };
  if (/\b(apartamento|apto|sala comercial|kitnet|flat)\b/i.test(`${r.titulo || ''} ${String(r.descricao || '').slice(0, 80)}`) && area > 1000) return { area: 0, motivo: 'apto_area_condominio' };
  return { area, motivo: null };
}

const rows = [];
for (let de = 0; rows.length < LIMITE; de += 500) {
  const pag = await sb(`imoveis_leilao?ativo=eq.true&or=(area_m2.is.null,area_m2.eq.0)&descricao=not.is.null&select=id,fonte,tipo,titulo,descricao&order=id&limit=500&offset=${de}`);
  rows.push(...pag);
  if (pag.length < 500) break;
}
const porFonte = {};
let achou = 0, gravou = 0, falhou = 0;
const recusas = {};
for (const r of rows.slice(0, LIMITE)) {
  const { area, motivo } = areaDe(r);
  const f = (porFonte[r.fonte] ||= { lidos: 0, com_area: 0 });
  f.lidos++;
  if (motivo) { if (motivo !== 'sem_area') recusas[motivo] = (recusas[motivo] || 0) + 1; continue; }
  achou++; f.com_area++;
  if (!APLICAR) { if (achou <= 60) console.log(`  [seco] ${r.fonte}/${r.tipo} ${area} m²  ←  ${String(r.descricao).replace(/\s+/g, ' ').slice(0, 110)}`); continue; }
  // Só quem continua sem área; return=representation prova que gravou (forma nº 3).
  const up = await sb(`imoveis_leilao?id=eq.${r.id}&or=(area_m2.is.null,area_m2.eq.0)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ area_m2: area }) })
    .catch(e => { console.error(`  falhou ${r.id}: ${e.message}`); return null; });
  if (Array.isArray(up) && up.length === 1) gravou++; else falhou++;
}
console.log(`[area-da-descricao] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${rows.length} sem área com descrição · ${achou} com área na descrição · gravados ${gravou} · falhas ${falhou} · recusados ${JSON.stringify(recusas)}`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(porFonte).filter(([, v]) => v.com_area).sort((a, b) => b[1].com_area - a[1].com_area))));
