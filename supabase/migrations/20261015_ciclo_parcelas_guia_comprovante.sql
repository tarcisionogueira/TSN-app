-- Ciclo das parcelas da arrematação (15/10, dono): guia recebida → aprovada e enviada ao arrematante → comprovante
-- recebido e guardado → parcela paga. Regra de datas em src/utils/parcelamentoArremate.js (30 dias encadeados a
-- partir do pagamento da entrada; pagar até = vencimento − folga_dias, antecipado para dia útil).

-- 1) A RPC da tela passa a validar os campos novos do parcelamento.
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
  if p_parcelamento is not null and pg_column_size(p_parcelamento) > 16384 then
    raise exception 'parcelamento grande demais';
  end if;
  if p_parcelamento is not null then
    if coalesce(p_parcelamento->>'entrada_venc','') !~ '^(\d{4}-\d{2}-\d{2})?$'
       or coalesce(p_parcelamento->>'primeira_venc','') !~ '^(\d{4}-\d{2}-\d{2})?$'
       or coalesce(p_parcelamento->>'entrada_paga_em','') !~ '^(\d{4}-\d{2}-\d{2})?$' then
      raise exception 'data inválida (use AAAA-MM-DD)';
    end if;
    perform nullif(p_parcelamento->>'entrada_venc','')::date, nullif(p_parcelamento->>'primeira_venc','')::date,
            nullif(p_parcelamento->>'entrada_paga_em','')::date;
    if p_parcelamento ? 'folga_dias' and (jsonb_typeof(p_parcelamento->'folga_dias') <> 'number'
       or (p_parcelamento->>'folga_dias')::numeric not between 0 and 10) then
      raise exception 'folga_dias deve ser de 0 a 10';
    end if;
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

-- 2) Escrita ATÔMICA do servidor (cron que lê guia/comprovante): mexe só na chave da parcela, sem sobrescrever o
--    que a tela gravou no meio do caminho. SECURITY INVOKER + checagem de papel: só o service_role chama.
create or replace function public.parcelamento_registrar(p_arrematado uuid, p_idx int, p_guia jsonb default null,
                                                         p_pagamento jsonb default null, p_marcar_paga boolean default false)
returns jsonb language plpgsql security invoker set search_path to 'public' as $function$
declare p jsonb;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'só o servidor registra guia/pagamento'; end if;
  if p_idx is null or p_idx < 0 or p_idx > 60 then raise exception 'parcela inválida'; end if;
  select parcelamento into p from public.arrematados where id = p_arrematado for update;
  if p is null then raise exception 'arremate sem parcelamento'; end if;
  if p_marcar_paga and not (coalesce(p->'pagas', '[]'::jsonb) @> to_jsonb(p_idx)) then
    p := jsonb_set(p, '{pagas}', coalesce(p->'pagas', '[]'::jsonb) || to_jsonb(p_idx));
  end if;
  if p_guia is not null then
    p := jsonb_set(p, '{guias}', coalesce(p->'guias', '{}'::jsonb)
           || jsonb_build_object(p_idx::text, coalesce(p->'guias'->(p_idx::text), '{}'::jsonb) || p_guia));
  end if;
  if p_pagamento is not null then
    p := jsonb_set(p, '{pagamentos}', coalesce(p->'pagamentos', '{}'::jsonb) || jsonb_build_object(p_idx::text, p_pagamento));
  end if;
  if pg_column_size(p) > 16384 then raise exception 'parcelamento grande demais'; end if;
  update public.arrematados set parcelamento = p, updated_at = now() where id = p_arrematado;
  return p;
end $function$;

-- 3) Vínculo do documento do caso com a parcela (A: guia; C: comprovante). Processado uma vez; o motivo fica
--    escrito quando não vincula (valor/parcela não batem, caso sem parcelamento).
alter table public.caso_documentos add column if not exists parcela_idx int;
alter table public.caso_documentos add column if not exists parcela_status text;      -- vinculada | paga | aviso | sem_parcelamento | ignorado
alter table public.caso_documentos add column if not exists parcela_aviso text;
alter table public.caso_documentos add column if not exists parcela_lido jsonb;       -- o que a IA leu (valor, datas, nº da parcela)
alter table public.caso_documentos add column if not exists parcela_processado_em timestamptz;
create index if not exists caso_documentos_parcela_pend_idx on public.caso_documentos (criado_em)
  where parcela_processado_em is null and tipo in ('guia_deposito', 'comprovante_pagamento');
