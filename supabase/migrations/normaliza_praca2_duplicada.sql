-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 2ª PRAÇA QUE NÃO É 2ª PRAÇA — 28/08
--
-- 71 lotes tinham `data_leilao_2` <= `data_leilao`, impossível para uma segunda praça.
-- Olhando o dado, NÃO eram datas invertidas: 68 são DUPLICATA — o scraper põe a data seca em
-- `data_leilao` e o MESMO pregão, com hora, em `data_leilao_2`. O ZUK denuncia por si só:
-- horas distintas por lote no mesmo dia (13:56, 13:48, 13:29, 13:05) são uma sessão única
-- escalonada, não uma segunda praça. Os outros 3 (também ZUK) tinham `data_leilao_2` SETE
-- DIAS antes da 1ª — valor impossível, sem verdade recuperável.
--
-- POR QUE TRIGGER E NÃO CORREÇÃO PONTUAL: os scrapers escrevem cada um por sua conta
-- (`dom-parse-util.mjs`, `hasta-parse.mjs`, e os individuais). Corrigir as 71 linhas na mão
-- seria desfazer hoje o que a coleta refaz amanhã. O portão no banco vale para toda fonte,
-- inclusive as que ainda serão integradas — a mesma escolha já feita para bem móvel e para
-- fração ideal.
--
-- A HORA É PRESERVADA, não descartada: quando `data_leilao` está sem hora e `data_leilao_2`
-- traz uma hora plausível de pregão, ela sobe para `data_leilao` em ISO. Não é formato
-- inventado — 14.562 lotes do acervo já gravam `data_leilao` assim, contra 23.463 com data
-- seca. Fora da janela 07h–21h a hora é DESCARTADA em vez de promovida: 02h da manhã (o caso
-- do WEBLEILOES) é artefato de fuso, e promover isso encerraria o lote de madrugada.
--
-- CONSEQUÊNCIA QUE VALE DIZER EM VOZ ALTA: com a hora em `data_leilao`, `leilao_ja_encerrado`
-- passa a usar o INSTANTE exato em vez do fim do dia. O lote sai do ar às 17h, quando o
-- pregão realmente fecha, em vez de seguir sendo oferecido até 23h59 de um leilão terminado.
-- Brasil não tem horário de verão desde 2019, então America/Sao_Paulo é sempre -03:00.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.trg_normaliza_praca_duplicada()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
declare d1 date; d2 date; h time;
begin
  if new.data_leilao_2 is null then return new; end if;
  d1 := public.data_leilao_para_date(new.data_leilao);
  if d1 is null then return new; end if;
  d2 := (new.data_leilao_2 at time zone 'America/Sao_Paulo')::date;

  -- 2ª praça DE VERDADE (dia posterior): não se toca.
  if d2 > d1 then return new; end if;

  h := (new.data_leilao_2 at time zone 'America/Sao_Paulo')::time;
  if d2 = d1
     and new.data_leilao !~ '[0-9]:[0-9]'
     and h >= time '07:00' and h <= time '21:00' then
    new.data_leilao := to_char(new.data_leilao_2 at time zone 'America/Sao_Paulo',
                               'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00';
  end if;
  new.data_leilao_2 := null;
  return new;
end;
$$;

-- Nome com "_a_" para rodar ANTES de `trg_data_fim_leilao` (gatilhos disparam em ordem
-- alfabética): `data_fim` precisa ser calculado sobre o valor já normalizado, senão guardaria
-- a data que acabamos de descartar.
drop trigger if exists trg_a_normaliza_praca_duplicada on public.imoveis_leilao;
create trigger trg_a_normaliza_praca_duplicada
  before insert or update of data_leilao, data_leilao_2
  on public.imoveis_leilao
  for each row execute function public.trg_normaliza_praca_duplicada();

comment on function public.trg_normaliza_praca_duplicada() is
  'Descarta data_leilao_2 quando ela nao e uma 2a praca (mesmo dia ou anterior a 1a), promovendo a hora do pregao para data_leilao quando ela e plausivel. Portao unico para todas as fontes.';

-- BACKFILL dos 71: o UPDATE apenas TOCA as colunas para o gatilho rodar. A regra vive num
-- lugar só — reescrevê-la aqui criaria duas cópias que precisam concordar para sempre.
update public.imoveis_leilao
   set data_leilao_2 = data_leilao_2
 where data_leilao ~ '^\d{4}' and data_leilao_2 is not null
   and (data_leilao_2 at time zone 'America/Sao_Paulo')::date
       <= public.data_leilao_para_date(data_leilao);
