-- Data do leilão divergente do que o leiloeiro e o edital dizem (11/11, Cravo, Feira de Santana).
-- Pedido do dono: "isso precisa ser corrigido e não pode se repetir".
--
-- O CASO: o lote 12733 mostrava "Data do leilão 09/03/27" e, na mesma tela, a descrição do leiloeiro
-- "Leilão: 21/01/2027 às 15:00". O edital tem DUAS tentativas: 1ª (21/01 e 28/01/2027) e, só se ela
-- falhar, 2ª (02/03 e 09/03/2027). O acervo gravou a última data da tentativa de reserva. O edital
-- escrevia as datas por extenso e nenhum leitor do sistema entendia — os dois relatórios foram
-- gerados sem comparar nada. O 12732 tinha 14/10/2027: a data em que "a matrícula foi expedida".
--
-- 1) CORREÇÃO dos três lotes da Cravo com as datas do edital/resumo do leiloeiro.
-- 2) VIGIA: `lote_data_diverge_resumo()` acusa lote ativo cuja data gravada não bate com a data que
--    o leiloeiro publica no início da descrição ("Leilão: dd/mm/aaaa"). Entra no health-check.

update public.imoveis_leilao set
  data_leilao = '2027-01-21T15:00:00-03:00', data_leilao_2 = '2027-01-28T15:00:00-03:00', atualizado_em = now()
where fonte = 'CRAVOLEIL' and fonte_id in ('cravoleil_12733', 'cravoleil_12734');

update public.imoveis_leilao set
  data_leilao = '2027-01-21T11:00:00-03:00', atualizado_em = now()
where fonte = 'CRAVOLEIL' and fonte_id = 'cravoleil_12732';

create or replace function public.lote_data_diverge_resumo()
returns table (fonte text, fonte_id text, imovel_id uuid, data_gravada text, data_resumo date)
language sql
stable
security invoker
set search_path = public
as $$
  with x as (
    select i.fonte, i.fonte_id, i.id, i.data_leilao, i.data_leilao_2,
           regexp_match(i.descricao, '^\s*Leil[ãa]o:\s*(\d{2})/(\d{2})/(\d{4})') m
      from public.imoveis_leilao i
     where i.ativo and i.descricao ~* '^\s*Leil[ãa]o:\s*\d{2}/\d{2}/\d{4}'
  ), y as (
    select x.*, make_date(m[3]::int, m[2]::int, m[1]::int) dr
      from x
     where m[2]::int between 1 and 12 and m[1]::int between 1 and 31
  )
  select y.fonte, y.fonte_id, y.id, coalesce(left(y.data_leilao::text, 16), '(vazia)'), y.dr
    from y
   where y.dr >= current_date                      -- praça já passada não é mais o que se vigia
     and (y.data_leilao is null
          or (left(y.data_leilao::text, 10) <> to_char(y.dr, 'YYYY-MM-DD')
              and coalesce(left(y.data_leilao_2::text, 10), '') <> to_char(y.dr, 'YYYY-MM-DD')))
   order by y.dr;
$$;

comment on function public.lote_data_diverge_resumo() is
  'Lote ativo cuja data gravada diverge da data que o leiloeiro publica no início da descrição ("Leilão: dd/mm/aaaa"). Verde = vazio. Caso de origem: Cravo 12733 (11/11).';
