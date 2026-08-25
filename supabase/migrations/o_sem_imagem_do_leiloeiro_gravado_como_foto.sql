-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O "SEM IMAGEM" DO LEILOEIRO GRAVADO COMO FOTO DO IMÓVEL — 25/08/2026
--
-- Fui investigar `sem_foto` (1.878 contra limite 1.600) e o caminho levou a outro defeito,
-- pior, que ninguém vigiava. Cruzando fotos repetidas por fonte:
--     TORRES3 — 50 lotes com "foto", 39 deles apontando para a MESMA URL:
--               https://www.3torresleiloes.com.br/site/images/sem-imagem-lote.jpg
-- O nome do arquivo diz o que ele é. É o placeholder do próprio site, gravado como se fosse
-- a foto do imóvel. VEGAS e RJLEILOES têm o mesmo — os três dividem o template de CMS.
--
-- DOIS DANOS, e o segundo é o que assusta:
--   1. O cliente vê o slot de foto PREENCHIDO, com um "sem imagem" no lugar do imóvel.
--   2. `sem_foto` SUBCONTAVA. Tecnicamente havia URL, então o lote não entrava na conta —
--      a trava que existe para medir essa lacuna estava sendo enganada por ela.
-- É a forma nº 1 da lista do CLAUDE.md em roupa nova: AUSÊNCIA ENTREGUE COMO CONTEÚDO.
--
-- CONSERTO NA CLASSE, NÃO NAS LINHAS. São 5 fontes hoje, três no mesmo template, e a próxima
-- integração herdaria o furo. Um gatilho BEFORE normaliza na ESCRITA, então vale para
-- qualquer scraper — presente ou futuro — sem tocar em cinco parsers.
--
-- E A TRAVA PARA O PLACEHOLDER QUE AINDA NÃO CONHEÇO. A lista de padrões pega o que tem nome
-- óbvio ("sem-imagem", "nao-disponivel", "lote_default"). Um site novo pode chamar o seu de
-- "img_2024_final.png" e passar batido. A assinatura que NÃO depende do nome é a repetição:
-- foto de imóvel é única; placeholder se repete. `foto_repetida_como_lote` acusa fonte com
-- 20+ fotos em que uma única URL cobre mais de 10% do acervo.
-- Calibrado DEPOIS da limpeza: a maior repetição legítima hoje é 3% (ZUK, 3 em 540).
--
-- MEDIDO: 60 linhas normalizadas — TORRES3 41 · VEGAS 8 · FRAZAO 4 · CALIL 3 · RJLEILOES 3 ·
-- EMILIOMATOS 1. E `sem_foto` subiu de 1.878 para 1.928: o número honesto.
--
-- ⚠️ O QUE ISTO NÃO CONSERTA: a HASTA tem 579 lotes ativos e ZERO fotos (100% da fonte) —
-- `hasta-parse.mjs` simplesmente não devolve `link_foto`, e é a maior parcela do `sem_foto`.
-- Não consertei porque não consigo, deste ambiente, buscar uma página da HASTA para ver como
-- a imagem aparece no HTML (o proxy recusa o CONNECT), e escrever o seletor no escuro seria
-- adivinhar. Fica registrado com o número, não varrido para debaixo do tapete.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.foto_placeholder(url text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(url, '') ~* '(sem[-_]?imagem|sem[-_]?foto|no[-_]?image|nao[-_]?disponivel|indisponivel|lote[-_]?default|default[-_]?lote|placeholder|img[-_]?padrao)'
$$;

comment on function public.foto_placeholder(text) is
  'True quando a URL e o "sem imagem" do proprio site do leiloeiro, nao uma foto do imovel. 3torres, vegas e rjleiloes compartilham o mesmo template (/site/images/sem-imagem-lote.jpg).';

create or replace function public.trg_foto_placeholder_nula()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.link_foto is not null and public.foto_placeholder(new.link_foto) then
    new.link_foto := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_foto_placeholder_nula on public.imoveis_leilao;
create trigger trg_foto_placeholder_nula
  before insert or update of link_foto on public.imoveis_leilao
  for each row execute function public.trg_foto_placeholder_nula();

-- limpeza do que ja estava gravado (o gatilho so pega escrita nova)
update public.imoveis_leilao set link_foto = null
 where link_foto is not null and public.foto_placeholder(link_foto);

-- a trava para o placeholder de nome desconhecido
do $do$
declare def text; ancora text := '     (''sem_foto'','; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname='qa_invariantes';
  if def is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('foto_repetida_como_lote' in def) > 0 then raise notice 'ja aplicado'; return; end if;
  if position(ancora in def) = 0 then raise exception 'ancora nao encontrada — revise antes de aplicar'; end if;

  novo :=
'     (''foto_repetida_como_lote'',''Fonte servindo a MESMA foto para 10%+ do acervo (placeholder disfarcado de foto)'',''Captura'',''bug'',
       (select count(distinct fonte) from (
          select fonte, link_foto, count(*) c, sum(count(*)) over (partition by fonte) tot
            from imoveis_leilao
           where ativo and coalesce(link_foto,'''') <> ''''
           group by fonte, link_foto
        ) z where z.tot >= 20 and z.c::numeric / z.tot > 0.10), 0),
' || ancora;

  execute replace(def, ancora, novo);
  raise notice 'trava de foto repetida adicionada';
end $do$;

-- VERIFICADO: gravei 'https://exemplo.com/site/images/sem-imagem-lote.jpg' num lote e o
-- gatilho guardou NULO (transacao desfeita). qa_invariantes(): 50 linhas, 2.668 ms.
