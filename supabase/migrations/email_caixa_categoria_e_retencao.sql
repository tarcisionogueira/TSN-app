-- 27/09 — CAIXA DE E-MAIL: guardar só o que tem relevância JURÍDICA ou OPERACIONAL (dono).
--
-- Cada e-mail nasce CLASSIFICADO (gatilho abaixo, sem depender de cada tela que grava):
--   juridico  → envio ao jurídico/análise documental e toda a conversa que dele descende. PERMANENTE.
--   leiloeiro → contato/consulta a leiloeiro (e respostas). Fica enquanto pode virar operação.
--   operacao  → demais envios da equipe (respostas manuais, cobrança/condomínio…).
--   spam      → pasta spam.
--   avulso    → entrada que não responde a nada nosso nem virou chamado.
-- Resposta HERDA a categoria da mensagem original (por `resposta_de` ou `in_reply_to`).
--
-- Retenção (email_caixa_expiraveis): spam 30 dias · avulso 90 dias · leiloeiro/operacao SEM
-- resposta recebida 180 dias da última mensagem da conversa · COM resposta 365 dias · jurídico e
-- `reter = true` nunca. O dono autorizou (27/09) apagar a conversa com leiloeiro que não evoluiu;
-- `reter` fixa a conversa que evoluiu (arremate/acordo) — a primeira vez que alguém responde a um
-- e-mail JURÍDICO a conversa já nasce retida. Todo expurgo deixa rastro SEM conteúdo em
-- `email_expurgo_log` (prestação de contas LGPD: o que saiu, quando e por qual regra).

alter table public.email_caixa add column if not exists categoria text;
alter table public.email_caixa add column if not exists reter boolean not null default false;
create index if not exists email_caixa_categoria_idx on public.email_caixa (categoria, criado_em);

create or replace function public.email_caixa_classificar()
returns trigger language plpgsql set search_path = public as $$
declare pai record;
begin
  if new.pasta = 'spam' then new.categoria := 'spam'; return new; end if;
  if tg_op = 'UPDATE' and old.pasta = 'spam' and new.pasta <> 'spam' then new.categoria := null; end if;
  if new.categoria is not null and new.categoria <> 'spam' then return new; end if;

  select c.categoria, c.reter into pai from public.email_caixa c
   where c.id = new.resposta_de or (new.in_reply_to is not null and c.message_id = new.in_reply_to)
   limit 1;
  if pai.categoria is not null and pai.categoria not in ('spam','avulso') then
    new.categoria := pai.categoria; new.reter := new.reter or coalesce(pai.reter, false);
  elsif coalesce(new.assunto,'') ~* '(apoio jur[ií]dico|an[aá]lise documental|parecer)'
     or coalesce(new.caixa,'') ~* '^juridico' or coalesce(new.de_email,'') ~* '^juridico\+' then
    new.categoria := 'juridico';
  elsif new.direcao = 'saida' and coalesce(new.assunto,'') ~* '^(re:\s*)*(contato|consulta|proposta)' then
    new.categoria := 'leiloeiro';
  elsif new.direcao = 'saida' or new.chamado_id is not null then
    new.categoria := 'operacao';
  else
    new.categoria := 'avulso';
  end if;
  if new.categoria = 'juridico' then new.reter := true; end if;
  return new;
end $$;

drop trigger if exists trg_email_caixa_classificar on public.email_caixa;
create trigger trg_email_caixa_classificar before insert or update of pasta on public.email_caixa
  for each row execute function public.email_caixa_classificar();

-- Classifica o acervo existente (ordem cronológica: a resposta encontra o pai já classificado).
do $$ declare r record; begin
  for r in select id from public.email_caixa where categoria is null order by criado_em loop
    update public.email_caixa set pasta = pasta where id = r.id;
  end loop;
end $$;

create table if not exists public.email_expurgo_log (
  id bigint generated always as identity primary key,
  email_id uuid not null, categoria text, direcao text, criado_em timestamptz,
  regra text not null, anexos int not null default 0, expurgado_em timestamptz not null default now()
);
alter table public.email_expurgo_log enable row level security;  -- só service role

