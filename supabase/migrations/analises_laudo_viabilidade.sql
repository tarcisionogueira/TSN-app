-- AGENTE DE DEFESA / LAUDO DE VIABILIDADE (3º documento).
-- Consolida o relatório MERCADOLÓGICO (analises_mercado) + o DOCUMENTAL/JURÍDICO
-- (analises_documental) num parecer final de defesa/veredito. NÃO reprocessa
-- fontes pagas (Bright Data / web search): lê apenas os dois relatórios já
-- gerados e faz uma única passada de IA. Persistente, igual aos outros dois.

create table if not exists public.analises_laudo (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  imovel_id   text not null,
  titulo      text,
  cidade      text,
  estado      text,
  imovel      jsonb,
  inputs      jsonb,
  status      text not null default 'gerando',   -- gerando | concluida | erro
  result      jsonb,
  erro        text,
  data_leilao timestamptz,
  arrematado  boolean default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, imovel_id)
);

alter table public.analises_laudo enable row level security;

-- Dono lê/gera/apaga o seu; equipe (admin/analista/consultor/advogado) lê tudo.
drop policy if exists al_select on public.analises_laudo;
create policy al_select on public.analises_laudo for select using (auth.uid() = user_id);
drop policy if exists al_select_staff on public.analises_laudo;
create policy al_select_staff on public.analises_laudo for select using (
  exists (select 1 from public.perfis where perfis.id = auth.uid()
          and perfis.role = any (array['admin','analista','consultor','advogado']))
);
drop policy if exists al_insert on public.analises_laudo;
create policy al_insert on public.analises_laudo for insert with check (auth.uid() = user_id);
drop policy if exists al_update on public.analises_laudo;
create policy al_update on public.analises_laudo for update using (auth.uid() = user_id);
drop policy if exists al_delete on public.analises_laudo;
create policy al_delete on public.analises_laudo for delete using (auth.uid() = user_id);

-- LOOP DE APRENDIZADO do agente de defesa: o analista, ao dar o parecer da reunião,
-- pode corrigir o veredito/argumentos da IA — essas correções voltam ao prompt
-- (como já acontece no jurídico via juridico_aprendizado). Sem devolutivas, é no-op.
create table if not exists public.laudo_aprendizado (
  id            uuid primary key default gen_random_uuid(),
  imovel_id     text,
  veredito_ia   text,
  veredito_real text,
  observacao    text,
  criado_por    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now()
);
alter table public.laudo_aprendizado enable row level security;
-- Só a equipe registra e lê o aprendizado (o servidor usa service key, ignora RLS).
drop policy if exists la_staff on public.laudo_aprendizado;
create policy la_staff on public.laudo_aprendizado for all using (
  exists (select 1 from public.perfis where perfis.id = auth.uid()
          and perfis.role = any (array['admin','analista','consultor','advogado']))
) with check (
  exists (select 1 from public.perfis where perfis.id = auth.uid()
          and perfis.role = any (array['admin','analista','consultor','advogado']))
);
