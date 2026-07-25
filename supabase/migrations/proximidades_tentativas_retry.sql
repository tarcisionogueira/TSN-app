-- Pontos próximos: retry em vez de exclusão permanente.
-- O cron (enriquecer-proximidades) marcava proximidades_em MESMO em falha do Overpass
-- (sem gravar pontos_proximos), e a fila filtra proximidades_em is null → ~9,9 mil
-- imóveis ficavam PRESOS para sempre por uma falha transitória (rate-limit do Overpass).
--
-- Correção: um contador de tentativas. O cron passa a NÃO marcar proximidades_em em
-- falha (só incrementa tentativas) e a fila exige tentativas < 5 → falhas transitórias
-- são re-tentadas (agora com espelhos do Overpass), e só desiste após 5 tentativas reais.
alter table public.imoveis_leilao
  add column if not exists proximidades_tentativas smallint not null default 0;

-- RE-ENFILEIRA os que ficaram presos pela regra antiga (marcados mas sem pontos):
-- volta proximidades_em a null e zera tentativas para entrarem de novo na fila.
update public.imoveis_leilao
set proximidades_em = null, proximidades_tentativas = 0
where ativo = true
  and proximidades_em is not null
  and pontos_proximos is null;
