-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O 1º RELATÓRIO NASCE DA TRIAGEM — 29/08 (regra `ativacao.primeiro_relatorio`)
--
-- MEDIDO ANTES DE ESCREVER (30 dias): 54 contas novas, 4 relatórios. 37 das 54 somem na
-- PRIMEIRA HORA. 47 dos 52 exploradores nunca gastaram uma amostra grátis sequer — ou seja,
-- **o paywall não está barrando ninguém**: as pessoas não chegam até ele. Das 16 que abriram
-- a `/analise`, 10 nunca clicaram em Gerar.
--
-- A triagem já colhe objetivo e faixa de capital de 34 dessas 54 pessoas, e o cadastro já
-- colhe a cidade de 52. Havia tudo para escolher um lote e não se escolhia nenhum: a pessoa
-- respondia 5 perguntas e caía num painel vazio.
--
-- Esta função escolhe o lote do PRIMEIRO relatório. Ela NÃO gera nada e NÃO gasta nada —
-- é `stable`, e existe separada da geração exatamente para poder ser testada em seco (o
-- antídoto que funcionou nas 4 ocorrências da forma nº 10 em 29/08).
--
-- O QUE FOI MEDIDO PARA DECIDIR OS CRITÉRIOS, e não presumido:
--   · `imoveis_leilao.valor_mercado` está preenchido em 6 de 30.618 lotes ativos — inútil
--     como filtro. Foi o primeiro critério que tentei e o número derrubou.
--   · O que de fato prevê relatório com conteúdo é ter GEO: a amostragem de comparáveis
--     (níveis 1 e 2) é por raio. Dos 68 relatórios dos últimos 120 dias, 66 saíram com valor
--     de mercado — 97%. Por isso `latitude/longitude not null` é exigência, não preferência.
--   · Candidatos sob o teto MAIS APERTADO (até R$ 150 mil → teto R$ 200 mil), com desconto
--     ≥ 40% e geo: 17.257 lotes. A faixa mais estreita é a que tem menos, e ainda assim sobra.
--
-- O TETO DE CAPITAL É O MESMO de `alerta_acima_do_capital` e de `api/enviar-alertas-cron.js`.
-- Mandar ao cliente novo, no primeiro contato com o produto, um lote acima do capital que ele
-- ACABOU de declarar seria repetir em 30 segundos o defeito de 25/08 — e aqui seria pior,
-- porque é a primeira impressão.
--
-- NUNCA relaxa o teto. Se não houver lote sob o teto declarado, a resposta é `encontrou:
-- false` com o motivo por extenso. Devolver um lote caro "para ter o que mostrar" é entregar
-- o fracasso da busca como se fosse conteúdo — a forma nº 1 da lista do CLAUDE.md.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.primeiro_imovel_para_triagem(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_eu     uuid := auth.uid();
  v_alvo   uuid := coalesce(p_user_id, auth.uid());
  v_role   text;
  v_obj    text;
  v_faixa  text;
  v_cidade text;
  v_uf     text;
  v_teto   numeric;
  v_piso   numeric;
  v_tipos  text[];
  v_dmin   int;
  v_relax  boolean := false;
  v_n      int;
  r        record;
begin
  -- regra `ativacao.primeiro_relatorio` (regra_negocio) — o nome da chave fica no corpo de
  -- propósito: é assim que `auditoria_regras_negocio()` prova que a regra tem quem a aplique.
  if v_eu is null then raise exception 'sem sessao'; end if;
  select role into v_role from public.perfis where id = v_eu;
  if v_alvo <> v_eu and coalesce(v_role,'') not in ('admin','analista') then
    raise exception 'apenas o proprio usuario ou admin';
  end if;

  -- INTERRUPTOR NO BANCO, e ele mora AQUI e não no front: `app_config` é admin-only por RLS,
  -- então o explorador não conseguiria lê-lo — um interruptor que o chamador não enxerga é um
  -- interruptor que não existe. Admin e analista passam mesmo com ele desligado: é isso que
  -- torna a coisa testável antes de ligar para todo mundo.
  if coalesce((select value from public.app_config where key = 'primeiro_relatorio_auto'), 'false') <> 'true'
     and coalesce(v_role,'') not in ('admin','analista') then
    return jsonb_build_object('encontrou', false, 'desligado', true,
      'motivo', 'desligado em app_config.primeiro_relatorio_auto');
  end if;

  select perfil_investidor, faixa_capital, endereco_cidade, endereco_uf
    into v_obj, v_faixa, v_cidade, v_uf
    from public.perfis where id = v_alvo;
  if not found then
    return jsonb_build_object('encontrou', false, 'motivo', 'perfil inexistente');
  end if;
  if coalesce(v_obj,'') = '' then
    return jsonb_build_object('encontrou', false,
      'motivo', 'triagem nao respondida: sem objetivo declarado nao ha criterio de escolha');
  end if;

  -- Teto por faixa declarada. `acima_1mi` = sem teto (não pode GANHAR teto por engano — foi
  -- um dos 9 casos de aceitação do helper `tetoEfetivo` em 25/08).
  v_teto := case v_faixa
              when 'ate_150k'  then 200000
              when '150_400k'  then 520000
              when '400k_1mi'  then 1300000
              else 1e12 end;
  -- PISO da faixa. Sem ele, a ordenacao por desconto entrega o lote mais extremo do acervo:
  -- no ensaio em seco, quem declarou "R$ 400 mil a 1 milhao" recebeu uma VAGA DE GARAGEM de
  -- 22 m2 por R$ 2.183 (95% de desconto, dado correto — nao e erro de parser). Mostrar algo
  -- 500x abaixo do capital declarado nao e o que a pessoa pediu. `ate_150k` fica sem piso de
  -- proposito: ali o fundo da faixa E o produto (medido: abaixo de R$ 30 mil ha 695 lotes
  -- ativos, 459 residenciais e so 35 vagas — a hipotese de que o fundo do acervo e lixo foi
  -- testada e REPROVADA, entao nao vira filtro).
  v_piso := case v_faixa
              when '150_400k'  then 150000
              when '400k_1mi'  then 400000
              when 'acima_1mi' then 1000000
              else 0 end;

  -- Objetivo → tipos e desconto mínimo. Revenda e locação DELEGAM a `intencao_filtro`, que é
  -- onde as regras `busca.intencao_*` vivem: duplicar os números aqui criaria a segunda fonte
  -- de verdade que a auditoria de regras existe para impedir.
  if v_obj in ('revenda','locacao') then
    select array(select jsonb_array_elements_text(f->'tipos')), (f->>'desconto_min')::int
      into v_tipos, v_dmin
      from (select public.intencao_filtro(v_obj) as f) x;
  elsif v_obj = 'incorporacao' then
    v_tipos := array['terreno','rural','imovel'];  v_dmin := 0;
  else -- uso_proprio: morar/usar. Sem exigência de desconto — o critério da pessoa é servir,
       -- não a margem; pedir 40% aqui esconderia justamente o que ela procura.
    v_tipos := array['apartamento','casa','imovel']; v_dmin := 0;
  end if;

  -- Uma passada só, com a preferência inteira no ORDER BY. Determinístico até o desempate por
  -- `id`: o que o admin vê no teste em seco é exatamente o que o cliente recebe.
  for r in
    select i.id, i.titulo, i.tipo, i.cidade, i.estado, i.valor_minimo_ref, i.valor_avaliacao,
           i.desconto_percentual, (i.tem_matricula_doc or i.link_matricula is not null) as tem_doc,
           (i.cidade_norm = replace(public.txt_norm(coalesce(v_cidade,'')), ' ', '')) as mesma_cidade,
           (i.estado = v_uf) as mesmo_estado
      from public.imoveis_leilao i
     where i.ativo
       and i.suprimido_motivo is null
       and i.tipo = any(v_tipos)
       and i.valor_minimo_ref is not null
       and i.valor_minimo_ref > 0
       and i.valor_minimo_ref <= v_teto                 -- NUNCA relaxado
       and i.valor_minimo_ref >= v_piso
       -- Sem cidade/estado o lote nao pode nem ser situado, e a frase "fora do estado do
       -- cadastro" viraria mentira sobre um lugar que nao conhecemos.
       and i.cidade is not null and i.estado is not null
       -- VAGA DE GARAGEM fica de fora do PRIMEIRO relatório — e só dele. É imóvel de verdade e
       -- continua no acervo; o que ela não é, é uma representação do que a pessoa declarou
       -- querer. No ensaio em seco, duas contas de faixa "até R$ 150 mil" receberam a MESMA
       -- vaga de 22 m² por R$ 2.183 em São Paulo, só porque 95% é o maior desconto do estado.
       -- São 81 lotes em 30.616 com geo (0,26%): tirar não estreita nada.
       -- Junto com a vaga, sai também o lote que não é o IMÓVEL e sim um DIREITO sobre ele
       -- ("direitos aquisitivos") — 16 lotes. A regra `acervo.fracao_ideal` já barra do acervo
       -- o direito creditório e a nua-propriedade pelo mesmo raciocínio; aqui a exclusão vale
       -- só para o primeiro relatório, porque mudar o acervo é decisão do dono, não minha.
       and i.titulo !~* '(vaga|box)\s*(de\s*)?(garagem|estacionamento)|vaga de garagem|direitos? aquisitiv|^direitos?\s*[-—]'
       and coalesce(i.desconto_percentual,0) >= v_dmin
       -- Geo é exigência, não gosto: os comparáveis são amostrados por RAIO. Sem coordenada,
       -- o relatório sai sem base de mercado — que é o caso que hoje vira anomalia.
       and i.latitude is not null and i.longitude is not null
       and not public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2, current_date)
     -- `nulls last` NÃO é enfeite: no ensaio em seco os três piores resultados eram lotes SEM
     -- estado, e em `order by ... desc` o NULL vem PRIMEIRO por padrão — a preferência por
     -- "mesma cidade" estava, na prática, preferindo o lote de lugar desconhecido.
     order by mesma_cidade desc nulls last, mesmo_estado desc nulls last, tem_doc desc nulls last,
              coalesce(i.desconto_percentual,0) desc, i.id
     limit 1
  loop
    return jsonb_build_object(
      'encontrou', true,
      'imovel_id', r.id,
      'titulo', r.titulo, 'tipo', r.tipo, 'cidade', r.cidade, 'estado', r.estado,
      'valor', r.valor_minimo_ref, 'avaliacao', r.valor_avaliacao,
      'desconto', r.desconto_percentual, 'tem_doc', r.tem_doc,
      'motivo', case when r.mesma_cidade then 'na cidade do cadastro'
                     when r.mesmo_estado then 'no estado do cadastro'
                     else 'fora do estado do cadastro' end
                || case when r.tem_doc then ', com documento' else ', sem documento anexo' end,
      'criterios', jsonb_build_object('objetivo', v_obj, 'faixa', v_faixa, 'teto', v_teto, 'piso', v_piso,
                                      'tipos', to_jsonb(v_tipos), 'desconto_min', v_dmin,
                                      'cidade', v_cidade, 'uf', v_uf, 'relaxou_desconto', v_relax));
  end loop;

  -- Nada sob o teto com o desconto do objetivo. UMA tentativa de relaxar o DESCONTO (nunca o
  -- teto), e ela é declarada no retorno — silêncio aqui viraria "não há imóvel para você".
  if v_dmin > 0 and not v_relax then
    v_relax := true; v_dmin := 0;
    for r in
      select i.id, i.titulo, i.tipo, i.cidade, i.estado, i.valor_minimo_ref, i.valor_avaliacao,
             i.desconto_percentual, (i.tem_matricula_doc or i.link_matricula is not null) as tem_doc,
             (i.cidade_norm = replace(public.txt_norm(coalesce(v_cidade,'')), ' ', '')) as mesma_cidade,
             (i.estado = v_uf) as mesmo_estado
        from public.imoveis_leilao i
       where i.ativo and i.suprimido_motivo is null
         and i.tipo = any(v_tipos)
         and i.valor_minimo_ref is not null and i.valor_minimo_ref > 0
         and i.valor_minimo_ref <= v_teto
         and i.valor_minimo_ref >= v_piso
         and i.cidade is not null and i.estado is not null
         and i.titulo !~* '(vaga|box)\s*(de\s*)?(garagem|estacionamento)|vaga de garagem|direitos? aquisitiv|^direitos?\s*[-—]'
         and i.latitude is not null and i.longitude is not null
         and not public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2, current_date)
       order by mesma_cidade desc nulls last, mesmo_estado desc nulls last, tem_doc desc nulls last,
                coalesce(i.desconto_percentual,0) desc, i.id
       limit 1
    loop
      return jsonb_build_object(
        'encontrou', true, 'imovel_id', r.id, 'titulo', r.titulo, 'tipo', r.tipo,
        'cidade', r.cidade, 'estado', r.estado, 'valor', r.valor_minimo_ref,
        'avaliacao', r.valor_avaliacao, 'desconto', r.desconto_percentual, 'tem_doc', r.tem_doc,
        'motivo', 'sem lote no desconto minimo do objetivo; escolhido o de maior desconto sob o teto',
        'criterios', jsonb_build_object('objetivo', v_obj, 'faixa', v_faixa, 'teto', v_teto, 'piso', v_piso,
                                        'tipos', to_jsonb(v_tipos), 'desconto_min', 0,
                                        'cidade', v_cidade, 'uf', v_uf, 'relaxou_desconto', true));
    end loop;
  end if;

  select count(*) into v_n from public.imoveis_leilao
   where ativo and valor_minimo_ref is not null and valor_minimo_ref <= v_teto;
  return jsonb_build_object('encontrou', false,
    'motivo', format('nenhum lote ativo do tipo declarado sob o teto de R$ %s (ha %s lotes sob o teto em outros tipos)',
                     round(v_teto), v_n),
    'criterios', jsonb_build_object('objetivo', v_obj, 'faixa', v_faixa, 'teto', v_teto, 'piso', v_piso,
                                    'tipos', to_jsonb(v_tipos), 'cidade', v_cidade, 'uf', v_uf));
