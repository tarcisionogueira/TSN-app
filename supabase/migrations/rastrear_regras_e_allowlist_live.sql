-- ─────────────────────────────────────────────────────────────────────────────
-- RASTREABILIDADE DAS REGRAS NOVAS + allowlist de live_inscritos  (26/08/2026)
--
-- A auditoria de regras acusou 4 críticos assim que as migrações de hoje entraram, e
-- estava certa: `auditoria_regras_negocio()` confere se a função aplicadora MENCIONA a
-- chave da regra no próprio corpo (`position(r.chave in v_src)`). As funções aplicavam as
-- regras mas não as citavam — do ponto de vista da auditoria, regra órfã.
--
-- Não é burocracia: é o elo que fez "explorador indica mas só saca sendo pagante" deixar
-- de ser comentário e virar código verificável. Quem ler a função daqui a seis meses
-- descobre QUAL regra ela implementa sem precisar adivinhar.
--
-- O corpo das funções NÃO é reescrito aqui: o comentário é inserido no texto da definição
-- que já está no banco, ancorado no `declare`. Redigitar cem linhas de função só para
-- acrescentar um comentário é como se introduz uma diferença silenciosa entre o que se
-- revisou e o que ficou.
-- ─────────────────────────────────────────────────────────────────────────────

do $do$
declare
  v_src text;
  v_alvos text[][] := array[
    array['confirmar_compra_produto', '  -- Regras de negócio aplicadas aqui: produto.concede_plano, produto.bonus_e_upsell'],
    array['comprar_produto_iniciar',  '  -- Regra de negócio aplicada aqui: produto.order_bump'],
    array['entregar_itens_compra',    '  -- Regra de negócio aplicada aqui: produto.order_bump']
  ];
  i int;
begin
  for i in 1 .. array_length(v_alvos, 1) loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_alvos[i][1]
     limit 1;
    if v_src is null then
      raise exception 'funcao % nao existe', v_alvos[i][1];
    end if;
    -- Já anotada? Não faz nada — a migração precisa poder rodar de novo sem empilhar
    -- comentário a cada execução.
    if position(v_alvos[i][2] in v_src) > 0 then
      continue;
    end if;
    -- Âncora no PRIMEIRO `declare`, que é o do corpo. As três funções têm um só
    -- (os `begin ... exception` internos não declaram nada), então a substituição é única.
    v_src := regexp_replace(v_src, E'\\ndeclare', E'\n' || v_alvos[i][2] || E'\ndeclare');
    execute v_src;
  end loop;
end
$do$;

-- ── live_inscritos entra na allowlist ────────────────────────────────────────
-- Ela é SECURITY DEFINER e executável por anônimo DE PROPÓSITO: a landing da aula é uma
-- página aberta e mostra "N inscritos" como prova social. O que ela devolve é um NÚMERO —
-- nunca nome, e-mail ou telefone, que é o que a tabela guarda e continua fechada por RLS.
-- Sem esta entrada, o alerta reapareceria em toda auditoria e viraria ruído: alerta que
-- sempre aparece é alerta que ninguém lê.
do $do$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'auditoria_seguranca' limit 1;
  if v_src is null then raise exception 'auditoria_seguranca nao existe'; end if;
  if position('live_inscritos' in v_src) > 0 then return; end if;
  v_src := replace(v_src,
    E'''get_convite_equipe_info'',''get_convite_vendedor_info'',''acervo_busca_cidade''',
    E'''get_convite_equipe_info'',''get_convite_vendedor_info'',''acervo_busca_cidade'',\n    ''live_inscritos''');
  execute v_src;
end
$do$;
