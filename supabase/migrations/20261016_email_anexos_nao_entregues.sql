-- E-mails que saíram SEM anexos que o registro dizia enviados (auditoria de 16/10 contra o Resend).
--
-- Causa: anexo ia por LINK (`path`) e o Resend, quando não conseguia buscar, descartava calado;
-- nós gravávamos `enviado: true`. O cron de arquivo (arquivar-anexos-email-cron), ao não achar o
-- anexo pelo nome, pegava "pela posição" (`|| itens[idx]`) e guardou conteúdo de um arquivo com o
-- nome de outro. Conserto do código no mesmo commit (api/_email.js baixa e manda o conteúdo;
-- o cron casa só por nome e marca o que não foi entregue). Aqui: a pendente ignora `enviado:false`
-- e os 4 registros afetados passam a dizer a verdade.
--
--   4dd7abcd Contato Santana (15/10): 6 declarados, 3 entregues (os 3 "Documento.pdf").
--            Matrícula/Edital/Anexo do leiloeiro NÃO foram; seus arquivos guardados eram, na
--            verdade, os 3 Documentos (117158/399423/871281 bytes) → viram os arquivos dos Documentos.
--   72a62a7c Apoio jurídico Santana (15/10): 5 declarados, 1 entregue ("Condições Gerais").
--   a3e41d83 Contato Barueri (15/10): 2 declarados, 0 entregues.
--   7d20e11a Fwd Brotas Salvador (09/10): 5 declarados, 0 entregues.

create or replace function public.email_caixa_anexos_pendentes(p_desde timestamp with time zone, p_limite integer DEFAULT 25)
 RETURNS TABLE(id uuid, direcao text, resend_email_id text, anexos jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 16/10: anexo marcado `enviado:false` (não foi no e-mail) não é pendência de arquivo — sem isto
  -- o cron tentava de novo a cada rodada, para sempre.
  select c.id, c.direcao, c.resend_email_id, c.anexos
    from public.email_caixa c
   where c.resend_email_id is not null
     and c.criado_em >= p_desde
     and coalesce(c.categoria, '') <> 'spam'
     and exists (select 1 from jsonb_array_elements(coalesce(c.anexos, '[]'::jsonb)) a
                  where a->>'arquivo' is null and coalesce(a->>'enviado', 'true') <> 'false')
   order by c.criado_em asc
   limit greatest(1, least(p_limite, 200));
$function$;

-- Marca como NÃO ENTREGUE as posições indicadas (1-based) e tira a referência de arquivo delas
-- (o arquivo guardado ali não era o documento do nome).
create or replace function pg_temp.nao_entregue(p_id uuid, p_pos int[], p_motivo text) returns void language sql as $$
  update public.email_caixa c
     set anexos = (select jsonb_agg(case when t.ord = any(p_pos)
                                         then (t.e - 'arquivo' - 'arquivado_em' - 'tamanho' - 'content_type')
                                              || jsonb_build_object('enviado', false, 'motivo', p_motivo)
                                         else t.e end order by t.ord)
                     from jsonb_array_elements(c.anexos) with ordinality t(e, ord))
   where c.id = p_id;
$$;

select pg_temp.nao_entregue('4dd7abcd-916d-43a3-ab0f-5a2126fc8f9f', array[1,2,3],
  'não foi no e-mail: o Resend não conseguiu buscar o arquivo (auditoria 16/10)');
-- Os 3 "Documento.pdf" apontavam todos para o 1º; o 2º e o 3º estavam guardados sob outros nomes.
update public.email_caixa c
   set anexos = jsonb_set(jsonb_set(c.anexos,
         '{4,arquivo}', '"email/4dd7abcd-916d-43a3-ab0f-5a2126fc8f9f/1_Edital.pdf"'),
         '{5,arquivo}', '"email/4dd7abcd-916d-43a3-ab0f-5a2126fc8f9f/2_Anexo_do_leiloeiro_597c9cba-0c75-492f-b204-4113541dccfd.pdf"')
 where c.id = '4dd7abcd-916d-43a3-ab0f-5a2126fc8f9f'
   and c.anexos->4->>'nome' = 'Documento.pdf' and c.anexos->5->>'nome' = 'Documento.pdf';

select pg_temp.nao_entregue('72a62a7c-fd2c-45c8-9968-cc543f944493', array[1,2,3,5],
  'não foi no e-mail: o Resend não conseguiu buscar o arquivo (auditoria 16/10)');
select pg_temp.nao_entregue('a3e41d83-921d-457f-a0d5-9648a66a1bd9', array[1,2],
  'não foi no e-mail: o Resend não conseguiu buscar o arquivo (auditoria 16/10)');
select pg_temp.nao_entregue('7d20e11a-00bc-48f4-8ae6-b46c74f04775', array[1,2,3,4,5],
  'não foi no e-mail: o Resend não conseguiu buscar o arquivo (auditoria 16/10)');
