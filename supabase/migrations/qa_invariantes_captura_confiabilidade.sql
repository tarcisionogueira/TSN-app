-- ═══════════════════════════════════════════════════════════════════════════════
-- QA — quatro invariantes de CONFIABILIDADE DA CAPTURA (11/08)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Os quatro nasceram do mesmo dia de investigação. Nenhum deles teria sido pego por
-- varredura de código: os três primeiros só existem como rastro no banco.
--
-- 1. bd_teto_saturado — o teto semanal do Bright Data ficou ESGOTADO 4 semanas seguidas
--    (450/450 desde 20/07) e ninguém soube. Todo consumidor lia "sem cota" como "a fonte
--    não tem nada": o scraper RJ saía com exit 0, check verde, acervo congelado em 30/07.
--    Alerta em 90% do teto — ANTES de a coleta começar a passar fome.
--
-- 2. fonte_cega_no_monitor — fonte com lote ativo e ZERO linha em `fonte_saude` não tem
--    piso aprendido, logo o alerta de regressão nunca dispara para ela. Era o caso do
--    RJLEILOES: `registrarSaude` só era chamado no caminho de sucesso, e como a coleta
--    nunca teve sucesso, a fonte nunca entrou no monitor. Esta query é a do CLAUDE.md
--    (ritual de abertura, item 1) promovida a invariante — que roda todo dia sozinha.
--
-- 3. valor_diverge_do_titulo — o SOLEON escreve o preço no próprio nome do lote
--    ("… Lance Inicial: R$600.000,00- Avaliação: R$1.000.000,00"). Onde o campo diverge
--    do título, o parser errou. Medido: 3 dos 5 imóveis RJ ativos com `valor_minimo`
--    igual a 5% do lance real — era a COMISSÃO do leiloeiro, pega pelo `Math.min` de
--    todos os "R$" da página. O cliente via R$ 30 mil num imóvel de R$ 600 mil.
--
-- 4. leilao_vencido_ativo — imóvel ativo com data de leilão no passado. Hoje 1.648, dos
--    quais 1.642 são CEF e 1.168 foram ATUALIZADOS nas últimas 24h: ou seja, a CEF segue
--    publicando o lote e a data não é refrescada. É 'gap' (backlog vigiado), com limite
--    calibrado para 0 falso-positivo hoje e alerta se piorar. Investigação separada.

