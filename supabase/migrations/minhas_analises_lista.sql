-- ─────────────────────────────────────────────────────────────────────────────
-- A lista de "Minhas Análises" deixa de ser três janelas de 12 e passa a ser UMA
-- consulta por imóvel. (12/08, a partir da tela do dono: "os mercadológicos sumiram")
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O QUE ESTAVA ERRADO. `AnalisesContext` lia as três tabelas com `.limit(12)`,
-- CADA UMA ordenada pelo seu próprio `updated_at`. Com 51 mercadológicos e 19
-- documentais na conta do dono, os cortes caem em datas diferentes: um imóvel
-- cujo documental é recente (entra no top 12 dele) e cujo mercadológico é antigo
-- (fica no 27º) aparecia na lista com o chip "Jurídico: risco médio" e NENHUM
-- chip de mercado. O relatório estava no banco o tempo todo.
--
-- Não era só cosmético, e é por isso que vale uma RPC em vez de aumentar o 12:
--   · `Analise.jsx` lê o relatório do MESMO contexto truncado. Abrir uma análise
--     fora dos 12 mostrava "não gerado" — e um clique em Gerar reprocessava a IA
--     de um relatório que já existia (não recobra cota, mas gasta).
--   · O título canônico vem da mercadológica; a documental grava o endereço da
--     matrícula. Sem a linha de mercado, o card trocava de nome — dois cards da
--     tela do dono apareciam como "Rua Marte, N. 429" e "Rua Engenheiro ...".
--   · `data_leilao` costuma estar preenchida na mercadológica e NULA na
--     documental. Sem a linha de mercado, a tela achava que não havia data e não
--     mostrava o aviso "Leilão em … arrematou?" — sumindo justamente a janela
--     em que o cliente precisa registrar o arremate.
--
-- COMO FICA: uma linha por imóvel, montada no servidor, com o título e o imóvel
-- preferindo a mercadológica (ordem 1 → 2 → 3), a data de leilão EFETIVA (maior
-- entre as análises e a praça do acervo) e, de cada relatório, só o status e as
-- poucas chaves que a lista desenha. O `result` inteiro (12 kB em média) NÃO
-- viaja — a lista fica leve mesmo com 50 imóveis, e a tela de detalhe continua
-- buscando o relatório completo por imóvel.
--
-- NÃO filtra expirado de propósito: quem tira da lista é a retenção, apagando
-- (`limpar_analises_orfas`). Reimplementar a regra de prazo aqui criaria duas
-- verdades que divergem no dia em que alguém mudar `ANALISE_LIMPAR_DIAS`.
create or replace function public.minhas_analises_lista(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_caller uuid := auth.uid();
  v_alvo   uuid;
  v_role   text;
begin
  if v_caller is null then raise exception 'não autenticado'; end if;
  v_alvo := coalesce(p_user_id, v_caller);
  -- Modo suporte: admin/analista pode ler a lista do cliente que está atendendo.
  if v_alvo <> v_caller then
    select role into v_role from public.perfis where id = v_caller;
    if coalesce(v_role,'') not in ('admin','analista') then
      raise exception 'sem permissão para ler análises de outro usuário';
    end if;
  end if;

  return coalesce((
    with linhas as (
      select 1 as ord, 'mercado'::text as tipo, imovel_id, titulo, cidade, estado, imovel,
             status, data_leilao, arrematado, updated_at, created_at,
             jsonb_build_object('temResultado', result is not null) as flags
        from public.analises_mercado where user_id = v_alvo
      union all
      select 2, 'documental', imovel_id, titulo, cidade, estado, imovel,
             status, data_leilao, arrematado, updated_at, created_at,
             jsonb_build_object(
               'precisaDocumentos', coalesce(result->'precisaDocumentos', 'false'::jsonb),
               'emCaptura',         coalesce(result->'emCaptura', 'false'::jsonb),
               'nivelRisco',        result->>'nivelRisco')
        from public.analises_documental where user_id = v_alvo
      union all
      select 3, 'laudo', imovel_id, titulo, cidade, estado, imovel,
             status, data_leilao, arrematado, updated_at, created_at,
             jsonb_build_object(
               'precisaRelatorios', coalesce(result->'precisaRelatorios', 'false'::jsonb),
               'veredito',          result->>'veredito')
        from public.analises_laudo where user_id = v_alvo
    ),
    porim as (
      select imovel_id,
             (array_agg(titulo order by ord) filter (where coalesce(titulo,'') <> ''))[1] as titulo,
             (array_agg(cidade order by ord) filter (where coalesce(cidade,'') <> ''))[1] as cidade,
             (array_agg(estado order by ord) filter (where coalesce(estado,'') <> ''))[1] as estado,
             (array_agg(imovel order by ord) filter (where imovel is not null))[1]        as imovel,
             max(data_leilao)                 as praca_analise,
             max(updated_at)                  as updated_at,
             min(created_at)                  as created_at,
             bool_or(arrematado)              as arrematado,
             jsonb_object_agg(tipo, jsonb_build_object('status', status, 'flags', flags)) as relatorios
        from linhas group by imovel_id
    ),
    comp as (
      select p.*, i.ativo as imovel_ativo,
             (select max(x) from (values
                ((nullif(i.data_leilao, ''))::timestamptz),
                (i.data_leilao_2),
                (i.data_fim::timestamptz + interval '1 day' - interval '1 second')
              ) v(x)) as praca_acervo
        from porim p
        left join public.imoveis_leilao i on i.id::text = p.imovel_id::text
    )
    select jsonb_agg(jsonb_build_object(
             'imovelId',    imovel_id,
             'titulo',      titulo,
             'cidade',      cidade,
             'estado',      estado,
             'imovel',      imovel,
             'dataLeilao',  nullif(greatest(coalesce(praca_acervo,'-infinity'::timestamptz),
                                            coalesce(praca_analise,'-infinity'::timestamptz)),
                                   '-infinity'::timestamptz),
             'imovelAtivo', coalesce(imovel_ativo, false),
             'arrematado',  coalesce(arrematado, false),
             'updatedAt',   updated_at,
             'createdAt',   created_at,
             'relatorios',  relatorios)
           order by updated_at desc)
      from comp
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.minhas_analises_lista(uuid) from anon;
grant  execute on function public.minhas_analises_lista(uuid) to authenticated;
