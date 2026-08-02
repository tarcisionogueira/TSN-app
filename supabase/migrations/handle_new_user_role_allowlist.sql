-- CRÍTICO — ESCALAÇÃO DE PRIVILÉGIO NO CADASTRO PÚBLICO (achado do bug bounty 02/08).
--
-- `handle_new_user` (trigger de auth.users, SECURITY DEFINER → passa por cima da RLS) gravava
-- `perfis.role` direto do metadado do cliente:
--     coalesce(new.raw_user_meta_data->>'role', 'explorador')
-- `raw_user_meta_data` é o `options.data` do `supabase.auth.signUp` — 100% controlado por quem
-- chama, com a anon key que está no bundle do site. Ou seja: qualquer pessoa podia se cadastrar
-- com `data: { role: 'admin' }` e nascer ADMIN.
--
-- Por que a proteção existente NÃO pegava: `trg_proteger_perfil`
-- (proteger_campos_sensiveis_perfil) é BEFORE **UPDATE** — o caminho do INSERT ficava aberto.
-- E `auditoria_seguranca()` confere que a trigger anti-escalação EXISTE, não que ela cubra INSERT
-- (por isso o painel seguia 0 crítico / 0 atenção).
--
-- CORREÇÃO: allowlist no INSERT. O cadastro público só nasce 'explorador'; qualquer outro valor
-- vindo do metadado é IGNORADO (não falha o cadastro — só não eleva).
-- Nenhum fluxo legítimo quebra — todos já mandam 'explorador':
--   src/pages/Login.jsx:322 · src/pages/Checkout.jsx:606 · api/criar-conta-checkout.js:57 ·
--   api/assinar-com-cadastro.js:86 · api/promo-capturar.js:87 · api/sdr-capturar.js:70
-- e o convite de equipe NÃO depende do metadado: `usar_convite_equipe(p_token,p_user_id)` valida
-- o token no servidor e aí sim faz `update perfis set role = ...` (src/pages/Login.jsx:51).
-- A elevação por pagamento continua igual (webhook/servidor, após aprovação).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  up_id  uuid;
  ref_raw text;
  v_role text;
begin
  ref_raw := nullif(trim(new.raw_user_meta_data->>'ref_codigo'), '');
  if ref_raw is not null then
    -- 1) tenta como uuid direto (?ref=<uid> quando o código curto ainda não existia)
    begin
      up_id := ref_raw::uuid;
      if not exists (select 1 from public.perfis where id = up_id) then up_id := null; end if;
    exception when others then up_id := null; end;
    -- 2) senão, como código de indicação de QUALQUER parceiro (não só consultor)
    if up_id is null then
      select id into up_id from public.perfis where codigo_indicacao = upper(ref_raw) limit 1;
    end if;
    -- anti-autoindicação
    if up_id = new.id then up_id := null; end if;
  end if;

  -- ALLOWLIST: o metadado do cliente NUNCA eleva o papel. Papel de equipe/plano é atribuído
  -- depois, por caminho validado no servidor (usar_convite_equipe / webhook de pagamento).
  -- Para liberar um novo papel auto-atribuível no futuro, some-o ao array — e só.
  v_role := coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'explorador');
  if not (v_role = any (array['explorador'])) then
    v_role := 'explorador';
  end if;

  insert into public.perfis (id, nome, telefone, endereco, role, lgpd_aceito, lgpd_data, indicado_por)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    v_role,
    coalesce((new.raw_user_meta_data->>'lgpd_aceito')::boolean, false),
    (new.raw_user_meta_data->>'lgpd_data')::timestamptz,
    up_id
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

comment on function public.handle_new_user() is
  'Cria o perfil no cadastro. role é SEMPRE explorador — metadado do cliente (raw_user_meta_data.role) não eleva papel (correção da escalação de privilégio de 02/08). Papel de equipe vem de usar_convite_equipe; papel de plano vem do webhook de pagamento.';
