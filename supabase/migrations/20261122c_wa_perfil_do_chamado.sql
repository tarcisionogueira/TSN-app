-- Perfil do investidor levantado pela IA no WhatsApp, visível para a EQUIPE dentro do chamado
-- (22/11, dono: "mapear melhor o perfil do investidor"). wa_conversas é só do servidor (RLS sem
-- policy); a tela lê por esta função, que confere o papel de quem chama.
create or replace function public.wa_perfil_do_chamado(p_chamado uuid)
returns table (telefone text, perfil_lead text, interesse text, perfil_em timestamptz, anuncio text, optout_em timestamptz, ia_pausada_ate timestamptz)
language sql stable security definer set search_path = public as $$
  select w.telefone, w.perfil_lead, w.interesse, w.perfil_em, w.origem->>'headline', w.optout_em, w.ia_pausada_ate
    from wa_conversas w
   where w.chamado_id = p_chamado
     and exists (select 1 from perfis p where p.id = auth.uid() and p.role in ('admin','analista','consultor'))
   limit 1
$$;
revoke all on function public.wa_perfil_do_chamado(uuid) from public, anon;
grant execute on function public.wa_perfil_do_chamado(uuid) to authenticated;
