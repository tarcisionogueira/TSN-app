-- Runner residencial (27/09): LEJE e FREITAS entram em scripts/runner-residencial.sh. O gate
-- `coleta_cliente_claim` devolve FALSE para fonte sem linha aqui — sem este insert o runner
-- pularia as duas em silêncio ("não é a hora"), para sempre. Mesma cadência dos irmãos (72 h).
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo)
values ('LEJE', 72, true, array['LEJE']), ('FREITAS', 72, true, array['FREITAS'])
on conflict (fonte) do nothing;
