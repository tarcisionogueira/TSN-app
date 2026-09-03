-- ══════════════════════════════════════════════════════════════════════════════════════
-- O EDITAL VIRA LOTE — pedido do dono (03/09): "pode liberar lotes sem foto, mas precisa
-- reforçar que precisamos da matrícula e edital para o sistema poder analisar; precisa
-- verificar com base nas informações que temos para não ter duplicidades."
-- ══════════════════════════════════════════════════════════════════════════════════════
--
-- ── POR QUE A CHAVE DE DEDUP NÃO É `numero_processo` ────────────────────────────────────
-- Medido antes desta migração: `numero_processo` está preenchido em **2 de 4.630** lotes
-- ativos de SP (0,04%). Cruzar por processo não encontraria quase nada — não é que os
-- imóveis sejam diferentes, é que a coluna está vazia no lado do acervo. A chave real
-- disponível dos DOIS lados é a MATRÍCULA: 138 dos 238 editais processados têm
-- `imovel_matricula`, e o acervo tem `numero_matricula` em 1.235 lotes — pequeno, mas real
-- e confiável (é o número do registro do cartório, não um palpite).
--
-- ── DUAS CONFIANÇAS, NUNCA UMA SÓ DECISÃO BINÁRIA ───────────────────────────────────────
-- FORTE (matrícula normalizada bate, mesmo estado) → o edital é LIGADO ao lote existente,
-- nunca cria um segundo. É o caso mais valioso: o Radar apenas ENRIQUECE o que já temos
-- (numero_processo, avaliação, ocupação, url do leiloeiro) sem duplicar nada.
--
-- MÉDIA (mesma cidade + valor de avaliação a até 10% OU praça a até 10 dias do que o
-- acervo tem) → o lote é CRIADO (nunca fica de fora), mas fica marcado como suspeita de
-- duplicidade para revisão. A escolha deliberada: um falso negativo aqui (achar que é
-- duplicata e não ser) apaga um imóvel real da vitrine, em silêncio, para sempre — é pior
-- que um falso positivo (achar que pode ser duplicata e não ser), que só pede um olhar
-- humano depois. Testado nos dados reais antes de aplicar: das 5 suspeitas que a régua
-- encontrou nos 87 editais elegíveis de hoje, uma citava explicitamente "Z37275" no título
-- do lote existente — o mesmo prefixo de fonte_id do ZUK — sinal forte de que É a mesma
-- praça, chegando pelos dois caminhos.
--
-- ── SEM FOTO, DE PROPÓSITO — E O QUE ISSO SIGNIFICA PARA A ANÁLISE ─────────────────────
-- `link_foto` nunca é preenchido por este caminho. `tem_matricula_doc`/`tem_edital_doc` são
-- colunas GERADAS por trigger (`calc_tem_matricula_doc`/`calc_tem_edital_doc`, a partir de
-- `link_matricula`/`link_edital`/`anexos`) — como o Radar não tem esses LINKS de documento
-- (o DJEN dá o texto do edital, não um PDF; a matrícula é ainda mais rara), os lotes nascem
-- com `tem_matricula_doc = false`. `api/gerar-analise.js` JÁ degrada honestamente quando
-- esses campos faltam (registra `avaliacao_ausente`/`valor_minimo_ausente` em vez de
-- inventar) — não foi necessário criar um gate novo, o gate genérico já existe e vale para
-- qualquer fonte. O que muda aqui é a origem: `fonte = 'EDITAL_DJEN'` deixa claro, em
-- qualquer consulta, quais lotes nasceram sem documento e precisam de um.
--
-- ── E A PARTE 2 DESTE PEDIDO (conectar ao site do leiloeiro) — migração separada ────────
-- A busca de matrícula/edital no `url_lote` do leiloeiro é código, não SQL — fica no cron
-- em `api/radar-editais-cron.js`. Esta migração só grava o endereço (`url_lote`) e as duas
-- colunas de controle de tentativa; quem entra no site é o cron.

