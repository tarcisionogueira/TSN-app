#!/usr/bin/env node
/**
 * Enriquecimento em LOTE de valor FIPE de referência para veículos em leilão.
 *
 * A régua de casamento e a trava de cota diária vivem em api/_fipe.js — mesma usada pela
 * busca SOB DEMANDA (api/veiculo-fipe.js, disparada ao abrir a tela do veículo). Este cron
 * cobre o backfill do acervo inteiro aos poucos; a busca sob demanda cobre o veículo que
 * um analista abre AGORA, antes do cron chegar nele.
 *
 * NUNCA roda no fluxo de captura — a FIPE só atualiza a tabela 1x/mês, não faz sentido chamar
 * a cada scrape.
 *
 * 24/09: (a) marca/modelo vêm do TÍTULO quando a fonte não separa (93% do acervo não tinha
 * `modelo` e nunca entrava aqui); (b) respostas da API ficam em `fipe_cache` por 25 dias — acerto
 * não gasta cota; (c) o lote vai até a cota acabar, não para em 60. Prioriza leilão mais próximo.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: FIPE_LIMITE (padrão 600).
 */
import { createClient } from '@supabase/supabase-js';
import { criarFipeFetch, buscarFipe, RETENTAR_SEM_MATCH_DIAS, RETENTAR_OK_DIAS, TETO_CRON_FIPE } from '../api/_fipe.js';

const TIPOS_COM_FIPE = ['carro', 'moto', 'caminhao', 'van_utilitario', 'onibus'];

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.FIPE_LIMITE || '600', 10);

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB, KEY);

// Prova que a linha mudou (`.select()`) em vez de confiar em `error: null` — update que a RLS
// filtra devolve `error: null` do mesmo jeito (ver CLAUDE.md, forma nº 3).
async function gravar(id, campos) {
  const { data, error } = await supabase.from('veiculos_leilao').update(campos).eq('id', id).select('id');
  if (error) { console.log(`  ⚠️ gravação falhou (veículo ${id}): ${error.message}`); return false; }
  if (!data?.length) { console.log(`  ⚠️ gravação não alcançou nenhuma linha (veículo ${id}) — RLS ou id inexistente`); return false; }
  return true;
}

