-- Badge de "respostas não lidas" do chat do site: conversa de WhatsApp continua no WhatsApp (22/11).
-- Sem este filtro, cada resposta da IA no WhatsApp acenderia o badge no site, levando a uma conversa
-- que o widget nem lista (ChatSuporte/MeusChamados filtram canal='whatsapp').
CREATE OR REPLACE FUNCTION public.suporte_respostas_nao_lidas()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(count(distinct c.id), 0)::int
    from public.chamados c
    join public.chamados_mensagens m on m.chamado_id = c.id
   where c.user_id = auth.uid()
     and c.canal <> 'whatsapp'
     and m.autor_tipo <> 'cliente'
     and m.criado_em > coalesce(c.cliente_visto_em, c.criado_em);
$function$;
