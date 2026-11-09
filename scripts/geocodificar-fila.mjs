/**
 * Fila de geolocalização no GitHub Actions (09/11) — CUSTO ZERO.
 *
 * O gargalo da fila é o 1 req/s do Nominatim: cada rodada da Vercel para em 240 s (~40 lotes/hora) e passa quase
 * todo o tempo ESPERANDO — e a Vercel cobra a memória provisionada pelo tempo de parede, inclusive a espera. Aqui
 * (repositório público = minutos de Actions grátis) a mesma `processarLote` de api/geocodificar.js roda até ~45 min.
 *
 * Sem GOOGLE_MAPS_API_KEY no GitHub: só rotas gratuitas (Nominatim/IBGE/BrasilAPI). O Google continua na rodada
 * horária da Vercel e na página do imóvel, sob o teto mensal de api/_geo.js.
 *
 * Nunca encosta na rodada da Vercel (minuto :00): para no minuto :57 da hora, qualquer que seja o atraso do agendador
 * do GitHub — somadas, as duas nunca passam de 1 req/s no Nominatim.
 */
import { processarLote } from '../api/geocodificar.js';

const MIN = Number(process.env.GEOCOD_MINUTOS || 45);
const agora = new Date();
const limiteHora = new Date(agora); limiteHora.setUTCMinutes(57, 0, 0);
if (limiteHora <= agora) limiteHora.setUTCHours(limiteHora.getUTCHours() + 1);
const deadline = Math.min(Date.now() + MIN * 60_000, limiteHora.getTime());

const total = { processados: 0, endereco: 0, rua: 0, bairro: 0, cidade: 0, falhas: 0, cache_hits: 0, lotes: 0 };
let erro = null, tentativas = 0;
console.log(`[geocodificar-fila] até ${new Date(deadline).toISOString()}`);
while (Date.now() < deadline) {
  const res = await processarLote('', 50, deadline, null);
  if (res?.erro) { erro = res.erro; if (++tentativas > 3) break; await new Promise((r) => setTimeout(r, 3000 * tentativas)); continue; }
  if (!res || res.processados === 0) break;
  for (const k of ['processados', 'endereco', 'rua', 'bairro', 'cidade', 'falhas', 'cache_hits']) total[k] += res[k] || 0;
  total.lotes++;
  console.log(`[geocodificar-fila] lote ${total.lotes}: ${JSON.stringify(res)}`);
  if (res.interrompido || res.processados < 50) break;
}
console.log('[geocodificar-fila] fim', JSON.stringify({ ...total, erro }));
// Não conseguiu LER a fila e nada processou = falha (vermelho), não "fila vazia".
if (erro && total.processados === 0) process.exit(1);
