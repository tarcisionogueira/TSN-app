-- NUDGE DE ATIVAÇÃO — o segundo toque para quem cadastrou e nunca gerou nada.
--
-- POR QUE (09/08): dos 30 exploradores, 27 têm UM ÚNICO dia de atividade — o do cadastro.
-- Não existe nada que os procure. Os crons de nome parecido fazem outra coisa:
-- `saldo-abandono-cron` é sobre saldo esquecido, `retencao-avisos-cron` é sobre APAGAR
-- documento, e `enviar-alertas-cron` só alcança quem criou filtro salvo (quase ninguém).
-- Das 90 amostras grátis disponíveis (3 por conta), 3 foram usadas.
--
-- REGRA: no máximo DOIS e-mails na vida, D+2 e D+7, e some da fila assim que a pessoa
-- gera a primeira análise. A dedup é estrutural (unique por user+etapa), não confiança
-- no cron rodar uma vez só.

begin;

create table if not exists public.ativacao_nudge (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  etapa       text not null check (etapa in ('d2','d7')),
  enviado_em  timestamptz not null default now(),
  email_ok    boolean not null default false,
  imoveis     jsonb,                       -- o que foi oferecido, para saber o que funciona
  unique (user_id, etapa)                  -- a trava: rodar o cron 10× não reenvia
);

alter table public.ativacao_nudge enable row level security;
-- Sem policy = ninguém além do service_role enxerga. É registro operacional nosso.

create index if not exists idx_ativacao_nudge_user on public.ativacao_nudge(user_id);

comment on table public.ativacao_nudge is
  'Nudge de ativação (D+2/D+7) para quem cadastrou e não gerou análise. Máx. 2 por pessoa, na vida.';

-- ─────────────────────────────────────────────────────────────────────────────
-- QUEM RECEBE. Função separada de propósito: o dono consegue conferir a lista sem
-- disparar nada — `select * from public.ativacao_nudge_candidatos();`
--
-- p_backlog: as janelas D+2/D+7 são de UM DIA cada, porque o cron roda diariamente. Na
-- primeira execução isso deixaria de fora quem já se cadastrou há semanas (justamente os
-- 27). Com backlog=true, quem passou da janela entra uma única vez, na etapa 'd2'.
create or replace function public.ativacao_nudge_candidatos(p_backlog boolean default false)
returns table (user_id uuid, email text, nome text, etapa text, dias int, cidade text, uf text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, u.email::text, p.nome, x.etapa, x.dias,
         -- `cidades_interesse` é jsonb: [{uf, cidade, raio_km}]. É o interesse DECLARADO na
         -- triagem, melhor sinal que o endereço do cadastro — daí a precedência.
         coalesce(nullif(btrim(p.cidades_interesse->0->>'cidade'), ''), nullif(btrim(p.endereco_cidade), '')) as cidade,
         coalesce(nullif(btrim(p.cidades_interesse->0->>'uf'), ''), nullif(btrim(p.endereco_uf), '')) as uf
    from public.perfis p
    join auth.users u on u.id = p.id
    cross join lateral (
      select case
               when p_backlog and floor(extract(epoch from (now() - p.created_at)) / 86400) >= 2 then 'd2'
               when floor(extract(epoch from (now() - p.created_at)) / 86400) = 2 then 'd2'
               when floor(extract(epoch from (now() - p.created_at)) / 86400) = 7 then 'd7'
             end as etapa,
             floor(extract(epoch from (now() - p.created_at)) / 86400)::int as dias
    ) x
   where x.etapa is not null
     -- Só quem tem amostra grátis para gastar. Equipe e pagante ficam de fora: o pagante
     -- já tem o alerta de oportunidades, e a equipe não gera relatório próprio.
     and p.role = 'explorador'
     and coalesce(p.ativo, true)
     -- NÃO SE ATIVOU: nenhuma análise e nenhuma amostra consumida.
     and coalesce(p.amostra_mercado_usadas, 0) = 0
     and not exists (select 1 from public.analises_mercado a where a.user_id = p.id)
     -- CONTAS INTERNAS FORA. A retenção já nudou o próprio dono uma vez; aqui o corte é
     -- explícito e por domínio, não por confiança no papel.
     and u.email not ilike '%@reimob.com.br'
     and u.email not ilike '%@bidprobrasil.com.br'
     -- Descadastrado é descadastrado: mesmo sinal do e-mail de oportunidades.
     and not exists (select 1 from public.alertas_email ae where ae.user_id = p.id and ae.ativo = false)
     -- Ainda não recebeu ESTA etapa.
     and not exists (select 1 from public.ativacao_nudge n where n.user_id = p.id and n.etapa = x.etapa)
     -- No backlog, quem já recebeu qualquer etapa não entra de novo.
     and (not p_backlog or not exists (select 1 from public.ativacao_nudge n2 where n2.user_id = p.id))
   order by p.created_at desc
$function$;

-- SECURITY DEFINER lê auth.users: só o backend chama. Sem isso o EXECUTE fica em PUBLIC
-- por padrão e a função vira um vazador de e-mail para qualquer anon.
revoke all on function public.ativacao_nudge_candidatos(boolean) from public, anon, authenticated;
grant execute on function public.ativacao_nudge_candidatos(boolean) to service_role;

-- INTERRUPTOR no banco, não em env var: ligar/desligar vira uma linha de SQL, sem redeploy,
-- e dá para desligar às pressas no meio de um envio. Nasce DESLIGADO.
--   update public.app_config set value='true'  where key='ativacao_nudge_ativo';  -- liga
--   update public.app_config set value='false' where key='ativacao_nudge_ativo';  -- desliga
-- O env ATIVACAO_NUDGE_ATIVO=0 continua valendo como freio de mão por cima disto.
insert into public.app_config (key, value)
values ('ativacao_nudge_ativo', 'false')
on conflict (key) do nothing;

commit;
