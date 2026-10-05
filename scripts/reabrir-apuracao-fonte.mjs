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
// REABRIR_SUSPEITOS=1 (05/10, #44): só "vendido" com valor < 30% do lance mínimo — a assinatura do
// leitor antigo pegando o R$ de uma cláusula (débito, incremento). Vira indeterminado + volta à fila:
// "vendido por R$ 25.000" num lote de R$ 167.000 é pior que "não sei". REABRIR_FONTE='*' = todas.
if (process.env.REABRIR_SUSPEITOS === '1') {
  let q = sb.from('imoveis_leilao').select('id,fonte,valor_minimo,valor_lance_vencedor')
    .eq('resultado_leilao', 'vendido').is('resultado_origem', null).not('valor_lance_vencedor', 'is', null).limit(5000);
  if (fonte !== '*') q = q.eq('fonte', fonte);
  const { data: v, error: ev } = await q;
  if (ev) { console.error('leitura:', ev.message); process.exit(1); }
  const alvo = v.filter((l) => Number(l.valor_minimo) > 0 && Number(l.valor_lance_vencedor) < 0.3 * Number(l.valor_minimo));
  const porFonte = {}; for (const l of alvo) porFonte[l.fonte] = (porFonte[l.fonte] || 0) + 1;
  console.log(`suspeitos: ${alvo.length} de ${v.length} vendidos · ${JSON.stringify(porFonte)}${process.env.REABRIR_APLICAR === '1' ? ' — reabrindo' : ' (em seco)'}`);
  if (process.env.REABRIR_APLICAR !== '1') process.exit(0);
  let ok = 0;
  for (let i = 0; i < alvo.length; i += 100) {
    const ids = alvo.slice(i, i + 100).map((l) => l.id);
    const { data: f, error: e3 } = await sb.from('imoveis_leilao')
      .update({ resultado_leilao: 'indeterminado', valor_lance_vencedor: null, resultado_apuracao_tentativas: 0 })
      .in('id', ids).eq('resultado_leilao', 'vendido').select('id');
    if (e3) { console.error('gravar:', e3.message); process.exit(1); }
    ok += f.length;
  }
  console.log(`reabertos ${ok}`);
  process.exit(0);
}
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
