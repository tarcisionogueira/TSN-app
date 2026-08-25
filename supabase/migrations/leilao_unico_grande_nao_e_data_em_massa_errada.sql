-- ─────────────────────────────────────────────────────────────────────────────────────────
-- UM LEILÃO GRANDE NÃO É "DATA EM MASSA ERRADA" — 25/08/2026
--
-- `fonte_data_leilao_uniforme` acusava HASTA: 579 lotes ativos, TODOS com data_leilao
-- 28/08/2026, 2ª praça 03/09 e data_fim 03/09. A regra é "fonte com 100+ lotes e 1-2 datas
-- distintas = data em massa errada", escrita depois do caso real da PESTANA (26/10).
--
-- Só que aqui a data uniforme é VERDADE. Medido antes de mexer em qualquer coisa:
--     579 lotes · 572 valor_minimo distintos · 310 avaliações distintas
--     570 matrículas distintas · 208 cidades · 24 UFs · de R$ 48 mil a R$ 7,75 milhões
-- Um parser que carimba constante não produz 572 valores diferentes em 579 linhas. E o
-- parser (`scripts/lib/hasta-parse.mjs`) lê a data POR LOTE, do próprio HTML — o regex casa
-- "Data 1º Leilão: dd/mm/aaaa … Lance Inicial: R$ …" dentro da página de cada item.
--
-- É um leilão extrajudicial nacional único, com 579 lotes, 1ª praça 28/08 e 2ª em 03/09.
-- Terceiro falso positivo da mesma família nesta sessão: a trava mandando consertar o que
-- está intacto. Se eu tivesse "consertado" o scraper da HASTA, teria quebrado o que funciona.
--
-- O QUE NÃO FAZER: subir o limite de 0 para 1. Isso é recalibrar na mão e esconde a próxima
-- ocorrência de verdade — que é justamente o que a regra existe para pegar.
--
-- O QUE FAZER: prender a dispensa à DATA verificada, não à fonte. Enquanto a HASTA estiver
-- com 28/08/2026, ela não acusa. No dia em que a data uniforme virar outra — porque o leilão
-- passou e veio um lote novo, ou porque o parser quebrou e passou a carimbar constante — o
-- par (fonte, data) deixa de casar e o alerta volta sozinho, sem ninguém precisar lembrar.
-- A verificação expira pelo próprio dado.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.fonte_data_uniforme_verificada (
  fonte         text not null,
  data_leilao   date not null,
  verificado_em timestamptz not null default now(),
  evidencia     text not null,
  primary key (fonte, data_leilao)
);
alter table public.fonte_data_uniforme_verificada enable row level security;

comment on table public.fonte_data_uniforme_verificada is
  'Pares (fonte, data) em que a data uniforme foi CONFERIDA e e legitima — leilao unico grande, nao parser carimbando. A dispensa vale so para aquela data: mudou a data, o invariante fonte_data_leilao_uniforme volta a acusar.';

insert into public.fonte_data_uniforme_verificada (fonte, data_leilao, evidencia)
values ('HASTA', date '2026-08-28',
        '579 lotes com 572 valor_minimo distintos, 570 matriculas distintas, 208 cidades e 24 UFs — parser lendo por lote, nao carimbando. hasta-parse.mjs extrai a data de dentro da pagina de cada item. Leilao extrajudicial nacional unico: 1a praca 28/08, 2a 03/09.')
on conflict (fonte, data_leilao) do nothing;

do $do$
declare def text; ancora text := '(select count(*) from (
          select fonte from imoveis_leilao
           where ativo and data_leilao is not null
           group by fonte
          having count(*) >= 100 and count(distinct data_leilao::date) <= 2
        ) u), 0),'; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';
  if def is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('fonte_data_uniforme_verificada' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer'; return;
  end if;
  if position(ancora in def) = 0 then
    raise exception 'ancora do invariante nao encontrada — revise antes de aplicar';
  end if;

  novo := '(select count(*) from (
          select fonte,
                 min(data_leilao::date) as d,
                 count(distinct data_leilao::date) as nd
            from imoveis_leilao
           where ativo and data_leilao is not null
           group by fonte
          having count(*) >= 100 and count(distinct data_leilao::date) <= 2
        ) u
         where not (u.nd = 1
                    and exists (select 1 from public.fonte_data_uniforme_verificada v
                                 where v.fonte = u.fonte and v.data_leilao = u.d))), 0),';

  execute replace(def, ancora, novo);
  raise notice 'invariante passa a dispensar par (fonte, data) verificado';
end $do$;
