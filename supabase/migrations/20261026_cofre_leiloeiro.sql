-- 26/10 — COFRE DO LEILOEIRO: a regra "Explorador e visitante NUNCA recebem o leiloeiro" passa a valer no BANCO
-- inteiro, não só na tela (arena de 25/10, frente A). Regra do dono: nome, site, link do lote, URL do edital e da
-- matrícula só para plano pago de imóveis (top2/assessorado/clube, mensal e anual) e equipe.
--
-- O QUE A ARENA ACHOU E FOI CONFERIDO AQUI ANTES DE MEXER (25/10, simulando o papel no banco — o proxy da sessão
-- não alcança o PostgREST; `set local role anon` + request.jwt.claims é o mesmo caminho que o PostgREST usa):
--  1. PORTA DA TABELA: anon/authenticated ainda tinham SELECT POR COLUNA em 84 colunas de imoveis_leilao (grant de
--     20261021). `select fonte` dá 42501 (o revoke de 20261025 está aplicado), mas `select doc_fatos` devolvia
--     `fonteEdital: https://documentacao.portalzuk.com.br/...` e `https://static.suporteleiloes.com.br/...` — e
--     titulo/descricao/link_foto/fotos CRUS, desfazendo a máscara que a view aplica nesses quatro.
--  2. A VIEW imoveis_leilao_mascarado repassava sem máscara: doc_fatos (19 lotes ativos com URL do PDF do
--     leiloeiro), correcao_edital.fonte (2 com URL), ficha_juridica inteira (12 — o raio-X jurídico, produto Pro) e
--     numero_processo (1.098 lotes). numero_edital: 0 preenchidos hoje.
--  3. analises_mercado: 2 relatórios de Explorador com a URL do edital (condicoesEdital.fonte e
--     metodologia.documento.editalFonte). Corrigido no gerador (api/gerar-analise.js) e no backfill abaixo.
--
-- INVENTÁRIO PARA O REVOKE NÃO VIRAR "TELA VAZIA" (forma 2), 25/10:
--  • src/: zero `.from('imoveis_leilao')` e zero recurso embutido `imoveis_leilao(...)`. Tudo pela view.
--  • api/: toda leitura direta usa SUPABASE_SERVICE_KEY (guia-parcela, scraper-caixa e publico.js conferidos à mão;
--    publico.js lê a VIEW com a chave pública e não usa numero_processo/numero_edital).
--  • views: imoveis_leilao_mascarado (security_invoker=false, lê como dono — não é afetada);
--    imoveis_leilao_indice_base (invoker, mas sem grant para anon/authenticated; só gerar_indice_regiao, DEFINER, lê).
--  • funções INVOKER que leem a tabela e que anon/authenticated podem executar (pg_proc): só UMA é chamada com a
--    chave de quem está logado — contar_imoveis_por_cidade (src/pages/Busca.jsx:948). Passa a ler a VIEW (item 1).
--    As outras 15 (acervo_lotes_fantasma, gemeos_*, reconciliar_*, geocode_fila, qa_*, ab_mercado_lote,
--    atualizar_valor_vigente_lote, _acervo_cidades_calcular, fonte_regressao_suspeita, acervo_por_fonte,
--    trg_geocode_pino_generico) só rodam com service_role (crons/monitor/health-check). Para anon e authenticated
--    elas passam a falhar — que é o certo: devolviam fonte/numero_matricula a qualquer um.
--  • policies de outras tabelas e gatilhos de outras tabelas que leem imoveis_leilao: nenhum.
--
-- O QUE ESTE ARQUIVO FAZ — itens 1–6 aplicados por apply_migration em 25/10 (só `create or replace` / grant);
-- o item 7 (REVOKE) e o item 8 (rodar o backfill) são do DONO, no SQL Editor: o conector MCP trava em REVOKE e
-- em UPDATE.

-- 1) contar_imoveis_por_cidade (Busca, chave do navegador) lê a VIEW: mesma contagem, sem depender do grant de tabela.
create or replace function public.contar_imoveis_por_cidade(uf text)
returns table(cidade_norm text, total bigint)
language sql stable set search_path to 'public' as $$
  SELECT m.cidade_norm, count(*)::bigint
  FROM public.imoveis_leilao_mascarado m
  WHERE m.ativo = true
    AND m.estado = upper(uf)
    AND m.cidade_norm IS NOT NULL
    AND m.cidade_norm <> ''
  GROUP BY m.cidade_norm
