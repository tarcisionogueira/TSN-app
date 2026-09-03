-- 01/09 — Motor do ManyChat próprio, peça 1: A FILA QUE SABE QUE HORAS SÃO.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Esta é a primeira peça do motor, e é a que mais importa acertar, porque o defeito dela
-- não dá erro: uma fila que envelhece em silêncio **queima a janela** e nada acusa. Fica
-- idêntica, por fora, a uma fila vazia — que é a assinatura de falha nº 1 do CLAUDE.md.
--
-- ─── A FILA NÃO É POR ORDEM DE CHEGADA. É POR VENCIMENTO. ─────────────────────────────
-- São DOIS relógios, e eles não são o mesmo:
--
--   comentário → 7 dias, contados do COMENTÁRIO, e **uma DM por comentário, para sempre**.
--                A private reply é a única forma sancionada de mandar a primeira mensagem
--                a quem nunca escreveu. Perder esse prazo não é atraso: é perder o contato.
--   dm/story   → 24 h, contadas da ÚLTIMA mensagem DELA, e renovadas por cada nova.
--
-- Ordenar por chegada faria um comentário de 6 dias esperar atrás de uma DM de 10 minutos.
-- Por isso `ig_fila_resposta()` ordena por `vence_em` e devolve o vencido como LINHA, com
-- `expirado = true`, em vez de escondê-lo com um `where` — "não deu tempo" é informação, e
-- sumir com ela é o mesmo erro que `fonte_regressao_suspeita` cometeu até 29/08, quando
-- devolvia vazio para fonte que não conseguia medir.
--
-- ─── UMA RESPOSTA POR CONVERSA, NÃO POR MENSAGEM ─────────────────────────────────────
-- Três mensagens seguidas da mesma pessoa são UMA conversa dentro de UMA janela de 24 h.
-- Uma fila por mensagem responderia três vezes ao mesmo assunto — comportamento de robô,
-- e gasto triplo. Por isso DM/story colapsam por pessoa (a mensagem mais recente ganha) e
-- só comentário fica por linha, porque ali cada um tem o seu próprio tiro único.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. `ocorrido_em` — quando ACONTECEU, não quando eu gravei
-- ─────────────────────────────────────────────────────────────────────────────────────
-- `criado_em` é o instante do INSERT. Nos dois casos em que isso diverge do fato, ele
-- mente a favor do otimismo: se o webhook ficou fora do ar e a Meta reentregou dois dias
-- depois, `criado_em` diz "agora" e a conta dá 7 dias de prazo onde restam 5. O prazo é o
-- ativo mais perecível deste sistema; ele não pode ser derivado do relógio de quem grava.
alter table public.ig_mensagens
  add column if not exists ocorrido_em timestamptz;

comment on column public.ig_mensagens.ocorrido_em is
  'Quando o evento aconteceu segundo a META (entry.time / value.created_time). NULO quando '
  'a entrega não trouxe carimbo — aí a fila cai em criado_em e assume o pior. Nunca usar '
  'criado_em para prazo sem esse coalesce: reentrega da Meta reinicia o relógio errado.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2. Classificação — a classe decide o que pode sair sozinho
-- ─────────────────────────────────────────────────────────────────────────────────────
-- O classificador vem ANTES do redator de propósito. Sem ele, a única forma de decidir se
-- uma resposta pode sair sozinha seria confiar no texto que o próprio redator produziu —
-- e o redator não sabe quando está errado.
create table if not exists public.ig_classe (
  chave        text primary key,
  titulo       text not null,
  autonomo     boolean not null default false,
  prioridade   int not null default 50,
  instrucao    text,
  ativo        boolean not null default true
);

comment on table public.ig_classe is
  'Classes de mensagem do Instagram. `autonomo` decide se a resposta sai sozinha ou vai como '
  'rascunho para o dono. Promoção a autônoma é por MEDIÇÃO (8 de 10 rascunhos enviados sem '
  'edição), nunca por impressão.';
comment on column public.ig_classe.prioridade is
  'Menor = atendido primeiro quando dois itens vencem junto. Não substitui `vence_em`: '
  'a fila ordena por prazo e usa prioridade só para desempate.';

