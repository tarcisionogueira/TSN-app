-- ─────────────────────────────────────────────────────────────────────────────
-- GEOCODING: PARAR DE RE-PERGUNTAR O QUE JÁ SE SABE QUE NÃO MELHORA  (26/08/2026)
--
-- O dono perguntou por que a cota do Google estourou se "seriam apenas os imóveis novos
-- que entrariam". Ele estava certo em desconfiar: NÃO eram os novos.
--
-- `regeocod-imprecisos` re-enfileira todo imóvel com nível 'cidade' ou 'falhou' para tentar
-- melhorá-lo, com guard de 14 dias. A intenção é boa (corrigir o pino no bairro errado). O
-- que faltava era um FIM: quem não melhora volta para a fila 14 dias depois, e de novo.
--
-- Medido: 5.815 imóveis no alvo; 4.454 já reprocessados e AINDA imprecisos contra 3.948 que
-- melhoraram — 47% de acerto. Os 53% restantes são endereços ruins na origem, que não
-- melhoram por insistência, e re-perguntá-los custava ~9.500 chamadas/mês: a cota gratuita
-- inteira, para não mudar nada.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.imoveis_leilao
  add column if not exists geocod_tentativas smallint not null default 0;

comment on column public.imoveis_leilao.geocod_tentativas is
  'Quantas vezes o reprocessamento já tentou melhorar este geocoding. A partir de 3 o imóvel '
  'sai da fila: endereço que não melhorou em três tentativas não melhora por insistência, e '
  'cada tentativa é uma chamada paga ao Google.';

-- Backfill honesto: quem já foi reprocessado e continua impreciso conta 1 tentativa — é o
-- que o `geocod_reproc_em` prova. O histórico anterior não foi contado e não se inventa.
update public.imoveis_leilao
   set geocod_tentativas = 1
 where geocod_reproc_em is not null and geocod_nivel in ('cidade','falhou') and geocod_tentativas = 0;

create index if not exists idx_imoveis_regeocod_fila
  on public.imoveis_leilao (geocod_nivel, geocod_tentativas, geocod_reproc_em) where ativo;

-- O incremento acontece NO SERVIDOR: um PATCH do PostgREST não sabe somar, e devolver o
-- valor lido perderia incrementos se duas execuções se cruzassem — e contador que não sobe
-- devolve, em silêncio, o loop que esta mudança existe para cortar.
create or replace function public.geocode_contar_tentativa(p_ids uuid[])
returns int language sql security definer set search_path to 'public' as $$
  with alvo as (
    update imoveis_leilao set geocod_tentativas = coalesce(geocod_tentativas, 0) + 1
     where id = any(p_ids) returning 1
  ) select count(*)::int from alvo;
$$;
revoke all on function public.geocode_contar_tentativa(uuid[]) from public, anon, authenticated;

create or replace function public.geocode_fila_status()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'alvo_total',       count(*) filter (where ativo and geocod_nivel in ('cidade','falhou')),
    'ainda_na_fila',    count(*) filter (where ativo and geocod_nivel in ('cidade','falhou') and geocod_tentativas < 3),
    'desistidos',       count(*) filter (where ativo and geocod_nivel in ('cidade','falhou') and geocod_tentativas >= 3),
    'melhoraram',       count(*) filter (where ativo and geocod_nivel in ('endereco','rua') and geocod_reproc_em is not null),
    'novos_por_dia',    round(count(*) filter (where criado_em > now() - interval '20 days') / 20.0),
    'cota_mes_por_dia', 333
  ) from imoveis_leilao;
$$;
revoke all on function public.geocode_fila_status() from public, anon;
grant execute on function public.geocode_fila_status() to authenticated;