-- Conversa = a mensagem raiz e tudo que responde a ela. A retenção olha a CONVERSA inteira:
-- nunca apaga a pergunta e deixa a resposta (ou o contrário).
create or replace function public.email_caixa_expiraveis(p_limite int default 50)
returns table(id uuid, categoria text, direcao text, criado_em timestamptz, anexos jsonb, regra text)
language sql stable security definer set search_path = public as $$
  with recursive arvore as (
    select c.id, c.id as raiz from public.email_caixa c
     where c.resposta_de is null
       and not exists (select 1 from public.email_caixa p where c.in_reply_to is not null and p.message_id = c.in_reply_to)
    union all
    select f.id, a.raiz from public.email_caixa f
      join public.email_caixa pai on pai.id = f.resposta_de or (f.in_reply_to is not null and pai.message_id = f.in_reply_to)
      join arvore a on a.id = pai.id
  ),
  conversa as (
    select a.raiz,
           max(c.criado_em) as ultima,
           bool_or(c.reter) as retida,
           bool_or(c.categoria = 'juridico') as juridica,
           bool_or(c.direcao = 'entrada' and c.categoria <> 'spam') as respondida,
           min(c.categoria) filter (where c.categoria not in ('spam','avulso')) as cat_operacao
      from arvore a join public.email_caixa c on c.id = a.id
     group by a.raiz
  ),
  alvo as (
    select a.id,
      case
        when k.retida or k.juridica then null
        when c.categoria = 'spam' and c.criado_em < now() - interval '30 days' then 'spam_30d'
        when k.cat_operacao is null and c.categoria = 'avulso' and k.ultima < now() - interval '90 days' then 'avulso_90d'
        when k.cat_operacao is not null and not k.respondida and k.ultima < now() - interval '180 days' then 'operacao_sem_resposta_180d'
        when k.cat_operacao is not null and k.respondida and k.ultima < now() - interval '365 days' then 'operacao_com_resposta_365d'
      end as regra
      from arvore a join conversa k on k.raiz = a.raiz join public.email_caixa c on c.id = a.id
  )
  select c.id, c.categoria, c.direcao, c.criado_em, c.anexos, t.regra
    from alvo t join public.email_caixa c on c.id = t.id
   where t.regra is not null
   order by c.criado_em
   limit greatest(1, least(p_limite, 500));
$$;
revoke all on function public.email_caixa_expiraveis(int) from public, anon, authenticated;

-- Arquivamento de anexos: spam não vale a cópia (sai em 30 dias de qualquer forma).
create or replace function public.email_caixa_anexos_pendentes(p_desde timestamptz, p_limite int default 25)
returns table(id uuid, direcao text, resend_email_id text, anexos jsonb)
language sql stable security definer set search_path = public as $$
  select c.id, c.direcao, c.resend_email_id, c.anexos
    from public.email_caixa c
   where c.resend_email_id is not null
     and c.criado_em >= p_desde
     and coalesce(c.categoria, '') <> 'spam'
     and exists (select 1 from jsonb_array_elements(coalesce(c.anexos, '[]'::jsonb)) a where a->>'arquivo' is null)
   order by c.criado_em asc
   limit greatest(1, least(p_limite, 200));
$$;
revoke all on function public.email_caixa_anexos_pendentes(timestamptz, int) from public, anon, authenticated;

-- O invariante de anexo sem cópia não conta spam (que deixou de ser arquivado de propósito).
DO $do$
DECLARE src text;
  velho text := $m$where c.resend_email_id is not null and a->>'arquivo' is null and c.criado_em < now() - interval '3 days'), 0),$m$;
  novo  text := $m$where c.resend_email_id is not null and a->>'arquivo' is null and c.criado_em < now() - interval '3 days' and coalesce(c.categoria,'') <> 'spam'), 0),$m$;
BEGIN
  src := pg_get_functiondef('public.qa_invariantes'::regproc);
  IF position(novo in src) > 0 THEN RETURN; END IF;
  IF position(velho in src) = 0 THEN RAISE EXCEPTION 'qa_invariantes(): marcador do anexo_email_nao_arquivado não encontrado'; END IF;
  EXECUTE replace(src, velho, novo);
END $do$;
