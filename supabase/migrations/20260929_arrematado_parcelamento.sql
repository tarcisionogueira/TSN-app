-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CONDIÇÕES DE PAGAMENTO DA ARREMATAÇÃO — 29/09/2026 (pedido do dono)
--
-- A tela do arremate (src/pages/Arrematados.jsx) passa a mostrar a data da arrematação, o
-- cronograma (entrada + parcelas) e um lembrete antes de cada vencimento — atraso em leilão
-- judicial dá multa de 10% sobre a parcela + vincendas (art. 895, §4º, CPC). O cronograma é
-- calculado em src/utils/parcelamentoArremate.js a partir deste jsonb:
--   { forma: 'a_vista'|'parcelado', entrada_pct, entrada_venc, parcelas, primeira_venc,
--     indice, pagas: [0 = entrada/à vista, 1..n], atualizado_em, atualizado_por }
--
-- Por que RPC e não UPDATE direto: a RLS de `arrematados` só deixa o DONO alterar a linha, e quem
-- registra as condições é a EQUIPE (lê o auto de arrematação). A função aceita o dono OU a equipe
-- e só mexe nesta coluna — não abre o resto da linha.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.arrematados add column if not exists parcelamento jsonb;
comment on column public.arrematados.parcelamento is
  'Condições de pagamento da arrematação (forma, entrada, parcelas, vencimentos, pagas). Cronograma em src/utils/parcelamentoArremate.js; aviso em api/parcelas-arremate-cron.js.';

create or replace function public.salvar_parcelamento_arremate(p_arrematado uuid, p_parcelamento jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  update public.arrematados
     set parcelamento = case when p_parcelamento is null then null
                             else p_parcelamento || jsonb_build_object('atualizado_em', now(), 'atualizado_por', auth.uid()) end,
         updated_at = now()
   where id = p_arrematado
  returning parcelamento into v;
  return v;
end $$;

revoke all on function public.salvar_parcelamento_arremate(uuid, jsonb) from public, anon;
grant execute on function public.salvar_parcelamento_arremate(uuid, jsonb) to authenticated;
