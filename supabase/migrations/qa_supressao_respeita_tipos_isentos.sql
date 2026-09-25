-- FALSO POSITIVO do vigia `email_para_endereco_suprimido` (25/09). O gate de supressão tem uma
-- lista DELIBERADA de tipos que tentam mesmo assim — jurídico, financeiro, segurança da conta
-- (SUPRESSAO_NAO_SE_APLICA em api/_email.js). O vigia não conhecia essa lista e acusava "o gate
-- furou" por um `juridica_preliminar` enviado a um endereço com bounce — o comportamento previsto.
-- MANTER EM SINCRONIA com SUPRESSAO_NAO_SE_APLICA (api/_email.js).
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
     and coalesce(l.status, '') <> 'suprimido'
     and coalesce(l.tipo, '') not in ('contrato', 'assinatura', 'parecer_juridico', 'juridica_preliminar',
       'honorario_exito', 'pagamento', 'estorno', 'estorno_comissao', 'kyc_documento', 'boas_vindas');
$function$;
