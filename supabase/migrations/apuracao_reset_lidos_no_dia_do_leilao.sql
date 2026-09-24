-- ─────────────────────────────────────────────────────────────────────────────────────────
-- APURAÇÃO LIDA NO PRÓPRIO DIA DO LEILÃO — reset (24/09/2026, dono: "resolva o ZUK e o FRAZAO")
--
-- O cron apurava `data_fim <= hoje` a cada 3 h: abria a página ANTES do pregão, lia
-- 'indeterminado' (ou "sem lance" — a página mostra "nenhum lance" antes de começar) e gastava
-- as 3 tentativas no mesmo dia. Medido: FRAZAO 49/51 indeterminados e ZUK 107/131 apurados no
-- dia do leilão; os 4 sem_lance corretos da FRAZAO, todos no dia seguinte. O cron agora só
-- apura a partir do dia seguinte; este reset devolve à fila (janela de 10 dias) o que foi lido
-- cedo demais: 251 indeterminados + 102 sem_lance de imóveis. 'vendido' fica (exige R$ junto).
-- SUPERBID/SOLD/CEF fora: apurados por outro caminho, que já só olha dia anterior.
-- ─────────────────────────────────────────────────────────────────────────────────────────
update public.imoveis_leilao
   set resultado_leilao = null, resultado_apuracao_tentativas = 0, resultado_apurado_em = null
 where resultado_leilao in ('indeterminado', 'sem_lance')
   and fonte not in ('SUPERBID', 'SOLD', 'CEF')
   and coalesce(resultado_origem, '') <> 'api_superbid_residencial'
   and data_fim >= current_date - 10
   and (resultado_apurado_em at time zone 'America/Sao_Paulo')::date <= data_fim;
