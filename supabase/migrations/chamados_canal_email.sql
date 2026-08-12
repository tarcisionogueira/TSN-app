-- ─────────────────────────────────────────────────────────────────────────────
-- Atendimento passa a receber e-mail: suporte@/privacidade@/contato@ viram CHAMADO.
-- (12/08, pedido do dono ao preencher a verificação da G2RS)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O QUE ESTAVA ACONTECENDO, e é pior do que "faltava uma feature":
--
--   · A home publica `suporte@bidprobrasil.com.br`; os Termos e a Política de
--     Privacidade publicam `privacidade@bidprobrasil.com.br`.
--   · `api/notificar-cliente.js` responde ao cliente com
--     `reply_to: suporte@bidprobrasil.com.br` e o texto **"é só responder este
--     e-mail"**.
--   · E `api/inbound-juridico.js`, único ponto de entrada de e-mail, fazia:
--         if (!caso) return json({ ok: true, unmatched: true });
--     ou seja, TODO e-mail que não casasse com um caso jurídico era descartado —
--     com HTTP 200, sem log, sem alerta.
--
-- O sistema convidava a resposta e jogava fora. Inclui pedido de titular de dados
-- endereçado ao `privacidade@`, que a LGPD (Art. 18) obriga a atender.
--
-- ESTRUTURA:
--   chamados.canal        'app' (padrão, como sempre foi) | 'email'
--   chamados.email_token  identificador do reply-to (`suporte+<token>@`), para a
--                         resposta do cliente voltar ao MESMO chamado
--   chamados_mensagens.canal             marca a mensagem que entrou/saiu por e-mail
--   chamados_mensagens.email_message_id  Message-ID do e-mail: dedup (webhook pode
--                         reentregar) e threading por In-Reply-To/References
--
-- Os índices únicos são PARCIAIS de propósito: só valem onde a coluna existe, então
-- as 24 conversas históricas (todas 'app', sem token) não são afetadas.
-- ANTES DE TUDO: `chamados.user_id` era NOT NULL, e isso já quebrava o que existe.
-- `api/duvida.js` (formulário de dúvida da Landing, visitante sem conta) insere
-- `user_id: null` desde sempre — a linha era REJEITADA pelo banco, o `[chamado] =
-- await res.json()` estourava sobre o corpo de erro e o visitante recebia "Não foi
-- possível registrar sua dúvida agora". Medido: `sdr_leads` VAZIA e ZERO chamados com
-- segmento 'curioso'. A intenção original era aceitar nulo — a própria RLS
-- (`chamados_staff_escopo`) trata `WHEN user_id IS NULL THEN 'curioso'`. Só a
-- constraint ficou para trás. Sem isto, o e-mail que chega no inbound (também sem
-- conta) morreria do mesmo jeito.
alter table public.chamados alter column user_id drop not null;

alter table public.chamados            add column if not exists canal      text not null default 'app';
alter table public.chamados            add column if not exists email_token text;
alter table public.chamados_mensagens  add column if not exists canal      text;
alter table public.chamados_mensagens  add column if not exists email_message_id text;

create unique index if not exists chamados_email_token_uk
  on public.chamados (email_token) where email_token is not null;

-- Dedup do webhook: a MESMA mensagem reentregue não pode virar duas linhas no chat.
create unique index if not exists chamados_mensagens_email_mid_uk
  on public.chamados_mensagens (email_message_id) where email_message_id is not null;

-- Busca do chamado pelo remetente quando o e-mail não traz token nem referência
-- (cliente que escreve de novo, em vez de responder o fio anterior).
create index if not exists chamados_email_aberto_idx
  on public.chamados (user_email, status) where canal = 'email';

comment on column public.chamados.canal is
  'app = nasceu dentro do sistema (formulário/chat) · email = chegou por e-mail no inbound. Quem responde precisa saber: em canal=email a resposta SAI por e-mail.';
comment on column public.chamados.email_token is
  'Token do reply-to suporte+<token>@ — é o que faz a resposta do cliente voltar para este chamado em vez de abrir outro.';
