-- 09/09, 2ª rodada do pedido do dono: "coloquei um botão para convidar a pessoa para o grupo...
-- a mensagem não pode se repetir". Ele JÁ chamou os 7 inscritos desta edição hoje (17:41–17:48),
-- então a fila de "quem nunca foi chamado" está vazia e o próximo convite é, por definição, o
-- SEGUNDO para a mesma pessoa. Duas mudanças de estrutura:
--
-- 1. `rodada` — qual convite é este para esta pessoa (0 = o primeiro). É o que permite ao
--    montador escolher um texto diferente a cada vez em vez de reenviar o mesmo parágrafo.
-- 2. `inscricao_id` — a chave passa a ser a INSCRIÇÃO, não o usuário. O índice anterior usava
--    coalesce(user_id, uuid zero): com inscrito ANÔNIMO (sem conta), todos colapsariam na MESMA
--    chave e chamar um marcaria todos como chamados. Hoje os 7 têm user_id e nada se perdeu,
--    mas a landing aceita inscrição sem conta — era questão de tempo.
alter table public.whatsapp_disparo_grupo_log
  add column if not exists inscricao_id uuid references public.live_inscricoes(id) on delete cascade,
  add column if not exists rodada smallint not null default 0;

update public.whatsapp_disparo_grupo_log g
   set inscricao_id = i.id
  from public.live_inscricoes i
 where i.user_id = g.user_id and i.edicao = g.edicao and g.inscricao_id is null;

drop index if exists public.whatsapp_disparo_grupo_unico;

-- Uma linha por inscrição POR RODADA: mantém a idempotência do clique duplo dentro da mesma
-- rodada e libera o convite seguinte, que é o ponto desta migração.
create unique index if not exists whatsapp_disparo_grupo_unico
  on public.whatsapp_disparo_grupo_log (evento_id, edicao, inscricao_id, rodada);

-- A fila ganha `p_todos`: com false (padrão) segue sendo "quem nunca foi chamado" — o que a tela
-- de disparo em massa usa. Com true devolve TODOS os inscritos da edição, cada um com a rodada
-- que vem a seguir, que é o que o botão por linha do Admin precisa.
create or replace function public.whatsapp_fila_grupo(p_evento uuid, p_edicao date, p_todos boolean default false)
returns table(inscricao_id uuid, user_id uuid, nome text, cidade text, uf text,
              telefone_wa text, inscrito_em timestamptz, rodada smallint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.id, i.user_id, i.nome, i.cidade, i.uf,
         case when length(regexp_replace(coalesce(i.whatsapp,''), '\D', '', 'g')) in (10, 11)
              then '55' || regexp_replace(i.whatsapp, '\D', '', 'g')
              else regexp_replace(i.whatsapp, '\D', '', 'g') end,
         i.criado_em,
         (select count(*) from public.whatsapp_disparo_grupo_log g
           where g.evento_id = p_evento and g.edicao = p_edicao and g.inscricao_id = i.id)::smallint
    from public.live_inscricoes i
   where i.evento_id = p_evento and i.edicao = p_edicao
     and length(regexp_replace(coalesce(i.whatsapp,''), '\D', '', 'g')) between 10 and 13
     and (p_todos or not exists (select 1 from public.whatsapp_disparo_grupo_log g
                                  where g.evento_id = p_evento and g.edicao = p_edicao
                                    and g.inscricao_id = i.id))
   order by i.criado_em asc;
$function$;
