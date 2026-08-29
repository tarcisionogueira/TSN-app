-- 29/08: a landing da aula ao vivo (/live/leilao-ao-vivo) — a MESMA que recebe o tráfego pago
-- do Meta e para onde o convite de domingo manda a base — registrou em erros_cliente:
--   Supabase 500 em "rpc/live_plataforma_numeros": canceling statement due to statement timeout
--
-- Causa: a função varria imoveis_leilao INTEIRA (66.285 linhas) com quatro agregados, dois deles
-- count(distinct …). Medido com cache quente: 1,70 s / 36.186 buffers. O teto do PostgREST para
-- anon é bem menor que isso com cache frio — e o front, que trata a ausência dos números como
-- "sem credencial" (padrao-ok em LiveInscricao.jsx), simplesmente ESCONDIA a prova social.
-- Vazio entregue como resposta: a forma nº 1 do CLAUDE.md, na página que mais custa clique.
--
-- Correção: número de vitrine não precisa ser vivo. Passa a ler uma linha só, e quem recalcula é
-- a varredura HORÁRIA que já mexe em `ativo` (desativar-encerrados-cron) — a mesma que decide o
-- que entra e sai da conta. `atualizado_em` viaja no payload de propósito: cache que congela em
-- silêncio seria trocar um defeito por outro, e o invariante `live_numeros_congelados` grita.

create table if not exists public.plataforma_numeros_cache (
  id            boolean primary key default true check (id),
  dados         jsonb       not null,
  atualizado_em timestamptz not null default now()
);

alter table public.plataforma_numeros_cache enable row level security;
-- Sem policy: ninguém lê a tabela direto. O acesso público é só pela função abaixo.

create or replace function public.live_plataforma_numeros_atualizar()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'lotes',        count(*) filter (where ativo),
    'leiloeiros',   count(distinct fonte) filter (where ativo),
    'cidades',      count(distinct cidade) filter (where ativo and cidade is not null),
    'com_desconto', count(*) filter (where ativo and desconto_percentual between 50 and 95)
  ) into v from public.imoveis_leilao;

  insert into public.plataforma_numeros_cache (id, dados, atualizado_em)
  values (true, v, now())
  on conflict (id) do update set dados = excluded.dados, atualizado_em = excluded.atualizado_em;

  return v || jsonb_build_object('atualizado_em', now());
end;
$$;

revoke execute on function public.live_plataforma_numeros_atualizar() from public, anon, authenticated;

create or replace function public.live_plataforma_numeros()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.dados || jsonb_build_object('atualizado_em', c.atualizado_em)
    from public.plataforma_numeros_cache c where c.id;
$$;

grant execute on function public.live_plataforma_numeros() to anon, authenticated;

-- Semeia agora para a página não nascer sem números esperando o primeiro cron.
select public.live_plataforma_numeros_atualizar();
