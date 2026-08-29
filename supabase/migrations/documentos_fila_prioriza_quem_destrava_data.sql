-- A FILA DE DOCUMENTOS PASSA A ATENDER QUEM PRECISA, NÃO QUEM CHEGOU PRIMEIRO (29/08).
--
-- POR QUE: `captura-documentos` lia `documentos_fila` em FIFO puro (`order by criado_em`), com
-- 1.315 pendentes. Enquanto isso, a leitura de documento — que existe justamente para preencher
-- data de lote que não tem — encontrou, na validação, **137 de 160 candidatos SEM documento
-- nenhum**. As duas rotinas trabalhavam em paralelo em vez de uma alimentar a outra.
--
-- O que a prioridade compra, e por isso ela é esta e não outra: lote ATIVO e SEM DATA é o único
-- em que o documento destrava DUAS coisas ao mesmo tempo —
--   · `desativar_leiloes_encerrados` é cego em quem não tem data, então o lote nunca expira e
--     fica no acervo criando expectativa depois do leilão;
--   · o gate `leilao_ja_encerrado` FALHA ABERTO sem data, então o cliente gasta cota gerando
--     relatório de um leilão que já aconteceu.
-- Lote com data já resolvida não compra nenhuma das duas com o mesmo documento.
--
-- Dentro de cada faixa a ordem continua sendo `criado_em`: prioridade reordena faixas, não
-- transforma a fila em loteria — quem está esperando há mais tempo dentro da mesma urgência
-- continua na frente.
--
-- Lote INATIVO cai para o fim, mas NÃO sai: o documento dele ainda serve a relatório histórico
-- e a caso em andamento. Descartar seria decidir por retenção num lugar que é de fila.
begin;

create or replace function public.documentos_fila_proxima(p_limite int default 40)
returns table (imovel_id uuid, tentativas int, prioridade int)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.imovel_id,
         coalesce(f.tentativas, 0) as tentativas,
         case
           when i.ativo and i.data_leilao is null then 1   -- destrava expiração E fecha o gate
           when i.ativo                           then 2   -- serve ao relatório do cliente
           else 3                                          -- histórico: atende, mas por último
         end as prioridade
    from public.documentos_fila f
    join public.imoveis_leilao i on i.id = f.imovel_id
   where f.status = 'pendente'
      or (f.status = 'erro' and coalesce(f.tentativas, 0) < 4)
   order by 3, f.criado_em
   limit greatest(1, least(coalesce(p_limite, 40), 500));
$function$;

revoke all on function public.documentos_fila_proxima(int) from public, anon;

commit;
