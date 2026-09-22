-- Pedido do dono (22/09), respondendo à ressalva de ontem: "Sim! Mas ao buscar vai tirar
-- essa dúvida de indeterminado ou sem lance" — confirma estender os 15 dias de retenção
-- (anexos_expirados_retencao_sem_lance_15_dias.sql) também para 'indeterminado', E pede que
-- a BUSCA diária ative tente resolver essa dúvida em vez de deixar parada até alguém abrir a
-- tela do imóvel — ver api/apurar-resultado-leilao-cron.js (mesmo commit) pra essa segunda
-- parte.
--
-- Amplia o ramo de 15 dias de 'sem_lance' para 'sem_lance' OU 'indeterminado' — os dois
-- representam a mesma dúvida ("não temos sinal de venda") pro cliente final, que já os vê
-- juntos no filtro "Sem lance" da tela de busca.
CREATE OR REPLACE FUNCTION public.anexos_expirados(p_limite integer DEFAULT 100)
 RETURNS TABLE(id uuid, storage_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  select a.id, a.storage_path
  from public.imovel_anexos a
  where a.storage_path is not null
    and a.arrematado = false
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
