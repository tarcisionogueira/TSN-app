-- ─────────────────────────────────────────────────────────────────────────────────────────
-- AS TRÊS INTENÇÕES VIRAM REGRA DECLARADA — 28/08
--
-- Revenda, Locação e Temporada decidem o que o cliente VÊ na Busca e o que RECEBE por e-mail,
-- e viviam só em constantes de código — duas cópias, inclusive. `auditoria_regras_negocio()`
-- não tinha o que vigiar: se o piso da revenda mudasse num arquivo e não no outro, ninguém
-- saberia. Foi assim, literalmente, que "explorador não saca" virou letra morta em 08/08.
--
-- MUDANÇA DE REGRA no mesmo commit: o piso da REVENDA sobe de 30% para 40% (decisão do dono).
-- Medido antes de mexer, no acervo ativo de tipos líquidos: 19.174 lotes passavam com 30% e
-- 17.077 passam com 40% — saem 2.097 (11%), sobra 89% do material.
--
-- POR QUE UMA FUNÇÃO E NÃO SÓ A LINHA EM `regra_negocio`: a auditoria exige que cada nome em
-- `aplicada_por` seja função do Postgres cujo corpo MENCIONE a chave. Declarar sem função
-- produziria "crítico" permanente — um painel que não pode ficar verde, que é o defeito que
-- esta sessão passou o dia consertando.
--
-- A APLICAÇÃO CONTINUA EM JS (`src/lib/intencao.js`), porque o filtro é montado no cliente e
-- no cron. Esta função é a DECLARAÇÃO canônica, e `npm run verificar:regras` compara as duas
-- no CI — sem essa comparação seriam duas cópias, que é o problema, não a solução.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.intencao_filtro(p_intencao text)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  -- busca.intencao_revenda: tipos líquidos + desconto mínimo de 40% (dono, 28/08 — era 30%).
  -- busca.intencao_locacao: residencial; SEM piso de rendimento, porque o acervo não tem
  --   aluguel por lote (só 44 dos 29.447 ativos, e apenas onde já houve relatório).
  -- busca.intencao_temporada: residencial em destino turístico (a lista vive em _temporada.js).
  select case p_intencao
    when 'revenda'   then jsonb_build_object('tipos', jsonb_build_array('apartamento','casa','comercial','imovel'), 'desconto_min', 40)
    when 'locacao'   then jsonb_build_object('tipos', jsonb_build_array('apartamento','casa','imovel'),             'desconto_min', 0)
    when 'temporada' then jsonb_build_object('tipos', jsonb_build_array('apartamento','casa','imovel'),             'desconto_min', 0, 'exige_cidade_turistica', true)
    else jsonb_build_object('tipos', '[]'::jsonb, 'desconto_min', 0)
  end;
$$;

comment on function public.intencao_filtro(text) is
  'Declaracao canonica das intencoes da Busca. A aplicacao vive em src/lib/intencao.js (cliente + cron); esta funcao e o que a auditoria_regras_negocio enxerga, e npm run verificar:regras compara as duas.';

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values
 ('busca.intencao_revenda',
  '{"tipos":["apartamento","casa","comercial","imovel"],"desconto_min":40,"antes":30,"mudou_em":"2026-08-28"}'::jsonb,
  'Revenda (flip): so tipos liquidos e desconto minimo de 40% sobre a avaliacao. Subiu de 30% para 40% por decisao do dono em 28/08 — medido antes: 19.174 lotes ativos passavam com 30%, 17.077 passam com 40% (saem 2.097, 11%).',
  array['intencao_filtro'], true),
 ('busca.intencao_locacao',
  '{"tipos":["apartamento","casa","imovel"],"desconto_min":0,"piso_rendimento":null,"motivo_sem_piso":"acervo nao tem aluguel por lote"}'::jsonb,
  'Locacao: apenas residencial. NAO ha piso de rendimento no filtro porque o acervo nao carrega aluguel por lote (44 de 29.447 ativos, e so onde ja houve relatorio) — a regua de 1% pertence ao relatorio, onde o aluguel existe, e nao a Busca, onde filtrar por ela esconderia 99,8% do acervo.',
  array['intencao_filtro'], true),
 ('busca.intencao_temporada',
  '{"tipos":["apartamento","casa","imovel"],"desconto_min":0,"exige_cidade_turistica":true,"cidades":104}'::jsonb,
  'Temporada: residencial em destino turistico — litoral, termas, serra, historicas e parques. A lista de 104 cidades vive em api/_temporada.js e e espelhada na Busca (conferidas identicas em 28/08).',
  array['intencao_filtro'], true)
on conflict (chave) do update
   set valor = excluded.valor, descricao = excluded.descricao,
       aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();

-- ── REGRESSÃO MINHA, no mesmo dia, que a auditoria pegou ─────────────────────────────────
-- Ao reescrever `fracao_ideal_barrada` (v3 da cláusula de condomínio, horas antes) perdi o
-- comentário que citava a chave `acervo.fracao_ideal`, e a regra virou órfã: a auditoria
-- passou a acusar "a função deveria aplicar esta regra e não a menciona". Ela fez exatamente
-- o trabalho para o qual foi escrita. A menção volta ao corpo, com o porquê.
do $do$
declare def text;
begin
  select pg_get_functiondef(oid) into def
    from pg_proc where oid = 'public.fracao_ideal_barrada(text,text)'::regprocedure;
  if position('acervo.fracao_ideal' in def) = 0 then
    def := replace(def,
      '  with t as (select coalesce(p_titulo,'''') || '' '' || coalesce(p_descricao,'''') as txt)',
      '  -- Aplica a regra acervo.fracao_ideal: parte/fracao ideal, direito creditorio e' || chr(10) ||
      '  -- nua-propriedade nao entram no acervo (nos tres casos nao se compra O IMOVEL).' || chr(10) ||
      '  with t as (select coalesce(p_titulo,'''') || '' '' || coalesce(p_descricao,'''') as txt)');
    execute def;
  end if;
end $do$;
