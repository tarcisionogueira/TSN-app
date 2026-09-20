-- Auditoria do botão "Enviar e-mail" do caso (pedido do dono, 20/09): um clique anexa todos
-- os documentos do LOTE (imoveis_leilao.anexos) e, quando o cliente é assessorado, também os
-- documentos PESSOAIS dele (usuario_docs) — e o remetente escolhe entre enviar ao JURÍDICO
-- (juridico_destinatarios, mesma resolução de api/enviar-juridico-email.js) ou ao LEILOEIRO
-- do lote (leiloeiro_contato, mesmo padrão de api/propor-veiculo-leiloeiro.js). Ver
-- api/enviar-email-caso.js. Igual a `veiculo_propostas_leiloeiro`: só o servidor (service_role)
-- escreve ou lê — nenhum acesso direto do cliente.
create table if not exists public.caso_emails_enviados (
  id bigserial primary key,
  caso_id uuid not null references public.casos(id) on delete cascade,
  destino text not null,                 -- 'juridico' | 'leiloeiro'
  destinatario_email text,
  enviado_por uuid references auth.users(id),
  anexos_lote int not null default 0,
  anexos_pessoais int not null default 0,
  texto_enviado text,
  resend_id text,
  status text not null,                  -- 'enviado' | 'falha' | 'sem_contato'
  criado_em timestamptz default now()
);
create index if not exists idx_caso_emails_enviados_caso on public.caso_emails_enviados (caso_id);
alter table public.caso_emails_enviados enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='caso_emails_enviados' and policyname='service_only_caso_emails_enviados') then
    execute 'create policy service_only_caso_emails_enviados on public.caso_emails_enviados for all using (false)';
  end if;
end $$;
