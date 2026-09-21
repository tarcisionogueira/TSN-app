-- Pedido do dono (21/09): "esses imóveis sem lance o sistema deve armazenar as informações
-- e anexos dele por mais 15 dias para dar tempo de fazer uma proposta. os que foram
-- arrematados pode seguir a cronologia de retirar do sistema de forma padrão já configurada."
--
-- `anexos_expirados()` decide quais anexos (`imovel_anexos.storage_path`) o
-- `limpar-documentos-cron.js` apaga do bucket. Regra padrão hoje (leilão com praça, fora
-- venda_direta): apaga 1 dia após `data_leilao` OU assim que o imóvel sai do acervo
-- (`ativo=false`) — o que vier primeiro. Isso é rápido demais pra quem precisa dos
-- documentos pra montar uma proposta de compra direta pro leiloeiro num lote sem lance: o
-- leiloeiro tira o lote do ar quase no mesmo dia (achado de hoje, no cron de apuração), então
-- na prática os documentos sumiam no dia seguinte ao leilão, quase sempre ANTES de alguém
-- decidir propor.
--
-- Resultado ARREMATADO (`resultado_leilao='vendido'`) fica de fora desta mudança de propósito
-- — segue a MESMA cronologia padrão de sempre, como pedido.
--
-- Novo ramo: quando `resultado_leilao='sem_lance'`, ignora o gatilho de `ativo=false` (que
-- dispara quase imediato) e usa só a data — 15 dias após `data_leilao` em vez de 1. Enquanto
-- não apurado (null) ou indeterminado, a regra padrão continua valendo (não foi pedido para
-- estes — ficam de fora de propósito, ver nota no HANDOFF).
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
          when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.resultado_leilao = 'sem_lance')
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