create or replace function public.qa_invariantes()
returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text)
language sql set search_path to 'public' as $function$
  with inv(chave, titulo, categoria, gravidade, valor, limite) as (
    values
     ('edital_eq_matricula','Botão Edital abre a Matrícula','Documentos','bug',
       (select count(*) from imoveis_leilao where ativo and link_edital is not null and link_edital = link_matricula), 8),
     ('matricula_eq_lote','Matrícula aponta p/ a página do lote','Documentos','bug',
       (select count(*) from imoveis_leilao where ativo and link_matricula is not null and link_matricula = url_lote), 8),
     ('aval_incoerente','Avaliação > 10× o lance (mis-read)','Relatório','bug',
       (select count(*) from imoveis_leilao where ativo and valor_avaliacao>0 and valor_minimo>0 and valor_avaliacao > valor_minimo*10), 30),
     ('valor_sentinela','Valor sentinela gravado','Relatório','bug',
       (select count(*) from imoveis_leilao where ativo and (valor_minimo in (999999999,99999999,9999999999,111111111,123456789) or valor_avaliacao in (999999999,99999999,9999999999,111111111,123456789))), 0),
     ('perfil_sem_role','Perfil sem role definido','Conta','bug',
       (select count(*) from perfis where coalesce(role,'')=''), 0),
     ('proximidades_vazio_falso','Proximidades vazias em cidade já mapeada','Relatório','bug',
       (select count(*) from imoveis_leilao i where i.ativo and i.pontos_proximos = '{}'::jsonb
          and coalesce(i.cidade,'') <> ''
          and exists (select 1 from imoveis_leilao v
                       where v.ativo and v.cidade = i.cidade and v.estado is not distinct from i.estado
                         and v.pontos_proximos is not null and v.pontos_proximos <> '{}'::jsonb)), 300),
     -- ── novos em 11/08 ────────────────────────────────────────────────────────
     ('bd_teto_saturado','Bright Data: cota semanal perto do teto','Captura','bug',
       (select coalesce(requests,0) from brightdata_uso where semana = date_trunc('week', now())::date), 405),
     ('fonte_cega_no_monitor','Fonte com acervo ativo e sem histórico de saúde','Captura','bug',
       (select count(*) from (select distinct i.fonte from imoveis_leilao i
          where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0),
     ('valor_diverge_do_titulo','Lance gravado diverge do lance no título','Relatório','bug',
       (select count(*) from imoveis_leilao
         where ativo and titulo ~ 'Lance Inicial:\s*R\$\s*[\d.]+,\d{2}'
           and abs(coalesce(valor_minimo,0) - replace(regexp_replace(
                 (regexp_match(titulo, 'Lance Inicial:\s*R\$\s*([\d.]+,\d{2})'))[1],
                 '[^0-9,]', '', 'g'), ',', '.')::numeric) > 1), 0),
     ('leilao_vencido_ativo','Lote ativo com data de leilão no passado','Captura','gap',
       (select count(*) from imoveis_leilao
         where ativo and data_leilao ~ '^\d{4}-\d{2}-\d{2}' and data_leilao::date < current_date), 1800),
     ('aval_ausente_com_doc','Lote com edital/anexo mas SEM avaliação','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(valor_avaliacao,0)=0
          and ((case when jsonb_typeof(anexos)='array' then jsonb_array_length(anexos) else 0 end) > 0 or coalesce(link_edital,'') ~* '\.pdf')), 3800),
     ('desconto_ge90','Desconto ≥ 90% (suspeito de mis-read)','Relatório','gap',
       (select count(*) from imoveis_leilao where ativo and desconto_percentual >= 90), 200),
     ('sem_foto','Lote ativo sem foto','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(link_foto,'')=''), 1600),
     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)
  )
  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,
    case when valor > limite then 'alerta' else 'ok' end
  from inv;
$function$;
revoke execute on function public.qa_invariantes() from public, anon, authenticated;
grant execute on function public.qa_invariantes() to service_role;

-- ── REPARO do que o parser errado gravou ──────────────────────────────────────
-- O título é o que o próprio leiloeiro escreveu; o campo é o que o parser deduziu.
-- Onde divergem, o título ganha. Só toca linha em que o título traz o valor de forma
-- inequívoca — nenhuma linha sem evidência é alterada.
update public.imoveis_leilao i set
  valor_minimo = replace(regexp_replace((regexp_match(titulo, 'Lance Inicial:\s*R\$\s*([\d.]+,\d{2})'))[1], '[^0-9,]', '', 'g'), ',', '.')::numeric,
  valor_avaliacao = coalesce(
    replace(regexp_replace((regexp_match(titulo, 'Avalia[çc][ãa]o:\s*R\$\s*([\d.]+,\d{2})'))[1], '[^0-9,]', '', 'g'), ',', '.')::numeric,
    valor_avaliacao),
  atualizado_em = now()
where ativo
  and titulo ~ 'Lance Inicial:\s*R\$\s*[\d.]+,\d{2}'
  and abs(coalesce(valor_minimo,0) - replace(regexp_replace(
        (regexp_match(titulo, 'Lance Inicial:\s*R\$\s*([\d.]+,\d{2})'))[1], '[^0-9,]', '', 'g'), ',', '.')::numeric) > 1;

-- Deriváveis do lance/avaliação corrigidos (a tela mostra desconto e viabilidade).
update public.imoveis_leilao set
  desconto_percentual = case when valor_avaliacao > 0 then round((1 - valor_minimo / valor_avaliacao) * 100) else null end,
  viavel              = case when valor_avaliacao > 0 then (1 - valor_minimo / valor_avaliacao) >= 0.3 else null end,
  score_viabilidade   = case when valor_avaliacao > 0 then least(100, round((1 - valor_minimo / valor_avaliacao) * 150)) else 30 end
where ativo and fonte = 'RJLEILOES';
