-- 25/10 — FECHA A "PORTA DOS FUNDOS" DO LEILOEIRO (arena das páginas pré-login, passo 5).
--
-- ⚠️ QUEM APLICA É O DONO (SQL Editor do Supabase). O conector MCP trava em REVOKE (pede confirmação
-- que a sessão remota não exibe). NÃO aplicar por apply_migration.
--
-- O QUE ESTAVA ABERTO: a migração 20261021_imoveis_leiloeiro_plano_pago.sql tirou o SELECT de tabela de
-- anon/authenticated e devolveu um GRANT POR COLUNA — e a lista devolvida ainda incluía fonte, fonte_id,
-- numero_edital, numero_matricula e numero_processo. Ou seja: a view imoveis_leilao_mascarado esconde o
-- leiloeiro de quem não paga, mas `GET /rest/v1/imoveis_leilao?select=fonte,fonte_id` com a chave pública
-- devolvia o mesmo dado de graça. A landing nova vende "leiloeiro, edital e matrícula: Investidor Pro" —
-- vender isso com a porta aberta seria vender o que já sai pela API. Até ESTA migração ser aplicada, a
-- landing promete só "link do lote, edital e matrícula" (sem a palavra leiloeiro).
--
-- INVENTÁRIO FEITO ANTES (25/10), para o REVOKE não virar "tela vazia com cara de sem resultado" (forma 2):
--  • src/: ZERO leituras de `.from('imoveis_leilao')` — tudo já passa pela view mascarada desde 21/10.
--  • api/: todas as leituras diretas usam SUPABASE_SERVICE_KEY (service_role tem SELECT de tabela inteira).
--    Única exceção: api/busca-raio.js chama as RPCs abaixo COM A CHAVE PÚBLICA para quem não paga.
--  • funções SECURITY INVOKER executáveis por anon/authenticated que leem as 5 colunas DA TABELA:
--      buscar_por_raio_v2 e buscar_por_raio_v2_sem_geocode_count → filtro `i.fonte is distinct from
--        'EDITAL_DJEN'`. Com o REVOKE, a busca por raio do visitante e do Explorador passaria a dar
--        "permission denied for column fonte". → viram SECURITY DEFINER aqui (abaixo). Seguro: a policy de
--        SELECT de imoveis_leilao é `true` (o definer não abre linha nova) e o que sai para o cliente
--        continua vindo da view mascarada, que decide pelo pode_ver_leiloeiro() (lê o JWT, não o current_user).
--      acervo_lotes_fantasma, acervo_por_fonte, fonte_regressao_suspeita, gemeos_coanuncio_grupos,
--        gemeos_matricula_grupos → só cron/admin com service_role (nenhuma chamada em src/). Para anon e
--        authenticated elas passam a falhar — que é o certo: devolviam numero_matricula/fonte a qualquer um.
--  • views: imoveis_leilao_mascarado é security_invoker=false (lê como dono, não é afetada);
--    imoveis_leilao_indice_base é security_invoker=true mas não lê nenhuma das 5 colunas.
--
-- AINDA ABERTO DEPOIS DISTO (fora deste passo, registrado no relatório): a view mascarada devolve
-- numero_edital, numero_matricula e numero_processo SEM máscara. Não são links nem PDF (o que a landing
-- promete como Pro), mas identificam o processo/matrícula. Decidir com o dono antes de mascarar — o SSR de
-- /leilao/:id pode exibir o número do processo.

-- 1) As duas RPCs da busca por raio deixam de depender do grant de coluna de quem chama.
alter function public.buscar_por_raio_v2(double precision, double precision, double precision, integer, integer, text[], text, text[], text[], double precision, double precision, double precision, text, text, boolean, text, text)
  security definer;
alter function public.buscar_por_raio_v2_sem_geocode_count(text, text[], text, text[], text[], double precision, double precision, double precision, text, text, boolean, text)
  security definer;

-- 2) auditoria_seguranca() acusaria as duas como rpc_definer_anon. São leitura pública POR DESENHO (a busca
--    aberta do site), sem PII, e o conteúdo sai pela view mascarada — mesmo caso de landing_numeros.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.auditoria_seguranca'::regproc);
  if position('''buscar_por_raio_v2''' in d) = 0 then
    d := replace(d, '''landing_numeros''', '''landing_numeros'',''buscar_por_raio_v2'',''buscar_por_raio_v2_sem_geocode_count''');
    if position('''buscar_por_raio_v2''' in d) = 0 then
      raise exception 'allowlist de auditoria_seguranca mudou de forma — ajuste esta migração';
    end if;
    execute d;
  end if;
end $$;

-- 3) O REVOKE propriamente dito (o grant atual é POR COLUNA — ver 20261021, linha ~175 —, então o revoke
--    por coluna tira exatamente estas cinco e mantém as outras).
revoke select (fonte, fonte_id, numero_edital, numero_matricula, numero_processo)
  on public.imoveis_leilao from anon, authenticated;

-- PROVA (rodar depois, como anon — tem de dar 42501 "permission denied for column fonte"):
--   curl "$SUPABASE_URL/rest/v1/imoveis_leilao?select=fonte&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
-- E a busca por raio continuar respondendo (como anon):
--   curl -X POST "$SUPABASE_URL/rest/v1/rpc/buscar_por_raio_v2_sem_geocode_count" -H "apikey: $ANON" \
--     -H "Content-Type: application/json" -d '{"cidade_norm_filtro":"sao paulo","tipos_filtro":[],"estado_filtro":"SP","modalidades_filtro":[],"pagamentos_filtro":[],"valor_min":0,"valor_max":9999999999,"desconto_min":0,"data_de":null,"data_ate":null,"sem_data":false,"resultado_filtro":""}'
-- Depois: erros_cliente e cliente_travou(2) por 48 h (CLAUDE.md, item 1b).
