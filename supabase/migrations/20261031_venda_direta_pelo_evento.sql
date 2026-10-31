-- 31/10 — `venda_direta_com_praca` = 44 era o INSTRUMENTO medindo outra coisa (forma nº 10): os 44 são venda direta
-- de verdade com PRAZO PARA PROPOSTA (conferido no site: LANCEVIP "Prazo para propostas 29/11" = data gravada;
-- SCHULMANN "recebimento de propostas" até 08/12 14h = gravada; BENEDETTO "até 26/11 15h" = gravada; TABA "VENDA
-- DIRETA" com contagem de Fechamento). Venda direta tem prazo — por isso o invariante já precisava de exceção fixa
-- para COMPREI/SHIOKAWA/ZACCARINO/CUNHA. Classificação errada é venda direta com 2ª PRAÇA (hoje: 0).
--
-- E o erro de verdade estava no sentido oposto: 86 vendas diretas gravadas como judicial/extrajudicial — publicadas
-- como EVENTO ("/leilao/venda-direta-crediplanalto…/lote_id/N" = "Venda direta Sicoob", HASTAPUBLICALEL 59;
-- Peterlongo/SUPORTE 12; Szortyka 5; DLD, GT, MP, Raupp…). O template LeilãoPro traz o art. 895 do CPC ("até o início
-- do primeiro leilão", "processo", "juiz") em toda página e o teste de "judicial" vencia. Conserto no parser
-- (leilaopro-parse: `eventoVendaDireta`) e aqui, para TODA fonte: sem 2ª praça + "venda direta" no slug do evento
-- ou no começo do título → venda_direta. Lote com 2ª praça nunca vira venda direta (regra do dono, 09/09).
create or replace function public.trg_venda_direta_pelo_evento() returns trigger
 language plpgsql set search_path to 'public' as $$
begin
  if coalesce(new.modalidade, '') not ilike '%venda%direta%'
     and new.data_leilao_2 is null and new.praca2_fim is null
     and (new.url_lote ~* '/(leilao|eventos/leilao)/[^/]*venda[-_]direta'
          or new.url_lote ~* '[-_]venda[-_]direta/?$'
          or new.titulo ~* '^\s*venda\s+direta') then
    new.modalidade := 'venda_direta';
  end if;
  return new;
end $$;

create or replace trigger trg_venda_direta_pelo_evento before insert or update on public.imoveis_leilao
  for each row execute function public.trg_venda_direta_pelo_evento();

-- o invariante passa a medir o que o nome diz: venda direta COM 2ª praça
do $$
declare d text;
  antes constant text := 'count(*) filter (where modalidade ilike ''%venda%direta%'' and data_leilao is not null and fonte not in (''COMPREI'', ''SHIOKAWA'', ''ZACCARINO'', ''CUNHA'')) as c15';
  depois constant text := 'count(*) filter (where modalidade ilike ''%venda%direta%'' and (data_leilao_2 is not null or praca2_fim is not null)) as c15';
begin
  d := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  if (length(d) - length(replace(d, antes, ''))) / length(antes) <> 1 then
    raise exception 'c15 do qa_invariantes não encontrado exatamente 1 vez';
  end if;
  d := replace(d, antes, depois);
  d := replace(d, '''Modalidade venda_direta com praça datada (classificação errada)''',
                  '''Venda direta com 2ª praça (classificação errada; prazo de proposta sozinho é normal)''');
  execute d;
end $$;

-- dado já gravado
update public.imoveis_leilao set modalidade = modalidade
 where ativo and coalesce(modalidade, '') not ilike '%venda%direta%' and data_leilao_2 is null and praca2_fim is null
   and (url_lote ~* '/(leilao|eventos/leilao)/[^/]*venda[-_]direta' or url_lote ~* '[-_]venda[-_]direta/?$'
        or titulo ~* '^\s*venda\s+direta');
