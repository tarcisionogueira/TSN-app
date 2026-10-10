-- 10/10 — LEILOEIRO PELO PROCESSO. Dos 549 editais reais sem leiloeiro (nome e site nulos), a
-- maioria é DECISÃO que só diz "o leiloeiro nomeado" — o texto não tem o que extrair. Mas o MESMO
-- processo costuma ter outra publicação (ou um lote no acervo) que nomeia: medido, 30 por outro
-- edital e 6 por lote do acervo. Esta função copia de lá, e só quando a fonte é INEQUÍVOCA:
--   1) outro edital do processo com nome/site — exige UM ÚNICO leiloeiro (nome_norm ou domínio)
--      entre os irmãos; processo com dois leiloeiros diferentes fica como está;
--   2) lote do acervo (fonte ≠ EDITAL_DJEN) do processo — exige UM ÚNICO leiloeiro entre os
--      lotes; aí o edital é, por definição, de leiloeiro integrado.
-- Só preenche campo NULO (nunca sobrescreve o que o edital já tem). Roda no radar-editais-cron a
-- cada execução (custo: duas leituras agregadas) e se esgota sozinha.
create or replace function public.editais_leiloeiro_pelo_processo()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
declare
  v_edital int := 0;
  v_acervo int := 0;
  v_lixo int := 0;
begin
  -- NOME-LIXO VIRA NULO primeiro (achado no dry-run: "Com A Remoção", "Outros Documentos",
  -- "Da Presente Decisão", "a publicação do edital na forma do art" — frase do texto gravada como
  -- leiloeiro). Nulo é a verdade ("não sei"), e aí o passo abaixo ainda pode achar o nome real.
  with feito as (
    update editais_leilao
       set leiloeiro_nome = null, leiloeiro_nome_norm = null, atualizado_em = now()
     where leiloeiro_nome_norm ~ '\m(remocao|documentos?|outros|arrematacao|processo|intimacao|decisao|vistos|edital|juizo|vara|autos)\M'
    returning id
  )
  select count(*) into v_lixo from feito;

  with alvo as (
    select id, regexp_replace(numero_processo, '\D', '', 'g') np
      from editais_leilao
     where leiloeiro_nome is null and leilao_plataforma_url is null
       and status in ('processado', 'erro_parse') and numero_processo ~ '\d{7}'
  ), fonte_ok as (
    -- Só copia o que é CONFIÁVEL na origem (medido no dry-run de 10/10): o acervo de editais tem
    -- nomes-lixo antigos ("Com A Remoção", "Outros Documentos") e site de órgão público gravado como
    -- plataforma (cav.receita.fazenda.gov.br). Propagar isso multiplicaria o erro pelo processo.
    select regexp_replace(numero_processo, '\D', '', 'g') np, atualizado_em, leiloeiro_jucesp, leiloeiro_integrado,
           case when leiloeiro_nome_norm !~ '\m(remocao|documentos?|outros|arrematacao|processo|intimacao|decisao|vistos|edital|juizo|vara|autos)\M'
                then leiloeiro_nome end nome,
           case when leiloeiro_nome_norm !~ '\m(remocao|documentos?|outros|arrematacao|processo|intimacao|decisao|vistos|edital|juizo|vara|autos)\M'
                then leiloeiro_nome_norm end nome_norm,
           case when leilao_plataforma_url !~* '\.(gov|jus|leg|mp|def)\.br' then leilao_plataforma_url end url
      from editais_leilao
     where numero_processo ~ '\d{7}' and (leiloeiro_nome is not null or leilao_plataforma_url is not null)
  ), irmaos as (
    select np,
           count(distinct coalesce(nome_norm, lower(url))) n_leiloeiros,
           (array_agg(nome order by (nome is null), atualizado_em desc))[1] nome,
           (array_agg(nome_norm order by (nome_norm is null), atualizado_em desc))[1] nome_norm,
           (array_agg(leiloeiro_jucesp order by (leiloeiro_jucesp is null), atualizado_em desc))[1] jucesp,
           (array_agg(url order by (url is null), atualizado_em desc))[1] url,
           bool_or(leiloeiro_integrado) integrado
      from fonte_ok
     where nome is not null or url is not null
     group by 1
  ), feito as (
    update editais_leilao e
       set leiloeiro_nome = i.nome, leiloeiro_nome_norm = i.nome_norm,
           leiloeiro_jucesp = coalesce(e.leiloeiro_jucesp, i.jucesp),
           leilao_plataforma_url = i.url, leiloeiro_integrado = coalesce(i.integrado, false),
           atualizado_em = now()
      from alvo a join irmaos i on i.np = a.np and i.n_leiloeiros = 1
     where e.id = a.id
    returning e.id
  )
  select count(*) into v_edital from feito;

  with alvo as (
    select id, regexp_replace(numero_processo, '\D', '', 'g') np
      from editais_leilao
     where leiloeiro_nome is null and leilao_plataforma_url is null
       and status in ('processado', 'erro_parse') and numero_processo ~ '\d{7}'
  ), lotes as (
    select regexp_replace(numero_processo, '\D', '', 'g') np,
           count(distinct leiloeiro) n_leiloeiros, min(leiloeiro) leiloeiro,
           min(substring(url_lote from '^(https?://[^/]+)')) url
      from imoveis_leilao
     where fonte <> 'EDITAL_DJEN' and numero_processo ~ '\d{7}' and leiloeiro is not null
     group by 1
  ), feito as (
    update editais_leilao e
       set leiloeiro_nome = l.leiloeiro,
           -- mesma normalização do `norm` de api/radar-editais-cron.js (sem acento, minúscula, não-alfanumérico → espaço)
           leiloeiro_nome_norm = btrim(regexp_replace(lower(translate(l.leiloeiro, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', ' ', 'g')),
           leilao_plataforma_url = l.url, leiloeiro_integrado = true, atualizado_em = now()
      from alvo a join lotes l on l.np = a.np and l.n_leiloeiros = 1
     where e.id = a.id
    returning e.id
  )
  select count(*) into v_acervo from feito;

  return jsonb_build_object('nome_lixo_anulado', v_lixo, 'por_outro_edital', v_edital, 'por_lote_do_acervo', v_acervo);
end $function$;

revoke all on function public.editais_leiloeiro_pelo_processo() from public, anon, authenticated;
grant execute on function public.editais_leiloeiro_pelo_processo() to service_role;
