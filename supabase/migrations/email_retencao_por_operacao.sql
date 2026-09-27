-- ════════════════════════════════════════════════════════════════════════════════════════
-- RETENÇÃO DA CAIXA PELA OPERAÇÃO (27/09, dono: "o principal não é só a comunicação, são os
-- documentos expedidos — busque embasamento legal").
--
-- BASE LEGAL (levantada em 27/09; confirmar com o jurídico):
--   · Código Civil art. 1.194 — o empresário conserva "escrituração, CORRESPONDÊNCIA e mais papéis"
--     da atividade ENQUANTO NÃO OCORRER PRESCRIÇÃO dos atos neles consignados.
--   · CC art. 205 + STJ EREsp 1.281.594/SP (Corte Especial, 2019) — responsabilidade CONTRATUAL
--     prescreve em 10 anos. É o prazo mais longo aplicável: cobre os demais.
--   · Lei 9.613/98 art. 9º p.ú. XIV "a" + art. 10 §2º — assessoria em compra e venda de imóveis
--     guarda registros por no mínimo 5 anos da conclusão da transação.
--   · CDC art. 27 e CTN arts. 173/174 — 5 anos.
--   · LGPD arts. 6º III, 15, 16 e 7º VI — guardar só o necessário, eliminar ao fim da finalidade;
--     conservação permitida para obrigação legal e defesa em processo. Por isso nada fica "para
--     sempre" sem motivo: o jurídico sem caso passa de eterno para 10 anos; eterno só com
--     `reter` MANUAL (retenção por litígio/ordem, decisão humana).
--
-- REGRA (por CONVERSA — a mesma que a tela agrupa: outra ponta + assunto sem Re:/Enc:):
--   retencao_manual        reter=true em qualquer mensagem        → sem prazo
--   operacao_em_andamento  vinculada a caso ainda não concluído   → sem prazo
--   operacao_concluida_10a vinculada a caso concluído             → conclusão (ou última msg) + 10 anos
--   juridico_10a           categoria jurídico, sem caso           → última msg + 10 anos
--   spam_30d · avulso_90d · sem_resposta_180d · com_resposta_365d (negociação que não evoluiu:
--   nenhum ato consignado → nenhuma obrigação de guarda).
--
-- Por que a chave de conversa e não só in_reply_to: o Outlook repete message_id em respostas
-- diferentes (medido 25/09) — a árvore por cabeçalho separava o que a tela mostra junto, e o
-- vínculo feito na tela não protegeria a mensagem "irmã". Os cabeçalhos continuam valendo na
-- herança do trigger (resposta nova herda caso/retenção do pai).
-- ════════════════════════════════════════════════════════════════════════════════════════

alter table public.email_caixa add column if not exists caso_id uuid references public.casos(id) on delete set null;
create index if not exists email_caixa_caso_idx on public.email_caixa (caso_id) where caso_id is not null;

-- Espelha `chaveConversa` de src/components/CaixaEmail.jsx (contraparte | assunto normalizado).
create or replace function public.email_conversa_chave(p_direcao text, p_de text, p_para text[], p_assunto text)
returns text language sql immutable set search_path = public as $$
  select lower(btrim(coalesce(case when p_direcao = 'saida' then p_para[1] else p_de end, ''))) || '|' ||
         lower(btrim(regexp_replace(
           regexp_replace(coalesce(p_assunto, ''), '^\s*((re|res|fw|fwd|enc|tr|rv|aw|wg)\s*(\[\d+\])?\s*:\s*)+', '', 'i'),
           '\s+', ' ', 'g')))
$$;

alter table public.email_caixa add column if not exists conversa_chave text
  generated always as (public.email_conversa_chave(direcao, de_email, para, assunto)) stored;
create index if not exists email_caixa_conversa_idx on public.email_caixa (conversa_chave);

-- Trigger: além da categoria, a mensagem nova HERDA caso e retenção manual da conversa
-- (pai por cabeçalho OU mesma chave de conversa). Jurídico deixa de ligar `reter` sozinho.
create or replace function public.email_caixa_classificar()
returns trigger language plpgsql set search_path = public as $$
declare pai record; irmao record; chave text;
begin
  chave := public.email_conversa_chave(new.direcao, new.de_email, new.para, new.assunto);
  select c.categoria, c.reter, c.caso_id into pai from public.email_caixa c
   where c.id = new.resposta_de or (new.in_reply_to is not null and c.message_id = new.in_reply_to)
   limit 1;
  select bool_or(c.reter) as reter, (array_agg(c.caso_id order by c.criado_em desc) filter (where c.caso_id is not null))[1] as caso_id
    into irmao from public.email_caixa c
   where c.conversa_chave = chave and c.id is distinct from new.id;
  if tg_op = 'INSERT' then
    new.caso_id := coalesce(new.caso_id, pai.caso_id, irmao.caso_id);
    new.reter := new.reter or coalesce(pai.reter, false) or coalesce(irmao.reter, false);
  end if;

  if new.pasta = 'spam' then new.categoria := 'spam'; return new; end if;
  if tg_op = 'UPDATE' and old.pasta = 'spam' and new.pasta <> 'spam' then new.categoria := null; end if;
  if new.categoria is not null and new.categoria <> 'spam' then return new; end if;

  if pai.categoria is not null and pai.categoria not in ('spam','avulso') then
    new.categoria := pai.categoria;
  elsif coalesce(new.assunto,'') ~* '(apoio jur[ií]dico|an[aá]lise documental|parecer)'
     or coalesce(new.caixa,'') ~* '^juridico' or coalesce(new.de_email,'') ~* '^juridico\+' then
    new.categoria := 'juridico';
  elsif new.direcao = 'saida' and coalesce(new.assunto,'') ~* '^(re:\s*)*(contato|consulta|proposta)' then
    new.categoria := 'leiloeiro';
  elsif new.direcao = 'saida' or new.chamado_id is not null or new.caso_id is not null then
    new.categoria := 'operacao';
  else
    new.categoria := 'avulso';
  end if;
  return new;
end $$;

-- O `reter` dos jurídicos foi ligado AUTOMATICAMENTE pela versão anterior (não por decisão
-- humana). Desliga: o jurídico agora tem prazo próprio (10 anos), e `reter` volta a significar
-- só "retenção manual".
update public.email_caixa set reter = false where categoria = 'juridico' and reter;

-- Prazo de cada mensagem. Interna (sem grant): usada pelo expurgo e pelo wrapper da tela.
create or replace function public._email_caixa_prazos()
returns table(id uuid, regra text, guardar_ate timestamptz)
language sql stable security definer set search_path = public as $$
  with conv as (
    select c.conversa_chave as k,
           max(c.criado_em) as ultima,
           bool_or(c.reter) as retida,
           bool_or(c.categoria = 'juridico') as juridica,
           bool_or(c.direcao = 'entrada' and c.categoria <> 'spam') as respondida,
           bool_or(c.categoria not in ('spam','avulso')) as operacional,
           bool_or(c.caso_id is not null) as tem_caso,
           bool_or(c.caso_id is not null and cs.concluido_em is null) as caso_aberto,
           max(cs.concluido_em) as concluido
      from public.email_caixa c left join public.casos cs on cs.id = c.caso_id
     group by 1
  )
  select c.id,
    case when k.retida then 'retencao_manual'
         when k.tem_caso and k.caso_aberto then 'operacao_em_andamento'
         when k.tem_caso then 'operacao_concluida_10a'
         when k.juridica then 'juridico_10a'
         when c.categoria = 'spam' then 'spam_30d'
         when not coalesce(k.operacional, false) then 'avulso_90d'
         when not k.respondida then 'sem_resposta_180d'
         else 'com_resposta_365d' end,
    case when k.retida or (k.tem_caso and k.caso_aberto) then null
         when k.tem_caso then greatest(k.concluido, k.ultima) + interval '10 years'
         when k.juridica then k.ultima + interval '10 years'
         when c.categoria = 'spam' then c.criado_em + interval '30 days'
         when not coalesce(k.operacional, false) then k.ultima + interval '90 days'
         when not k.respondida then k.ultima + interval '180 days'
         else k.ultima + interval '365 days' end
    from public.email_caixa c join conv k on k.k = c.conversa_chave
$$;
revoke all on function public._email_caixa_prazos() from public, anon, authenticated;

-- Para a TELA: mesma cerca da RLS de email_caixa (pessoal só o dono; comunicação só equipe).
create or replace function public.email_caixa_prazos(p_ids uuid[])
returns table(id uuid, regra text, guardar_ate timestamptz, caso_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.regra, p.guardar_ate, c.caso_id
    from public._email_caixa_prazos() p join public.email_caixa c on c.id = p.id
   where c.id = any(p_ids)
     and (c.dono = auth.uid() or (c.dono is null and public.pode_caixa_email()))
$$;
revoke all on function public.email_caixa_prazos(uuid[]) from public, anon;
grant execute on function public.email_caixa_prazos(uuid[]) to authenticated;

-- Casos para o seletor "Vincular à operação" (a RLS de casos esconde do consultor os casos em
-- que ele não está — mas vincular e-mail é trabalho da caixa, com a mesma cerca dela).
create or replace function public.email_caixa_casos_opcoes()
returns table(id uuid, imovel_endereco text, status_etapa text, concluido_em timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select cs.id, cs.imovel_endereco, cs.status_etapa, cs.concluido_em, cs.created_at
    from public.casos cs
   where public.pode_caixa_email()
   order by (cs.concluido_em is null) desc, cs.updated_at desc nulls last
   limit 300
$$;
revoke all on function public.email_caixa_casos_opcoes() from public, anon;
grant execute on function public.email_caixa_casos_opcoes() to authenticated;

-- Vincula/desvincula a CONVERSA inteira a um caso e/ou liga a retenção manual. Devolve quantas
-- mensagens mudaram (0 = nada alcançado — a tela avisa em vez de dizer "feito").
create or replace function public.email_caixa_definir_retencao(p_ids uuid[], p_caso uuid, p_mudar_caso boolean, p_reter boolean)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.pode_caixa_email() then raise exception 'A caixa de e-mail é só da equipe.' using errcode = '42501'; end if;
  if p_mudar_caso and p_caso is not null and not exists (select 1 from public.casos where id = p_caso) then
    raise exception 'Caso não encontrado.' using errcode = 'P0002';
  end if;
  update public.email_caixa c
     set caso_id = case when p_mudar_caso then p_caso else c.caso_id end,
         reter   = coalesce(p_reter, c.reter),
         categoria = case when p_mudar_caso and p_caso is not null and c.categoria in ('avulso','leiloeiro') then 'operacao' else c.categoria end
   where (c.dono = auth.uid() or c.dono is null)
     and c.conversa_chave in (select x.conversa_chave from public.email_caixa x where x.id = any(p_ids)
                               and (x.dono = auth.uid() or x.dono is null));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.email_caixa_definir_retencao(uuid[], uuid, boolean, boolean) from public, anon;
grant execute on function public.email_caixa_definir_retencao(uuid[], uuid, boolean, boolean) to authenticated;

-- Expurgo: mesma assinatura (o cron não muda), agora lendo o prazo único.
create or replace function public.email_caixa_expiraveis(p_limite int default 50)
returns table(id uuid, categoria text, direcao text, criado_em timestamptz, anexos jsonb, regra text)
language sql stable security definer set search_path = public as $$
  select c.id, c.categoria, c.direcao, c.criado_em, c.anexos, p.regra
    from public._email_caixa_prazos() p join public.email_caixa c on c.id = p.id
   where p.guardar_ate is not null and p.guardar_ate < now()
   order by c.criado_em
   limit greatest(1, least(p_limite, 500));
$$;
revoke all on function public.email_caixa_expiraveis(int) from public, anon, authenticated;
