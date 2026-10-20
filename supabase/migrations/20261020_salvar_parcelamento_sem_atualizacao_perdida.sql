-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #233 (20/10): a tela de parcelamento (PagamentoArremate.jsx) gravava o jsonb inteiro que leu ao abrir, e
-- salvar_parcelamento_arremate SUBSTITUÍA tudo. O parcelas-documentos-cron liga guia/comprovante e marca parcela
-- paga por parcelamento_registrar nesse meio-tempo — o próximo clique na tela apagava a guia, o comprovante e a
-- marca de paga (ou as devolvia na versão velha). Regras agora, para qualquer chamador:
--   • guias / pagamentos são do SERVIDOR: payload SEM a chave mantém o que está no banco (a tela para de mandar);
--     quem manda (guia-parcela, ler-condicoes — leem o banco na hora) continua gravando como antes.
--   • pagas: a tela manda `_base_pagas` (o que ela leu). Final = pagas da tela ∪ (pagas do banco − base): a mudança
--     da tela vale, e o que o cron marcou DEPOIS da leitura sobrevive. Sem base, vale a união (nunca perde paga).
--   • `_base_pagas` não é gravado.
-- A linha é travada (for update) para a leitura do atual e a escrita não se cruzarem com o cron.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.salvar_parcelamento_arremate(p_arrematado uuid, p_parcelamento jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb; v_cur jsonb; v_in jsonb := p_parcelamento; v_base jsonb;
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

  select parcelamento into v_cur from public.arrematados where id = p_arrematado for update;

  if v_in is not null then
    if v_in ? '_base_pagas' and jsonb_typeof(v_in->'_base_pagas') <> 'array' then
      raise exception '_base_pagas deve ser lista';
    end if;
    if v_cur is not null then
      if not (v_in ? 'guias') and v_cur ? 'guias' then v_in := v_in || jsonb_build_object('guias', v_cur->'guias'); end if;
      if not (v_in ? 'pagamentos') and v_cur ? 'pagamentos' then v_in := v_in || jsonb_build_object('pagamentos', v_cur->'pagamentos'); end if;
      if jsonb_typeof(v_cur->'pagas') = 'array' then
        v_base := coalesce(v_in->'_base_pagas', v_in->'pagas', '[]'::jsonb);
        v_in := v_in || jsonb_build_object('pagas', coalesce((
          select jsonb_agg(x order by x) from (
            select distinct (e #>> '{}')::numeric x from jsonb_array_elements(coalesce(v_in->'pagas', '[]'::jsonb)) e
             where jsonb_typeof(e) = 'number'
            union
            select (e #>> '{}')::numeric from jsonb_array_elements(v_cur->'pagas') e
             where jsonb_typeof(e) = 'number' and not (v_base @> jsonb_build_array(e))
          ) u), '[]'::jsonb));
      end if;
    end if;
    v_in := v_in - '_base_pagas';
  end if;

  if v_in is not null and coalesce(v_in->>'forma','') not in ('a_vista','parcelado') then
    raise exception 'forma inválida';
  end if;
  if v_in is not null and pg_column_size(v_in) > 16384 then
    raise exception 'parcelamento grande demais';
  end if;
  if v_in is not null then
    if coalesce(v_in->>'entrada_venc','') !~ '^(\d{4}-\d{2}-\d{2})?$'
       or coalesce(v_in->>'primeira_venc','') !~ '^(\d{4}-\d{2}-\d{2})?$'
       or coalesce(v_in->>'entrada_paga_em','') !~ '^(\d{4}-\d{2}-\d{2})?$' then
      raise exception 'data inválida (use AAAA-MM-DD)';
    end if;
    perform nullif(v_in->>'entrada_venc','')::date, nullif(v_in->>'primeira_venc','')::date,
            nullif(v_in->>'entrada_paga_em','')::date;
    if v_in ? 'folga_dias' and (jsonb_typeof(v_in->'folga_dias') <> 'number'
       or (v_in->>'folga_dias')::numeric not between 0 and 10) then
      raise exception 'folga_dias deve ser de 0 a 10';
    end if;
    if v_in ? 'parcelas' and (jsonb_typeof(v_in->'parcelas') <> 'number'
       or (v_in->>'parcelas')::numeric not between 1 and 60) then
      raise exception 'parcelas deve ser de 1 a 60';
    end if;
    if v_in ? 'entrada_pct' and (jsonb_typeof(v_in->'entrada_pct') <> 'number'
       or (v_in->>'entrada_pct')::numeric not between 0 and 100) then
      raise exception 'entrada_pct deve ser de 0 a 100';
    end if;
    if v_in ? 'pagas' and (jsonb_typeof(v_in->'pagas') <> 'array'
       or exists (select 1 from jsonb_array_elements(v_in->'pagas') e
                   where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric not between 0 and 60)) then
      raise exception 'pagas deve ser lista de índices 0..60';
    end if;
  end if;
  update public.arrematados
     set parcelamento = case when v_in is null then null
                             else v_in || jsonb_build_object('atualizado_em', now(), 'atualizado_por', auth.uid()) end,
         updated_at = now()
   where id = p_arrematado
  returning parcelamento into v;
  return v;
end $function$;
