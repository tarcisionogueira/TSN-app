/**
 * #44 (05/10): devolve à fila de apuração os lotes "indeterminado" de UMA fonte cujo leitor foi
 * corrigido (zera tentativas e o resultado). Sem isto, os lotes que gastaram as tentativas com o
 * leitor antigo nunca seriam reapurados. EM SECO por padrão; REABRIR_APLICAR=1 grava.
 * REABRIR_RESULTADOS=1 também refaz vendido/sem_lance gravados pela apuração (resultado_origem
 * nulo) — para quando o leitor antigo ERROU (VIP, 05/10: "vendido R$ 5.500" num lote de R$ 1,2 mi).
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const fonte = String(process.env.REABRIR_FONTE || '').trim();
if (!fonte) { console.error('REABRIR_FONTE obrigatório'); process.exit(2); }
const estados = process.env.REABRIR_RESULTADOS === '1' ? ['indeterminado', 'vendido', 'sem_lance'] : ['indeterminado'];
const { data, error } = await sb.from('imoveis_leilao').select('id').eq('fonte', fonte).in('resultado_leilao', estados).is('resultado_origem', null);
if (error) { console.error('leitura:', error.message); process.exit(1); }
console.log(`${fonte}: ${data.length} lotes (${estados.join('/')})${process.env.REABRIR_APLICAR === '1' ? ' — reabrindo' : ' (em seco)'}`);
if (process.env.REABRIR_APLICAR !== '1') process.exit(0);
const { data: feitos, error: e2 } = await sb.from('imoveis_leilao')
  .update({ resultado_leilao: null, resultado_apuracao_tentativas: 0, valor_lance_vencedor: null })
  .eq('fonte', fonte).in('resultado_leilao', estados).is('resultado_origem', null).select('id');
if (e2) { console.error('gravar:', e2.message); process.exit(1); }
console.log(`reabertos ${feitos.length}`);
