-- 07/11 — Timeouts que o Cliente 360 mostrava em "Erros abertos" (admin_precisa_de_voce: 3x de 04 a 06/11)
-- e o /api/publico (acervo_uf_contagem: média 2 s, pico 8 s em 74 chamadas).
--
-- Causa comum: o banco tem 320 MB de shared_buffers e imoveis_leilao ocupa 441 MB. Consulta que precisa
-- de PÁGINA DO HEAP de imoveis_leilao lê do disco quando a página saiu do cache, e o mesmo SQL varia de
-- 0,2 s (quente) a 4,6 s (frio). O `authenticated` tem 8 s de statement_timeout.
--
-- (1) admin_precisa_de_voce → fonte_regressao_pendente → fonte_regressao_suspeita, CTE `expirados`:
--     lia 6.753 blocos do heap (lotes inativos atualizados em 7 dias). Índice parcial com as colunas da
--     conta em INCLUDE faz index-only scan: 704 blocos, ~5 MB de índice, que fica quente.
--     Criado em produção com CONCURRENTLY (não trava a escrita dos coletores). Aqui fica sem
--     CONCURRENTLY porque migração roda em transação; `if not exists` torna a reaplicação inócua.
create index if not exists idx_imoveis_inativos_expiracao
  on public.imoveis_leilao (atualizado_em) include (fonte, modalidade, data_leilao, data_leilao_2)
  where not ativo;

-- (2) acervo_uf_contagem (/leiloes): passa a ler do cache que a passada HORÁRIA já mantém
--     (live_plataforma_numeros_atualizar, chamada pelo desativar-encerrados-cron), no mesmo desenho de
--     acervo_cidades_top/todas. A página fica 1 h na borda, então o atraso de até 1 h não muda nada.
--     Cache ausente ou velho (> 3 h, o mesmo limite do invariante live_numeros_congelados) = calcula na hora,
--     como antes: o cache acelera, nunca vira a única fonte.
alter table public.acervo_cidades_cache add column if not exists ufs jsonb;

create or replace function public._acervo_uf_calcular()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'total', n) order by n desc), '[]'::jsonb)
  from (
    select upper(estado) as uf, count(*) as n
      from public.imoveis_leilao
     where ativo and coalesce(estado,'') <> ''
     group by 1
  ) t;
$function$;
revoke execute on function public._acervo_uf_calcular() from public, anon, authenticated;

create or replace function public.acervo_uf_contagem()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select c.ufs from public.acervo_cidades_cache c
      where c.id and c.ufs is not null and c.atualizado_em > now() - interval '3 hours'),
    public._acervo_uf_calcular());
$function$;

-- Corpo = o de PRODUÇÃO em 07/11 (lido com pg_get_functiondef), mais a coluna `ufs`.
create or replace function public.live_plataforma_numeros_atualizar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'lotes',         count(*),
    'leiloeiros',    count(distinct fonte),
    'cidades',       count(distinct cidade),
    'com_desconto',  count(*) filter (where desconto_percentual between 50 and 95),
    'fotos_storage', count(*) filter (where link_foto like '%supabase%')
  ) into v from public.imoveis_leilao where ativo;

  insert into public.plataforma_numeros_cache (id, dados, atualizado_em)
  values (true, v, now())
  on conflict (id) do update set dados = excluded.dados, atualizado_em = excluded.atualizado_em;

  insert into public.acervo_cidades_cache (id, top, todas, ufs, atualizado_em)
  values (true,
          public._acervo_cidades_calcular(300),
          (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'cidade_norm', cidade_norm)), '[]'::jsonb)
             from (select distinct upper(estado) as uf, cidade_norm
                     from public.imoveis_leilao
                    where ativo and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> '') t),
          public._acervo_uf_calcular(),
          now())
  on conflict (id) do update set top = excluded.top, todas = excluded.todas, ufs = excluded.ufs,
                                 atualizado_em = excluded.atualizado_em;

  return v || jsonb_build_object('atualizado_em', now());
end;
$function$;
