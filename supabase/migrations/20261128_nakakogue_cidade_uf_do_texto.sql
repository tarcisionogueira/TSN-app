-- 28/11: NAKAKOGUE — 342 lotes ativos sem cidade e sem UF (somem de /leiloes), todos com o padrão
-- "Lote 001 - ALAGOAS - CIDADE: ARAPIRACA - Casa…" no texto. O leitor (scripts/lib/nakakogue-parse.mjs →
-- estadoCidadeRotulados) passou a ler isto nas próximas coletas; aqui o acervo atual.
-- Regra igual à do leitor: estado por extenso → sigla; cidade só quando JÁ existe com esse nome naquele estado em
-- outro lote do acervo (de onde vem a grafia acentuada: "Maceió", não "MACEIO"). Simulado antes: 342 de 342.
with uf(nome, sigla) as (values ('acre','AC'),('alagoas','AL'),('amapa','AP'),('amazonas','AM'),('bahia','BA'),('ceara','CE'),
  ('distrito federal','DF'),('espirito santo','ES'),('goias','GO'),('maranhao','MA'),('mato grosso','MT'),('mato grosso do sul','MS'),
  ('minas gerais','MG'),('para','PA'),('paraiba','PB'),('parana','PR'),('pernambuco','PE'),('piaui','PI'),('rio de janeiro','RJ'),
  ('rio grande do norte','RN'),('rio grande do sul','RS'),('rondonia','RO'),('roraima','RR'),('santa catarina','SC'),('sao paulo','SP'),
  ('sergipe','SE'),('tocantins','TO')),
alvo as (select i.id, m[1] est_txt, m[2] cid_txt from public.imoveis_leilao i,
           regexp_match(i.descricao, '-\s+([^-]+?)\s+-\s+CIDADE:\s*(.+?)\s+-\s+') m
          where i.ativo and i.fonte = 'NAKAKOGUELEILOES' and coalesce(i.cidade, '') = ''),
can as (select estado, cidade_norm, (array_agg(cidade order by (cidade ~ '[áàâãéêíóôõúç]') desc, n desc))[1] cidade
          from (select estado, cidade_norm, cidade, count(*) n from public.imoveis_leilao
                 where cidade_norm is not null and cidade ~ '[a-zà-ú]' group by 1, 2, 3) z group by 1, 2),
res as (select a.id, u.sigla, c.cidade
          from alvo a
          join uf u on public.norm_cidade(u.nome) = public.norm_cidade(trim(a.est_txt))
          join can c on c.estado = u.sigla and c.cidade_norm = public.norm_cidade(a.cid_txt))
update public.imoveis_leilao i set cidade = r.cidade, estado = r.sigla
  from res r where i.id = r.id;
