-- email_para_endereco_suprimido acusava 1 em 16/10 e o gate NÃO tinha furado: a linha era
-- status 'limitado' (barrada pelo limite semanal de campanha) — o e-mail nunca saiu. O invariante
-- contava toda linha do log que não fosse 'suprimido', inclusive as que também NÃO saíram
-- (forma nº 10: media "linhas no log" e reportava "e-mails enviados"). Agora fica de fora tudo o
-- que não saiu: suprimido, limitado, enfileirado, falha. Status de entrega novos continuam contando.
CREATE OR REPLACE FUNCTION public.qa_invariantes_supressao()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)
    from public.emails_log l
    join public.emails_supressao s on s.destinatario = l.destinatario
   where s.suprimido and s.suprimido_em is not null
     and l.enviado_em > s.suprimido_em
     and coalesce(l.status, '') not in ('suprimido', 'limitado', 'enfileirado', 'falha')
     and coalesce(l.tipo, '') not in ('contrato', 'assinatura', 'parecer_juridico', 'juridica_preliminar',
       'honorario_exito', 'pagamento', 'estorno', 'estorno_comissao', 'kyc_documento', 'boas_vindas');
$function$;
