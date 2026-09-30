-- 30/09 (dono): "estimativa entre cada despacho do juiz… em quanto tempo deve sair a próxima
-- movimentação… probabilidade de acordo com o fluxo jurídico". Base REAL: processo_movimentos (série
-- que o cnj-monitor grava; 3.268 movimentos / 109 processos em 30/09), classificados pelos códigos
-- da Tabela Processual Unificada do CNJ (51 Conclusão, 12164 Decisão, 11010 Mero expediente…).
-- Devolve, por Justiça (estadual/trabalho/federal ou todas):
--   • transições imediatas classe → próxima classe (probabilidade + dias P25/mediana/P75);
--   • 'conclusao' → 'decisao_seguinte': tempo dos autos com o juiz até a próxima decisão/despacho;
--   • 'decisao'   → 'decisao_seguinte': tempo ENTRE atos do juiz.
-- Amostra pequena não vira número: quem consome só mostra linha com n >= 5.
create or replace function public.movimento_classe(p_codigo int, p_descricao text)
returns text language sql immutable as $$
  select case
    when p_codigo in (51, 15101) or p_descricao ~* '^conclus' then 'conclusao'
    when p_codigo in (22, 848, 246) or p_descricao ~* 'baixa defini|tr[âa]nsito em julgado|arquivamento defini' then 'encerramento'
    when p_codigo in (12164, 11010, 12185, 193, 12444, 219, 898, 12266, 220, 11009, 11021)
      or p_descricao ~* 'decis[ãa]o|despacho|mero expediente|julgament|senten[çc]a|deferi|indeferi|homolog|proced[eê]n' then 'decisao'
    when p_codigo in (92, 1061, 928) or p_descricao ~* 'publica[çc][ãa]o|disponibiliza[çc][ãa]o no di[áa]rio' then 'publicacao'
    when p_codigo in (1051) or p_descricao ~* 'decurso de prazo' then 'prazo'
    when p_codigo in (85, 118) or p_descricao ~* 'peti[çc][ãa]o' then 'peticao'
    when p_codigo in (60, 12265, 12282, 106) or p_descricao ~* 'expedi|mandado|carta' then 'expedicao'
    when p_codigo in (123, 982, 132) or p_descricao ~* 'remessa|recebimento' then 'remessa'
    when p_codigo in (11383) or p_descricao ~* 'ato ordinat' then 'ato_ordinatorio'
    else 'outro' end
$$;

create or replace function public.justica_do_numero(p_numero text)
returns text language sql immutable as $$
  select case substr(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), 14, 1)
    when '8' then 'estadual' when '5' then 'trabalho' when '4' then 'federal' else 'outra' end
$$;

create or replace function public.processo_fluxo_estatistica(p_justica text default null)
returns table (de text, para text, n int, prob numeric, p25 int, mediana int, p75 int)
language sql stable security definer set search_path to 'public' as $$
  with m as (
    select numero_processo, data, public.movimento_classe(codigo, descricao) as classe
      from processo_movimentos
     where p_justica is null or public.justica_do_numero(numero_processo) = p_justica
  ),
  -- um evento por (processo, dia, classe): rajadas do mesmo dia não viram "transição de 0 dias"
  e as (select distinct numero_processo, data, classe from m where classe <> 'outro'),
  seq as (
    select numero_processo, data, classe,
           lead(classe) over w as prox, lead(data) over w as prox_data
      from e window w as (partition by numero_processo order by data, classe)
  ),
  imediatas as (
    select classe as de, prox as para, (prox_data - data) as dias
      from seq where prox is not null and prox <> classe
  ),
  ate_decisao as (   -- de conclusão/decisão até a PRÓXIMA decisão (não necessariamente imediata)
    select a.classe as de, 'decisao_seguinte'::text as para,
           (select min(b.data) from e b where b.numero_processo = a.numero_processo and b.classe = 'decisao' and b.data > a.data) - a.data as dias
      from e a where a.classe in ('conclusao', 'decisao')
  ),
  tudo as (select * from imediatas union all select * from ate_decisao where dias is not null)
  select t.de, t.para, count(*)::int,
         case when t.para = 'decisao_seguinte' then null
              else round(count(*)::numeric / nullif(sum(count(*)) filter (where t.para <> 'decisao_seguinte') over (partition by t.de), 0), 3) end,
         percentile_disc(0.25) within group (order by t.dias)::int,
         percentile_disc(0.5)  within group (order by t.dias)::int,
         percentile_disc(0.75) within group (order by t.dias)::int
    from tudo t group by t.de, t.para;
$$;
revoke all on function public.processo_fluxo_estatistica(text) from public, anon, authenticated;
grant execute on function public.processo_fluxo_estatistica(text) to service_role;
