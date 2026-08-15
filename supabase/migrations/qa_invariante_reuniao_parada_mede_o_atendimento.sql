-- CORREÇÃO DO INVARIANTE `reuniao_solicitada_parada` (15/08, mesmo dia em que nasceu).
--
-- ELE FICOU VERDE SEM O PROBLEMA TER SIDO RESOLVIDO. A versão original media
-- `analista_id is null` — "pedido parado SEM analista". Horas depois, o trigger
-- `trg_solicitacao_cai_para_admin` deu dono aos três pedidos, e o invariante caiu de 3 para 0.
--
-- Só que os três CONTINUAM em `status='solicitado'`, com `reuniao_em` nulo, desde 1 e 5 de
-- julho — 41 a 45 dias. Nada mudou para o cliente que pediu a reunião. Mudou uma coluna.
--
-- É a família de defeito da casa, aplicada ao próprio instrumento: **medir o sintoma
-- acessório em vez do fato**. Ter dono era condição para o atendimento acontecer, não prova
-- de que aconteceu — e usar a condição como métrica faz o alarme se apagar exatamente quando
-- se dá o primeiro passo, que é quando ele mais precisa continuar aceso.
--
-- A régua passa a ser o que o CLIENTE percebe: pedido aberto há mais de 3 dias sem reunião
-- marcada. Com dono ou sem, é um cliente esperando. Verde = 0.
do $$
declare def text; alvo text; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc
   where proname = 'qa_invariantes' and pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'qa_invariantes() não encontrada'; end if;
  if position('s.reuniao_em is null and s.analista_id is null' in def) = 0 then
    raise notice 'invariante já corrigido (ou texto divergente) — nada a fazer';
    return;
  end if;

  alvo := $q$('reuniao_solicitada_parada','Pedido de reunião do cliente parado sem analista','Atendimento','bug',
       (select count(*) from solicitacoes s
         where s.reuniao_em is null and s.analista_id is null
           and coalesce(s.status,'') not in ('cancelado','concluido','recusado')
           and s.created_at < now() - interval '3 days'), 0)$q$;

  novo := $q$('reuniao_solicitada_parada','Pedido de reunião do cliente sem reunião marcada há mais de 3 dias','Atendimento','bug',
       (select count(*) from solicitacoes s
         where s.reuniao_em is null
           and coalesce(s.status,'') not in ('cancelado','concluido','recusado')
           and s.created_at < now() - interval '3 days'), 0)$q$;

  if position(alvo in def) = 0 then raise exception 'bloco original não encontrado — revisar à mão'; end if;
  def := replace(def, alvo, novo);
  execute def;
end $$;
