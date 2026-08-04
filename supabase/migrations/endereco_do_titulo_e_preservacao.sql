-- ─────────────────────────────────────────────────────────────────────────────
-- ENDEREÇO: derivar do TÍTULO e nunca deixar retroceder para vazio
--
-- ACHADO (04/08, o dono mandou conferir um mercadológico do cliente Rafael): o Nível 1 do
-- relatório (mesmo endereço / raio ~250 m) voltou 0 amostras. O defeito NÃO era do buscador
-- de amostras: o lote `zuk_37094-231508` tem `endereco` e `bairro` VAZIOS, embora o título
-- traga "Rua José Miguel Ackel, 2252". Sem endereço, o geocode caiu num ponto genérico de
-- Guarulhos — a MESMA coordenada de outros 3 lotes, de 3 fontes diferentes. Ou seja: o raio
-- de 250 m foi medido do lugar errado e a busca por "mesmo endereço" não tinha endereço.
-- O relatório dizia "não foram encontrados comparáveis para o endereço fornecido" quando
-- endereço nenhum tinha sido fornecido.
--
-- ESCALA: ~1.065 lotes ativos têm o logradouro no título e a coluna vazia (ZUK 736/840,
-- SUPERBID 174, MEGA 67, LJUD 58, LEILOTECH 22).
--
-- POR QUE NO BANCO, E NÃO NOS MAPPERS (economia + segurança): um gatilho cobre INSERT e
-- UPDATE, todas as fontes e todo caminho de escrita — presente e futuro — sem editar 5
-- scrapers, sem cron novo e sem nenhuma chamada paga. E resolve de brinde o problema que
-- teria desfeito tudo: os mappers gravam `endereco: ''` LITERAL, e num upsert
-- merge-duplicates isso APAGA o que já estava lá (mesma família do bug do link_edital).
--
-- SEGURANÇA DA EXTRAÇÃO: endereço ERRADO é pior que vazio — desloca o raio de 250 m para
-- outro lugar sem avisar. Por isso a regra é auto-validada: a cidade que vem DENTRO do
-- título tem que bater com a cidade da linha. No ensaio: 722 de 840 casaram e 722 de 722
-- tiveram cidade conferindo — ZERO divergência. Título fora do padrão é recusado (fica vazio).
--
-- CAMADA 2 (ainda NÃO feita, ver HANDOFF): para os lotes cujo título não traz logradouro,
-- a fonte é o EDITAL / MATRÍCULA que já capturamos. Deve ser ON-DEMAND, na geração do
-- relatório — só paga quando alguém realmente pede aquele imóvel.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.endereco_do_titulo(p_titulo text, p_cidade text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  with m as (
    select regexp_match(
      coalesce(p_titulo,''),
      'em leil[ãa]o\s*-\s*((?:Rua|Avenida|Av\.|Travessa|Estrada|Alameda|Pra[çc]a|Rodovia|Largo|Via|Rod\.)[^-]{3,90}?)\s*-\s*([^/-]{2,60})/([A-Z]{2})\s*-',
      'i') as g
  )
  select case
    when g is null then null
    when lower(translate(btrim(g[2]), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       = lower(translate(btrim(coalesce(p_cidade,'')), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
      then nullif(btrim(regexp_replace(g[1], '[,\s]+$', '')), '')
    else null
  end from m;
$$;

create or replace function public.preservar_e_derivar_endereco()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare v_novo text;
begin
  if tg_op = 'UPDATE' then
    if coalesce(btrim(new.endereco),'') = '' and coalesce(btrim(old.endereco),'') <> '' then
      new.endereco := old.endereco;
    end if;
    if coalesce(btrim(new.bairro),'') = '' and coalesce(btrim(old.bairro),'') <> '' then
      new.bairro := old.bairro;
    end if;
  end if;

  if coalesce(btrim(new.endereco),'') = '' then
    v_novo := public.endereco_do_titulo(new.titulo, new.cidade);
    if v_novo is not null then
      new.endereco := v_novo;
      -- Pede regeocode: sem isto o endereço fica certo e o PONTO continua errado,
      -- que é metade do defeito. O cron horário usa só rotas GRATUITAS (Nominatim/
      -- IBGE/BrasilAPI) — o Google, pago, não entra em lote. Custo zero.
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_preservar_endereco on public.imoveis_leilao;
create trigger trg_preservar_endereco
  before insert or update on public.imoveis_leilao
  for each row
  execute function public.preservar_e_derivar_endereco();

-- BACKFILL dos já existentes (o gatilho só age na escrita).
update imoveis_leilao set atualizado_em = atualizado_em
where ativo and coalesce(btrim(endereco),'') = ''
  and public.endereco_do_titulo(titulo, cidade) is not null;

-- REGEOCODE de todos os derivados: o rótulo antigo de precisão não vale nada aqui, porque
-- todos foram geocodificados SEM endereço — 358 dos 722 dividiam coordenada com outro lote,
-- o que é impossível para endereços distintos, mesmo os marcados como 'rua'.
update imoveis_leilao set geocod_nivel = 'refazer'
where ativo and coalesce(btrim(endereco),'') <> ''
  and public.endereco_do_titulo(titulo, cidade) is not null
  and coalesce(geocod_nivel,'') <> 'refazer';