-- ── 0. Limpa o acervo de "cidade" que era texto institucional, não lugar ────────────────
-- Achado ao ensaiar a promoção: 12 das "cidades" dos 87 editais elegíveis eram lixo de
-- parser — "Detran", "IBAPE", "OAB", "TRATANDO", "Justiça do Estado de São Paulo TJ",
-- "Portal de Auxiliares da Justiça do TJ" — a mesma regex que acha "Cidade/UF" no texto
-- morde texto institucional que só PARECE esse formato. Sem esta limpeza, a promoção
-- criaria lotes em cidades que não existem. `CIDADE_BLOQ` (código) ganhou os termos novos;
-- aqui o acervo JÁ CAPTURADO recebe a mesma régua.
update public.editais_leilao
   set imovel_cidade = regexp_replace(imovel_cidade, '^(munic[íi]pio de|im[óo]veis de|comarca de)\s+', '', 'i')
 where imovel_cidade ~* '^(munic[íi]pio de|im[óo]veis de|comarca de)\s+';

update public.editais_leilao
   set imovel_cidade = null, imovel_uf = null
 where imovel_cidade ~* '(detran|ibape|\yoab\y|intime|tratando|divis[ãa]o|secretaria|justi[çc]a|tribunal|\ytj\y|portal|auxiliares?|tabela|\yvistos\y|cadastre|execu[çc][ãa]o|cpf|cnpj|ltda|\ys/?a\y|\ycri\y|cart[óo]rio|registro|of[íi]cio|expe[çc]a|matr[íi]cula|processo|edital|comarca|\yvara\y|\yforo\y)';

-- ── 1. As colunas de controle ───────────────────────────────────────────────────────────
alter table public.editais_leilao add column if not exists imovel_id uuid references public.imoveis_leilao(id);
alter table public.editais_leilao add column if not exists duplicata_suspeita_de uuid references public.imoveis_leilao(id);
alter table public.editais_leilao add column if not exists promovido_em timestamptz;
comment on column public.editais_leilao.imovel_id is 'O lote (novo ou já existente) a que este edital foi ligado. NULL = ainda não avaliado para promoção.';
comment on column public.editais_leilao.duplicata_suspeita_de is 'Lote EXISTENTE que pode ser o mesmo imóvel (confiança média — cidade+valor/data, sem matrícula para confirmar). Não bloqueia a criação; pede revisão.';

alter table public.imoveis_leilao add column if not exists doc_descoberta_em timestamptz;
alter table public.imoveis_leilao add column if not exists doc_descoberta_tentativas smallint not null default 0;
comment on column public.imoveis_leilao.doc_descoberta_em is 'Última vez que o cron tentou achar matrícula/edital no site do leiloeiro (url_lote). Existe para não bater no mesmo site a cada 4h — negative cache dedicado, não reaproveita matricula_checada_em/matricula_scan_em (que já têm outro significado: negative-cache de captura autenticada e marca de extração de cartório do PDF, respectivamente).';

