-- A DATA QUE DECIDE: `data_fim`.
--
-- ACHADO DO DONO (02/08): o lote `gl_28450` mostrava "Data do leilão 03/08/26" — hoje — sendo
-- que o leiloeiro publica **início 03/08/2026 00:00 e ENCERRAMENTO 03/11/2026 15:00**.
-- Guardávamos a data que menos importa e jogávamos fora o prazo para dar lance.
--
-- Duas coisas se somavam:
--   1) `extrairDataLeilao` devolvia `Math.min` das datas da página — numa página com início E
--      encerramento, isso é sempre o início (corrigido em api/enriquecer-lote.js, que agora
--      extrai o PAR e classifica cada data pelo contexto);
--   2) `data_leilao_2` existia mas NENHUM caminho de leiloeiro escrevia: medido, 0% em todas as
--      fontes exceto CEF (23,5%). O segundo campo estava lá e ninguém preenchia.
--
-- E o estrago aparecia na busca: a ordenação "Encerra em breve" filtrava `data_leilao >= hoje`,
-- então um lote aberto até novembro sumiria de uma lista chamada "encerra" já no dia seguinte.
-- Uma coluna com a data de COMEÇO sustentando um filtro de FIM é o oposto do que deveria.
--
-- `data_fim` resolve isso de uma vez, no banco: é sempre o **último prazo relevante** —
-- encerramento da janela, ou 2ª praça, ou a única data que existir. É ela que a busca ordena e
-- filtra, e é ela que o card e o e-mail de oportunidades exibem. Fica como coluna real mantida
-- por trigger (e não gerada) porque `data_leilao` é TEXT com formatos misturados (ISO simples e
-- timestamp completo), e cast de texto não é imutável.

-- Parse tolerante: a coluna acumulou 'YYYY-MM-DD', '2025-07-04T13:00:00Z' e
-- '2027-04-17T08:00:00-03:00'. Texto que não vira data devolve NULL em vez de explodir.
create or replace function public.data_leilao_para_date(p_txt text)
returns date
language plpgsql
immutable
as $$
declare d date;
begin
  if p_txt is null or btrim(p_txt) = '' then return null; end if;
  begin
    d := (btrim(p_txt))::timestamptz::date;
    return d;
  exception when others then
    begin
      d := (left(btrim(p_txt), 10))::date;   -- pega o 'YYYY-MM-DD' da frente
      return d;
    exception when others then
      return null;
    end;
  end;
end;
$$;

alter table public.imoveis_leilao add column if not exists data_fim date;

comment on column public.imoveis_leilao.data_fim is
  'ULTIMO prazo relevante do lote: encerramento da janela / 2a praca / unica data existente. E a coluna que a busca ordena e filtra em "Encerra em breve" — data_leilao sozinha era o INICIO e escondia lote ainda aberto.';

create or replace function public.trg_data_fim_leilao()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  -- Sempre a MAIOR data conhecida: o encerramento manda; sem ele, vale a que houver.
  new.data_fim := greatest(
    new.data_leilao_2::date,
    public.data_leilao_para_date(new.data_leilao)
  );
  -- greatest() com um lado NULL já devolve o outro no Postgres, mas deixamos explícito
  -- que a ausência de qualquer data resulta em NULL (e não numa data inventada).
  if new.data_leilao_2 is null and public.data_leilao_para_date(new.data_leilao) is null then
    new.data_fim := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_data_fim_leilao on public.imoveis_leilao;
create trigger trg_data_fim_leilao
  before insert or update of data_leilao, data_leilao_2 on public.imoveis_leilao
  for each row execute function public.trg_data_fim_leilao();

-- Backfill do que já está no acervo (a trigger só pega escrita nova).
update public.imoveis_leilao
   set data_fim = greatest(data_leilao_2::date, public.data_leilao_para_date(data_leilao))
 where data_fim is null
   and (data_leilao_2 is not null or data_leilao is not null);

-- A busca filtra por ativo + ordena por data_fim.
create index if not exists imoveis_leilao_data_fim_idx
  on public.imoveis_leilao (data_fim) where ativo;
