-- LOTE FANTASMA POR FONTE (24/10, dono: "faça o alerta").
--
-- Fantasma = lote ATIVO, de data FUTURA, que a coleta não toca há 4+ dias EMBORA a fonte tenha sido coletada com
-- sucesso nas últimas 48 h. Se a coleta passou e não o viu, o mais provável é que ele saiu do site e continua no
-- nosso ar com link morto (caso de 24/10: 5.145 veículos SUPERBID, dois abertos pelo dono com "Página não
-- encontrada"). A exigência de coleta recente é o que separa isto de "a fonte não rodou" — esse caso já é a
-- linha `medicao_velha` de fonte_regressao_pendente(), e contá-lo aqui mediria outra coisa (forma nº 10).
-- Calibrado no dia: com piso de 20 lotes e 20% do acervo da fonte, acusa SUPERBID (veículo), JELEILOES e SUBLIME.
-- Veículo casa com a saúde de `<FONTE>_VEICULOS` (coleta de veículo), imóvel com a de `<FONTE>`.
-- Lido pelo /api/health-check (2×/dia, custo zero; e-mail ao dono quando há linha).
create or replace function public.acervo_lotes_fantasma(p_dias int default 4, p_min int default 20, p_pct numeric default 20)
 returns table (tipo text, fonte text, ativos bigint, fantasmas bigint, pct numeric, ultima_coleta_ok timestamptz)
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  with s as (
    select f.fonte, max(f.executado_em) as ult_ok from fonte_saude f
     where f.status = 'ok' and f.executado_em > now() - interval '48 hours' group by 1
  ), v as (
    select 'veiculo'::text as tipo, x.fonte, count(*) as ativos,
           count(*) filter (where x.atualizado_em < now() - make_interval(days => p_dias) and x.data_leilao > now()) as fantasmas
      from veiculos_leilao x where x.ativo group by x.fonte
    union all
    select 'imovel', i.fonte, count(*),
           count(*) filter (where i.atualizado_em < now() - make_interval(days => p_dias) and greatest(i.data_fim, i.data_leilao::date) > current_date)
      from imoveis_leilao i where i.ativo and i.fonte not in ('CEF', 'caixa') group by i.fonte
  )
  select v.tipo, v.fonte, v.ativos, v.fantasmas, round(100.0 * v.fantasmas / v.ativos, 0),
         (select max(s.ult_ok) from s where s.fonte = case when v.tipo = 'veiculo' then v.fonte || '_VEICULOS' else v.fonte end)
    from v
   where v.fantasmas >= p_min and 100.0 * v.fantasmas / v.ativos >= p_pct
     and exists (select 1 from s where s.fonte = case when v.tipo = 'veiculo' then v.fonte || '_VEICULOS' else v.fonte end)
   order by v.fantasmas desc;
$function$;
