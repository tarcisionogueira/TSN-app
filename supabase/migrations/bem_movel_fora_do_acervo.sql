-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BEM MÓVEL FORA DO ACERVO — o gate de "isto é imóvel?" — 18/08/2026
--
-- POR QUE EXISTE. A varredura de 18/08 achou `pecini_10532` ATIVO no acervo: título
-- "VW/SAVEIRO CL 1.6 MI / CL/ C 1.6 Aeronaves em leilão". Um carro, numa plataforma de imóveis.
-- Os coletores aceitam tudo que a fonte enumera (o sitemap da PECINI lista veículos) e
-- `inferirTipo` apenas o classifica como 'outros' — não existia gate perguntando se o LOTE é
-- um imóvel.
--
-- CENSO COMPLETO (31.049 ativos, sem amostragem). Três bens móveis, em três fontes diferentes:
--     VIP .......... "Honda/CG 150 Titan KS, Ano 2007" — R$ 7.652,  tipo gravado 'imovel'
--     GRUPOLANCE ... "Veículo LR Evoque Pure P5D, 2011/2012" — R$ 96.763, tipo 'casa'
--                     (a URL do próprio leiloeiro é /imoveis/casas/sp/… — ele também errou)
--     PECINI ....... "VW/SAVEIRO CL 1.6 MI" — R$ 15.473, tipo 'outros'
--
-- O QUE O CENSO EVITOU, e é o ponto desta migração. Uma primeira regra por PALAVRA SOLTA no
-- texto acusaria 19 lotes — e 16 deles são IMÓVEIS DE VERDADE:
--     "Terreno 480 m² … Furnas IATE Clube"        (nome do condomínio)
--     "Apartamento — JOIAS DE SANTA BARBARA"       (nome do empreendimento, 12 lotes CEF)
--     "Casa — BALNEARIO JOIA"                      (nome do bairro)
--     "Garagem para quatro VEÍCULOS, do Edifício"  (vaga de garagem: é imóvel)
--     dois apartamentos da SODRE que citam "veículo" na descrição
-- Barrar 16 imóveis reais para pegar 3 carros seria um estrago maior que o problema.
--
-- A REGRA, então, tem DUAS partes e as duas importam:
--   (a) sinal de bem móvel ANCORADO NO TÍTULO — título que COMEÇA com "Veículo", categoria de
--       móvel (aeronave/embarcação/motocicleta/…), MARCA seguida de barra (`VW/`, `Honda/`) ou
--       par de anos de fabricação/modelo (`2011/2012`). Menção no meio da descrição não conta.
--   (b) ausência de sinal IMOBILIÁRIO em título+descrição. Se o texto fala de apartamento,
--       casa, terreno, lote, garagem, matrícula ou área em m², o lote FICA — mesmo que cite
--       "veículo". É o que salva a vaga de garagem e o condomínio chamado Iate Clube.
--
-- Conferida contra as 31.049 linhas ANTES de aplicar: 3 barrados, 3 corretos, 0 falso positivo.
--
-- ONDE MORA. No banco, como a fração ideal — e pelo mesmo motivo registrado lá: 117 dos 120
-- lotes de fração ideal entraram pelo coletor genérico, que não chama `checarQualidade`. Gate
-- em JS pega só quem passa por ele; gate em trigger pega TODO caminho de escrita, inclusive
-- `enriquecer-lote`, `api/scraper-leiloeiros` e correções manuais.
--
-- `ativo = false` e não `raise exception`: os coletores gravam em lote, e derrubar a instrução
-- inteira por causa de uma linha ruim é justamente o defeito que custou 12 dias de RJ. Assim a
-- linha fica no banco para auditoria, some da busca, e é reversível.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.bem_movel_barrado(p_titulo text, p_descricao text)
returns boolean language sql immutable set search_path to 'public', 'pg_temp' as $$
  -- Aplica a regra acervo.bem_movel: bem MÓVEL (veículo, aeronave, embarcação, máquina) não
  -- entra no acervo — a plataforma é de imóveis. A citação da chave aqui NÃO é decoração:
  -- `auditoria_regras_negocio()` casa `regra_negocio.aplicada_por` com o CORPO da função, e
  -- acusou esta regra como órfã até esta linha existir. É a mesma trava que pegou o
  -- "explorador não saca", escrito em comentário e aplicado por ninguém.
  with n as (
    select lower(translate(coalesce(p_titulo,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as t,
           lower(translate(coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as td
  )
  select
    -- (a) sinal de bem MÓVEL, ancorado no título
    (   t ~ '^\s*veiculo\M'
     or t ~ '\m(aeronave|helicoptero|embarcacao|jet ?ski|motocicleta|motoneta|semirreboque|retroescavadeira|empilhadeira)'
     or t ~ '\m(vw|gm|chevrolet|volkswagen|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citroen|scania|iveco|volvo|mercedes)/'
     or t ~ '\m(19|20)\d{2}/(19|20)\d{2}\M')
    -- (b) e NENHUM sinal imobiliário em título+descrição
    and not (td ~ '\m(apartamento|casa|terreno|lote|gleba|sala|loja|galp[ao]|chacara|sitio|fazenda|predio|edificio|garagem|vaga|imovel|matricula|area (construida|privativa|total|do terreno)|m2|m²|quadra)')
  from n;
$$;

comment on function public.bem_movel_barrado(text, text) is
  'TRUE quando o lote e bem MOVEL (veiculo/aeronave/embarcacao) e nao ha sinal imobiliario. Ancorado no TITULO de proposito: regra por palavra solta acusaria 16 imoveis reais (Iate Clube, Joias de Santa Barbara, "garagem para quatro veiculos") para pegar 3 carros. Ver migracao de 18/08.';

create or replace function public.imovel_barrar_bem_movel()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.ativo and public.bem_movel_barrado(new.titulo, new.descricao) then
    new.ativo := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_imovel_bem_movel on public.imoveis_leilao;
create trigger trg_imovel_bem_movel
  before insert or update on public.imoveis_leilao
  for each row execute function public.imovel_barrar_bem_movel();

-- REGRA DE NEGÓCIO como DADO (CLAUDE.md 2b): `aplicada_por` aponta a função que a aplica, e é
-- isso que faz `auditoria_regras_negocio()` conseguir acusar regra escrita e não aplicada.
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'acervo.bem_movel',
  jsonb_build_object('excluir', true,
    'inclui', jsonb_build_array('veículo', 'aeronave', 'embarcação', 'motocicleta', 'máquina'),
    'so_com_sinal_no_titulo', true,
    'preserva_se_houver_sinal_imobiliario', true),
  'Bem MÓVEL (veículo, aeronave, embarcação, máquina) não entra no acervo — a plataforma é de imóveis. O sinal tem de estar no TÍTULO, e lote com sinal imobiliário (apartamento/casa/terreno/garagem/matrícula/m²) nunca é barrado: vaga de garagem é imóvel, e condomínio chamado "Iate Clube" também.',
  array['bem_movel_barrado'],
  true
)
on conflict (chave) do update
   set valor = excluded.valor, descricao = excluded.descricao,
       aplicada_por = excluded.aplicada_por, ativo = true;

-- Passivo: os 3 já capturados.
update public.imoveis_leilao
   set ativo = false
 where ativo and public.bem_movel_barrado(titulo, descricao);

-- INVARIANTE. O trigger impede a entrada, mas regra que PARA DE FUNCIONAR não dá erro — só
-- deixa carro passando por imóvel outra vez. Limite 0: qualquer ocorrência é bug, nunca
-- sazonalidade.
do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)$a$;

  depois := $b$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('bem_movel_no_acervo','Bem movel (veiculo/aeronave) ativo numa plataforma de imoveis','Captura','bug',
       (select count(*) from imoveis_leilao where ativo and public.bem_movel_barrado(titulo, descricao)), 0)$b$;

  if position(antes in def) = 0 then
    if position('bem_movel_no_acervo' in def) > 0 then
      raise notice 'invariante ja presente';
      return;
    end if;
    raise exception 'ancora nao encontrada em qa_invariantes()';
  end if;

  execute replace(def, antes, depois);
  raise notice 'qa_invariantes atualizada com bem_movel_no_acervo';
end $do$;

-- NOTA DELIBERADA: NÃO existe cópia desta regra em JavaScript, e é de propósito. A fração
-- ideal tem as duas (JS + banco) e o comentário em `scraper-puppeteer.mjs` já avisa: "dois
-- regexes equivalentes em arquivos diferentes divergem no primeiro ajuste, e aí a fonte que
-- ficou para trás volta a admitir o que a outra barra". Aqui há UMA definição, no banco, que
-- é por onde todo caminho de escrita passa. Se um dia fizer falta no coletor, exporte a
-- decisão do banco — não reescreva o regex.
