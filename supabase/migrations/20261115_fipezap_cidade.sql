-- 15/11 — FIPEZAP OFICIAL POR CIDADE (arena #484, item 5). Gravado por scripts/fipezap-ingerir.mjs (Action
-- fipezap-ingerir.yml) a partir da série histórica pública da Fipe. Serve SÓ de alarme no Índice (api/indice-consulta.js):
-- não entra no valor. O "FipeZAP" que a pesquisa da IA declarava (amostra sintética em indice_amostra) não serve de régua:
-- Salvador a R$ 12.434/m² com 2 valores, Goiânia "casa" (o FipeZAP residencial é de apartamentos).
create table if not exists public.fipezap_cidade (
  cidade_norm text not null,          -- mesmo formato de indice_amostra.cidade_norm (sem acento/espaço: 'saopaulo')
  uf text not null,
  mes date not null,                  -- 1º dia do mês de referência
  venda_m2 numeric,                   -- preço médio de venda residencial (R$/m²)
  locacao_m2 numeric,                 -- preço médio de locação residencial (R$/m²·mês), quando a série traz
  cidade_rotulo text,                 -- nome como a Fipe escreve (auditoria do casamento)
  atualizado_em timestamptz not null default now(),
  primary key (cidade_norm, uf, mes)
);
alter table public.fipezap_cidade enable row level security;   -- sem política: só service_role
revoke all on public.fipezap_cidade from anon, authenticated;
