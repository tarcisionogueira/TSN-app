-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PRODUTO NOVO NÃO ESPERA A FILA — 27/08/2026
--
-- REGRA DO DONO, na palavra dele: "ao cadastrar um produto avisar e produtos que o usuário
-- ainda não visualizou ele receber 1x a divulgação daquele produto. divulgações não se
-- repetem. produtos novos devem ser divulgados."
--
-- DUAS DAS QUATRO REGRAS JÁ VALIAM e não foram tocadas:
--   • "divulgações não se repetem" — o UNIQUE (user_id, tipo, produto_id) em
--     `divulgacao_envio`, com CLAIM antes do envio, já garante 1x para sempre;
--   • "produtos que ainda não visualizou" — já exclui comprado e curso com progresso.
--
-- O QUE FALTAVA era consequência de UMA linha: a quinzena é por PESSOA, não por produto.
--     and not exists (select 1 from divulgacao_envio d
--                      where d.user_id = p.id
--                        and d.enviado_em > now() - make_interval(days => p_intervalo_dias))
-- Quem recebeu qualquer divulgação há 3 dias só veria um material NOVO daqui a 11. O
-- lançamento entra na fila em vez de avisar — exatamente o contrário de "produtos novos
-- devem ser divulgados".
--
-- A SEPARAÇÃO, então, é entre duas coisas que nunca deveriam ter dividido o mesmo freio:
--
--   NOVIDADE  produto cadastrado há pouco (`p_dias_novidade`, padrão 14) → **ignora a
--             quinzena**. É um anúncio: "isto acabou de chegar". Só uma vez por pessoa,
--             porque o UNIQUE continua valendo.
--
--   RESGATE   material antigo que a pessoa nunca abriu → **mantém a quinzena**. É a fila
--             pessoal que esvazia, e é dela que o freio anti-spam sempre foi.
--
-- ⚠️ O QUE IMPEDE ISSO DE VIRAR RAJADA: `distinct on (uid)` continua entregando NO MÁXIMO UM
-- material por pessoa por execução. Cadastrar cinco produtos de uma vez não manda cinco
-- e-mails — manda um, e os outros quatro entram na vez deles. Sem essa trava, "produto novo
-- ignora a quinzena" viraria cinco e-mails no mesmo minuto para a mesma pessoa.
--
-- E a novidade vence o resgate no desempate: anunciar o que acabou de sair vale mais do que
-- relembrar o que está parado há meses.
-- ─────────────────────────────────────────────────────────────────────────────────────────

drop function if exists public.divulgacao_candidatos(integer, integer);

create or replace function public.divulgacao_candidatos(
  p_limite integer default 300,
  p_intervalo_dias integer default 14,
  p_dias_novidade integer default 14
)
returns table(
  user_id uuid, nome text, tipo text, produto_id uuid, titulo text,
  descricao text, capa_url text, preco numeric, cor text, novidade boolean
)
language sql security definer set search_path to 'public' as $function$
  with produtos as (
    select 'curso'::text as tipo, c.id, c.titulo, c.descricao, c.capa_url,
           coalesce(c.preco,0)::numeric as preco, coalesce(c.cor,'#0D63DB') as cor,
           coalesce(c.destaque,false) as destaque, c.criado_em,
           (c.criado_em > now() - make_interval(days => p_dias_novidade)) as eh_novo
      from cursos_admin c
     where c.ativo and coalesce(c.onboarding,false) = false
    union all
    select 'ebook', e.id, e.titulo, e.descricao, e.capa_url,
           coalesce(e.preco,0)::numeric, '#0D63DB',
           coalesce(e.destaque,false), e.criado_em,
           (e.criado_em > now() - make_interval(days => p_dias_novidade))
      from ebooks_admin e
     where e.ativo and coalesce(e.arquivo_url,'') <> ''
  ),
  clientes as (
    -- A quinzena SAI daqui: ela não pode mais barrar a pessoa inteira, só o resgate. Quem
    -- decide agora é o `where` lá embaixo, material a material.
    select p.id as uid, p.nome,
           exists (select 1 from divulgacao_envio d
                    where d.user_id = p.id
                      and d.enviado_em > now() - make_interval(days => p_intervalo_dias))
             as dentro_da_quinzena
      from perfis p
     where p.ativo
       and p.role in ('explorador','top2','top2_anual','assessorado','clube')
       and not exists (select 1 from alertas_email a where a.user_id = p.id and a.ativo = false)
  )
  select distinct on (cl.uid)
         cl.uid, cl.nome, pr.tipo, pr.id, pr.titulo, pr.descricao, pr.capa_url, pr.preco,
         pr.cor, pr.eh_novo
    from clientes cl
    join produtos pr on true
   where not exists (select 1 from divulgacao_envio d
                      where d.user_id = cl.uid and d.tipo = pr.tipo and d.produto_id = pr.id)
     and not exists (select 1 from compras_produtos cp
                      where cp.user_id = cl.uid and cp.produto_tipo = pr.tipo
                        and cp.produto_id = pr.id and cp.status = 'ativo')
     and (pr.tipo <> 'curso' or not exists (
           select 1 from aula_progresso ap where ap.user_id = cl.uid and ap.curso_id = pr.id::text))
     -- AQUI está a regra nova: novidade passa sempre; resgate só fora da quinzena.
     and (pr.eh_novo or not cl.dentro_da_quinzena)
   order by cl.uid, pr.eh_novo desc, pr.destaque desc, pr.criado_em desc
   limit greatest(1, least(p_limite, 3000));
$function$;

revoke all on function public.divulgacao_candidatos(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.divulgacao_candidatos(integer, integer, integer) to service_role;
