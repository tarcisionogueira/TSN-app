/**
 * Faxina do espelho de documentos (24/09, autorizada pelo dono): apaga cópia de imóvel que saiu
 * do acervo sem cliente e cópias idênticas (reapontando os lotes para a que fica). A regra está
 * no banco (`espelho_limpeza_candidatos`) e o passo a passo em api/_limpeza-espelho.js — o MESMO
 * que o limpar-documentos-cron roda todo dia. EM SECO por padrão; ESPELHO_APLICAR=1 apaga.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; ESPELHO_APLICAR; ESPELHO_PRAZO_MIN (padrão 40).
 */
import { limparEspelho } from '../api/_limpeza-espelho.js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }
const aplicar = process.env.ESPELHO_APLICAR === '1';
const r = await limparEspelho({ url, key, aplicar, prazoMs: Number(process.env.ESPELHO_PRAZO_MIN || 40) * 60000, lote: 3000, log: (m) => console.log(' ', m) });
if (!aplicar) for (const c of r.amostra) console.log(`  [seco] ${c.motivo} ${c.path}${c.canonico ? ` → fica ${c.canonico}` : ''} (${Math.round(c.bytes / 1024)} KB)`);
console.log(`[limpar-espelho] ${aplicar ? 'APAGANDO' : 'EM SECO (1ª página)'} · expirados ${r.expirados} · cópias ${r.dups} · ${(r.bytes / 1073741824).toFixed(2)} GB · linhas reapontadas ${r.reapontados} · falhas ${r.falhas} · ${r.segundos}s${r.erro ? ` · ERRO ${r.erro}` : ''}`);
if (r.erro && r.erro !== 'rodada sem progresso') process.exit(1);
