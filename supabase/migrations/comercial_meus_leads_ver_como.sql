-- 22/08 — comercial_meus_leads ganha p_como (ver como consultor X) para o MODO SUPORTE:
-- a simulação é client-side (auth.uid() continua sendo o admin), então sem isto a tela
-- /comercial em suporte mostrava os leads do ADMIN (0), não os do consultor visto. Só admin
-- pode usar p_como (via eh_admin); leitura apenas — as escritas seguem por auth.uid().
drop function if exists public.comercial_meus_leads();
create or replace function public.comercial_meus_leads(p_como uuid default null)
 returns table(id uuid, nome text, produto text, origem text, status text, criado_em timestamptz, recebido_em timestamptz, finalizado_em timestamptz, resultado text, telefone text, email text, ultimo_evento_tipo text, ultimo_evento_em timestamptz)
 language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select l.id, l.nome,
         case l.origem when 'alavancagem_home_equity' then 'Home Equity'
                       when 'alavancagem_consorcio'   then 'Consórcio'
                       else l.origem end,
         l.origem, l.status, l.criado_em, l.recebido_em, l.finalizado_em, l.resultado,
         case when l.recebido_em is not null
               and coalesce(public.regra('comercial.contato_apos_receber')->>'evento_de_revelacao','recebido') = 'recebido'
              then l.whatsapp end,
         case when l.recebido_em is not null
               and coalesce(public.regra('comercial.contato_apos_receber')->>'evento_de_revelacao','recebido') = 'recebido'
              then l.email end,
         e.tipo, e.criado_em
    from public.sdr_leads l
    left join lateral (select tipo, criado_em from public.sdr_lead_eventos ev
                        where ev.lead_id = l.id order by ev.criado_em desc limit 1) e on true
   where l.origem = any (coalesce(
           (select array(select jsonb_array_elements_text(public.regra('comercial.escopo_leads')->'origens'))),
           array['alavancagem_consorcio','alavancagem_home_equity']))
     and (
       (p_como is not null and public.eh_admin() and l.consultor_id = p_como)
       or
       (p_como is null and public.comercial_gate() is not null and l.consultor_id = (select auth.uid()))
     )
   order by l.criado_em desc;
$function$;
revoke execute on function public.comercial_meus_leads(uuid) from anon, public;
grant execute on function public.comercial_meus_leads(uuid) to authenticated;
