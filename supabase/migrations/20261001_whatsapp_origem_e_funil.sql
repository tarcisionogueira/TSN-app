-- WhatsApp oficial: DE ONDE a conversa veio + funil da campanha perpétua (pedido do dono, 01/10:
-- "agente de IA para atender e uma campanha perpétua para a IA vender e direcionar ao sistema").
-- `origem` = o objeto `referral` que a Meta manda na 1ª mensagem vinda de anúncio "Clique para o
-- WhatsApp" (source_type/source_id = id do anúncio, headline, ctwa_clid). Sem ele, gasto de anúncio
-- e conversa não se encontram — a mesma lacuna que o cruzamento gclid × visita mostrou no Google.
alter table public.wa_conversas
  add column if not exists origem     jsonb,        -- último anúncio que trouxe a pessoa
  add column if not exists origem_em  timestamptz;

-- Funil, custo zero. Cadastro atribuído = perfis.mkt_utm_source='whatsapp' (o link que a IA manda
-- leva utm_source=whatsapp&utm_medium=ia) OU conversa já casada com um perfil pelo telefone.
create or replace function public.wa_funil(p_dias int default 30)
returns table (etapa text, quantidade bigint, detalhe text)
language sql stable security definer set search_path = public as $$
  with c as (select * from wa_conversas where criado_em > now() - make_interval(days => p_dias))
  select 'conversas', count(*), 'pessoas que escreveram no período' from c
  union all select 'vindas de anuncio', count(*) filter (where origem is not null), 'com referral do Clique-para-WhatsApp' from c
  union all select 'respondidas pela IA', count(distinct m.telefone), 'ao menos 1 resposta automática'
    from wa_mensagens m join c on c.telefone = m.telefone where m.autor = 'ia'
  union all select 'escaladas p/ humano', count(*) filter (where escalada_em is not null), 'pediram consultor/contratação ou bug' from c
  union all select 'ja cadastradas', count(*) filter (where user_id is not null), 'telefone casou com um perfil' from c
  union all select 'cadastros pelo link da IA', count(*), 'perfis com utm_source=whatsapp e utm_medium=ia (link da IA)'
    from perfis where mkt_utm_source = 'whatsapp' and mkt_utm_medium = 'ia' and created_at > now() - make_interval(days => p_dias);
$$;
revoke all on function public.wa_funil(int) from public, anon, authenticated;
grant execute on function public.wa_funil(int) to service_role;
