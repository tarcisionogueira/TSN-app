-- A RPC anexos_expirados (usada pelo limpar-documentos-cron) leva ~6,3s por lote de
-- 500 (NOT EXISTS em analises_mercado/documental/laudo + reunioes + join imoveis) —
-- perto/acima do teto de 8s que o PostgREST aplica às RPCs (authenticator=8s; o
-- service_role null herda esse teto na prática). Resultado: o cron recebia timeout,
-- quebrava no 1º lote e NÃO apagava nada — a limpeza praticamente nunca drenou
-- (só ~364 de ~7,7 mil anexos limpos historicamente), por isso o bucket documentos
-- inchou. Fix resiliente: teto de tempo próprio (60s), como no snapshot_metricas_fontes.
-- (Perf da RPC fica como follow-up — otimizar os NOT EXISTS/índices reduziria os 6,3s.)
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
    -- MANTER se o imóvel tem QUALQUER relatório gerado (regra do dono).
    and not exists (select 1 from public.analises_mercado   m where m.imovel_id::text = a.imovel_id::text)
    and not exists (select 1 from public.analises_documental d where d.imovel_id::text = a.imovel_id::text)
    and not exists (select 1 from public.analises_laudo      l where l.imovel_id::text = a.imovel_id::text)
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
