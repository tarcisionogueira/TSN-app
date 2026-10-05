/**
 * #44 (05/10): devolve à fila de apuração os lotes "indeterminado" de UMA fonte cujo leitor foi
 * corrigido (zera tentativas e o resultado). Sem isto, os lotes que gastaram as tentativas com o
 * leitor antigo nunca seriam reapurados. EM SECO por padrão; REABRIR_APLICAR=1 grava.
 */
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const fonte = String(process.env.REABRIR_FONTE || '').trim();
if (!fonte) { console.error('REABRIR_FONTE obrigatório'); process.exit(2); }
const { data, error } = await sb.from('imoveis_leilao').select('id').eq('fonte', fonte).eq('resultado_leilao', 'indeterminado');
if (error) { console.error('leitura:', error.message); process.exit(1); }
console.log(`${fonte}: ${data.length} lotes indeterminados${process.env.REABRIR_APLICAR === '1' ? ' — reabrindo' : ' (em seco)'}`);
if (process.env.REABRIR_APLICAR !== '1') process.exit(0);
const { data: feitos, error: e2 } = await sb.from('imoveis_leilao')
  .update({ resultado_leilao: null, resultado_apuracao_tentativas: 0 })
  .eq('fonte', fonte).eq('resultado_leilao', 'indeterminado').select('id');
if (e2) { console.error('gravar:', e2.message); process.exit(1); }
console.log(`reabertos ${feitos.length}`);
