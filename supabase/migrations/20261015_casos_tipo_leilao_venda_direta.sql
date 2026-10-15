-- Caso de VENDA DIRETA (Caixa/banco) tinha de escolher entre judicial e extrajudicial (15/10, dono: o caso do
-- Matheus estava "judicial" e foi venda direta online da Caixa). Tipo próprio no caso; a tela mostra "Venda Direta".
alter table public.casos drop constraint if exists casos_tipo_leilao_check;
alter table public.casos add constraint casos_tipo_leilao_check check (tipo_leilao = any (array['judicial','extrajudicial','venda_direta']));
update public.casos set tipo_leilao = 'venda_direta' where id = 'e678b17e-e31c-4d13-927d-b3b9b9b6f5ab';
