-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ENDURECIMENTO DA REVISÃO DE 29/09 (advisors do Supabase sobre o que entrou no dia)
--  1. sem_acento: search_path fixo (advisor function_search_path_mutable). Função pura, só usa
--     pg_catalog — travar o caminho não muda o resultado nem invalida o índice de expressão.
--  2. salvar_parcelamento_arremate: já confere dono/equipe e a forma; faltava TETO de tamanho do
--     JSON (usuário logado podia gravar um payload arbitrário na linha do arremate) e VALIDAÇÃO dos
--     campos que o cron lê: uma data inválida ("abc") fazia `toISOString()` lançar e derrubava o
--     lembrete de TODOS os arremates (o cron agora também isola por linha — defesa nos dois lados).
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter function public.sem_acento(text) set search_path = pg_catalog;

create or replace function public.salvar_parcelamento_arremate(p_arrematado uuid, p_parcelamento jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if not exists (
    select 1 from public.arrematados a
     where a.id = p_arrematado
       and (a.user_id = auth.uid()
            or exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','analista','consultor','advogado')))
  ) then
    raise exception 'sem permissão para este arremate';
  end if;
  if p_parcelamento is not null and coalesce(p_parcelamento->>'forma','') not in ('a_vista','parcelado') then
    raise exception 'forma inválida';
  end if;
  if p_parcelamento is not null and pg_column_size(p_parcelamento) > 8192 then
    raise exception 'parcelamento grande demais';
  end if;
  if p_parcelamento is not null then
    if coalesce(p_parcelamento->>'entrada_venc','') !~ '^(\d{4}-\d{2}-\d{2})?$'
       or coalesce(p_parcelamento->>'primeira_venc','') !~ '^(\d{4}-\d{2}-\d{2})?$' then
      raise exception 'data de vencimento inválida (use AAAA-MM-DD)';
    end if;
    perform nullif(p_parcelamento->>'entrada_venc','')::date, nullif(p_parcelamento->>'primeira_venc','')::date;
    if p_parcelamento ? 'parcelas' and (jsonb_typeof(p_parcelamento->'parcelas') <> 'number'
       or (p_parcelamento->>'parcelas')::numeric not between 1 and 60) then
      raise exception 'parcelas deve ser de 1 a 60';
    end if;
    if p_parcelamento ? 'entrada_pct' and (jsonb_typeof(p_parcelamento->'entrada_pct') <> 'number'
       or (p_parcelamento->>'entrada_pct')::numeric not between 0 and 100) then
      raise exception 'entrada_pct deve ser de 0 a 100';
    end if;
    if p_parcelamento ? 'pagas' and (jsonb_typeof(p_parcelamento->'pagas') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_parcelamento->'pagas') e
                   where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric not between 0 and 60)) then
      raise exception 'pagas deve ser lista de índices 0..60';
    end if;
  end if;
  update public.arrematados
     set parcelamento = case when p_parcelamento is null then null
                             else p_parcelamento || jsonb_build_object('atualizado_em', now(), 'atualizado_por', auth.uid()) end,
         updated_at = now()
   where id = p_arrematado
  returning parcelamento into v;
  return v;
end $function$;
