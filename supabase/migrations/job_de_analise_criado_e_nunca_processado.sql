-- 30/08 — O PRODUTO "ANÁLISE" NÃO TEM MOTOR, E NADA NO SISTEMA DIZIA ISSO
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Descoberto ao tentar REPROCESSAR os 2 casos cujo clique a RLS recusou (23-25/08). A
-- pergunta antes de inserir a linha foi "quem consome isto?" — e a resposta é NINGUÉM.
--
-- Varredura do repositório inteiro: `analise_jobs` tem **UMA** escrita em todo o código, o
-- upsert do próprio cliente em `Caso.jsx:824`. Não há rota em `api/`, script, workflow do
-- Actions nem botão no admin que mova um job de 'aguardando' para 'processando' ou
-- 'concluido'. O `Admin.jsx:10943` apenas LÊ, para imprimir "X/4 concluídas" — com o
-- comentário "Progresso REAL do trabalho da equipe", sobre uma tabela que ninguém escreve.
--
-- ─── POR QUE CRIAR AS LINHAS SERIA PIOR QUE NÃO FAZER NADA ────────────────────────────
-- A tela do cliente sairia de "0 de 4 concluídas" para "0 de 4 concluídas" — idêntica — com
-- 4 linhas paradas em 'aguardando' para sempre. E o invariante `caso_sem_analise_iniciada`
-- (criado hoje, algumas horas antes) ficaria VERDE com os dois clientes tão desatendidos
-- quanto antes: o alarme satisfeito por uma linha em vez de por trabalho entregue. É a
-- forma #10 aplicada ao nosso próprio painel, e por isso o reprocessamento foi RECUSADO em
-- vez de executado.
--
-- ─── O QUE ESTE INVARIANTE MEDE, E POR QUE O PRAZO É O DO PRÓPRIO SISTEMA ─────────────
-- Job em 'aguardando'/'processando' que passou do `prazo_limite_em` — as 48 h que o
-- `Caso.jsx` grava no momento do clique. Não inventa limiar: cobra a promessa que o próprio
-- sistema fez ao cliente.
--
-- Ele lê **0 hoje**, porque `analise_jobs` está vazia — e é justamente esse o desenho. No
-- instante em que alguém clicar em Solicitar (o que agora funciona, medido em 30/08), ele
-- arma sozinho e passa a gritar em 48 h. É o alarme que teria pego "publicamos um botão de
-- pedido sem nada atrás" na primeira semana, em vez de o assunto aparecer 39 dias depois
-- pela porta dos fundos de outro alarme.
--
-- Par com `caso_sem_analise_iniciada`: aquele pega "ninguém pediu"; este pega "pediram e
-- ninguém fez". As duas metades do mesmo silêncio — o caso parado sem nenhuma linha e o
-- caso parado com linha nenhuma processada geram a MESMA tela para o cliente.
create or replace function public.qa_invariante_job_analise_sem_motor()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint
    from public.analise_jobs j
   where j.status in ('aguardando','processando')
     and j.prazo_limite_em is not null
     and j.prazo_limite_em < now();
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('job_analise_sem_motor' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''job_analise_sem_motor'',''Job de analise passou do prazo que o proprio sistema prometeu (48h) sem ninguem processar'',''Atendimento'',''bug'',\n       public.qa_invariante_job_analise_sem_motor(), 0)';
  execute replace(d, alvo, novo);
end $do$;
