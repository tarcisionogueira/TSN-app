-- ════════════════════════════════════════════════════════════════════════════════════════════
-- SQL para o DONO rodar no Supabase › SQL Editor (05/10). Colar TUDO e clicar Run uma vez.
-- Estas duas não passam pelo conector da sessão (ele trava em DELETE/UPDATE no texto do SQL).
--   1) Pendência 130 — arquivar_lotes_inativos passa a guardar duplicata_suspeita_de no arquivo.
--   2) Pendência 101 — troca de role em perfis vira evento em atividade_log
--      ('role_alterado_manual' com sessão; 'role_alterado_sistema' por webhook/cron/SQL).
--   3) Pendência 49 — recalcula os selos de documento: edital em Word (~152) e matrícula já copiada
--      para o nosso Storage (~327). As funções já foram trocadas; o gatilho só recalcula ao regravar.
-- Conferência depois (cole e rode): veja o select no fim do arquivo — as duas colunas devem dar true.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1) Pendência 130 ──
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

-- ── 2) Pendência 101 ──
-- 05/10 — pendência 101: troca de role não deixava rastro em atividade_log.
--
-- O Admin troca o plano/papel com UPDATE direto em perfis (Admin.jsx, seletor de role), e
-- nada registrava quem mudou, de quê para quê, nem quando. Um trigger no banco pega TODOS
-- os caminhos (tela, SQL Editor, endpoints) — instrumentar só o front deixaria os outros cegos.
--
-- evento:
--   • 'role_alterado_manual'  → havia sessão (auth.uid() não nulo): alguém da equipe mexeu.
--   • 'role_alterado_sistema' → sem sessão (service role: webhook de pagamento, cron, SQL
--     Editor). Gravado também, com outro nome, para que o filtro do "manual" não misture
--     upgrade pago com intervenção humana.
-- Colunas conferidas no information_schema em 05/10: atividade_log(user_id, ator_id, evento,
-- detalhe, meta, criado_em default now(), apagar_em default now()+90d; id identity).
--
-- Falha ao gravar o log NÃO pode impedir a troca de role (o log é rastro, não trava):
-- o insert fica num bloco com exceção que só avisa.

create or replace function public.trg_log_role_alterado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
begin
  begin
    insert into public.atividade_log (user_id, ator_id, evento, detalhe, meta)
    values (
      new.id,
      v_ator,
      case when v_ator is null then 'role_alterado_sistema' else 'role_alterado_manual' end,
      coalesce(old.role, '(nulo)') || ' -> ' || coalesce(new.role, '(nulo)'),
      jsonb_build_object('role_antigo', old.role, 'role_novo', new.role, 'ator_id', v_ator)
    );
  exception when others then
    raise warning 'trg_log_role_alterado: não gravou atividade_log para %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

comment on function public.trg_log_role_alterado() is
  'Rastro de troca de role em perfis (05/10, pendência 101). Só é chamada pelo trigger perfis_log_role_alterado.';

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.perfis'::regclass
       and tgname = 'perfis_log_role_alterado'
  ) then
    create trigger perfis_log_role_alterado
      after update of role on public.perfis
      for each row
      when (old.role is distinct from new.role)
      execute function public.trg_log_role_alterado();
  end if;
end $$;

-- ── 3) Pendência 49 ──
-- Recalcula os selos de edital E de matrícula (Word + arquivo no nosso Storage): ~150 editais
-- (Leilão Brasil) e ~327 matrículas (PESTANA 294, CALIL 26…). O gatilho só roda quando o link é regravado.
update public.imoveis_leilao set link_edital = link_edital
 where ativo and ((not tem_edital_doc and public.calc_tem_edital_doc(id, link_edital, anexos))
   or (not tem_matricula_doc and public.calc_tem_matricula_doc(id, link_matricula, anexos, fonte, estado, fonte_id)));

-- ── Conferência ──
select position('duplicata_suspeita_de' in pg_get_functiondef('public.arquivar_lotes_inativos'::regproc::oid)) > 0 as p130_ok,
       exists (select 1 from pg_trigger where tgname = 'perfis_log_role_alterado') as p101_ok,
       (select count(*) filter (where tem_edital_doc) from public.imoveis_leilao where ativo and fonte = 'LEILAOBRASIL') as p49_leilaobrasil_com_edital, -- esperado ~156 de 158
       (select count(*) filter (where tem_matricula_doc) from public.imoveis_leilao where ativo and fonte = 'PESTANA') as p49_pestana_com_matricula; -- esperado ~294 de 308
