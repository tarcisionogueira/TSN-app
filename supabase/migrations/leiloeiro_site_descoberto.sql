-- Cache de "site do leiloeiro descoberto por busca" (22/09, pedido do dono: "com o nome do
-- leiloeiro e talvez CNPJ, conseguimos buscar os sites"). O DJEN não publica CNPJ, mas
-- publica nome + às vezes o registro na junta comercial (JUCESP/similar, já extraído em
-- editais_leilao.leiloeiro_jucesp). `api/radar-editais-cron.js` usa isso pra buscar (Claude
-- web_search) e SÓ grava se a própria página encontrada confirmar o nome/registro no
-- conteúdo — nunca confia no resultado cru da busca.
--
-- Existe pra NUNCA buscar o mesmo leiloeiro duas vezes (custo de web_search é por chamada,
-- e o mesmo nome aparece em várias editais/dias) — inclusive quando a busca NÃO encontra
-- nada de confiável: sem essa linha "tentado e não achou", o cron re-tentaria pra sempre.
create table if not exists public.leiloeiro_site_descoberto (
  leiloeiro_nome_norm text primary key,
  leiloeiro_nome text not null,
  jucesp text,
  url text,               -- null = buscou e não achou/não validou
  validado boolean not null default false,
  motivo text,            -- por que aceitou ou rejeitou (auditável, não "confiar e esquecer")
  tentado_em timestamptz not null default now()
);

comment on table public.leiloeiro_site_descoberto is
  'Cache de descoberta de site de leiloeiro por nome (web_search) para EDITAL_DJEN sem leilao_plataforma_url. Uma linha por leiloeiro_nome_norm, mesmo quando não encontra nada — evita re-buscar.';

alter table public.leiloeiro_site_descoberto enable row level security;
-- Só o servidor (service role) lê/escreve — não tem uso de cliente, é cache interno do cron.
create policy "leiloeiro_site_descoberto_service_only" on public.leiloeiro_site_descoberto
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
