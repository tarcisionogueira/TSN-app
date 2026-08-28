-- CONVITE DA BASE PARA A AULA AO VIVO — a trava que impede mandar duas vezes (28/08).
--
-- POR QUE EXISTE: até hoje não havia como convidar a base para uma aula. `/api/anunciar-produto`
-- só sabe anunciar curso e eBook, e `live-lembrete-cron` só fala com quem JÁ se inscreveu. O
-- convite saía na mão, um a um, ou não saía — e é ele que enche a live, não o anúncio pago
-- (R$ 40 de verba rendem 4 a 6 inscrições; a base são 72 pessoas que já conhecem a marca).
--
-- POR QUE A CHAVE TEM `edicao`, e não é só (evento_id, user_id): a aula é SEMANAL e recorrente
-- — um único `eventos_live` com `recorrencia='semanal'` serve todas as quartas. UNIQUE sem a
-- data significaria "cada pessoa pode ser convidada UMA VEZ NA VIDA", e o convite da semana
-- seguinte seria engolido em silêncio pelo 409, sem erro e sem log: exatamente a forma de
-- falha que o CLAUDE.md cataloga (a recusa entregue como sucesso). Com a data da edição, o
-- dedup vale DENTRO da semana — que é o que ele precisa proteger — e libera a próxima.
--
-- A `edicao` vem de `live_proxima()`, a MESMA função que a landing e o admin usam para dizer
-- "próxima aula". Calcular a data por conta própria no endpoint criaria uma segunda verdade
-- sobre quando é a aula, e as duas divergiriam na primeira mudança de recorrência.
--
-- CLAIM ANTES DE ENVIAR (padrão herdado de `divulgacao_envio`): a linha entra ANTES da chamada
-- ao Resend. Se o disparo for acionado duas vezes — dedo duplo no botão, retry, execução que
-- morreu no meio — a segunda colide no UNIQUE e não manda de novo. `email_ok` é atualizado
-- depois com o desfecho REAL, senão "convidado" significaria apenas "tentei".
begin;

create table if not exists public.live_convite_envio (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos_live(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  edicao     date not null,
  email_ok   boolean,
  criado_em  timestamptz not null default now(),
  unique (evento_id, user_id, edicao)
);

create index if not exists live_convite_envio_edicao_idx
  on public.live_convite_envio (evento_id, edicao);

-- RLS ligada SEM política: só a service key (o endpoint admin) enxerga. A tabela liga
-- `auth.users` a um convite de marketing — é dado de cliente, e o auditor de segurança
-- (`auditoria_seguranca()`) acusa tabela assim sem RLS.
alter table public.live_convite_envio enable row level security;

commit;
