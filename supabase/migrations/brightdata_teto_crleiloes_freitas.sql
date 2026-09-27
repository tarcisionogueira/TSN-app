-- 27/09: invariante `brightdata_proposito_sem_teto` acusou 2 propósitos gastando sem teto — os dois
-- nasceram nesta sessão (fallback Bright Data do CRLEILOES e o recon/coleta do FREITAS).
-- Consumo medido na semana de 21/09: crleiloes 23 · freitas 12 (100% sucesso).
-- Teto ≈ 1,7× o medido: cobre um catálogo maior sem deixar um laço quebrado queimar a cota.
-- Reserva 0: são fontes pequenas; não tiram fatia garantida dos coletores principais.
-- FREITAS roda pelo PC residencial (fetch direto, sem Bright Data) — o teto só pesa no fallback.
insert into public.brightdata_reserva (proposito, reserva, teto) values
  ('crleiloes', 0, 40),
  ('freitas',   0, 25)
on conflict (proposito) do update set reserva = excluded.reserva, teto = excluded.teto;
