-- Garantia de 7 dias é UMA VEZ POR CPF (evita o loop assinar→reembolsar→assinar→
-- reembolsar, inclusive recriando conta com o mesmo CPF). Guarda o hash do CPF em cada
-- reembolso; a rota /api/garantia-cancelar barra um novo reembolso do mesmo CPF.
alter table public.reembolsos_garantia add column if not exists cpf_hash text;
create index if not exists idx_reembolsos_garantia_cpf_hash on public.reembolsos_garantia (cpf_hash);
