-- ─────────────────────────────────────────────────────────────────────────────────────────
-- NÃO INSISTIR EM ENDEREÇO PROVADAMENTE MORTO — 27/08/2026
--
-- `_email.js` não checava NADA antes de enviar. O `resend-webhook.js` carimbava
-- `emails_log.status='bounce'` depois do fato, e ninguém lia esse carimbo: o próximo cron
-- mandava de novo para o mesmo endereço. Medido em 27/08 — dois endereços que deram bounce
-- em 10/08 receberam mais dois e-mails cada, o último em 24/08.
--
-- Reputação de domínio é o ativo mais frágil que temos, e a semana do lançamento é o pior
-- momento para gastá-la: bater repetidamente em caixa morta é o caminho mais curto para o
-- provedor mandar para spam o e-mail de quem está VIVO.
--
-- ⚠️ A REGRA INGÊNUA ESTARIA ERRADA EM METADE DOS CASOS QUE TEMOS. "Bounçou uma vez, suprime
-- para sempre" é o reflexo, e o histórico desmente:
--
--   domicianosousa03@gmail.com   bounce 10/08 · bounce 12/08 · **ENTREGUE 24/08**
--   triciatoyr@tahoo.com.br      bounce 10/08 · bounce 12/08 · bounce 24/08 · ZERO entregas
--
-- O primeiro é bounce TRANSITÓRIO (caixa cheia) e o endereço voltou — suprimir teria cortado
-- um cliente vivo. O segundo é `tahoo.com.br`, typo de `yahoo`: domínio que não existe e
-- nunca vai existir. O gate precisa separar os dois, e a prova para separar está no dado.
--
-- AS TRÊS REGRAS, nesta ordem de força:
--   1. bounce PERMANENTE (Resend diz `bounce.type = Permanent`) → suprime na hora;
--   2. 3 bounces TRANSITÓRIOS seguidos, sem nenhuma entrega no meio → suprime;
--   3. QUALQUER ENTREGA zera o contador e reativa — é a regra que salva o domiciano.
--      Exceção: RECLAMAÇÃO de spam nunca é revertida por entrega. Quem marcou como spam não
--      está dizendo "não chegou", está dizendo "não quero" — e isso entrega não desmente.
--
-- O gate vive em `_email.js`, no helper por onde passam os 24 arquivos que mandam e-mail:
-- um lugar só, e nenhum caminho novo nasce de fora dele.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.emails_supressao (
  destinatario      text primary key,
  motivo            text not null,
  detalhe           text,
  bounces_seguidos  integer not null default 0,
  suprimido         boolean not null default false,
  suprimido_em      timestamptz,
  ultimo_bounce_em  timestamptz,
  ultima_entrega_em timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- E-mail de cliente é PII. RLS ligada e SEM política: só a service key enxerga — que é
-- exatamente o que `auditoria_seguranca()` exige de tabela com dado pessoal.
alter table public.emails_supressao enable row level security;

comment on table public.emails_supressao is
  'Lista de supressão de e-mail. Alimentada pelo resend-webhook; lida pelo gate em _email.js.';


-- ─── REGISTRAR BOUNCE ────────────────────────────────────────────────────────────────────
-- Devolve `true` se, DEPOIS deste bounce, o endereço passou a estar suprimido.
create or replace function public.emails_registrar_bounce(
  p_destinatario text,
  p_permanente   boolean default false,
  p_detalhe      text default null
) returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare
  v_dest text := lower(btrim(coalesce(p_destinatario, '')));
  v_perm boolean := coalesce(p_permanente, false);
  v_sup  boolean;
begin
  if v_dest = '' or v_dest not like '%@%' then return false; end if;

  insert into public.emails_supressao as s
    (destinatario, motivo, detalhe, bounces_seguidos, suprimido, suprimido_em, ultimo_bounce_em)
  values
    (v_dest,
     case when v_perm then 'bounce_permanente' else 'bounce_transitorio' end,
     left(coalesce(p_detalhe, ''), 300),
     1, v_perm, case when v_perm then now() end, now())
  on conflict (destinatario) do update set
    bounces_seguidos = s.bounces_seguidos + 1,
    -- 3 transitórios SEGUIDOS e nenhuma entrega no meio: na prática, endereço morto.
    suprimido = s.suprimido or v_perm or (s.bounces_seguidos + 1) >= 3,
    suprimido_em = coalesce(
      s.suprimido_em,
      case when v_perm or (s.bounces_seguidos + 1) >= 3 then now() end),
    motivo = case
      when s.motivo = 'reclamacao' then 'reclamacao'          -- reclamação não é rebaixada
      when v_perm then 'bounce_permanente'
      when (s.bounces_seguidos + 1) >= 3 then 'bounce_repetido'
      else s.motivo end,
    detalhe = left(coalesce(p_detalhe, s.detalhe, ''), 300),
    ultimo_bounce_em = now(),
    atualizado_em = now()
  returning s.suprimido into v_sup;

  return coalesce(v_sup, false);
end $$;


-- ─── REGISTRAR ENTREGA — a regra que evita cortar cliente vivo ───────────────────────────
create or replace function public.emails_registrar_entrega(p_destinatario text)
returns void
language sql security definer set search_path to 'public' as $$
  update public.emails_supressao
     set bounces_seguidos  = 0,
         suprimido         = false,
         suprimido_em      = null,
         motivo            = 'reativado_por_entrega',
         ultima_entrega_em = now(),
         atualizado_em     = now()
   where destinatario = lower(btrim(coalesce(p_destinatario, '')))
     and motivo <> 'reclamacao'                 -- "não quero" não é desmentido por "chegou"
     and (suprimido or bounces_seguidos > 0);
$$;


-- ─── REGISTRAR RECLAMAÇÃO DE SPAM — suprime e não volta ──────────────────────────────────
create or replace function public.emails_registrar_reclamacao(p_destinatario text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_dest text := lower(btrim(coalesce(p_destinatario, '')));
begin
  if v_dest = '' or v_dest not like '%@%' then return; end if;
  insert into public.emails_supressao as s
    (destinatario, motivo, detalhe, suprimido, suprimido_em, atualizado_em)
  values (v_dest, 'reclamacao', 'marcou como spam', true, now(), now())
  on conflict (destinatario) do update set
    motivo = 'reclamacao', suprimido = true,
    suprimido_em = coalesce(s.suprimido_em, now()), atualizado_em = now();
end $$;


-- Só o servidor executa. Nenhuma destas é para anon/authenticated — e o auditor de
-- segurança acusaria se fossem (`rpc_definer_anon`).
revoke all on function public.emails_registrar_bounce(text, boolean, text)   from public, anon, authenticated;
revoke all on function public.emails_registrar_entrega(text)                 from public, anon, authenticated;
revoke all on function public.emails_registrar_reclamacao(text)              from public, anon, authenticated;
grant execute on function public.emails_registrar_bounce(text, boolean, text)  to service_role;
grant execute on function public.emails_registrar_entrega(text)                to service_role;
grant execute on function public.emails_registrar_reclamacao(text)             to service_role;


-- ─── BACKFILL — o que o histórico já prova ───────────────────────────────────────────────
-- Critério: 2+ bounces E nenhuma entrega em TODA a história do endereço. É o que separa
-- `triciatoyr@tahoo.com.br` (entra) de `domicianosousa03@gmail.com` (fica de fora, teve
-- entrega em 24/08). Não invento o tipo do bounce que não foi gravado na época — uso a
-- única prova disponível, que é a ausência de qualquer entrega.
insert into public.emails_supressao
  (destinatario, motivo, detalhe, bounces_seguidos, suprimido, suprimido_em, ultimo_bounce_em)
select l.destinatario,
       'bounce_repetido',
       'backfill 27/08: ' || count(*) || ' bounce(s) e nenhuma entrega registrada',
       count(*)::int, true, now(), max(l.enviado_em)
  from public.emails_log l
 where l.status = 'bounce'
 group by l.destinatario
having count(*) >= 2
   and not exists (select 1 from public.emails_log e
                    where e.destinatario = l.destinatario and e.entregue_em is not null)
on conflict (destinatario) do nothing;