insert into public.ig_classe (chave, titulo, autonomo, prioridade, instrucao) values
  ('quer_link',    'Pediu o link / quer entrar',                     false, 10,
   'A pessoa já decidiu. Entregue o link da oferta vigente e nada mais — não venda de novo para quem já disse sim.'),
  ('duvida_leilao','Dúvida sobre leilão (como funciona, risco, praça)', false, 20,
   'Responda a dúvida de verdade, curto, e só depois ofereça o próximo passo. Responder com link sem responder a pergunta é o que faz a pessoa sair.'),
  ('quem_e_voce',  'O que é a plataforma / quem é você',              false, 30,
   'Diga em duas frases o que a ferramenta faz por ELA, não o que ela é.'),
  ('elogio',       'Elogio, emoji, reação de story',                  false, 40,
   'Agradeça como gente. Não emende oferta em cima de elogio — é o que faz parecer robô.'),
  ('preco',        'Preço, desconto, condição de pagamento',          false, 15,
   'NUNCA responde sozinho. Preço é compromisso comercial e negociação é do dono.'),
  ('reclamacao',   'Reclamação, cobrança, insatisfação',              false, 5,
   'NUNCA responde sozinho, e sobe na fila. Uma resposta automática a uma reclamação é pior do que silêncio.'),
  ('juridico',     'Jurídico, processo, promessa de resultado',       false, 1,
   'NUNCA responde sozinho. Promessa de retorno financeiro em leilão é risco regulatório.'),
  ('spam',         'Spam, divulgação de terceiro, golpe',             false, 90,
   'Não responde. Não é conversa.'),
  ('outro',        'Não classificado com confiança',                  false, 50,
   'Quando não souber, é esta. Rascunho para o dono — chutar a classe é pior do que admitir.')
on conflict (chave) do nothing;

-- ⚠️ TODAS nascem `autonomo = false`, INCLUSIVE as fáceis. Não é excesso de zelo: a régua
-- de promoção (8 de 10 enviados sem edição) não tem como ter sido cumprida por uma classe
-- que nunca produziu um rascunho. Nascer autônoma seria afirmar um número que não existe.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3. A classe fica na mensagem
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.ig_mensagens
  add column if not exists classe      text references public.ig_classe(chave),
  add column if not exists classe_conf numeric;

comment on column public.ig_mensagens.classe_conf is
  'Confiança do classificador (0-1). Abaixo do piso a mensagem vira `outro` e NUNCA sai '
  'sozinha — "não sei" tem que ter uma saída própria, senão vira palpite com cara de classe.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4. `ig_persona` — a voz, e o que ela NÃO pode dizer
-- ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.ig_persona (
  id            bigint generated always as identity primary key,
  versao        text not null,
  instrucao     text not null,
  nunca_dizer   text[] not null default '{}',
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

comment on table public.ig_persona is
  'A instrução de voz do bot, versionada. Versionada porque quando a taxa de "enviado sem '
  'editar" cair, a pergunta vai ser QUAL versão estava no ar — e sem isso não dá para saber.';
comment on column public.ig_persona.nunca_dizer is
  'Frases/promessas proibidas, checadas no texto ANTES de enviar. É trava mecânica, não '
  'instrução no prompt: instrução o modelo às vezes ignora, e aqui o custo é regulatório.';

insert into public.ig_persona (versao, instrucao, nunca_dizer)
select 'v1-partida',
  'Você escreve como o Tarcísio: engenheiro civil, veio do chão de obra, arremata em leilão '
  || 'desde 2018. Direto, sem jargão de marketing, sem emoji em excesso, sem "olá, tudo bem?". '
  || 'Frases curtas. Fala de número quando tem número. Quando o número manda NÃO arrematar, diz. '
  || 'UMA pergunta por mensagem — cada resposta dela renova a janela de 24 h, então despejar '
  || 'tudo de uma vez gasta a conversa num turno só. Nunca prometa retorno financeiro.',
  array[
    'lucro garantido', 'retorno garantido', 'sem risco', 'risco zero',
    'você vai lucrar', 'ganho certo', 'dinheiro fácil', 'multiplicar seu dinheiro'
  ]
where not exists (select 1 from public.ig_persona where versao = 'v1-partida');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 5. RLS + revogação (mesma regra das outras: só-servidor)
-- ─────────────────────────────────────────────────────────────────────────────────────
alter table public.ig_classe   enable row level security;
alter table public.ig_persona  enable row level security;
revoke insert, update, delete, truncate on public.ig_classe  from anon, authenticated;
revoke insert, update, delete, truncate on public.ig_persona from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 6. A FILA
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.ig_fila_resposta(limite int default 50)
returns table (
  ig_user_id      text,
  mid             text,
  origem          text,
  texto           text,
  ocorrido        timestamptz,
  janela          text,
  vence_em        timestamptz,
  horas_restantes numeric,
  expirado        boolean,
  classe          text,
  autonomo        boolean,
  estado          text,
  username        text
)
language sql
stable
security definer
set search_path = public
as $$
  with recebidas as (
    select m.*, coalesce(m.ocorrido_em, m.criado_em) as quando
      from public.ig_mensagens m
     where m.direcao = 'recebida'
       and not m.respondida
  ),
  -- DM e story colapsam por pessoa: uma janela, uma resposta. `distinct on` pega a mais
  -- recente, que é a que a resposta tem de endereçar.
  dm as (
    select distinct on (r.ig_user_id) r.*
      from recebidas r
     where r.origem in ('dm', 'story')
     order by r.ig_user_id, r.quando desc
  ),
  -- Comentário NÃO colapsa: cada um tem a sua private reply, uma só, para sempre.
  com as (
    select r.* from recebidas r where r.origem = 'comentario'
  ),
  tudo as (
    select d.*, 'dm_24h' as jan,
           -- A janela de DM conta da ÚLTIMA mensagem DELA, que é o que a conversa registra —
           -- não desta linha. Usar a linha daria prazo a mais numa conversa antiga reaberta.
           coalesce(c.ultima_msg_deles_em, d.quando) + interval '24 hours' as vence
      from dm d left join public.ig_conversas c on c.ig_user_id = d.ig_user_id
    union all
    select m.*, 'private_reply', m.quando + interval '7 days' from com m
  )
  select t.ig_user_id,
         t.mid,
         t.origem,
         t.texto,
         t.quando,
         t.jan,
         t.vence,
         round(extract(epoch from (t.vence - now())) / 3600.0, 2),
         t.vence <= now(),
         coalesce(t.classe, 'outro'),
         -- Sem classe ainda = não é autônomo. `coalesce(cl.autonomo, false)` importa: um
         -- LEFT JOIN sem classe devolveria NULL, e NULL num `if (autonomo)` de JS é falso
         -- por acidente e não por decisão — aqui é por decisão.
         coalesce(cl.autonomo, false),
         coalesce(cv.estado, 'bot'),
         cv.username
    from tudo t
    left join public.ig_classe    cl on cl.chave = t.classe and cl.ativo
    left join public.ig_conversas cv on cv.ig_user_id = t.ig_user_id
   -- Conversa que o dono assumiu ou pausou sai da fila do bot, mas NÃO é apagada: ela
   -- continua em `ig_mensagens` para o painel dele.
   where coalesce(cv.estado, 'bot') = 'bot'
   order by t.vence asc, coalesce(cl.prioridade, 50) asc
   limit greatest(limite, 1);
$$;

comment on function public.ig_fila_resposta(int) is
  'Fila de resposta do Instagram ORDENADA POR VENCIMENTO, não por chegada. DM/story colapsam '
  'por pessoa (uma janela de 24h, uma resposta); comentário fica por linha (uma private reply '
  'cada, para sempre). Item vencido volta como LINHA com expirado=true — esconder "não deu '
  'tempo" seria a mesma falha que devolver vazio para o que não se conseguiu medir.';

revoke all on function public.ig_fila_resposta(int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 7. O invariante que grita ANTES de a janela queimar
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Sem isto, a única forma de descobrir que o motor parou seria a ausência de respostas —
-- e ausência é exatamente o que este sistema já aprendeu a não confiar. O alarme mede
-- item cuja janela vence em menos de 6 h (DM) ou 24 h (comentário) e que ninguém tratou.
create or replace function public.ig_janela_a_queimar()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
    from public.ig_fila_resposta(500) f
   where not f.expirado
     and f.horas_restantes < case when f.janela = 'private_reply' then 24 else 6 end;
$$;

comment on function public.ig_janela_a_queimar() is
  'Quantos contatos estão a menos de 6h (DM) / 24h (comentário) de perder a janela sem '
  'resposta. Alimenta o invariante ig_janela_a_queimar em qa_invariantes().';

revoke all on function public.ig_janela_a_queimar() from public, anon, authenticated;
