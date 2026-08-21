-- ═══════════════════════════════════════════════════════════════════════════════
-- CONSULTOR COMERCIAL — FASE 4: Atendimento com escopo do parceiro.
-- O chamado que o api/duvida abre para a aplicação de alavancagem ganha o VÍNCULO
-- com o lead (chamados.lead_id) e o parceiro comercial passa a ver/atender SÓ os
-- chamados dos leads dele — por RLS, não por filtro de tela.
--
-- A autorização é a POSSE DO LEAD (l.consultor_id = auth.uid()): só quem tem a
-- capacidade comercial recebe lead (admin_comercial_atribuir/?ref validam), então
-- a posse já embute a capacidade — sem join extra com perfis. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.chamados add column if not exists lead_id uuid references public.sdr_leads(id);
create index if not exists chamados_lead_idx on public.chamados (lead_id);

-- Parceiro comercial: vê e ATENDE (update/assumir/finalizar + mensagens) os chamados
-- dos próprios leads. FOR ALL: o with check herda o using — ele não consegue mover um
-- chamado para fora do próprio escopo.
drop policy if exists chamados_consultor_comercial on public.chamados;
create policy chamados_consultor_comercial on public.chamados for all using (
  lead_id is not null and exists (
    select 1 from public.sdr_leads l where l.id = chamados.lead_id and l.consultor_id = (select auth.uid()))
);
drop policy if exists mensagens_consultor_comercial on public.chamados_mensagens;
create policy mensagens_consultor_comercial on public.chamados_mensagens for all using (
  exists (
    select 1 from public.chamados c join public.sdr_leads l on l.id = c.lead_id
     where c.id = chamados_mensagens.chamado_id and l.consultor_id = (select auth.uid()))
);

-- Backfill dos chamados de alavancagem que nasceram ANTES do vínculo: o título vem do
-- formulário ("Interesse em Home Equity/Consórcio…") e o e-mail casa com o lead.
update public.chamados c
   set lead_id = l.id
  from public.sdr_leads l
 where c.lead_id is null
   and l.origem like 'alavancagem_%'
   and c.titulo ilike 'Interesse em %'
   and lower(c.user_email) = lower(l.email);
