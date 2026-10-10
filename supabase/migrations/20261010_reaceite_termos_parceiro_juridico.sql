-- 10/10 — NOVO ACEITE OBRIGATÓRIO dos termos de parceiro (v10) e jurídico (v7), pedido do dono.
-- As versões novas trazem a cláusula de intermediação ("a BidPro recebe e repassa; responde
-- fiscalmente só pela própria parcela"). Até aqui as duas RPCs devolviam a data antiga quando já
-- havia aceite e NUNCA gravavam a versão nova — re-aceitar era impossível. Agora:
--   · *_aceite_em continua sendo o PRIMEIRO aceite (é o que os gates de comissão/êxito leem);
--   · *_aceite_versao passa a ser a ÚLTIMA versão aceita, com a data em *_aceite_versao_em.
-- A prova forte (IP + hash) vai para aceites_plano via /api/registrar-aceite, como os demais.
alter table public.perfis add column if not exists parceiro_aceite_versao_em timestamptz;
alter table public.perfis add column if not exists juridico_aceite_versao_em timestamptz;

create or replace function public.aceitar_parceria(p_versao text default null)
returns timestamptz language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_atual timestamptz; v_ver text := coalesce(nullif(btrim(p_versao), ''), 'v1');
begin
  if v_uid is null then return null; end if;
  select parceiro_aceite_em into v_atual from public.perfis where id = v_uid;
  update public.perfis
     set parceiro_aceite_em = coalesce(parceiro_aceite_em, now()),  -- 1º aceite fica
         parceiro_aceite_versao = v_ver,
         parceiro_aceite_versao_em = now()
   where id = v_uid and (parceiro_aceite_em is null or parceiro_aceite_versao is distinct from v_ver);
  return (select parceiro_aceite_em from public.perfis where id = v_uid);
end;
$function$;

create or replace function public.aceitar_termo_juridico(p_versao text default null)
returns timestamptz language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_role text; v_ver text := coalesce(nullif(btrim(p_versao), ''), 'v1');
begin
  if v_uid is null then return null; end if;
  select role into v_role from public.perfis where id = v_uid;
  -- Só advogado (e o admin, que revisa o fluxo) assina este termo: aceite que ninguém pediu vira
  -- prova de vínculo que nunca existiu.
  if coalesce(v_role,'') not in ('advogado','admin') then return null; end if;
  update public.perfis
     set juridico_aceite_em = coalesce(juridico_aceite_em, now()),
         juridico_aceite_versao = v_ver,
         juridico_aceite_versao_em = now()
   where id = v_uid and (juridico_aceite_em is null or juridico_aceite_versao is distinct from v_ver);
  return (select juridico_aceite_em from public.perfis where id = v_uid);
end;
$function$;
