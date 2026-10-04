-- ============================================================================
-- ARQUIVO DE LOTES INATIVOS (04/10) — causa do `qa_invariantes_lenta`
--
-- `imoveis_leilao` + 37 índices = 295 MB contra 256 MB de cache (shared_buffers); 56,6 mil das 82,6 mil
-- linhas estão inativas. O painel das 18:10 lê do disco (5,5–10,5 s). Compute maior foi descartado
-- pelo dono (custo). Esta é a saída (b) do perfilamento de 03/10: tirar lote inativo velho da tabela
-- quente SEM perder o dado.
--
-- POR QUE ARQUIVAR E NÃO APAGAR (`limpar_lotes_inativos`, de 08/08, apagava): o Índice BidPro
-- (`gerar_indice_regiao`) usa a avaliação/m² de TODOS os lotes, ativos e inativos — 6 mil dos
-- candidatos são CEF, amostra do índice. Apagar empobreceria o índice calado. O arquivo guarda a
-- linha inteira e o índice passa a ler a view `imoveis_leilao_indice_base` (as 7 colunas que usa).
--
-- QUEM FICA NA TABELA QUENTE (medido em 04/10 sobre 8.802 candidatos de 2 meses):
--   • resultado_leilao preenchido (1.103) — apuração custou crédito do Bright Data; reapurar lê daqui;
--   • referenciado em QUALQUER tabela por imovel_id/imovel_ref/arremate_imovel_id ou favoritos.item_id
--     (varredura dinâmica: tabela nova com essas colunas entra sozinha). Inclui as FKs: imovel_anexos
--     e documento_espelho apagam em CASCATA (171 teriam anexos perdidos) e editais_leilao bloqueia o
--     delete (a função de 08/08 falharia inteira).
--   • análise, visto por cliente, arremate, anexos no jsonb — os critérios de 08/08.
--
-- ⚠️ `insert ... select i.*` exige que imoveis_leilao_arquivo tenha AS MESMAS colunas: ao criar coluna nova em
-- imoveis_leilao, crie a mesma no arquivo (senão a próxima rodada falha alto — sem perder dado).
--
-- SIMULA POR PADRÃO. O arquivo NÃO encolhe o arquivo da tabela sozinho: depois de arquivar é preciso
-- `vacuum full public.imoveis_leilao;` (trava a tabela ~1 min) — fora do horário das coletas, no SQL
-- Editor (VACUUM não roda dentro de função/transação).
-- ============================================================================

create table if not exists public.imoveis_leilao_arquivo (like public.imoveis_leilao including defaults);
alter table public.imoveis_leilao_arquivo enable row level security;
create unique index if not exists imoveis_leilao_arquivo_id on public.imoveis_leilao_arquivo (id);
create index if not exists imoveis_leilao_arquivo_cidade on public.imoveis_leilao_arquivo (cidade_norm, estado);
comment on table public.imoveis_leilao_arquivo is
  'Lote inativo antigo, sem vinculo com cliente/apuracao, movido de imoveis_leilao (cache). Linha inteira preservada. Lido pelo Indice BidPro via imoveis_leilao_indice_base. So service role.';

create or replace view public.imoveis_leilao_indice_base with (security_invoker = true) as
  select cidade_norm, estado, bairro, latitude, longitude, area_m2, valor_avaliacao from public.imoveis_leilao
  union all
  select cidade_norm, estado, bairro, latitude, longitude, area_m2, valor_avaliacao from public.imoveis_leilao_arquivo;

-- Índice BidPro passa a ler ativos + inativos + arquivo (mesma amostra de antes).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.gerar_indice_regiao'::regproc);
  if strpos(d, 'from public.imoveis_leilao i') = 0 then return; end if; -- já aplicada
  d := replace(d, 'from public.imoveis_leilao i', 'from public.imoveis_leilao_indice_base i');
  execute d;
end $$;

create or replace function public.arquivar_lotes_inativos(
  p_meses int default 2,
  p_simular boolean default true,
  p_limite int default 10000
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_cand int; v_mov int; v_del int;
  v_papel text := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  -- Exclusão em massa: só service role / SQL Editor. Vale mesmo antes do revoke do bloco final.
  if v_papel in ('anon', 'authenticated') then
    raise exception 'arquivar_lotes_inativos: somente service role';
  end if;
  create temp table _cand on commit drop as
    select i.id from public.imoveis_leilao i
     where not i.ativo
       and i.atualizado_em < now() - make_interval(months => greatest(2, p_meses))
       and i.resultado_leilao is null
       and coalesce(jsonb_array_length(i.anexos), 0) = 0
     limit greatest(1, p_limite);

  -- Qualquer tabela que aponte para o lote o mantém na tabela quente (o app só lê imoveis_leilao).
  -- Junta os ids referenciados num conjunto com chave e cruza UMA vez (30 subconsultas sem índice
  -- passavam de 60 s).
  create temp table _ref (id text primary key) on commit drop;
  for r in
    select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.table_name not in ('imoveis_leilao', 'imoveis_leilao_arquivo')
       and (c.column_name in ('imovel_id', 'imovel_ref', 'arremate_imovel_id')
            or (c.table_name = 'favoritos' and c.column_name = 'item_id')
            -- FK sem cascata (varredura de 04/10): um lote citado aqui derrubaria o delete inteiro.
            or (c.table_name = 'editais_leilao' and c.column_name = 'duplicata_suspeita_de'))
       and c.data_type in ('uuid', 'text', 'character varying')
  loop
    execute format('insert into _ref select distinct %I::text from public.%I where %I is not null on conflict do nothing',
                   r.column_name, r.table_name, r.column_name);
  end loop;
  delete from _cand c using _ref f where f.id = c.id::text;

  select count(*) into v_cand from _cand;
  if p_simular or v_cand = 0 then
    return jsonb_build_object('ok', true, 'simulacao', true, 'elegiveis', v_cand,
      'criterio', 'inativo ha mais de ' || greatest(2, p_meses) || ' meses, sem resultado de leilao, sem anexos e sem referencia em nenhuma tabela');
  end if;

  insert into public.imoveis_leilao_arquivo select i.* from public.imoveis_leilao i join _cand c on c.id = i.id
    on conflict (id) do nothing;
  get diagnostics v_mov = row_count;
  delete from public.imoveis_leilao i using _cand c
   where c.id = i.id and exists (select 1 from public.imoveis_leilao_arquivo a where a.id = i.id);
  get diagnostics v_del = row_count;
  return jsonb_build_object('ok', true, 'simulacao', false, 'candidatos', v_cand, 'arquivados', v_mov, 'removidos_da_quente', v_del);
end $$;

grant execute on function public.arquivar_lotes_inativos(int, boolean, int) to service_role;

-- ── RODAR PELO DONO NO SQL EDITOR (o conector MCP não executa revogação) ──────────────────────
-- Até lá a função se protege sozinha (recusa anon/authenticated no início do corpo), a tabela de
-- arquivo tem RLS sem política e a view é security_invoker (herda a RLS das duas tabelas).
revoke all on function public.arquivar_lotes_inativos(int, boolean, int) from public, anon, authenticated;
revoke all on public.imoveis_leilao_arquivo from anon, authenticated;
revoke all on public.imoveis_leilao_indice_base from anon, authenticated;
