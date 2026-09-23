-- 23/09 — Rede Superbid (SUPERBID + SOLD + veículos) passa para o runner residencial.
-- Diária (20 h), não 2x/semana: acervo de ~1.300 lotes com praça todo dia. O GitHub só
-- coleta como RESERVA se `ultima_em` ficar 7+ dias para trás (scraper-puppeteer.mjs,
-- navegadorRedeSuperbid) — por isso esta linha é o sinal que as duas pontas leem.
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('SUPERBID', 20, true, array['SUPERBID','SOLD'])
on conflict (fonte) do update set intervalo_horas = excluded.intervalo_horas,
  ativo = true, fontes_acervo = excluded.fontes_acervo;
