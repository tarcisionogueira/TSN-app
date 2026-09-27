-- 27/09 — ANEXOS DA CAIXA DE E-MAIL NO NOSSO STORAGE (pedido do dono: não perder nenhum e-mail).
-- O Resend retém e-mails e anexos por 30 dias; os anexos de `email_caixa` só existiam lá.
-- api/arquivar-anexos-email-cron.js copia cada anexo para `documentos/email/<id>/...` (o backup
-- R2 já pega esse caminho) e marca `arquivo` no próprio item de `anexos`.

-- Fila do cron: mensagem com anexo ainda sem `arquivo`, dentro da janela de retenção do Resend.
create or replace function public.email_caixa_anexos_pendentes(p_desde timestamptz, p_limite int default 25)
returns table(id uuid, direcao text, resend_email_id text, anexos jsonb)
language sql stable security definer set search_path = public as $$
  select c.id, c.direcao, c.resend_email_id, c.anexos
    from public.email_caixa c
   where c.resend_email_id is not null
     and c.criado_em >= p_desde
     and exists (select 1 from jsonb_array_elements(coalesce(c.anexos, '[]'::jsonb)) a where a->>'arquivo' is null)
   order by c.criado_em asc
   limit greatest(1, least(p_limite, 200));
$$;
revoke all on function public.email_caixa_anexos_pendentes(timestamptz, int) from public, anon, authenticated;

-- Invariante: anexo com mais de 3 dias sem cópia nossa = o cron parou ou está falhando, e a
-- janela de 30 dias do Resend está correndo contra nós.
DO $do$
DECLARE
  src text;
  velho text := $m$('editais_avaliacao_perdida',$m$;
  novo  text := $m$('anexo_email_nao_arquivado','Anexo da caixa de e-mail com mais de 3 dias sem copia no nosso storage (o Resend apaga em 30 dias — ver api/arquivar-anexos-email-cron.js)','Atendimento','critico',
       (select count(*) from email_caixa c, jsonb_array_elements(coalesce(c.anexos,'[]'::jsonb)) a
         where c.resend_email_id is not null and a->>'arquivo' is null and c.criado_em < now() - interval '3 days'), 0),
     ('editais_avaliacao_perdida',$m$;
BEGIN
  src := pg_get_functiondef('public.qa_invariantes'::regproc);
  IF position(velho in src) = 0 THEN
    RAISE EXCEPTION 'qa_invariantes(): marcador esperado nao encontrado — funcao mudou, revise antes de reaplicar';
  END IF;
  IF position('anexo_email_nao_arquivado' in src) > 0 THEN RETURN; END IF;
  EXECUTE replace(src, velho, novo);
END $do$;
