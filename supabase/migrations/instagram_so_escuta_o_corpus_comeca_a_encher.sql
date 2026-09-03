-- 01/09 — ManyChat próprio, passo 1: SÓ-ESCUTA. As tabelas antes do bot.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- POR QUE ESTA PARTE VEM PRIMEIRO, e não é escolha de gosto (docs/INSTAGRAM_AUTOMACAO.md §3):
-- o histórico de DM do Instagram **não é exportável em massa pela API**. Só se aprende do dia
-- em que o webhook subir em diante. E `message_echoes` entrega as mensagens enviadas PELA
-- conta — inclusive as que o dono digita à mão no app. O corpus do jeito dele de responder
-- se captura sozinho, mas só a partir de agora: cada dia com o webhook desligado é um dia de
-- exemplo que não volta. A burocracia da Meta (Verificação de Negócio + App Review) leva
-- semanas; ela corre em paralelo, o corpus não pode esperar por ela.
--
-- ─── AS TABELAS SÃO SÓ-DO-SERVIDOR, E A REVOGAÇÃO É A LIÇÃO DE HOJE MAIS CEDO ──────────
-- `tabelas_so_do_servidor_perdem_o_grant_de_escrita.sql` (01/09) mostrou que tabela nova
-- nasce com o default do Supabase: anon E authenticated com DELETE/INSERT/UPDATE/TRUNCATE,
-- segurados só pela RLS. Aqui isso seria pior que nas outras seis, porque `ig_mensagens`
-- guarda conteúdo de DM — dado pessoal de TERCEIRO, que nunca teve conta no BidPro. Então a
-- revogação vem no mesmo arquivo da criação, não numa migração de conserto depois.
-- Efeito colateral bem-vindo: `auditoria_uso()` não vai acusar estas três, porque a
-- pré-condição dele é `has_table_privilege('authenticated', INSERT)`.
--
-- ─── LGPD: RETENÇÃO ANTES DE GRAVAR, E COMO MECANISMO ────────────────────────────────
-- A spec (§7.3) manda "definir retenção e finalidade ANTES de gravar". Finalidade está no
-- `comment on table`. Retenção está em `ig_limpar_antigas()`, chamada pelo
-- `limpar-eventos-cron` que já roda 1×/dia — porque retenção que depende de alguém lembrar
-- é promessa, e este repositório já aprendeu (`live-lembrete-cron`) o que acontece quando uma
-- promessa é entregue no lugar de um mecanismo.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. ig_conversas — uma linha por pessoa
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ig_conversas (
  ig_user_id           text primary key,
  username             text,
  primeiro_contato_em  timestamptz not null default now(),
  ultima_msg_deles_em  timestamptz,
  estado               text not null default 'bot'
                         check (estado in ('bot', 'humano', 'pausado')),
  lead_preenchido      boolean not null default false,
  resumo               text,
  atualizado_em        timestamptz not null default now()
);

comment on table public.ig_conversas is
  'Instagram DM/comentário: uma linha por pessoa. Finalidade: atender e qualificar quem procura '
  'a conta @tarcisionogueiraleiloes. Só-servidor. Retenção via ig_limpar_antigas().';

-- `ultima_msg_deles_em` é a coluna que governa a janela de 24 h da Meta — só se responde
-- automaticamente até 24 h depois da última mensagem DA PESSOA. Ela conta a partir da
-- mensagem RECEBIDA; echo do dono não reabre janela nenhuma, e por isso o webhook só a
-- atualiza em `direcao = 'recebida'`.
comment on column public.ig_conversas.ultima_msg_deles_em is
  'Última mensagem DA PESSOA. Governa a janela de 24h da Meta — nunca atualizar com echo nosso.';

comment on column public.ig_conversas.estado is
  'bot = automação responde · humano = o dono assumiu (lead preenchido) · pausado = não responder.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. ig_mensagens — o corpus e o histórico
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ig_mensagens (
  id          bigint generated always as identity primary key,
  mid         text not null unique,
  ig_user_id  text not null,
  direcao     text not null check (direcao in ('recebida', 'enviada')),
  origem      text not null check (origem in ('dm', 'comentario', 'story')),
  autor       text not null check (autor in ('pessoa', 'bot', 'dono')),
  texto       text,
  respondida  boolean not null default false,
  criado_em   timestamptz not null default now()
);

comment on table public.ig_mensagens is
  'Mensagens do Instagram (DM, comentário, resposta de story). Conteúdo de DM é dado pessoal '
  'de terceiro — retenção de 180 dias por ig_limpar_antigas(). Só-servidor.';

-- ⚠️ `autor` separa `bot` de `dono` DE PROPÓSITO, e é o campo que faz o treino funcionar:
-- sem ele o bot aprenderia com as próprias respostas e derivaria — o modelo reforçando o
-- próprio estilo, cada vez mais longe do original.
--
-- E a separação NÃO se faz lendo o echo, porque o echo de uma mensagem do bot é idêntico ao
-- de uma mensagem digitada à mão. Ela se faz pelo `mid`: quem ENVIA pelo bot grava a linha
-- com `autor = 'bot'` e o `mid` que a Send API devolveu; quando o echo chega, ele bate no
-- UNIQUE e é ignorado. Todo echo que SOBRA é, por construção, do dono. Hoje, sem bot
-- nenhum, isso é trivialmente verdade — o desenho existe para continuar verdade depois.
comment on column public.ig_mensagens.autor is
  'pessoa | bot | dono. O treino usa SÓ `dono` — treinar com `bot` faz o modelo reforçar a si '
  'mesmo. A distinção vem do UNIQUE em `mid` (quem envia grava antes; o echo é ignorado).';

