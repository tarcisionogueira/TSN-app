-- RECRUZAR: DOMÍNIO DA JUNTA × LOJA SUPERBID PELO storeId DO PRÓPRIO SITE (27/10).
--
-- Por que existe: o patch de 26/10 (20261026_recruzar_loja_superbid.sql) casa domínio e loja quando o RADICAL do
-- domínio é igual ao nome da loja ("hoppeleiloes" = "HOPPE LEILÕES"). 32 sites "Superbid Exchange" da junta ficaram
-- fora, por três motivos medidos em 27/10:
--   • o nome da loja não é o radical: eckertleiloes.com.br → loja "ECKERT ASSESSORIA" (21 imóveis no acervo, todos pelo
--     portal), presottoleiloes.com.br → "CAMILA PRESOTTO LEILÕES", davisonmoreira.com.br → lojas "DAVISON MOREIRA" e
--     "CASA LEILOEIRA LEILÕES" (o style.config.json do site lista as duas);
--   • radical de 2 letras (bz, cs, np, id) é barrado pelo mínimo de 3 — certo para o casamento por radical, que é
--     palpite, mas não para um casamento PROVADO;
--   • kronberg.lel.br → "PEDRO KRONBERG LEILÕES".
-- O par (domínio, loja) abaixo NÃO é palpite: storeId = `storeId` de https://siteconfig.superbid.net/<host>/style.config.json
-- (o arquivo que o site carrega para saber de qual loja é), e o nome = o da store-query
-- (store-query.superbid.net/stores/?portalId=[2,15]) para esse id. Os mesmos pares estão em scripts/lib/sbidloja-parse.mjs.
--
-- O que muda: (1) a chave 'sbidloja:' passa a existir com 2+ letras; (2) o casamento por RADICAL continua exigindo 3+
-- (length(lk) >= 12 = 'sbidloja:' + 3); (3) o domínio do mapa casa com a chave da(s) sua(s) loja(s). Patch por
-- substituição de texto no corpo VIVO (mesmo método dos patches de 26/10), para não atropelar mudança concorrente.
do $$
declare d text := pg_get_functiondef('public.leiloeiro_junta_recruzar(boolean, text[])'::regprocedure); n text; n1 text;
begin
  if d like '%sbmapa%' then
    raise notice 'recruzar já tem o mapa de lojas Superbid — nada a fazer';
    return;
  end if;
  n := replace(d,
    $a$     where length(k) >= 3 group by 1),$a$,
    $b$     where length(k) >= 2 group by 1),
  sbmapa as materialized (
    select m.dominio, 'sbidloja:' || lower(regexp_replace(translate(upper(m.loja), 'ÁÀÃÂÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z]|LEILOES|LEILOEIRO|LEILAO', '', 'g')) k
      from (values
        ('acostaleiloes.com.br', 'ACOSTA LEILÕES'), ('batistaleiloes.com.br', 'BATISTA LEILÕES'),
        ('bmleiloes.com.br', 'BRENO MAGALHÃES LEILÕES'), ('burihamleiloes.com.br', 'BURIHAM LEILÕES'),
        ('bzleiloes.com.br', 'BZ LEILÕES'), ('clebercardosoleiloes.com.br', 'CLEBER CARDOSO LEILÕES'),
        ('csleiloes.com.br', 'CS LEILÕES'), ('davisonmoreira.com.br', 'DAVISON MOREIRA'),
        ('davisonmoreira.com.br', 'CASA LEILOEIRA LEILÕES'), ('eckertleiloes.com.br', 'ECKERT ASSESSORIA'),
        ('fernandafreireleiloes.com.br', 'FERNANDA JOSÉ DA SILVA FREIRE'), ('franciscodavidleiloeiro.com.br', 'FRANCISCO DAVID LEILOEIRO'),
        ('ghvmleiloes.com.br', 'GHVM LEILÕES'), ('idleiloes.com.br', 'ID LEILÕES'), ('josimarleiloeiro.com.br', 'JOSIMAR LEILOEIRO'),
        ('kanandaleiloes.com.br', 'KANANDA LEILÕES'), ('kronberg.lel.br', 'PEDRO KRONBERG LEILÕES'),
        ('lauandleiloes.com.br', 'LAUAND LEILÕES'), ('leilominas.com.br', 'LEILO MINAS'), ('leiteleiloes.com.br', 'LEITE LEILÕES'),
        ('lincolnleiloes.com.br', 'LINCOLN LEILÕES'), ('mafraleiloes.com.br', 'MAFRA LEILÕES'),
        ('miguelperezleiloes.com.br', 'MIGUEL PEREZ LEILÕES'), ('npleiloes.com.br', 'NP LEILÕES'),
        ('olivirogerioleiloes.com.br', 'OLIVI ROGERIO LEILÕES'), ('pegoraroleiloes.com.br', 'PEGORARO LEILÕES'),
        ('presottoleiloes.com.br', 'CAMILA PRESOTTO LEILÕES'), ('saladeleiloes.com.br', 'SALA DE LEILÕES'),
        ('schanzerleiloes.com.br', 'Schanzer Leilões'), ('sperancaleiloes.com.br', 'SPERANÇA LEILÕES'),
        ('tadashileiloes.com.br', 'TADASHI LEILÕES'), ('tahaleiloes.com.br', 'TAHA LEILÕES'), ('xistoleiloes.com.br', 'XISTO LEILÕES')
      ) m(dominio, loja)),$b$);
  n1 := n;
  n := replace(n1,
    $a$        where (n.lk = j.nk or n.lk = j.sbk)$a$,
    $b$        where (n.lk = j.nk or (n.lk = j.sbk and length(n.lk) >= 12)
               or exists (select 1 from sbmapa m where m.dominio = j.dominio and m.k = n.lk))$b$);
  if n1 = d or n = n1 then
    raise exception 'recruzar: trecho esperado não encontrado — a função mudou; patch NÃO aplicado';
  end if;
  execute n;
end $$;