-- ── 2. A normalização de cidade — IDÊNTICA à da coluna gerada `imoveis_leilao.cidade_norm`
-- Não é uma aproximação: é a MESMA expressão (conferida via
-- information_schema.columns.generation_expression). Qualquer divergência faria o dedup
-- comparar duas normalizações diferentes e nunca casar nada — silenciosamente.
create or replace function public.norm_cidade(p text)
returns text
language sql
immutable
as $fn$
  select regexp_replace(translate(lower(coalesce(p,'')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z0-9]', '', 'g');
$fn$;

-- ── 3. O candidato a duplicata ───────────────────────────────────────────────────────────
create or replace function public.editais_dedup_candidato(p_edital_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare e record; v_mat text; cand record;
begin
  select imovel_uf, imovel_cidade, imovel_matricula, valor_avaliacao, data_praca_1::date as praca1
    into e from editais_leilao where id = p_edital_id;
  if e.imovel_uf is null then return null; end if;

  -- FORTE: matrícula normalizada bate, mesmo estado.
  if e.imovel_matricula is not null then
    v_mat := regexp_replace(e.imovel_matricula, '\D', '', 'g');
    if length(v_mat) >= 3 then
      select id into cand from imoveis_leilao
       where ativo and estado = e.imovel_uf and numero_matricula is not null
         and regexp_replace(numero_matricula, '\D', '', 'g') = v_mat
       limit 1;
      if found then
        return jsonb_build_object('imovel_id', cand.id, 'confianca', 'forte', 'motivo', 'matricula');
      end if;
    end if;
  end if;

  -- MÉDIA: mesma cidade + (valor de avaliação a até 10% OU praça a até 10 dias).
  if e.imovel_cidade is not null then
    select id into cand from imoveis_leilao i
     where i.ativo and i.estado = e.imovel_uf and i.cidade_norm = public.norm_cidade(e.imovel_cidade)
       and ( (e.valor_avaliacao is not null and i.valor_avaliacao is not null
              and abs(i.valor_avaliacao - e.valor_avaliacao) <= 0.1 * greatest(i.valor_avaliacao, e.valor_avaliacao))
          or (e.praca1 is not null and i.data_leilao is not null
              and public.data_leilao_para_date(i.data_leilao) is not null
              and abs(public.data_leilao_para_date(i.data_leilao) - e.praca1) <= 10) )
     limit 1;
    if found then
      return jsonb_build_object('imovel_id', cand.id, 'confianca', 'media', 'motivo', 'cidade+valor_ou_data');
    end if;
  end if;

  return null;
end $fn$;

-- ── 4. A promoção em si — chamada pelo cron a cada rodada, se esgota sozinha ────────────
create or replace function public.editais_promover_pendentes(p_teto integer default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  e record; v_dedup jsonb; v_novo_id uuid;
  v_avaliados int := 0; v_ligados int := 0; v_novos int := 0; v_suspeitas int := 0; v_sem_id int := 0;
begin
  for e in
    select * from editais_leilao
     where status = 'processado' and imovel_id is null and promovido_em is null
       -- identificação mínima pra ser útil na vitrine (cidade+uf sempre; e pelo menos UM
       -- dado substantivo — sem isso não é lote, é só uma localização solta)
       and imovel_cidade is not null and imovel_uf is not null
       and (imovel_endereco is not null or imovel_matricula is not null or valor_avaliacao is not null or lance_minimo is not null)
     order by criado_em asc
     limit p_teto
  loop
    v_avaliados := v_avaliados + 1;
    v_dedup := public.editais_dedup_candidato(e.id);

    if v_dedup is not null and v_dedup->>'confianca' = 'forte' then
      -- Já é nosso: liga ao lote existente, preenche só as LACUNAS — nunca sobrescreve
      -- dado que já existe (o scraper original é mais confiável que o texto do DJEN).
      update imoveis_leilao set
        numero_processo = coalesce(numero_processo, e.numero_processo),
        valor_avaliacao = case when coalesce(valor_avaliacao,0)=0 then e.valor_avaliacao else valor_avaliacao end,
        valor_minimo    = case when coalesce(valor_minimo,0)=0 then e.lance_minimo else valor_minimo end,
        ocupacao        = coalesce(ocupacao, e.ocupacao),
        url_lote        = coalesce(url_lote, e.leilao_plataforma_url)
       where id = (v_dedup->>'imovel_id')::uuid;
      update editais_leilao set imovel_id = (v_dedup->>'imovel_id')::uuid, promovido_em = now() where id = e.id;
      v_ligados := v_ligados + 1;
      continue;
    end if;

    -- Cria um lote novo — SEM foto, de propósito (decisão do dono, 03/09). `tem_edital_doc`/
    -- `tem_matricula_doc` ficam false (são geradas por trigger a partir de link_edital/
    -- link_matricula/anexos, que este caminho não tem ainda) — é o que "reforça" a
    -- necessidade de documento: qualquer consulta por `fonte='EDITAL_DJEN' and not
    -- tem_matricula_doc` mostra exatamente o que falta.
    insert into imoveis_leilao (
      fonte, fonte_id, titulo, tipo, modalidade, estado, cidade, endereco,
      valor_avaliacao, valor_minimo, area_m2, numero_processo, numero_matricula,
      data_leilao, data_leilao_2, ocupacao, leiloeiro, descricao, url_lote, ativo
    ) values (
      'EDITAL_DJEN', 'edital_' || e.id::text,
      left(coalesce(nullif(e.imovel_endereco,''), 'Imóvel em leilão judicial') || ' — ' || e.imovel_cidade || '/' || e.imovel_uf, 250),
      'imovel', 'judicial', e.imovel_uf, e.imovel_cidade, e.imovel_endereco,
      e.valor_avaliacao, e.lance_minimo, e.imovel_area_m2, e.numero_processo, e.imovel_matricula,
      to_char(e.data_praca_1::date, 'YYYY-MM-DD'), e.data_praca_2, e.ocupacao, e.leiloeiro_nome,
      left(e.texto_integral, 600), e.leilao_plataforma_url, true
    )
    on conflict (fonte, fonte_id) do nothing
    returning id into v_novo_id;

    if v_novo_id is null then
      -- Reentrada (o cron rodou de novo sobre o mesmo edital antes do UPDATE abaixo
      -- confirmar) — acha o que já foi criado em vez de tentar de novo.
      select id into v_novo_id from imoveis_leilao where fonte='EDITAL_DJEN' and fonte_id = 'edital_' || e.id::text;
    end if;

    update editais_leilao set
      imovel_id = v_novo_id,
      duplicata_suspeita_de = case when v_dedup is not null then (v_dedup->>'imovel_id')::uuid else null end,
      promovido_em = now()
     where id = e.id;

    if v_dedup is not null then v_suspeitas := v_suspeitas + 1; else v_novos := v_novos + 1; end if;
  end loop;

  select count(*) into v_sem_id from editais_leilao
   where status='processado' and imovel_id is null and promovido_em is null
     and (imovel_cidade is null or imovel_uf is null);

  return jsonb_build_object(
    'avaliados', v_avaliados, 'ligados_ao_acervo', v_ligados, 'novos', v_novos,
    'suspeitas_de_duplicidade', v_suspeitas, 'sem_identificacao_minima', v_sem_id
  );
end $fn$;

revoke all on function public.editais_promover_pendentes(integer) from public, anon, authenticated;
grant execute on function public.editais_promover_pendentes(integer) to service_role;
revoke all on function public.editais_dedup_candidato(uuid) from public, anon;
grant execute on function public.editais_dedup_candidato(uuid) to service_role, authenticated;

-- ── 5. Visibilidade no painel — os números que "reforçam" a exigência de documento ──────
create or replace function public.admin_radar_editais(p_dias integer default 30, p_so_nao_integrado boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'kpis', (
      select jsonb_build_object(
        'total', count(*),
        'novos_7d', count(*) filter (where data_disponibilizacao > (now()-interval '7 days')::date),
        'leiloeiros_distintos', count(distinct leiloeiro_nome_norm),
        'nao_integrados', count(*) filter (where leiloeiro_integrado is false),
        'ja_no_acervo', count(*) filter (where leiloeiro_integrado is true),
        'nao_conferidos', count(*) filter (where leiloeiro_integrado is null),
        'sem_leiloeiro', count(*) filter (where leiloeiro_nome is null),
        'erro_parse', count(*) filter (where status = 'erro_parse'),
        'promovidos_lote_novo', count(*) filter (where imovel_id is not null and duplicata_suspeita_de is null),
        'promovidos_ligados_ao_acervo', count(*) filter (where imovel_id is not null and duplicata_suspeita_de is null
          and exists (select 1 from public.imoveis_leilao i where i.id = editais_leilao.imovel_id and i.fonte <> 'EDITAL_DJEN')),
        'suspeitas_duplicidade_para_revisar', count(*) filter (where duplicata_suspeita_de is not null)
      )
      from public.editais_leilao
      where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
    ),
    'lotes_sem_documento', (
      -- "reforçar que precisamos de matrícula e edital" — a contagem que o painel mostra
      -- sempre que alguém abre a aba, não um alarme de fundo: é trabalho pendente esperado,
      -- não defeito. Cai conforme o item 4 (busca no site do leiloeiro) e a revisão humana
      -- forem preenchendo.
      select jsonb_build_object(
        'total', count(*),
        'sem_url_leiloeiro', count(*) filter (where url_lote is null)
      )
      from public.imoveis_leilao
      where ativo and fonte = 'EDITAL_DJEN' and not tem_matricula_doc and not tem_edital_doc
    ),
    'editais', coalesce((
      select jsonb_agg(to_jsonb(e) - 'texto_integral' - 'payload' order by e.data_disponibilizacao desc, e.criado_em desc)
      from (
        select * from public.editais_leilao
        where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
          and (not p_so_nao_integrado or leiloeiro_integrado is not true)
        order by data_disponibilizacao desc, criado_em desc
        limit 300
      ) e
    ), '[]'::jsonb)
  );
end $fn$;
revoke execute on function public.admin_radar_editais(integer, boolean) from public, anon;
grant execute on function public.admin_radar_editais(integer, boolean) to authenticated;
