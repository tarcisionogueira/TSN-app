-- 25/09 — O STATUS 'purgado' NUNCA EXISTIU (forma nº 7: a regra escrita não é a regra aplicada).
--
-- `limpar-documentos-cron` marca como 'purgado' o espelho cujo arquivo apagou, para que
-- `registrar_anexos_do_espelho` (que só publica 'copiado') não republique um caminho morto — o
-- conserto da "ressurreição de arquivo apagado" de 29/08. Mas o CHECK de documento_espelho.status
-- só aceita pendente/copiado/falhou/ignorado: o PATCH dava 400 e, sendo "best-effort", falhava
-- CALADO todo dia. Medido na faxina de 25/09 (mesmo 400, agora com log): 43.420 registros
-- 'copiado' apontando para arquivo inexistente (≈15 mil herdados da retenção antiga + os da faxina)
-- e 34 anexos em imovel_anexos com link morto — a ressurreição que o conserto devia impedir.
--
-- 1) o CHECK passa a aceitar 'purgado';
-- 2) `espelho_reconciliar_ausentes()` conserta o que o arquivo ausente deixou para trás — e roda
--    todo dia (espelhar-docs-cron), então qualquer divergência futura se desfaz sozinha:
--      · espelho de imóvel ATIVO ou com cliente → volta à fila ('pendente', sem caminho): o cron
--        baixa de novo do leiloeiro, de graça (fetch direto, sem Bright Data);
--      · o resto → 'purgado';
--      · imovel_anexos com caminho inexistente → caminho zerado (link morto some da ficha; o
--        registrar republica quando a cópia nova existir).
-- 3) `anexos_expirados` NÃO devolve anexo cujo arquivo ainda é usado por outro imóvel ativo — com
--    a deduplicação de 25/09, vários lotes apontam para o mesmo arquivo, e o vencimento de um não
--    pode apagar o do outro. Quando o último usuário vence, todos saem juntos.

alter table public.documento_espelho drop constraint if exists documento_espelho_status_check;
alter table public.documento_espelho add constraint documento_espelho_status_check
  check (status = any (array['pendente','copiado','falhou','ignorado','purgado']));

create or replace function public.espelho_reconciliar_ausentes()
returns jsonb language plpgsql volatile security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
as $$
declare v_fila int := 0; v_purg int := 0; v_anexo int := 0;
begin
  with aus as (
    select e.id, e.imovel_id
      from documento_espelho e
     where e.status = 'copiado' and e.storage_path is not null
       and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = e.storage_path)
  ), cls as (
    select aus.id,
           (exists (select 1 from imoveis_leilao i where i.id = aus.imovel_id and i.ativo)
            or exists (select 1 from analises_mercado    a where a.imovel_id = aus.imovel_id::text)
            or exists (select 1 from analises_documental a where a.imovel_id = aus.imovel_id::text)
            or exists (select 1 from analises_laudo      a where a.imovel_id = aus.imovel_id::text)
            or exists (select 1 from casos c where c.imovel_id::text = aus.imovel_id::text)
            or exists (select 1 from arrematados r where r.imovel_id = aus.imovel_id::text)) as vivo
      from aus
  ), f as (
    update documento_espelho e set status = 'pendente', storage_path = null, tentativas = 0,
           motivo = 'arquivo ausente no bucket — recopiar', atualizado_em = now()
      from cls where e.id = cls.id and cls.vivo
    returning 1
  ), p as (
    update documento_espelho e set status = 'purgado', motivo = 'arquivo ausente no bucket (retencao)', atualizado_em = now()
      from cls where e.id = cls.id and not cls.vivo
    returning 1
  )
  select (select count(*) from f), (select count(*) from p) into v_fila, v_purg;

  with z as (
    update imovel_anexos a set storage_path = null
     where a.storage_path is not null
       and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = a.storage_path)
    returning 1
  ) select count(*) into v_anexo from z;

  return jsonb_build_object('recopiar', v_fila, 'purgados', v_purg, 'anexos_zerados', v_anexo, 'em', now());
end $$;
revoke all on function public.espelho_reconciliar_ausentes() from public, anon, authenticated;

-- 3) Trava de arquivo compartilhado na retenção (corpo idêntico ao vigente + o bloco marcado).
create or replace function public.anexos_expirados(p_limite integer default 100)
returns table(id uuid, storage_path text)
language sql stable security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
  select a.id, a.storage_path
  from public.imovel_anexos a
  where a.storage_path is not null
    and a.arrematado = false
    -- 25/09: arquivo ainda usado por OUTRO imóvel ativo (deduplicação) não sai daqui.
    and not exists (
      select 1 from public.imovel_anexos b join public.imoveis_leilao ib on ib.id = b.imovel_id
       where b.storage_path = a.storage_path and b.id <> a.id and coalesce(ib.ativo, false)
    )
    and not exists (
      select 1 from public.documento_espelho e join public.imoveis_leilao ie on ie.id = e.imovel_id
       where e.storage_path = a.storage_path and e.status = 'copiado' and e.imovel_id <> a.imovel_id and coalesce(ie.ativo, false)
    )
    and not (
          exists (select 1 from public.analises_mercado    m where m.imovel_id::text = a.imovel_id::text)
      and exists (select 1 from public.analises_documental d where d.imovel_id::text = a.imovel_id::text)
      and exists (select 1 from public.analises_laudo      l where l.imovel_id::text = a.imovel_id::text)
    )
    and case
      when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id) then
        case
          when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.modalidade = 'venda_direta')
            then exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and coalesce(i.ativo, true) = false)
          when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.resultado_leilao in ('sem_lance','indeterminado'))
            then exists (
              select 1 from public.imoveis_leilao i
              where i.id = a.imovel_id
                and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
                and substring(i.data_leilao, 1, 10)::date < (current_date - 15)
            )
          else exists (
            select 1 from public.imoveis_leilao i
            where i.id = a.imovel_id
              and (
                (i.data_leilao ~ '^\d{4}-\d{2}-\d{2}' and substring(i.data_leilao, 1, 10)::date < (current_date - 1))
                or coalesce(i.ativo, true) = false
              )
          )
        end
      else a.criado_em::date <= (current_date - 5)
    end
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$function$;
