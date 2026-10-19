-- ─────────────────────────────────────────────────────────────────────────────────────────
-- apurar_vendidos_cef estourou os 8 s às 05h UTC de 19/10 (limpar-imoveis-stale: falhas = vendidos_cef 57014).
-- Duas causas, as mesmas já tratadas nos passos irmãos (20261017_limpeza_diaria_em_lotes.sql e
-- 20261018_cef_vencidos_indice.sql):
--   (a) o "máximo por estado" lia as 40 mil linhas CEF (ativas e inativas) do heap — 6,1 s a frio, duas vezes.
--       Agora vem só das ATIVAS (quem a última lista da Caixa trouxe está ativo, então o máximo é o mesmo) e
--       sai do índice idx_imoveis_ativo_fonte_estado_atualizado: 6.155 → 166 ms. Estado sem CEF ativo fica
--       de fora: lista vazia não prova venda.
--   (b) o backlog chega a centenas por dia (17/10: 567; 19/10: 469 pendentes) e cada UPDATE atravessa ~30
--       gatilhos (~28 ms) → não cabe em 8 s. Agora em lotes de `lote` linhas; o cron repete até vir lote menor.
-- Nome novo (`_lote`) em vez de parâmetro na antiga: sobrecarga com default deixa a chamada sem argumento
-- ambígua no PostgREST. A antiga continua existindo e delega, sem lote.
-- O 2º passo (desfaz vendido de quem voltou à lista como venda direta) só toca ATIVOS e é pequeno: fica inteiro.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.apurar_vendidos_cef_lote(lote integer default 200)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer; c integer;
begin
  with uf as (
    select estado, max(atualizado_em) m from imoveis_leilao where fonte = 'CEF' and ativo group by estado
  ), alvo as (
    select i.id
      from imoveis_leilao i join uf on uf.estado = i.estado
     where i.fonte = 'CEF'
       and i.modalidade in ('extrajudicial', 'licitacao_aberta')
       and (i.resultado_leilao is null or i.resultado_leilao = 'indeterminado')
       and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
       and i.data_leilao::date < current_date
       and i.atualizado_em < uf.m - interval '2 days'
       and i.atualizado_em::date >= i.data_leilao::date - 1
     limit greatest(1, lote)
  )
  update imoveis_leilao i
     set resultado_leilao = 'vendido', resultado_origem = 'inferido_lista_caixa', resultado_apurado_em = now()
    from alvo where i.id = alvo.id;
  get diagnostics n = row_count;

  with uf as (
    select estado, max(atualizado_em) m from imoveis_leilao where fonte = 'CEF' and ativo group by estado
  )
  update imoveis_leilao i
     set resultado_leilao = 'sem_lance', resultado_origem = 'relistagem_caixa',
         resultado_apurado_em = now(), valor_lance_vencedor = null
    from uf
   where uf.estado = i.estado
     and i.fonte = 'CEF'
     and i.ativo
     and i.resultado_leilao = 'vendido'
     and i.resultado_origem = 'inferido_lista_caixa'
     and coalesce(i.modalidade,'') ~* 'venda[_ -]?(direta|online)'
     and i.atualizado_em >= uf.m - interval '2 days';
  get diagnostics c = row_count;
  if c > 0 then raise log 'apurar_vendidos_cef: % vendido(s) inferido(s) desfeito(s) por relistagem', c; end if;
  return n;
end $function$;

create or replace function public.apurar_vendidos_cef()
 returns integer
 language sql
 security definer
 set search_path to 'public'
as $function$ select public.apurar_vendidos_cef_lote(1000000) $function$;

revoke all on function public.apurar_vendidos_cef_lote(integer) from public, anon, authenticated;
grant execute on function public.apurar_vendidos_cef_lote(integer) to service_role;
