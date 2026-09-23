-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Caixa de e-mail: ENTREGUE / ABERTO / CLICADO nos Enviados — 23/09/2026 (pedido do dono)
--
-- "Sinalizar se o destinatário abrir o e-mail." O Resend já manda email.delivered/opened/
-- clicked/bounced para /api/resend-webhook, que carimba `emails_log`. A caixa passa a guardar
-- os mesmos carimbos (casados por resend_email_id) para a tela mostrar sem outra consulta.
-- Aviso de leitura: abertura depende de o cliente de e-mail carregar imagens — Apple Mail
-- (proteção de privacidade) pode marcar "aberto" sem leitura, e quem bloqueia imagens nunca
-- aparece como aberto. "Aberto" é sinal forte; "não aberto" NÃO prova que não leu.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.email_caixa add column if not exists entregue_em timestamptz;
alter table public.email_caixa add column if not exists aberto_em timestamptz;
alter table public.email_caixa add column if not exists clicado_em timestamptz;
alter table public.email_caixa add column if not exists entrega_status text;  -- entregue|bounce|reclamacao
create index if not exists email_caixa_resend_idx on public.email_caixa (resend_email_id) where resend_email_id is not null;

-- Backfill do que o emails_log já sabe.
update public.email_caixa c set entregue_em = l.entregue_em, aberto_em = l.aberto_em, clicado_em = l.clicado_em,
       entrega_status = case when l.status in ('entregue','bounce','reclamacao') then l.status end
  from public.emails_log l
 where c.direcao = 'saida' and c.resend_email_id is not null and l.resend_id = c.resend_email_id;
