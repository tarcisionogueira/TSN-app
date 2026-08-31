-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O VIGIA DA INGESTÃO DE MARKETING SE CHAMAVA "GOOGLE ADS" E MEDIA TODOS OS CANAIS — 31/08/2026
--
-- `mkt_ingestao_atrasada` tinha por título *"Marketing: ingestao do Google Ads parada"* e por
-- medida:
--
--     select case when coalesce(max(data), '1970-01-01') < current_date - 2 then 1 else 0 end
--       from marketing_metricas_dia
--
-- `max(data)` SEM `where canal`. O maior de todos os canais responde por qualquer um deles.
--
-- POR QUE ISSO NUNCA IA DISPARAR: os dois canais ingerem em horários diferentes — o Meta
-- grava cedo (08h10 UTC medido em 31/08) e o Google chega por volta das 10h50. Enquanto o
-- Meta escrever todo dia, `max(data)` é sempre "hoje" e o vigia responde 'ok' — ainda que a
-- ingestão do Google esteja parada há semanas. O número existia, era plausível, e media
-- outra coisa: a forma #10 do CLAUDE.md, num invariante cujo nome próprio já prometia o
-- recorte que ele não fazia.
--
-- (No dia da correção os dois estavam em dia — o achado veio de LER a medida, não de um
-- alarme. Fosse esperar o alarme, ele não viria.)
--
-- A CORREÇÃO mede por CANAL e conta quantos pararam:
--
--     select count(*) from (select canal, max(data) ult from marketing_metricas_dia group by canal) c
--      where c.ult < current_date - 2 and c.ult >= current_date - 10
--
-- O piso `>= current_date - 10` é deliberado: canal DESLIGADO de propósito para de escrever
-- e ficaria acusando para sempre, e um alarme que nunca apaga é um alarme que se aprende a
-- ignorar. A janela de 3 a 10 dias é exatamente "estava produzindo e parou" — que é a
-- pergunta que o invariante existe para responder. Canal parado há mais de 10 dias é decisão
-- de mídia, não falha de ingestão.
-- ─────────────────────────────────────────────────────────────────────────────────────────

do $do$
declare
  corpo text;
  velho text;
  novo  text;
begin
  select prosrc into corpo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  if corpo is null then raise exception 'qa_invariantes nao existe'; end if;

  if position('group by canal' in corpo) > 0 then
    raise notice 'ja aplicado';
  else
    velho := '(select (case when coalesce(max(data), date ''1970-01-01'') < current_date - 2 then 1 else 0 end)::bigint' || e'\n' ||
             '          from marketing_metricas_dia)';
    if position(velho in corpo) = 0 then
      raise exception 'ancora de mkt_ingestao_atrasada nao encontrada — NAO aplico as cegas';
    end if;
    novo := '(select count(*)::bigint from (' || e'\n' ||
            '            select canal, max(data) as ult from marketing_metricas_dia group by canal' || e'\n' ||
            '          ) c where c.ult < current_date - 2 and c.ult >= current_date - 10)';
    corpo := replace(corpo, velho, novo);
    corpo := replace(corpo,
      '''Marketing: ingestao do Google Ads parada (ultimo dia < D-2; D-1 chega ~10h50 UTC)''',
      '''Marketing: ingestao de algum CANAL parada (ultimo dia < D-2; D-1 chega ~10h50 UTC)''');

    -- `set search_path to 'public'` REEMITIDO — regra de 22/08: prosrc guarda só o corpo.
    execute 'create or replace function public.qa_invariantes()' || e'\n' ||
            ' returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text)' || e'\n' ||
            ' language sql stable set search_path to ''public'' as $corpo$' || corpo || '$corpo$';
  end if;
end
$do$;

alter function public.qa_invariantes() owner to postgres;
revoke execute on function public.qa_invariantes() from public, anon;
grant execute on function public.qa_invariantes() to service_role;
