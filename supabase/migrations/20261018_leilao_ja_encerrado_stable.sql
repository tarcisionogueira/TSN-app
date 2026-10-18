-- ─────────────────────────────────────────────────────────────────────────────────────────
-- leilao_ja_encerrado: IMMUTABLE → STABLE, e inlinável (perfil do painel de invariantes, 18/10)
--
-- Usava now() (e cast texto→timestamptz, que depende do fuso) marcada IMMUTABLE — errado: o planner pode
-- tratar o resultado como constante. E o subselect `(select max(x) from (values …))` + o `SET search_path`
-- impediam o inline: a função rodava pelo executor 30 mil vezes por varredura (leilao_vencido_ativo ~390 ms
-- no painel; a mesma chamada está em desativar_leiloes_encerrados, de hora em hora, e no gatilho de escrita).
-- greatest() ignora nulos como o max() — mesma semântica. Conferido em 18/10: 0 divergências em 83.428 lotes.
-- Nenhum índice, check ou coluna gerada depende dela (por isso pode deixar de ser IMMUTABLE).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.leilao_ja_encerrado(p_data_leilao text, p_data_leilao_2 timestamp with time zone, p_data_fim date, p_modalidade text)
 returns boolean
 language sql
 stable
as $function$
  select case
    when coalesce(p_modalidade,'') ~* 'venda[_ -]?(direta|online)' then false
    else coalesce(greatest(
        case when p_data_leilao ~ '[0-9]:[0-9]'
             then (nullif(p_data_leilao,''))::timestamptz
             else (nullif(p_data_leilao,''))::timestamptz + interval '1 day' - interval '1 second' end,
        p_data_leilao_2,
        (p_data_fim)::timestamptz + interval '1 day' - interval '1 second') < pg_catalog.now(), false)
  end
$function$;
