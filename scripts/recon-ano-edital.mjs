/**
 * RECON EM SECO (26/09) — quanto `anoPorDocumento` (api/_ano-veiculo.js) acha de ano/placa nos
 * veículos ativos SEM ano, pelo edital em PDF e pela página do lote. Nada é gravado.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; RECON_LIMITE (padrão 120).
 */
import { anoPorDocumento } from '../api/_ano-veiculo.js';

const SB_URL = process.env.VITE_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = Number(process.env.RECON_LIMITE || 120);
const FONTES = process.env.RECON_FONTES ? `&fonte=in.(${process.env.RECON_FONTES})` : '';
const sb = async (path) => {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
};
const vs = await sb(`veiculos_leilao?ativo=eq.true&ano_fabricacao=is.null&ano_modelo=is.null&select=id,fonte,titulo,modelo,placa,chassi,anexos,link_lote${FONTES}&limit=${LIMITE}&order=fonte`);
const lotesPorDoc = async (url) => (await sb(`veiculos_leilao?anexos=cs.${encodeURIComponent(JSON.stringify([{ url }]))}&select=id&limit=2`)).length;
const res = {};
const placasVistas = new Map(); // placa → título (a mesma placa em 2 lotes = leitura do vizinho)
for (const v of vs) {
  const t0 = Date.now();
  const a = await anoPorDocumento(v, lotesPorDoc).catch((e) => ({ ano: null, motivos: [`exceção ${e.message}`] }));
  // mesma checagem do endpoint: placa de OUTRO veículo = leitura errada
  if (a.placa) {
    const outro = await sb(`veiculos_leilao?placa=eq.${encodeURIComponent(a.placa)}&id=neq.${v.id}&select=id&limit=1`);
    if (outro.length) { a.motivos = [...(a.motivos || []), `placa ${a.placa} é de outro veículo — descartado`]; a.ano = null; }
  }
  if (a.ano && a.placa) {
    if (placasVistas.has(a.placa)) { res.PLACA_REPETIDA = (res.PLACA_REPETIDA || 0) + 1; console.log(`  ⚠️ placa ${a.placa} já saiu para "${placasVistas.get(a.placa)}"`); }
    else placasVistas.set(a.placa, String(v.titulo).slice(0, 40));
  }
  const k = `${v.fonte}:${a.ano ? a.fonte : 'nao_achou'}`;
  res[k] = (res[k] || 0) + 1;
  console.log(`${v.fonte} · ${String(v.titulo).slice(0, 55)} → ${a.ano ? `${a.ano.join('/')} (${a.fonte})${a.placa ? ` placa ${a.placa}` : ''}` : `✗ ${a.motivos.join(' · ')}`} · ${Date.now() - t0} ms`);
}
console.log(`\n[resumo] ${vs.length} veículos · ${JSON.stringify(res)}`);
