-- 29/08 — "conversoes: null" DO META NÃO ERA "NÃO CONVERTEU": ERA "NUNCA PERGUNTAMOS"
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `marketing_metricas_dia` tinha `conversoes` preenchido no Google Ads e NULL em 100% das
-- linhas do Meta Ads. A causa, em `api/meta-insights-cron.js`:
--
--     &fields=campaign_name,spend,clicks,impressions      ← `actions` nunca foi pedido
--     ...
--     conversoes: null,                                    ← e o mapper cravava null
--
-- É a **forma nº 8** do CLAUDE.md ao pé da letra: *o que não é PEDIDO nunca chega para ser
-- ignorado*. O campo não podia ser outra coisa senão nulo, e o painel de CAC/ROAS do Meta
-- ficava sem denominador — com a verba rodando, sem ninguém saber se comprava alguém.
--
-- ─── POR QUE ESTA MIGRAÇÃO ACRESCENTA UMA COLUNA DE EVIDÊNCIA ───────────────────────────
-- No Meta, conversão não é um campo: vem num array `actions`, com `action_type` de várias
-- famílias que se sobrepõem (`purchase` e `offsite_conversion.fb_pixel_purchase` contam a
-- MESMA venda). Somar tudo dobra o número; somar a família errada dá um valor plausível e
-- errado — a forma nº 10, que nesta base já apareceu sete vezes.
--
-- O antídoto que o CLAUDE.md prescreve é *rodar em seco sobre dado real antes de gravar*, e
-- ele NÃO estava disponível: o `META_ADS_TOKEN` vive no painel da Vercel e não neste
-- ambiente, então não dá para ver quais `action_type` a conta devolve de fato. Em vez de
-- chutar e deixar o chute invisível, o cron passa a GRAVAR o que viu:
--
--   `conversoes_detalhe.por_tipo`  → todos os action_type que vieram, com seus valores
--   `conversoes_detalhe.usados`    → quais entraram na soma
--
-- Assim a primeira execução real já permite conferir o total contra o Gerenciador de
-- Anúncios sem reabrir a investigação — e um mapeamento errado fica VISÍVEL na linha, em
-- vez de virar um número bonito que ninguém questiona.
alter table public.marketing_metricas_dia
  add column if not exists conversoes_detalhe jsonb;

comment on column public.marketing_metricas_dia.conversoes_detalhe is
  'Meta Ads: o array actions como veio (por_tipo) e o subconjunto somado (usados). Existe '
  'para que o total seja CONFERIVEL contra o Gerenciador de Anuncios — mapeamento de '
  'action_type errado da numero plausivel, e sem isto ele seria invisivel.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- A TRAVA: canal gastando com conversão que nunca chega
-- ─────────────────────────────────────────────────────────────────────────────────────
-- O defeito ficou no ar desde que o Meta entrou porque NADA acusava. Este invariante pega a
-- classe inteira (campo não pedido, mapper cravando null, credencial trocada): canal com
-- gasto real nos últimos 3 dias e NENHUMA linha com conversão apurada.
--
-- Janela de 3 dias, não 7, de propósito: o cron reescreve os últimos 7 dias a cada execução,
-- então 3 dias é folga suficiente para ele já ter passado — e curto o bastante para não
-- acusar eternamente as linhas históricas que a correção não alcança (as anteriores a 22/08
-- seguem nulas, e isso é passado, não defeito vivo).
create or replace function public.qa_invariante_canal_sem_conversao_apurada()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint from (
    select canal
      from public.marketing_metricas_dia
     where data > current_date - 3
     group by canal
    having sum(gasto) > 0 and count(conversoes) = 0   -- count(col) ignora NULL: 0 = todas nulas
  ) c;
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('canal_sem_conversao_apurada' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''canal_sem_conversao_apurada'',''Canal de anuncio gastando com conversao NUNCA apurada (campo nao pedido a API / mapper cravando null)'',''Marketing'',''bug'',\n       public.qa_invariante_canal_sem_conversao_apurada(), 0)';
  execute replace(d, alvo, novo);
end $do$;