async function main() {
  const desde90 = new Date(Date.now() - RETENTAR_SEM_MATCH_DIAS * 86400000).toISOString();
  const desde25 = new Date(Date.now() - RETENTAR_OK_DIAS * 86400000).toISOString();
  // PRIORIDADE (25/09, pedido do dono: "sem FIPE não conseguimos fazer proposta"). A fila era
  // `data_leilao asc` — o mais ANTIGO primeiro, o que gastava a cota diária em lote já VENDIDO
  // e deixava por último o "sem lance", que é exatamente onde entra a proposta de compra direta.
  // Agora: 1º sem lance/condicional (alvo de proposta), 2º leilão futuro mais próximo. Vendido
  // não entra — FIPE de lote arrematado não serve a ninguém.
  // CARROS PRIMEIRO (14/10, dono: "dê preferência aos carros, são os que eu mais consulto"): a fila é
  // montada em duas levas — carro, depois os demais tipos — e a cota do dia acaba nos carros antes.
  const base = (tipos) => supabase
    .from('veiculos_leilao')
    .select('id, titulo, marca, modelo, ano_fabricacao, ano_modelo, tipo_veiculo, fipe_status, fipe_atualizado_em')
    .eq('ativo', true)
    .in('tipo_veiculo', tipos)
    .not('ano_fabricacao', 'is', null)
    .or(`fipe_atualizado_em.is.null,and(fipe_status.in.(sem_match,sem_dados),fipe_atualizado_em.lt.${desde90}),and(fipe_status.not.in.(sem_match,sem_dados),fipe_atualizado_em.lt.${desde25})`);
  const hoje = new Date().toISOString().slice(0, 10);
  const OUTROS = TIPOS_COM_FIPE.filter((t) => t !== 'carro');
  const leva = (tipos) => [
    base(tipos).in('resultado_leilao', ['sem_lance', 'condicional']).order('resultado_apurado_em', { ascending: false, nullsFirst: false }).limit(LIMITE),
    base(tipos).is('resultado_leilao', null).gte('data_leilao', hoje).order('data_leilao', { ascending: true }).limit(LIMITE),
  ];
  const respostas = await Promise.all([...leva(['carro']), ...leva(OUTROS)]);
  const errBusca = respostas.find((r) => r.error)?.error;
  const vistos = new Set();
  const candidatos = respostas.flatMap((r) => r.data || [])
    .filter((v) => !vistos.has(v.id) && vistos.add(v.id)).slice(0, LIMITE);
  if (errBusca) { console.error('Erro ao buscar candidatos:', errBusca.message); process.exit(1); }
  if (!candidatos?.length) { console.log('Nada pendente.'); return; }
  console.log(`${candidatos.length} veículo(s) candidato(s) a enriquecer.`);

  const validoDesde = new Date(Date.now() - RETENTAR_OK_DIAS * 86400000).toISOString();
  let acertos = 0, novos = 0;
  const cacheFipe = {
    async ler(path) {
      const { data, error } = await supabase.from('fipe_cache').select('resposta').eq('path', path).gte('obtido_em', validoDesde).maybeSingle();
      if (error) throw new Error(error.message);
      if (data) acertos++;
      return data?.resposta;
    },
    async gravar(path, resposta) {
      const { error } = await supabase.from('fipe_cache').upsert({ path, resposta, obtido_em: new Date().toISOString() }).select('path');
      if (error) throw new Error(error.message);
      novos++;
    },
  };
  // Teto do LOTE no contador do dia: 75% da cota útil (TETO_CRON_FIPE, 15/10); FIPE_TETO_LOTE só para baixar à mão.
  const teto = Math.min(TETO_CRON_FIPE, Number(process.env.FIPE_TETO_LOTE) || TETO_CRON_FIPE);
  const fipeGet = criarFipeFetch(() => supabase.rpc('registrar_uso_fipe', { p_teto: teto }).then(r => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }), cacheFipe);
  const cache = new Map(); // marcas/modelos por categoria — reaproveitado por todo o lote

  let ok = 0, aproximado = 0, semMatch = 0, semDados = 0, erro = 0, semCota = 0;
  let falhasSeguidas = 0;
  for (const v of candidatos) {
    // 16/10: UMA requisição lenta (timeout de 15 s) derrubava o lote inteiro com exit 1 — os 279
    // gastos no dia ficaram sem o resto. Falha de rede não é "sem FIPE": não grava nada no veículo
    // (ele volta amanhã), conta como erro e segue; 5 seguidas = API fora, para o lote.
    let resultado;
    try { resultado = await buscarFipe(fipeGet, v, cache); falhasSeguidas = 0; }
    catch (e) {
      erro++; falhasSeguidas++;
      console.log(`  ⚠️ FIPE falhou para ${v.id}: ${String(e?.message || e).slice(0, 100)} — fica para a próxima rodada`);
      if (falhasSeguidas >= 5) { console.log('  🛑 5 falhas seguidas — API da FIPE fora; parando o lote.'); break; }
      continue;
    }
    if (resultado.status === 'sem_cota') {
      console.log('  🛑 cota diária da FIPE esgotada — parando o lote aqui (retoma amanhã).');
      semCota++; break;
    }
    const agora = new Date().toISOString();
    // Faixa (20/10): intervalo do `aproximado` ou do `faixa_modelo` (lote sem ano) — mesma gravação de api/_fipe-garantir.js.
    const faixa = Array.isArray(resultado.faixa) ? { fipe_faixa_min: resultado.faixa[0], fipe_faixa_max: resultado.faixa[1] } : { fipe_faixa_min: null, fipe_faixa_max: null };
    if (resultado.status === 'ok' || resultado.status === 'aproximado') {
      const gravou = await gravar(v.id, {
        valor_fipe: resultado.valor, fipe_codigo: resultado.codigoFipe,
        fipe_mes_referencia: resultado.mesReferencia, fipe_status: resultado.status, fipe_atualizado_em: agora, ...faixa,
      });
      if (!gravou) { erro++; continue; }
      resultado.status === 'ok' ? ok++ : aproximado++;
    } else if (resultado.status === 'faixa_modelo') {
      const gravou = await gravar(v.id, { valor_fipe: null, fipe_codigo: null, fipe_mes_referencia: resultado.mesReferencia, fipe_status: 'faixa_modelo', fipe_atualizado_em: agora, ...faixa });
      if (!gravou) { erro++; continue; }
      aproximado++;
    } else {
      const gravou = await gravar(v.id, { fipe_status: resultado.status, fipe_atualizado_em: agora });
      if (!gravou) { erro++; continue; }
      if (resultado.status === 'sem_match') semMatch++;
      else if (resultado.status === 'sem_dados') semDados++;
      else erro++;
    }
  }
  console.log(`Concluído: ${ok} ok, ${aproximado} aproximado, ${semMatch} sem_match, ${semDados} sem_dados (título sem marca/modelo), ${erro} erro, ${semCota ? 'parado por cota' : 'cota ok'}.`);
  console.log(`Cache: ${acertos} resposta(s) reaproveitada(s) sem gastar cota, ${novos} nova(s) guardada(s).`);
}

main();
