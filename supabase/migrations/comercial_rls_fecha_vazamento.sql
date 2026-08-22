-- 22/08 — Fecha o vazamento do escopo comercial (bug bounty de abertura).
-- Três buracos de RLS no sistema do consultor comercial (F1/F4), todos confirmados por leitura.
-- As capturas (api/duvida, api/sdr-capturar) usam a SERVICE KEY (bypassam RLS) e nenhuma tela
-- escreve em sdr_leads com a anon key (só SELECT: Consultor.jsx, Admin.jsx) — então apertar as
-- policies abaixo NÃO quebra o fluxo. Idempotente.

-- (1) sdr_leads — remove o INSERT público irrestrito.
-- `leads_insercao_publica WITH CHECK (true)` deixava QUALQUER um inserir lead com o
-- consultor_id/resultado à escolha e FABRICAR pipeline: "recebe" e finaliza como 'ganho' pelas
-- RPCs legítimas e os 5 invariantes da F6 não pegam — o insert forjado entra no CSV "prova
-- datada" para a financeira como se fosse pipeline real. Nada no front usa essa policy.
drop policy if exists leads_insercao_publica on public.sdr_leads;

-- (2) sdr_leads — segmenta o FOR ALL de equipe.
-- `leads_equipe FOR ALL (role in admin,analista,consultor)` dava a analista/consultor: leitura
-- de TODO contato (whatsapp/email) sem passar pelo "Receber", reatribuição de carteira sem gerar
-- o evento 'atribuido', e DELETE — que, por `on delete cascade`, apaga junto a trilha
-- append-only e o NPS. Quebra as duas promessas do modelo (contato só após Receber; trilha
-- imutável), que só valiam para quem entra pela RPC.
drop policy if exists leads_equipe on public.sdr_leads;
-- admin: acesso total (é o operador de confiança).
create policy leads_admin on public.sdr_leads for all
  using  (exists (select 1 from public.perfis where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from public.perfis where id = (select auth.uid()) and role = 'admin'));
-- analista: só LEITURA (dashboards do Admin). Não escreve nem apaga direto na tabela.
create policy leads_analista_leitura on public.sdr_leads for select
  using (exists (select 1 from public.perfis where id = (select auth.uid()) and role = 'analista'));
-- consultor/parceiro: LÊ só os próprios leads (Consultor.jsx:112 filtra por consultor_id).
-- Toda escrita/atribuição continua exclusivamente pelas RPCs definer — a tela não escreve.
create policy leads_dono_leitura on public.sdr_leads for select
  using (consultor_id = (select auth.uid()));

-- (3) chamados/mensagens do parceiro (F4) — tira DELETE e edição de mensagem.
-- O `for all` incluía DELETE de chamado e UPDATE/DELETE de mensagem: o parceiro podia apagar o
-- chamado do cliente dele e reescrever/apagar mensagens já trocadas (inclusive as do cliente),
-- sem prova — a trilha de sdr_lead_eventos não guarda o conteúdo do chamado. O parceiro precisa
-- de SELECT + UPDATE no chamado (assumir/finalizar) e SELECT + INSERT na mensagem (responder).
drop policy if exists chamados_consultor_comercial on public.chamados;
create policy chamados_consultor_comercial_sel on public.chamados for select using (
  lead_id is not null and exists (
    select 1 from public.sdr_leads l where l.id = chamados.lead_id and l.consultor_id = (select auth.uid())));
create policy chamados_consultor_comercial_upd on public.chamados for update
  using (
    lead_id is not null and exists (
      select 1 from public.sdr_leads l where l.id = chamados.lead_id and l.consultor_id = (select auth.uid())))
  with check (
    lead_id is not null and exists (
      select 1 from public.sdr_leads l where l.id = chamados.lead_id and l.consultor_id = (select auth.uid())));

drop policy if exists mensagens_consultor_comercial on public.chamados_mensagens;
create policy mensagens_consultor_comercial_sel on public.chamados_mensagens for select using (
  exists (select 1 from public.chamados c join public.sdr_leads l on l.id = c.lead_id
     where c.id = chamados_mensagens.chamado_id and l.consultor_id = (select auth.uid())));
create policy mensagens_consultor_comercial_ins on public.chamados_mensagens for insert with check (
  exists (select 1 from public.chamados c join public.sdr_leads l on l.id = c.lead_id
     where c.id = chamados_mensagens.chamado_id and l.consultor_id = (select auth.uid())));
