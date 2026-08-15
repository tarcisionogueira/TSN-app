-- INVARIANTE NOVO: pedido de reunião do cliente parado sem analista.
--
-- POR QUE (15/08). Investigando por que 3 solicitações de reunião não viraram nenhuma
-- reunião agendada, apareceu isto: as três estão em `status='solicitado'` desde **1 e 5 de
-- julho** — 41 a 45 dias — com `analista_id` nulo e `reuniao_em` nulo. E a causa não é de
-- código: **não existe nenhum perfil com role='analista' ativo** (o único papel de equipe
-- cadastrado é o admin). Há 42 slots futuros disponíveis, e ninguém para ocupá-los.
--
-- O agravante é o de sempre: ninguém foi avisado. Um cliente pediu para falar com um
-- analista e ficou 45 dias no silêncio — do lado dele, o pedido simplesmente não existiu.
-- É a mesma família de "falha que não sabe que falhou", agora no atendimento: nenhuma
-- exceção, nenhum erro, nenhum alarme; só um pedido parado.
--
-- Verde é 0. Valor N = N pedidos de reunião parados há mais de 3 dias sem analista.
do $$
declare def text; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc
   where proname = 'qa_invariantes' and pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'qa_invariantes() não encontrada'; end if;
  if position('reuniao_solicitada_parada' in def) > 0 then return; end if;

  novo := $q$     ('reuniao_solicitada_parada','Pedido de reunião do cliente parado sem analista','Atendimento','bug',
       (select count(*) from solicitacoes s
         where s.reuniao_em is null and s.analista_id is null
           and coalesce(s.status,'') not in ('cancelado','concluido','recusado')
           and s.created_at < now() - interval '3 days'), 0),
$q$;
  def := replace(def, '     (''aval_ausente_com_doc''', novo || '     (''aval_ausente_com_doc''');
  execute def;
end $$;
