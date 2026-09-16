-- PUBLICAÇÃO DO ESPELHO: exclui documento GENÉRICO (não é do lote) do passo "todo anexo"
-- (18/09, mesmo dia — achado ao testar: um dos anexos publicados era um relatório de
-- transparência salarial da EMPRESA do leiloeiro, sem nenhuma relação com o imóvel).
--
-- MEDIDO antes de publicar em escala: o mesmo `url_origem` se repete em centenas/milhares de
-- `documento_espelho` de imóveis DIFERENTES — sinal de que não é anexo do LOTE, é peça do
-- SITE inteira do leiloeiro (aviso de cookies em 120 imóveis, "cartilha do arrematante" em
-- 162, um relatório de blog em 380, um PDF do Superbid em 1.201). Nenhum lote tem centenas de
-- anexos verdadeiros; o que se repete em dezenas/centenas de imóveis DIFERENTES é material
-- institucional, não documento do leilão. Um documento de UM evento com vários lotes (ex.:
-- regras daquele leilão específico) ainda é legítimo e fica sob o teto abaixo.
--
-- Corte: anexo só entra no passo 3 (genéricos) se aparecer em NO MÁXIMO 15 imóveis
-- DISTINTOS — cobre um leilão real de porte médio sem deixar passar material institucional
-- do site inteiro. Não mexe nos passos 1/2 (matrícula/edital/laudo/regras nomeados, sempre
-- publicados — são sempre específicos do lote, o problema é só no genérico).

