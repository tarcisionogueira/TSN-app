-- Retenção EFICIENTE de documentos (evita retrabalho: capturar → apagar → recapturar).
-- Regra antiga apagava o doc "no dia seguinte ao leilão" mesmo com o LOTE AINDA ATIVO
-- (leilão futuro/reaberto, multi-praça, data defasada) → doc caro/login-gated era
-- apagado e recapturado à toa, e o botão ficava 404.
--
-- Nova regra: MANTÉM enquanto o imóvel está ATIVO no acervo. Só apaga quando ele SAI
-- do acervo (inativo); se houve reunião (cliente engajou), respeita 30 dias após o
-- leilão. Entrada manual (fora do acervo): graça de 5 dias.
create or replace function public.anexos_expirados(p_limite integer default 100)
returns table(id uuid, storage_path text)
language sql stable security definer set search_path to 'public'
as $function$
  select a.id, a.storage_path
  from public.imovel_anexos a
  where a.storage_path is not null
    and a.arrematado = false
    and case
      when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id) then
        exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and coalesce(i.ativo, true) = false)
        and (
          not exists (
            select 1 from public.reunioes r
            join public.casos c on c.id = r.caso_id
            where c.imovel_id = a.imovel_id::text
              and (r.status in ('realizada','concluida') or r.realizado_em is not null))
          or coalesce(a.data_leilao, (current_date - 31)) <= (current_date - 30)
        )
      else a.criado_em::date <= (current_date - 5)
    end
  limit greatest(1, least(coalesce(p_limite, 100), 500))
$function$;
