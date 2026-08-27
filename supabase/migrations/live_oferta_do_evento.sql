-- ─────────────────────────────────────────────────────────────────────────────
-- QUAL PRODUTO A AULA VENDE  (27/08/2026)
--
-- O remarketing precisa de duas coisas que hoje não se falam: QUEM viu a oferta
-- (live_inscricoes) e QUAL era a oferta (o produto com janela). Sem esta ligação, o
-- cron teria que adivinhar — e adivinhar aqui significa mandar e-mail de "sua vaga no
-- curso X" para quem se inscreveu numa aula sobre outra coisa.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.eventos_live
  add column if not exists oferta_produto_tipo text,
  add column if not exists oferta_produto_id uuid;

comment on column public.eventos_live.oferta_produto_id is
  'Produto que esta aula vende. É o que liga os inscritos à janela de oferta para o
   remarketing. Nulo = aula sem oferta: o cron simplesmente não a considera.';

-- Público do remarketing, resolvido no banco.
-- Devolve os inscritos da aula que AINDA NÃO compraram o produto ofertado. A regra de
-- "não comprou" olha compras ATIVAS de qualquer época — quem comprou semana passada não
-- pode receber "última chance".
create or replace function public.lancamento_publico(p_evento_slug text)
returns table (user_id uuid, nome text, produto_tipo text, produto_id uuid,
               titulo text, fecha_em timestamptz, em_janela boolean)
language sql stable security definer set search_path to 'public' as $$
  select i.user_id,
         coalesce(p.nome, i.nome) as nome,
         e.oferta_produto_tipo,
         e.oferta_produto_id,
         v.titulo,
         (v.vig->>'fecha_em')::timestamptz,
         coalesce((v.vig->>'em_janela')::boolean, false)
    from eventos_live e
    join live_inscricoes i on i.evento_id = e.id
    left join perfis p on p.id = i.user_id
   cross join lateral (
     select produto_preco_vigente(e.oferta_produto_tipo, e.oferta_produto_id) as vig
   ) x
   cross join lateral (select x.vig->>'titulo' as titulo, x.vig as vig) v
   where e.slug = p_evento_slug
     and e.ativo
     and e.oferta_produto_id is not null
     and i.user_id is not null
     and not exists (
       select 1 from compras_produtos c
        where c.user_id = i.user_id
          and c.produto_id = e.oferta_produto_id
          and c.status = 'ativo'
     );
$$;

revoke all on function public.lancamento_publico(text) from public, anon, authenticated;
