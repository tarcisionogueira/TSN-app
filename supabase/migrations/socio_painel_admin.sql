-- PAINEL da base socio-demográfica — "onde eu vejo isso?" (pergunta do dono).
--
-- A base existe e alimenta o parecer, mas até aqui era invisível: nenhuma tela mostrava se as
-- fontes carregaram, quantas cidades já têm dado, nem o que exatamente o relatório vai citar.
-- Dado que ninguém consegue olhar é dado em que ninguém confia — e com razão.
--
-- `socio_fontes`/`socio_ingestao` têm RLS sem policy (só service_role). Em vez de abrir as
-- tabelas, esta RPC devolve o painel pronto e SÓ para admin.
create or replace function public.socio_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare j jsonb;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'fontes', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.ordem), '[]'::jsonb)
      from (
        select chave, descricao, agregado, periodo, ativa, ordem,
               ultimo_em, ultimo_ok, ultimo_linhas, ultimo_erro
          from public.socio_fontes
      ) f
    ),
    'cobertura', (
      select jsonb_build_object(
        'cidades',        count(*),
        'com_populacao',  count(*) filter (where populacao is not null or pop_estim is not null),
        'com_domicilios', count(*) filter (where domicilios is not null),
        'com_pressao',    count(*) filter (where pressao_classe is not null),
        'demanda_reprimida', count(*) filter (where pressao_classe = 'demanda_reprimida'),
        'equilibrio',        count(*) filter (where pressao_classe = 'equilibrio'),
        'estoque_ocioso',    count(*) filter (where pressao_classe = 'estoque_ocioso'),
        'atualizado_em',  max(atualizado_em)
      ) from public.cidade_socio where nivel = 'cidade'
    ),
    'execucoes', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.executado_em desc), '[]'::jsonb)
      from (
        select executado_em, fonte, ok, linhas, ms, erro
          from public.socio_ingestao order by executado_em desc limit 12
      ) e
    )
  ) into j;
  return j;
end;
$$;

revoke all on function public.socio_painel() from public, anon;
grant execute on function public.socio_painel() to authenticated;

comment on function public.socio_painel() is
  'Painel admin da base socio-demografica (fontes, cobertura, ultimas ingestoes). Só admin — as tabelas seguem fechadas.';


-- Consulta de UMA cidade pelo nome escrito à mão (o admin digita "Praia Grande", não
-- "praiagrande"). Devolve exatamente o que o relatório enxerga.
create or replace function public.socio_consultar(p_cidade text, p_uf text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare norm text;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  norm := regexp_replace(lower(unaccent(coalesce(p_cidade,''))), '[^a-z0-9]', '', 'g');
  return public.socio_regiao(norm, p_uf, '');
exception when undefined_function then
  -- sem a extensão unaccent, cai numa normalização equivalente feita à mão
  norm := regexp_replace(lower(translate(coalesce(p_cidade,''),
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g');
  return public.socio_regiao(norm, p_uf, '');
end;
$$;

revoke all on function public.socio_consultar(text,text) from public, anon;
grant execute on function public.socio_consultar(text,text) to authenticated;
