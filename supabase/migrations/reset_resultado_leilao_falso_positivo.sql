-- Achado ao vivo, 21/09 (pedido do dono: "verifique por que esse filtro não está trazendo
-- nada"): `_resultado-leilao.js` casava "vendido"/"arrematado" soltos com cláusula padrão que
-- existe em TODO edital, vendido ou não ("o imóvel será vendido no estado em que se encontra";
-- "despesas do arrematante"/"documentação... arrematado(s)... será entregue") — confirmado ao
-- vivo em LEILOFY e PESTANA. PESTANA piora: `url_lote` é a AGENDA do leilão inteiro (até 1.070
-- lotes compartilhando a mesma URL), nunca a página do lote — apurar essa fonte nunca vai dar
-- certo (ver FONTES_SEM_URL_POR_LOTE em api/apurar-resultado-leilao-cron.js).
--
-- Este reset (dado, não schema) desfaz exatamente o que ficou errado, sem tocar no que está
-- correto: 'vendido' sem valor confirmado era o sintoma exato do falso positivo (ZUK/MEGA
-- genuínos sempre tinham o valor real do lance junto) — 15 linhas no total (10 PESTANA + 5
-- LEILOFY). PESTANA/EDITAL_DJEN ficam resetadas por inteiro (mesmo as já 'indeterminado') por
-- estarem excluídas da apuração daqui pra frente — não há por que carregar um resultado de uma
-- fonte que nunca respondeu à pergunta certa.

-- 1) Falsos positivos: 'vendido' sem valor confirmado.
update public.imoveis_leilao
set resultado_leilao = null, valor_lance_vencedor = null, resultado_apurado_em = null, resultado_apuracao_tentativas = 0
where resultado_leilao = 'vendido' and valor_lance_vencedor is null;

-- 2) Fontes sem URL por lote: tudo que ficou apurado (certo ou errado) nelas.
update public.imoveis_leilao
set resultado_leilao = null, valor_lance_vencedor = null, resultado_apurado_em = null, resultado_apuracao_tentativas = 0
where fonte in ('PESTANA', 'EDITAL_DJEN') and resultado_leilao is not null;