comment on column public.ig_mensagens.mid is
  'Id da mensagem na Meta. UNIQUE = idempotência: a Meta REENTREGA o lote inteiro quando o '
  'webhook não responde 200, e é isto que torna seguro devolver erro numa gravação que falhou.';

create index if not exists ig_mensagens_conversa_idx
  on public.ig_mensagens (ig_user_id, criado_em desc);

-- Índice do corpus de treino: "o que o DONO escreveu, mais recente primeiro".
create index if not exists ig_mensagens_corpus_idx
  on public.ig_mensagens (criado_em desc) where autor = 'dono';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. ig_oferta_vigente — o que o bot direciona HOJE
-- ─────────────────────────────────────────────────────────────────────────────────────
-- TABELA, não prompt fixo. A oferta muda (a aula de 02/09 agora, outra coisa em outubro) e o
-- comportamento tem de mudar SEM DEPLOY — mesmo padrão dormente do Pixel e do SITEMAP_LOTES.
create table if not exists public.ig_oferta_vigente (
  id         bigint generated always as identity primary key,
  titulo     text not null,
  link       text not null,
  intencao   text not null,
  inicio     timestamptz not null default now(),
  fim        timestamptz,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

comment on table public.ig_oferta_vigente is
  'O que a automação do Instagram direciona hoje. Tabela e não prompt fixo: a oferta muda sem deploy.';

comment on column public.ig_oferta_vigente.intencao is
  'O que se quer que a pessoa FAÇA (ex.: "se inscrever na aula de quarta"). É o que orienta a '
  'resposta — sem isso o bot manda link e não sabe para quê.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. ig_webhook_recebido — a PROVA de que a escuta está escutando
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Esta tabela existe por causa da forma de falha nº 1 do CLAUDE.md, aplicada ao caso aqui:
-- um webhook que recebe um formato que não conhece, devolve 200 e não grava nada fica
-- **idêntico, por fora, a um webhook que ninguém está chamando**. Nos dois casos
-- `ig_mensagens` fica vazia e nada dá erro. Semanas depois, na hora de treinar, o corpus
-- estaria vazio e a causa seria indistinguível.
--
-- Então toda entrega deixa uma linha, com a contagem do que foi RECONHECIDO e do que não
-- foi — e o payload cru é guardado SÓ quando algo não foi reconhecido (guardar sempre seria
-- estocar DM em dobro, sem finalidade).
create table if not exists public.ig_webhook_recebido (
  id                bigint generated always as identity primary key,
  recebido_em       timestamptz not null default now(),
  campos            text[],
  gravadas          int not null default 0,
  nao_reconhecidos  int not null default 0,
  bruto             jsonb,
  erro              text
);

comment on table public.ig_webhook_recebido is
  'Uma linha por entrega da Meta. Distingue "ninguém está chamando o webhook" de "está chamando '
  'e eu não entendo o formato" — por fora os dois deixam ig_mensagens vazia. `bruto` só é '
  'preenchido quando nao_reconhecidos > 0.';

create index if not exists ig_webhook_recebido_recente_idx
  on public.ig_webhook_recebido (recebido_em desc);

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. RLS + revogação da escrita (as quatro são só-do-servidor)
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.ig_conversas        enable row level security;
alter table public.ig_mensagens        enable row level security;
alter table public.ig_oferta_vigente   enable row level security;
alter table public.ig_webhook_recebido enable row level security;

-- Sem política nenhuma: RLS ligada e sem política nega tudo para anon/authenticated, e a
-- SERVICE_KEY (service_role) passa por cima da RLS por definição. Nenhuma tela do navegador
-- lê ou escreve nestas tabelas hoje — quando o painel do dono existir, ele entra por RPC
-- SECURITY DEFINER com checagem de admin, não por política ampla.
revoke insert, update, delete, truncate on public.ig_conversas        from anon, authenticated;
revoke insert, update, delete, truncate on public.ig_mensagens        from anon, authenticated;
revoke insert, update, delete, truncate on public.ig_oferta_vigente   from anon, authenticated;
revoke insert, update, delete, truncate on public.ig_webhook_recebido from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. Retenção — o mecanismo, não a promessa
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.ig_limpar_antigas(dias int default 180)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_msg int;
  n_log int;
  n_conv int;
begin
  delete from public.ig_mensagens where criado_em < now() - make_interval(days => dias);
  get diagnostics n_msg = row_count;

  -- O log de entregas é diagnóstico, não corpus: 30 dias bastam para responder "o webhook
  -- está sendo chamado?" e evitam guardar payload cru mais tempo do que o necessário.
  delete from public.ig_webhook_recebido where recebido_em < now() - interval '30 days';
  get diagnostics n_log = row_count;

  -- Conversa sem NENHUMA mensagem restante não tem mais o que atender: some junto. Não usa
  -- `ultima_msg_deles_em` como critério porque essa coluna é nula em conversa que só teve
  -- comentário — apagaria por ausência de dado, não por idade.
  delete from public.ig_conversas c
   where not exists (select 1 from public.ig_mensagens m where m.ig_user_id = c.ig_user_id);
  get diagnostics n_conv = row_count;

  return jsonb_build_object('mensagens', n_msg, 'log', n_log, 'conversas', n_conv, 'dias', dias);
end;
$$;

comment on function public.ig_limpar_antigas(int) is
  'Retenção LGPD do acervo de Instagram: 180 dias de mensagem, 30 dias de log de entrega. '
  'Chamada por api/limpar-eventos-cron.js.';

revoke all on function public.ig_limpar_antigas(int) from public, anon, authenticated;
