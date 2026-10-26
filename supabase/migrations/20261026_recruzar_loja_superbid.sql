-- RECRUZAR: LOJA DO PORTAL SUPERBID CONTA COMO COLETADO (26/10, triagem da junta pelo banco).
--
-- Por que existe: 62 domínios `nao_coletado` rodam o white-label "Superbid Exchange" (S4B) — a home é a mesma
-- SPA vazia (`<title></title>`, recaptcha `onloadCallback`, meta keywords "Superbid Exchange"). Os lotes deles JÁ
-- ESTÃO no acervo: o coletor SUPERBID (portal 2/15, scripts/scraper.js) grava cada oferta com `url_lote` em
-- superbid.net e `leiloeiro` = NOME DA LOJA ("HOPPE LEILÕES", "CHUI LEILÕES", "MONZON LEILÕES"...). O recruzar
-- não via: o host é superbid.net (não o domínio do leiloeiro) e a loja é a MARCA, não o nome da pessoa na junta.
-- Medido em 26/10: 30 dos 62 domínios casam exatamente com uma loja SUPERBID (radical do domínio sem "leiloes" =
-- nome da loja sem "LEILÕES"), somando ~1.500 lotes ATIVOS (HOPPE 742, CHUI 313, ANDRÉ LUIZ 98, MONZON 77...).
-- Tratar esses 30 como "nao_coletado" era medir o formato da URL com o nome de cobertura (forma nº 10).
--
-- O que muda: uma evidência a mais em `nomes` — chave 'sbidloja:<radical da loja>' das lojas com lote ATIVO na
-- fonte SUPERBID — e o `ev_nome` aceita também o radical do domínio da junta contra essa chave. Igualdade EXATA
-- (sem "contém"), mínimo de 3 letras. O resto da função fica intacto: o patch é por substituição de texto no corpo
-- VIVO (mesmo método do patch de 26/10 que tirou o fallback da triagem), para não atropelar mudança concorrente.
do $$
declare d text := pg_get_functiondef('public.leiloeiro_junta_recruzar(boolean, text[])'::regprocedure); n text; n1 text;
begin
  if d like '%sbidloja:%' then
    raise notice 'recruzar já tem a evidência de loja SUPERBID — nada a fazer';
    return;
  end if;
  n := replace(d,
    $a$nomes as (select lk, fonte, count(*) n from lotes where lk is not null and length(lk) >= 8 group by 1, 2),$a$,
    $b$nomes as (select lk, fonte, count(*) n from lotes where lk is not null and length(lk) >= 8 group by 1, 2
    union all
    select 'sbidloja:' || k, 'SUPERBID', count(*) from (
      select lower(regexp_replace(translate(upper(leiloeiro), 'ÁÀÃÂÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z]|LEILOES|LEILOEIRO|LEILAO', '', 'g')) k
        from (select leiloeiro from imoveis_leilao where ativo and fonte = 'SUPERBID'
              union all select leiloeiro from veiculos_leilao where ativo and fonte = 'SUPERBID') x) y
     where length(k) >= 3 group by 1),$b$);
  n1 := n;
  n := replace(n1,
    $a$where n.lk = j.nk and n.fonte not in ('EDITAL_DJEN', 'LJUD')) ev_nome,$a$,
    $b$where (n.lk = j.nk
               or (j.dominio is not null
                   and n.lk = 'sbidloja:' || regexp_replace(regexp_replace(j.dbase, '^.*\.', ''), '(leiloes|leiloeiro|leilao)$', '')))
          and n.fonte not in ('EDITAL_DJEN', 'LJUD')) ev_nome,$b$);
  if n1 = d or n = n1 then
    raise exception 'recruzar: trecho esperado não encontrado — a função mudou; patch NÃO aplicado';
  end if;
  execute n;
end $$;
