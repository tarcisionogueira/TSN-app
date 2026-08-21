-- ═══════════════════════════════════════════════════════════════════════════════
-- CONSULTOR COMERCIAL — FASE 3 (atribuição): RPC de atribuição MANUAL pelo admin.
-- A atribuição AUTOMÁTICA (?ref do link) é gravada pelo api/duvida no servidor,
-- resolvendo o código — nunca aceita consultor_id do corpo.
--
-- Reatribuição zera recebido_em: o NOVO dono precisa clicar "Receber cliente" para
-- ver o contato — coerente com regra('comercial.contato_apos_receber') e deixa o
-- registro de revelação em nome de quem realmente vai atender.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_comercial_atribuir(p_lead uuid, p_consultor uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_lead public.sdr_leads; v_cons record; v_reatrib boolean;
begin
  if not exists (select 1 from public.perfis where id = (select auth.uid()) and role = 'admin') then
    raise exception 'apenas admin';
  end if;
  select * into v_lead from public.sdr_leads
   where id = p_lead
     and origem = any (coalesce(
           (select array(select jsonb_array_elements_text(public.regra('comercial.escopo_leads')->'origens'))),
           array['alavancagem_consorcio','alavancagem_home_equity']))
   for update;
  if not found then raise exception 'lead nao encontrado ou fora do escopo comercial'; end if;
  if v_lead.finalizado_em is not null then raise exception 'lead finalizado — reabra antes de reatribuir'; end if;
  select id, nome into v_cons from public.perfis
   where id = p_consultor and (vendedor_tipo = 'consultor' or role in ('consultor','admin'));
  if not found then raise exception 'consultor invalido (precisa da capacidade comercial)'; end if;
  if v_lead.consultor_id = p_consultor then return; end if;
  v_reatrib := v_lead.consultor_id is not null;
  update public.sdr_leads
     set consultor_id = p_consultor, status = 'atribuido', recebido_em = null
   where id = p_lead;
  insert into public.sdr_lead_eventos (lead_id, autor_id, autor_papel, tipo, comentario)
  values (p_lead, (select auth.uid()), 'admin', 'atribuido',
          'Atribuído manualmente pelo admin a ' || coalesce(v_cons.nome, 'consultor')
          || case when v_reatrib then ' (reatribuição — o contato volta a exigir Receber)' else '' end);
end $$;
revoke all on function public.admin_comercial_atribuir(uuid, uuid) from public, anon;
grant execute on function public.admin_comercial_atribuir(uuid, uuid) to authenticated;

-- Regra do escopo agora é lida por TODAS as funções comerciais — aplicada_por completo.
update public.regra_negocio
   set aplicada_por = array['comercial_meus_leads','comercial_receber_lead','comercial_registrar_evento','admin_comercial_atribuir'],
       atualizado_em = now()
 where chave = 'comercial.escopo_leads';
