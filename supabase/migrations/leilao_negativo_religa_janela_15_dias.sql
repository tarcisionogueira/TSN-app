-- 23/09 — Leilão negativo apurado (sem_lance/indeterminado) fica ATIVO por 15 dias a partir da
-- apuração (janela de proposta, mesma regra de desativar_leiloes_encerrados). Estava sendo
-- desligado pelo sweep "sumiu_da_fonte" do coletor (a fonte tira o lote encerrado da vitrine) —
-- 186 de 186 SUPERBID invisíveis. O sweep e a retenção de veículos agora respeitam a janela
-- (scraper-puppeteer.mjs); aqui, religa o que já tinha sido desligado.
update imoveis_leilao set ativo = true, suprimido_motivo = null
where not ativo and resultado_leilao in ('sem_lance','indeterminado')
  and resultado_apurado_em > now() - interval '15 days'
  and suprimido_motivo in ('praca_vencida','sumiu_da_fonte');
