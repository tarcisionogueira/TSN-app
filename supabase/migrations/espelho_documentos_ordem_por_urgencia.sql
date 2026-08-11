-- ═══════════════════════════════════════════════════════════════════════════════
-- ESPELHO DE DOCUMENTOS: a fila passa a ser ordenada pela DATA DO LEILÃO (11/08)
-- ═══════════════════════════════════════════════════════════════════════════════
-- MEDIDO HOJE: 4.079 documentos `pendente` contra 543 `copiado`. O cron enfileira até
-- 200 por execução e copia 25 — 8× mais entrada que saída. Rodando de 4 em 4 horas, a
-- vazão real é de 148-150/dia (conferido em fonte_saude: 150, 148, 148, 97). Nesse ritmo
-- a fila atual leva ~27 dias para drenar, e ela cresce.
--
-- O problema não é só a vazão: a fila era `order by criado_em asc`. Documento de um lote
-- que vai a leilão DEPOIS DE AMANHÃ ficava atrás de milhares de outros cujo leilão é daqui
-- a três meses. Depois do leilão o leiloeiro tira o lote do ar e o documento é irrecuperável
-- — que é exatamente a perda que este espelho existe para evitar.
--
-- A ordem agora é por URGÊNCIA (leilão mais próximo primeiro), depois pela instabilidade
-- da fonte (quem quebra mais, espelha antes), depois pela ordem de chegada. Não muda o
-- custo: copia a mesma quantidade, só copia o que importa primeiro.

create or replace function public.proximos_espelho_documentos(p_limite int default 60)
returns table(id uuid, imovel_id uuid, fonte text, tipo text, url_origem text,
              tentativas smallint, data_leilao text, urgencia int)
language sql
security definer
set search_path to 'public'
as $fn$
  with inst as (select * from public.fonte_instabilidade())
  select e.id, e.imovel_id, e.fonte, e.tipo, e.url_origem, e.tentativas,
         i.data_leilao,
         case
           -- leilão dentro de 30 dias: é agora ou nunca
           when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
                and i.data_leilao::date between current_date and current_date + 30 then 0
           when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
                and i.data_leilao::date between current_date + 31 and current_date + 90 then 1
           -- sem data confiável: não dá para adiar sem saber até quando
           when i.data_leilao is null or i.data_leilao !~ '^\d{4}-\d{2}-\d{2}' then 2
           when i.data_leilao::date > current_date + 90 then 3
           else 4   -- leilão já passou: menor prioridade, mas continua na fila
         end as urgencia
    from documento_espelho e
    join imoveis_leilao i on i.id = e.imovel_id
    left join inst on inst.fonte = e.fonte
   where e.status = 'pendente' and coalesce(e.tentativas, 0) < 3 and i.ativo
   order by urgencia, coalesce(inst.pct_instavel, 0) desc, e.criado_em
   limit greatest(1, least(p_limite, 500));
$fn$;

revoke execute on function public.proximos_espelho_documentos(int) from public, anon, authenticated;
grant  execute on function public.proximos_espelho_documentos(int) to service_role;