create or replace function public.registrar_anexos_do_espelho(p_limite int default 5000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_upd int := 0; v_ins int := 0; v_out int := 0;
begin
  -- (1) PREENCHE o registro que ja existe e esta sem arquivo.
  with cand as (
    select distinct on (e.imovel_id, e.tipo)
           e.imovel_id, e.storage_path, e.url_origem, e.bytes,
           case e.tipo when 'regras' then 'regras_venda' else e.tipo end as tipo_anexo
      from documento_espelho e
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and e.tipo in ('matricula', 'edital', 'laudo', 'regras')
     order by e.imovel_id, e.tipo, e.bytes desc
  ), alvo as (
    select a.id, c.storage_path, c.url_origem, c.bytes,
      exists (select 1 from public.arrematados ar where ar.imovel_id = a.imovel_id::text) as ja_arrematado,
      case
        when exists (select 1 from public.arrematados ar where ar.imovel_id = a.imovel_id::text) then 0
        when exists (select 1 from public.analises_mercado    m where m.imovel_id = a.imovel_id::text)
          or exists (select 1 from public.analises_documental d where d.imovel_id = a.imovel_id::text)
          or exists (select 1 from public.analises_laudo      l where l.imovel_id = a.imovel_id::text) then 1
        when exists (select 1 from public.imoveis_leilao i where i.id = a.imovel_id and i.ativo) then 2
        else 3
      end as urgencia
      from imovel_anexos a
      join cand c on c.imovel_id = a.imovel_id and c.tipo_anexo = a.tipo
     where a.storage_path is null
     order by urgencia, a.criado_em
     limit p_limite
  ), u as (
    update imovel_anexos a
       set storage_path = alvo.storage_path,
           origem_url   = coalesce(a.origem_url, alvo.url_origem),
           tamanho_kb   = (alvo.bytes / 1024)::int,
           arrematado   = a.arrematado or alvo.ja_arrematado
      from alvo where a.id = alvo.id
    returning 1
  )
  select count(*) into v_upd from u;

  -- (2) INSERE so onde nao existe linha nenhuma daquele tipo.
  with cand as (
    select distinct on (e.imovel_id, e.tipo)
           e.imovel_id, e.storage_path, e.url_origem, e.bytes, e.criado_em,
           case e.tipo when 'regras' then 'regras_venda' else e.tipo end as tipo_anexo
      from documento_espelho e
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and e.tipo in ('matricula', 'edital', 'laudo', 'regras')
     order by e.imovel_id, e.tipo, e.bytes desc
  ), novos as (
    select c.*,
      exists (select 1 from public.arrematados ar where ar.imovel_id = c.imovel_id::text) as ja_arrematado,
      case
        when exists (select 1 from public.arrematados ar where ar.imovel_id = c.imovel_id::text) then 0
        when exists (select 1 from public.analises_mercado    m where m.imovel_id = c.imovel_id::text)
          or exists (select 1 from public.analises_documental d where d.imovel_id = c.imovel_id::text)
          or exists (select 1 from public.analises_laudo      l where l.imovel_id = c.imovel_id::text) then 1
        when exists (select 1 from public.imoveis_leilao i where i.id = c.imovel_id and i.ativo) then 2
        else 3
      end as urgencia
     from cand c
     where not exists (select 1 from imovel_anexos a
                        where a.imovel_id = c.imovel_id and a.tipo = c.tipo_anexo)
     order by urgencia, c.criado_em
     limit p_limite
  ), i as (
    insert into imovel_anexos (imovel_id, tipo, nome, storage_path, origem_url, tamanho_kb, arrematado, criado_em)
    select imovel_id, tipo_anexo, upper(left(tipo_anexo, 1)) || substr(tipo_anexo, 2),
           storage_path, url_origem, (bytes / 1024)::int, ja_arrematado, criado_em
      from novos
    returning 1
  )
  select count(*) into v_ins from i;

  -- (3) QUALQUER OUTRO anexo do leiloeiro — SÓ quando não for material institucional do site
  -- inteiro (repetido em mais de 15 imóveis distintos).
  with dup as (
    select url_origem, count(distinct imovel_id) as n
      from documento_espelho
     where status = 'copiado'
     group by url_origem
  ), cand as (
    select e.id, e.imovel_id, e.storage_path, e.url_origem, e.bytes, e.criado_em,
      exists (select 1 from public.arrematados ar where ar.imovel_id = e.imovel_id::text) as ja_arrematado,
      case
        when exists (select 1 from public.arrematados ar where ar.imovel_id = e.imovel_id::text) then 0
        when exists (select 1 from public.analises_mercado    m where m.imovel_id = e.imovel_id::text)
          or exists (select 1 from public.analises_documental d where d.imovel_id = e.imovel_id::text)
          or exists (select 1 from public.analises_laudo      l where l.imovel_id = e.imovel_id::text) then 1
        when exists (select 1 from public.imoveis_leilao i where i.id = e.imovel_id and i.ativo) then 2
        else 3
      end as urgencia
      from documento_espelho e
      join dup on dup.url_origem = e.url_origem
     where e.status = 'copiado' and e.imovel_id is not null and e.storage_path is not null
       and coalesce(e.bytes, 0) >= 5000
       and dup.n <= 15
       and not exists (
         select 1 from imovel_anexos a
          where a.imovel_id = e.imovel_id
            and (a.storage_path = e.storage_path or a.origem_url = e.url_origem)
       )
     order by urgencia, e.criado_em
     limit p_limite
  ), o as (
    insert into imovel_anexos (imovel_id, tipo, nome, storage_path, origem_url, tamanho_kb, arrematado, criado_em)
    select imovel_id, 'outro',
           'Anexo do leiloeiro' || case when url_origem ~ '/([^/?#]+)\.[a-zA-Z0-9]+([?#].*)?$'
             then ' — ' || substring(url_origem from '/([^/?#]+)\.[a-zA-Z0-9]+([?#].*)?$') else '' end,
           storage_path, url_origem, (bytes / 1024)::int, ja_arrematado, criado_em
      from cand
    returning 1
  )
  select count(*) into v_out from o;

  update imovel_anexos a
     set arrematado = true
    from public.arrematados ar
   where ar.imovel_id = a.imovel_id::text and a.arrematado = false;

  return jsonb_build_object('preenchidos', v_upd, 'inseridos', v_ins, 'outros_publicados', v_out);
end $$;

comment on function public.registrar_anexos_do_espelho is
  'Torna visivel para a analise documental (e para o cliente, na tela de documentos) tudo que '
  'o espelho ja baixou: PREENCHE o storage_path do registro que ja existe, INSERE quem nao tem '
  'linha do tipo nomeado (matricula/edital/laudo/regras), e PUBLICA qualquer OUTRO anexo '
  'especifico do lote como tipo outro (18/09). EXCLUI material institucional do site inteiro '
  'do leiloeiro (mesmo url_origem repetido em mais de 15 imoveis distintos - cookies, '
  'cartilhas, curriculos da empresa, relatorios de RH) — nao e anexo do LOTE. Marca '
  'arrematado=true quando o imovel ja tem linha em arrematados. Processa por URGENCIA.';

revoke all on function public.registrar_anexos_do_espelho(int) from public, anon, authenticated;