$$;

-- 2) A LISTA DE PAPÉIS num lugar só no banco. pode_ver_leiloeiro() (quem está chamando, pelo JWT) e o backfill/
--    canário (papel de OUTRO usuário, o dono do relatório) usam a mesma. Espelho: api/_leiloeiro-acesso.js e
--    src/utils/leiloeiroAcesso.js — mudar nos três.
create or replace function public.role_ve_leiloeiro(p_role text)
returns boolean language sql immutable parallel safe set search_path = public as $$
  select coalesce(p_role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual',
                             'admin','analista','consultor','advogado','suporte'), false)
$$;
grant execute on function public.role_ve_leiloeiro(text) to anon, authenticated, service_role;

create or replace function public.pode_ver_leiloeiro()
returns boolean language sql stable security invoker set search_path = public as $$
  select coalesce((select auth.role()) = 'service_role', false)
      or exists (select 1 from public.perfis p where p.id = (select auth.uid())
                   and public.role_ve_leiloeiro(p.role))
$$;

-- 3) Helpers da máscara (puros, sem tabela — não abrem nada para quem chama).
--    jsonb_sem_url: rede de segurança — qualquer TEXTO com URL dentro do JSON vira null, em qualquer profundidade.
--    Existe porque as chaves conhecidas (fonteEdital/fonteMatricula/fonte) são as de HOJE; a próxima chave de URL
--    que o extrator ganhar não pode vazar por esquecimento.
create or replace function public.jsonb_sem_url(j jsonb)
returns jsonb language plpgsql immutable parallel safe set search_path = public as $$
begin
  if j is null then return null; end if;
  -- atalho: sem URL em lugar nenhum do JSON, devolve como está (o caso de quase todas as linhas)
  if (j::text) !~* '(https?://|www\.)' then return j; end if;
  case jsonb_typeof(j)
    when 'object' then
      return coalesce((select jsonb_object_agg(e.k, public.jsonb_sem_url(e.v)) from jsonb_each(j) e(k, v)), '{}'::jsonb);
    when 'array' then
      return coalesce((select jsonb_agg(public.jsonb_sem_url(e.v) order by e.o) from jsonb_array_elements(j) with ordinality e(v, o)), '[]'::jsonb);
    when 'string' then
      return 'null'::jsonb;
    else
      return j;
  end case;
end $$;
grant execute on function public.jsonb_sem_url(jsonb) to anon, authenticated, service_role;

--    ficha_juridica_resumo: o raio-X jurídico é produto Pro. Quem não pode vê SÓ que foi lido, quantos pontos de
--    atenção e o nível — é o TEASER da tela. null continua sendo "não lido" (diferente de 0 pontos).
--    Pontos = os mesmos sinais que o AnaliseJuridicaCard pinta de alerta (src/pages/ImovelDetalhe.jsx).
create or replace function public.ficha_juridica_resumo(fj jsonb)
returns jsonb language sql immutable parallel safe set search_path = public as $$
  select case
    when fj is null or jsonb_typeof(fj) = 'null' then null
    when jsonb_typeof(fj) <> 'object' then jsonb_build_object('lido', true, 'pontos', null, 'nivelRisco', null)
    else jsonb_build_object(
      'lido', true,
      'pontos',
          (case when fj->>'fraudeExecucao' in ('medio', 'médio', 'alto') then 1 else 0 end)
        + (case when fj->'direitoPreferencia' = 'true'::jsonb then 1 else 0 end)
        + (case when fj->'debitosALevantar' = 'true'::jsonb then 1 else 0 end)
        + (case when jsonb_typeof(fj->'debitosAssumidos') = 'number' and (fj->>'debitosAssumidos')::numeric > 0 then 1 else 0 end)
        + (case when jsonb_typeof(fj->'certidoesPendentes') = 'number' and (fj->>'certidoesPendentes')::numeric > 0 then 1 else 0 end)
        + (case when jsonb_typeof(fj->'ocupacaoTipo') = 'string' and fj->>'ocupacaoTipo' not in ('', 'desocupado') then 1 else 0 end),
      'nivelRisco', case when jsonb_typeof(fj->'nivelRisco') = 'string' then fj->'nivelRisco' end)
  end
