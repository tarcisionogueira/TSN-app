-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CONTA INTERNA NÃO É CLIENTE ESPERANDO — 18/08/2026
--
-- `reuniao_solicitada_parada` acusava 3 pedidos de reunião parados há mais de 3 dias. Os três
-- eram do PRÓPRIO DONO (`role = admin`), de 01 e 05/07, feitos testando a tela — o `user_id`
-- e o `analista_id` são a mesma pessoa nos três.
--
-- Contar teste como fila de atendimento é o defeito já catalogado no CLAUDE.md quando a
-- retenção "nudava o admin": o alarme perde o sentido e ensina a ignorar. Um alarme que dispara
-- sem cliente do outro lado é pior que alarme nenhum, porque gasta a atenção que o alarme
-- verdadeiro vai precisar.
--
-- Agora conta só quem NÃO é conta interna (admin/analista/juridico). Se subir, há gente de
-- verdade esperando — que é o que o título sempre prometeu.
-- ─────────────────────────────────────────────────────────────────────────────────────────
do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('reuniao_solicitada_parada','Pedido de reunião do cliente sem reunião marcada há mais de 3 dias','Atendimento','bug',
       (select count(*) from solicitacoes s
         where s.reuniao_em is null
           and coalesce(s.status,'') not in ('cancelado','concluido','recusado')
           and s.created_at < now() - interval '3 days'), 0)$a$;

  depois := $b$     ('reuniao_solicitada_parada','Pedido de reunião do CLIENTE sem reunião marcada há mais de 3 dias','Atendimento','bug',
       (select count(*) from solicitacoes s
          join perfis p on p.id = s.user_id
         where s.reuniao_em is null
           and coalesce(s.status,'') not in ('cancelado','concluido','recusado')
           and coalesce(p.role,'') not in ('admin','analista','juridico')
           and s.created_at < now() - interval '3 days'), 0)$b$;

  if position(antes in def) = 0 then
    if position('coalesce(p.role,'''') not in (''admin''' in def) > 0 then
      raise notice 'ja aplicado';
      return;
    end if;
    raise exception 'ancora reuniao_solicitada_parada nao encontrada';
  end if;

  execute replace(def, antes, depois);
  raise notice 'reuniao_solicitada_parada agora ignora conta interna';
end $do$;
