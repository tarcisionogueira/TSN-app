-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Resposta ao e-mail enviado volta para a CAIXA, não para o Gmail de quem enviou — 23/09/2026
--
-- Pedido do dono: "meu e-mail deve ser capaz de receber de volta mensagens e não devolver ao
-- e-mail da reimob". O botão "Enviar e-mail" do caso/lote usava reply-to = e-mail pessoal do
-- remetente: a resposta do leiloeiro ia para fora do sistema.
--
-- Agora cada envio leva reply-to `resposta+<resposta_token>@bidprobrasil.com.br`. O inbound
-- reconhece o token, grava a resposta na caixa com `resposta_de` = e-mail original, e NÃO abre
-- chamado (resposta de leiloeiro/jurídico a um contato nosso não é atendimento de cliente).
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.email_caixa add column if not exists resposta_token text;
alter table public.email_caixa add column if not exists resposta_de uuid references public.email_caixa(id) on delete set null;
create unique index if not exists email_caixa_resposta_token_uq on public.email_caixa (resposta_token) where resposta_token is not null;
create index if not exists email_caixa_resposta_de_idx on public.email_caixa (resposta_de) where resposta_de is not null;