$$;
grant execute on function public.ficha_juridica_resumo(jsonb) to anon, authenticated, service_role;

-- 4) A VIEW: mesmas colunas, mesma ordem, mesmos tipos (create or replace exige). Mudam só, para quem NÃO pode:
--    numero_edital, numero_processo → null (o SSR de /leilao/:id não os lê; PagamentoArremate e
--      AndamentoProcessoCaso caem no campo digitável, que já existe para lote sem número);
--    ficha_juridica → resumo {lido, pontos, nivelRisco};
--    doc_fatos → sem fonteEdital/fonteMatricula/numeroMatricula e sem nenhum texto com URL;
--    correcao_edital → sem fonte e sem nenhum texto com URL.
--    O resto é o corpo VIGENTE (pg_get_viewdef de 25/10: inclui as exceções da Caixa de 20261021_foto_fonte_texto).
create or replace view public.imoveis_leilao_mascarado with (security_invoker = false) as
 SELECT i.id,
        CASE
            WHEN (p.pode OR (i.fonte = ANY (ARRAY['CEF'::text, 'caixa'::text])) OR ((i.fonte = ANY (ARRAY['EDITAL_DJEN'::text, 'MANUAL'::text])) OR (i.fonte ~ '^(webhook|parceiro)_'::text))) THEN i.fonte
            ELSE NULL::text
        END AS fonte,
        CASE
            WHEN (p.pode OR (i.fonte = ANY (ARRAY['CEF'::text, 'caixa'::text])) OR ((i.fonte = ANY (ARRAY['EDITAL_DJEN'::text, 'MANUAL'::text])) OR (i.fonte ~ '^(webhook|parceiro)_'::text))) THEN i.fonte_id
            ELSE NULL::text
        END AS fonte_id,
        CASE
            WHEN (p.pode OR (i.fonte = ANY (ARRAY['CEF'::text, 'caixa'::text]))) THEN i.titulo
            ELSE titulo_sem_leiloeiro(i.titulo, i.tipo, i.cidade, i.estado)
        END AS titulo,
    i.tipo,
    i.modalidade,
    i.estado,
    i.cidade,
    i.bairro,
    i.endereco,
    i.valor_avaliacao,
    i.valor_minimo,
    i.desconto_percentual,
    i.area_m2,
        CASE
            WHEN (p.pode OR (i.fonte = ANY (ARRAY['CEF'::text, 'caixa'::text]))) THEN i.descricao
            ELSE descricao_sem_leiloeiro(i.descricao, i.fonte)
        END AS descricao,
        CASE
            WHEN p.pode THEN i.link_edital
            ELSE NULL::text
        END AS link_edital,
        CASE
            WHEN (p.pode OR (i.fonte = ANY (ARRAY['CEF'::text, 'caixa'::text]))) THEN i.link_foto
            ELSE foto_imovel_publica(i.id, i.link_foto, NULL::integer)
        END AS link_foto,
        CASE
            WHEN p.pode THEN i.leiloeiro
            ELSE NULL::text
        END AS leiloeiro,
    i.data_leilao,
    i.forma_pagamento,
    i.viavel,
    i.score_viabilidade,
    i.motivo_viabilidade,
    i.ativo,
        CASE
            WHEN p.pode THEN i.raw
            ELSE NULL::text
        END AS raw,
    i.atualizado_em,
    i.criado_em,
    i.fracionado,
        CASE
            WHEN p.pode THEN i.url_lote
            ELSE NULL::text
        END AS url_lote,
    i.nomecondominio,
        CASE
            WHEN p.pode THEN i.numero_edital
            ELSE NULL::text
        END AS numero_edital,
    i.numero_matricula,
        CASE
            WHEN p.pode THEN i.numero_processo
            ELSE NULL::text
        END AS numero_processo,
        CASE
            WHEN p.pode THEN i.link_matricula
            ELSE NULL::text
        END AS link_matricula,
    i.geocod_nivel,
        CASE
            WHEN p.pode THEN i.link_regras_venda
            ELSE NULL::text
        END AS link_regras_venda,
    i.latitude,
    i.longitude,
    i.cep,
    i.status,
    i.score_financeiro,
    i.score_juridico,
    i.score_calculado_em,
    i.pontos_proximos,
    i.proximidades_em,
    i.cidade_norm,
        CASE
            WHEN p.pode THEN i.anexos
            ELSE NULL::jsonb
        END AS anexos,
    i.enriquecido_em,
    i.score_localizacao,
    i.geocod_reproc_em,
    i.valor_mercado,
    i.analise_viavel,
    i.analise_em,
    i.ficha_cef,
    i.matricula_scan_em,
        CASE
            WHEN p.pode THEN i.ficha_juridica
            ELSE ficha_juridica_resumo(i.ficha_juridica)
        END AS ficha_juridica,
    i.ocupacao,
    i.matricula_checada_em,
    i.proximidades_tentativas,
    i.valor_minimo_2,
    i.data_leilao_2,
    i.data_fim,
        CASE
            WHEN p.pode OR i.doc_fatos IS NULL THEN i.doc_fatos
            ELSE jsonb_sem_url((((i.doc_fatos - 'fonteEdital'::text) - 'fonteMatricula'::text) - 'numeroMatricula'::text) #- '{matricula,numeroMatricula}'::text[])
        END AS doc_fatos,
    i.doc_fatos_em,
    i.proximidades_vazios,
    i.proximidades_vazio_em,
    i.proximidades_espelhos,
    i.valor_minimo_ref,
    i.tem_edital_doc,
    i.tem_matricula_doc,
    i.suprimido_motivo,
    i.geocod_tentativas,
    i.praca1_fim,
    i.praca2_fim,
    i.doc_descoberta_em,
    i.doc_descoberta_tentativas,
        CASE
            WHEN (p.pode OR (i.fonte = ANY (ARRAY['CEF'::text, 'caixa'::text])) OR (jsonb_typeof(i.fotos) IS DISTINCT FROM 'array'::text)) THEN i.fotos
            ELSE ( SELECT COALESCE(jsonb_agg(foto_imovel_publica(i.id, e.v, ((e.o - 1))::integer) ORDER BY e.o), '[]'::jsonb) AS "coalesce"
               FROM jsonb_array_elements_text(i.fotos) WITH ORDINALITY e(v, o))
        END AS fotos,
    i.resultado_leilao,
    i.valor_lance_vencedor,
    i.resultado_apurado_em,
    i.resultado_apuracao_tentativas,
    i.resultado_origem,
    i.foto_espelhada_em,
    i.foto_espelho_tentativas,
    i.zuk_docs_em,
    i.situacao_geo,
    i.situacao_geo_em,
    i.restricoes_geo,
    i.restricoes_geo_em,
        CASE
            WHEN p.pode OR i.correcao_edital IS NULL THEN i.correcao_edital
            ELSE jsonb_sem_url(i.correcao_edital - 'fonte'::text)
        END AS correcao_edital,
        CASE
            WHEN p.pode THEN i.anunciado_em
            ELSE NULL::jsonb
        END AS anunciado_em
   FROM (imoveis_leilao i
     CROSS JOIN ( SELECT pode_ver_leiloeiro() AS pode
         OFFSET 0) p);
grant select on public.imoveis_leilao_mascarado to anon, authenticated;

-- 5) BACKFILL dos relatórios mercadológicos já gravados com a URL do edital/matrícula para quem não pode ver.
--    MESMOS quatro caminhos de limparLeiloeiroDoRelatorio() em api/_leiloeiro-acesso.js (medido em 25/10: fora
--    deles, nenhum host de leiloeiro no result de quem não paga). No máx. 100 linhas por chamada (CLAUDE.md).
--    Dono do relatório SEM perfil conta como "não pode" (fail-closed).
create or replace function public.analise_mercado_com_leiloeiro_vazado(r jsonb)
returns boolean language sql immutable parallel safe set search_path = public as $$
  select coalesce(
       (r #>> '{mercado,condicoesEdital,fonte}') ~* '(https?://|www\.)'
    or (r #>> '{mercado,metodologia,documento,editalFonte}') ~* '(https?://|www\.)'
    or (r #>> '{mercado,metodologia,area,divergencia,fonte}') ~* '(https?://|www\.)'
    or (r #>> '{divergenciaArea,fonte}') ~* '(https?://|www\.)', false)
$$;

create or replace function public.analise_mercado_sem_leiloeiro_lote(p_limite integer default 100)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_lim int := least(greatest(coalesce(p_limite, 100), 1), 100);
  v_limpos int;
  v_restam bigint;
begin
  with alvo as (
    select a.id
      from public.analises_mercado a
      left join public.perfis p on p.id = a.user_id
     where a.result is not null
       and not public.role_ve_leiloeiro(p.role)
       and public.analise_mercado_com_leiloeiro_vazado(a.result)
     order by a.id
     limit v_lim
     for update of a skip locked
  )
  update public.analises_mercado a
     set result = a.result
                  #- '{mercado,condicoesEdital,fonte}'
                  #- '{mercado,metodologia,documento,editalFonte}'
                  #- '{mercado,metodologia,area,divergencia,fonte}'
                  #- '{divergenciaArea,fonte}'
    from alvo
   where a.id = alvo.id;
  get diagnostics v_limpos = row_count;

  select count(*) into v_restam
    from public.analises_mercado a
    left join public.perfis p on p.id = a.user_id
   where a.result is not null
     and not public.role_ve_leiloeiro(p.role)
     and public.analise_mercado_com_leiloeiro_vazado(a.result);

  return jsonb_build_object('limpos', v_limpos, 'restam', v_restam);
end $$;
-- INVOKER de propósito: quem roda é o dono (postgres, SQL Editor) ou o service_role. Chamada pela chave do site, a
-- RLS de analises_mercado/perfis restringe às linhas do próprio usuário — no máximo ele limpa o PRÓPRIO relatório.

-- 6) CANÁRIO: leiloeiro_vaza_para_anon — transforma "REVOKE escrito e não aplicado" (e qualquer regressão da view
--    ou do gerador) em alarme, custo zero. Lê três coisas:
--    (a) o CATÁLOGO: privilégio de SELECT de anon/authenticated na tabela e em cada coluna que a view mascara;
--    (b) a VIEW como anon, de verdade: troca os claims do JWT só dentro desta função (set_config local) — a view
--        decide por pode_ver_leiloeiro(), que lê o JWT, não o current_user — e restaura os originais no fim;
--    (c) analises_mercado de quem não pode ver com URL nos quatro caminhos.
--    Linha por item, para o health-check dizer QUAL porta está aberta.
create or replace function public.leiloeiro_vaza_para_anon()
returns table(item text, valor bigint)
language plpgsql volatile set search_path = public as $$
declare
  c_role text := current_setting('request.jwt.claim.role', true);
  c_sub  text := current_setting('request.jwt.claim.sub', true);
  c_all  text := current_setting('request.jwt.claims', true);
  v_view bigint;
  v_cols text[] := array['fonte','fonte_id','titulo','descricao','link_edital','link_foto','leiloeiro','raw','url_lote',
                         'numero_edital','numero_processo','link_matricula','link_regras_venda','anexos','ficha_juridica',
                         'doc_fatos','fotos','correcao_edital','anunciado_em'];
begin
  return query
    select 'tabela_select_' || r, (case when has_table_privilege(r, 'public.imoveis_leilao', 'select') then 1 else 0 end)::bigint
      from unnest(array['anon','authenticated']) r;

  return query
    select 'colunas_select_' || r,
           (select count(*) from unnest(v_cols) c where has_column_privilege(r, 'public.imoveis_leilao', c, 'select'))::bigint
      from unnest(array['anon','authenticated']) r;

  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    -- AMOSTRA, não varredura: os 93 mil lotes pela view custavam 7 s (detoast do doc_fatos). A máscara é a MESMA
    -- expressão em toda linha — o que se testa é se ela está lá; para isso basta a linha que TEM o dado sensível.
    -- Candidatos escolhidos só por `is not null` (sem abrir o JSON): até 3.000 com doc/jurídico/números e 300 com
    -- leiloeiro+link. Medido em 25/10: ~1,3 s (contra 7 s da varredura).
    select count(*) into v_view
      from public.imoveis_leilao_mascarado m
     where m.id in (
             (select i.id from public.imoveis_leilao i
               where i.ficha_juridica is not null or i.correcao_edital is not null
                  or i.numero_processo is not null or i.numero_edital is not null
               limit 3000)
             union all
             (select i.id from public.imoveis_leilao i where i.doc_fatos is not null and i.ativo limit 3000)
             union all
             (select i.id from public.imoveis_leilao i
               where i.leiloeiro is not null and i.url_lote is not null and i.link_edital is not null limit 300))
       and (m.leiloeiro is not null or m.url_lote is not null or m.link_edital is not null
        or m.link_matricula is not null or m.link_regras_venda is not null or m.anexos is not null
        or m.raw is not null or m.anunciado_em is not null
        or m.numero_processo is not null or m.numero_edital is not null
        or m.doc_fatos::text ~* '(https?://|www\.)'
        or m.correcao_edital::text ~* '(https?://|www\.)'
        or m.ficha_juridica::text ~* '(https?://|www\.)'
        or (jsonb_typeof(m.ficha_juridica) = 'object'
            and exists (select 1 from jsonb_object_keys(m.ficha_juridica) k where k not in ('lido','pontos','nivelRisco'))));
  exception when others then
    perform set_config('request.jwt.claim.role', coalesce(c_role, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(c_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(c_all, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.role', coalesce(c_role, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(c_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(c_all, ''), true);
  return query select 'view_como_anon'::text, v_view;

  return query
    select 'relatorio_explorador_com_url'::text, count(*)::bigint
      from public.analises_mercado a
      left join public.perfis p on p.id = a.user_id
     where a.result is not null
       and not public.role_ve_leiloeiro(p.role)
       and public.analise_mercado_com_leiloeiro_vazado(a.result);
end $$;
-- INVOKER: chamada pela chave do site, só conta o que a RLS deixa aquele usuário ver (e o catálogo, que é público).

--    E entra em qa_invariantes() (limite 0). Injeção no corpo VIGENTE (37 KB) em vez de recopiar: a forma 7b
--    (corpo divergente entre repo e banco) é exatamente o risco de recopiar à mão. Idempotente; se a âncora sumir,
--    FALHA em vez de seguir sem o canário.
do $$
declare d text; novo text;
  ancora text := E'\n  )\n  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,';
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position('leiloeiro_vaza_para_anon' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'qa_invariantes: âncora do fim do inv não encontrada — ajuste esta migração'; end if;
  novo := replace(d, ancora, E',\n     (''leiloeiro_vaza_para_anon'',''Segurança: o leiloeiro (nome, link, edital, matrícula) sai para visitante/Explorador — grant na tabela, view sem máscara ou relatório com URL (detalhe: select * from leiloeiro_vaza_para_anon())'',''Segurança'',''bug'',\n       (select coalesce(sum(v.valor), 0) from public.leiloeiro_vaza_para_anon() v), 0)' || ancora);
  execute novo;
end $$;

-- 7) ⚠️ DO DONO (SQL Editor) — o MCP trava em REVOKE. Fecha a porta da tabela: depois disto, o navegador só lê o
--    acervo pela view mascarada (já é assim em src/ desde 21/10). service_role (APIs/crons) não é afetado.
revoke select on public.imoveis_leilao from anon, authenticated;

-- 8) ⚠️ DO DONO (SQL Editor) — limpa os relatórios antigos, 100 por vez, até `restam = 0` (em 25/10: 2 linhas):
--    select public.analise_mercado_sem_leiloeiro_lote(100);
--
-- PROVA depois de 7 e 8 (tem de dar 0 em todos os itens):
--    select * from public.leiloeiro_vaza_para_anon();
--    select * from public.qa_invariantes() where chave = 'leiloeiro_vaza_para_anon';
-- E a Busca do visitante continuar contando cidades (como anon):
--    begin; set local role anon; select * from public.contar_imoveis_por_cidade('SP') limit 3; rollback;
