-- Retenção em CAMADAS dos documentos (edital/matrícula/anexos) do bucket.
-- Regra (decisão do produto): documento só "vale a pena guardar" se o cliente
-- avançou até a REUNIÃO com o analista. Curioso que só gerou relatório e não foi
-- à reunião tem o arquivo apagado rápido (ele gera de novo se quiser).
--   • SEM reunião realizada  → apaga 5 dias após a criação.
--   • COM reunião realizada  → mantém 30 dias após o leilão (janela p/ confirmar arremate).
--   • arrematado = true      → nunca apaga (permanente).
-- Retorna os anexos ELEGÍVEIS para exclusão; o cron apaga o arquivo do bucket e
-- zera o storage_path (mantém a linha para auditoria).
create or replace function public.anexos_expirados(p_limite int default 100)
returns table(id uuid, storage_path text)
language sql stable security definer set search_path = public as $$
  select a.id, a.storage_path
  from public.imovel_anexos a
  where a.storage_path is not null
    and a.arrematado = false
    and case
      when exists (
        select 1 from public.reunioes r
        join public.casos c on c.id = r.caso_id
        where c.imovel_id = a.imovel_id::text
          and (r.status in ('realizada','concluida') or r.realizado_em is not null)
      )
      then coalesce(a.data_leilao, a.criado_em::date) <= (current_date - 30)
      else a.criado_em::date <= (current_date - 5)
    end
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$$;

revoke all on function public.anexos_expirados(int) from anon, authenticated;
