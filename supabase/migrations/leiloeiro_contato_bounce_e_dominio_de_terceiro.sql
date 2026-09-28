-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CONTATO DE LEILOEIRO: DESCARTE AUTOMÁTICO POR BOUNCE + LIMPEZA DOS DE TERCEIRO — 28/09/2026
--
-- Gatilho do achado: "Contato — FORD" para contato@jrfleiloes.com.br voltou em bounce (25/09).
-- O bounce era SINTOMA. `leiloeiro_contato` é por FONTE, e o coletor automático
-- (_contato-leiloeiro.mjs) guardava o 1º e-mail que achasse na home — em plataforma
-- multi-tenant isso é o e-mail de UM tenant em destaque, não "o leiloeiro":
--   SUPERBID  (1.392 imóveis + 6.851 veículos, dezenas de leiloeiros) → contato@jrfleiloes.com.br
--   SBID9/21  → contato@dantasleiloes.com.br
--   HASTAPUBLICA (48 leiloeiros)                                      → contato@valland.com.br
--   MEGA      → thiagovidal@othis.com.br (meta "copyright": a AGÊNCIA que fez o site)
-- Medido: 6 e-mails de veículos de leiloeiros diversos do SUPERBID foram para a JRF, 5
-- "entregues" — a quem não tem nada com o lote. Forma #10 do CLAUDE.md: o campo se chama
-- "contato do leiloeiro" e mede "primeiro e-mail que apareceu na página".
--
-- Contramedidas:
--   1. coletor só aceita e-mail do MESMO domínio do site (ou provedor gratuito via mailto:), e
--      nunca um endereço suprimido (JS, _contato-leiloeiro.mjs);
--   2. endereço que entra em supressão (bounce permanente, 3 transitórios seguidos ou
--      reclamação) sai de `leiloeiro_contato` NA HORA — o próximo envio pede o e-mail certo
--      em vez de o gate barrar em silêncio;
--   3. os 5 contatos de terceiro de hoje saem, com registro (reversível pela tabela abaixo).
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.leiloeiro_contato_descartado (
  id            bigint generated always as identity primary key,
  fonte         text not null,
  email         text not null,
  origem        text,
  observacao    text,
  motivo        text not null,
  descartado_em timestamptz not null default now()
);
-- E-mail de terceiro: RLS sem política, só a service key lê (mesma regra de emails_supressao).
alter table public.leiloeiro_contato_descartado enable row level security;

create or replace function public.leiloeiro_contato_descartar_suprimido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.suprimido and not coalesce(old.suprimido, false) then
    with fora as (
      delete from public.leiloeiro_contato c where lower(btrim(c.email)) = lower(btrim(new.destinatario))
      returning c.fonte, c.email, c.origem, c.observacao
    )
    insert into public.leiloeiro_contato_descartado (fonte, email, origem, observacao, motivo)
    select fonte, email, origem, observacao, 'suprimido: ' || coalesce(new.motivo, '?') from fora;
  end if;
  return new;
end $$;
revoke all on function public.leiloeiro_contato_descartar_suprimido() from public, anon, authenticated;

drop trigger if exists leiloeiro_contato_descartar_suprimido on public.emails_supressao;
create trigger leiloeiro_contato_descartar_suprimido
  after insert or update of suprimido on public.emails_supressao
  for each row execute function public.leiloeiro_contato_descartar_suprimido();

-- Limpeza: os 5 automáticos cujo domínio não é o do site da fonte (lista medida acima).
with fora as (
  delete from public.leiloeiro_contato c
   where c.origem = 'auto'
     and (c.fonte, lower(c.email)) in (('SUPERBID','contato@jrfleiloes.com.br'), ('SBID9','contato@dantasleiloes.com.br'),
          ('SBID21','contato@dantasleiloes.com.br'), ('HASTAPUBLICA','contato@valland.com.br'), ('MEGA','thiagovidal@othis.com.br'))
  returning c.fonte, c.email, c.origem, c.observacao
)
insert into public.leiloeiro_contato_descartado (fonte, email, origem, observacao, motivo)
select fonte, email, origem, observacao, 'dominio_de_terceiro (limpeza 28/09)' from fora;
