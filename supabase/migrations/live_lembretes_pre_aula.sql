-- ── LEMBRETE PRÉ-AULA: a prova de que já mandamos ────────────────────────────
-- 28/08. O e-mail de confirmação da aula prometia, por escrito, "o lembrete antes de
-- começar" — e não existia cron nenhum que o enviasse (conferido nos 56 agendados). A
-- pessoa se inscrevia, recebia a confirmação e ficava em SILÊNCIO até o dia. Pior: o
-- `link_sala` do evento nunca era sequer LIDO em `api/live-inscrever.js`, então o
-- endereço da sala dependia de duas coisas manuais — a pessoa entrar no grupo do
-- WhatsApp, e alguém lembrar de postar o link lá. Promessa entregue como se fosse
-- mecanismo, e sobre tráfego pago.
--
-- Esta tabela é o DEDUP do cron `api/live-lembrete-cron.js`, e existe por um motivo só:
-- e-mail que já saiu não volta. O cron roda de hora em hora e a janela de cada etapa é
-- larga de propósito (para sobreviver a uma execução perdida), então sem esta prova a
-- mesma pessoa receberia o mesmo lembrete a cada hora dentro da janela.
--
-- A CHAVE É (evento, e-mail, etapa) E NÃO O id DA INSCRIÇÃO. Parece detalhe e não é: em
-- 27/08 as duas inscrições de teste foram gravadas (o log da API mostra POST 201 e 200)
-- e depois removidas direto no banco. Se o dedup pendurasse no id da inscrição, uma
-- limpeza dessas apagaria junto a memória do que já foi enviado — e o reenvio sairia
-- como se fosse a primeira vez. O par (evento, e-mail) é a identidade que sobrevive à
-- linha, e é ela que descreve o que o destinatário já viu na caixa de entrada.
create table if not exists public.live_lembretes (
  id           bigserial primary key,
  evento_id    uuid not null references public.eventos_live(id) on delete cascade,
  email        text not null,
  etapa        text not null,           -- 'vespera' (~1 dia antes) | 'agora' (~1h antes)
  inscricao_id uuid,                    -- rastro, NÃO é a chave: a inscrição pode sumir
  enviado_em   timestamptz not null default now(),
  unique (evento_id, email, etapa)
);

create index if not exists idx_live_lembretes_evento on public.live_lembretes(evento_id, etapa);

-- Guarda e-mail de inscrito: é PII. RLS ligada e NENHUMA política — só o servidor
-- (service key, que ignora RLS) escreve e lê. É a mesma postura de `live_inscricoes`,
-- e é o que o `auditoria_seguranca()` cobra de toda tabela nova com dado pessoal.
alter table public.live_lembretes enable row level security;

comment on table public.live_lembretes is
  'Prova de envio do lembrete pré-aula (api/live-lembrete-cron.js). Chave (evento,email,etapa): '
  'sobrevive a limpeza da linha de inscricao, porque o que se deduplica e a caixa de entrada '
  'do destinatario, nao a linha do banco. Apagar uma linha daqui FAZ o lembrete ser reenviado '
  '— e e assim que se testa o fluxo de novo.';
