-- 23/10 (pedido do dono): leilão de VEÍCULOS entra no perfil do investidor e no e-mail de oportunidades
-- (10 imóveis + 5 veículos). Quem não responde o perfil é modelado pelo clique no próprio e-mail.
--
-- perfis.interesse_veiculos: 'carro' | 'moto' | 'carro_moto' | 'pesado' (caminhão/utilitário/ônibus) | 'nao'.
--   NULO = não respondeu → o e-mail testa poucos veículos e aprende com o clique (api/_curadoria-veiculos.js).
-- perfis.veiculo_finalidade: 'uso' (rodar) | 'revenda' | 'recuperar' (aceita sinistro/sucata).
--   Só 'recuperar' recebe sucata: ~25% dos carros ativos são sucata, e mandar isso a quem quer rodar
--   é o "terreno para quem quer morar" dos veículos.
-- Os dois ficam FORA de proteger_campos_sensiveis_perfil de propósito: é resposta do próprio cliente.
alter table public.perfis add column if not exists interesse_veiculos text
  check (interesse_veiculos in ('carro', 'moto', 'carro_moto', 'pesado', 'nao'));
alter table public.perfis add column if not exists veiculo_finalidade text
  check (veiculo_finalidade in ('uso', 'revenda', 'recuperar'));

-- Rastro do e-mail para VEÍCULO: o que foi enviado (dedup 30 d) e o que foi clicado (aprendizado).
-- Tabela própria porque alertas_enviados/feedback_imovel apontam para imoveis_leilao.
create table if not exists public.veiculos_email_sinal (
  id bigserial primary key,
  user_id uuid not null references public.perfis(id) on delete cascade,
  veiculo_id uuid not null references public.veiculos_leilao(id) on delete cascade,
  sinal text not null check (sinal in ('enviado', 'clique')),
  contexto text,
  criado_em timestamptz not null default now(),
  unique (user_id, veiculo_id, sinal)
);
create index if not exists veiculos_email_sinal_user_idx on public.veiculos_email_sinal (user_id, criado_em desc);
alter table public.veiculos_email_sinal enable row level security;
revoke all on public.veiculos_email_sinal from anon, authenticated;

-- 12 imóveis → 10 imóveis + 5 veículos (15 bens). Dado, não código: editável em app_config sem deploy.
update public.app_config
   set value = (value::jsonb || '{"itens_padrao": 10, "itens_veiculos": 5}'::jsonb)::text, updated_at = now()
 where key = 'cadencia_email';