end;
$$;

revoke execute on function public.primeiro_imovel_para_triagem(uuid) from public, anon;
grant  execute on function public.primeiro_imovel_para_triagem(uuid) to authenticated, service_role;

-- A regra vira DADO, com quem a aplica declarado — senão `auditoria_regras_negocio()` acusa
-- órfã, que é exatamente o ponto dela.
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('ativacao.primeiro_relatorio',
        jsonb_build_object(
          'gatilho', 'fim da triagem',
          'gera', 'apenas o mercadologico',
          'consome', 'a amostra gratuita do explorador',
          'nunca_acima_do_teto_declarado', true,
          'exige_geo', true,
          'desligavel_em', 'app_config.primeiro_relatorio_auto'),
        'Ao terminar a triagem, o cliente cai num relatorio JA em geracao, escolhido pelo objetivo '
        'e pela faixa de capital que ele acabou de declarar. Nunca acima do teto da faixa. Exige '
        'lote com coordenada (os comparaveis sao por raio). Gera SO o mercadologico — a documental '
        'e de plano pago e oferecer o que a pessoa nao pode ter e pior que nao oferecer.',
        array['primeiro_imovel_para_triagem'], true)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = excluded.ativo;

-- DESLIGADO por padrão: o dono liga depois de testar. Um interruptor que nasce ligado não é
-- testável — é um deploy.
insert into public.app_config (key, value) values ('primeiro_relatorio_auto', 'false')
on conflict (key) do nothing;
