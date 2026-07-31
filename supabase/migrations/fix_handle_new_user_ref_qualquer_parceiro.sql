-- BUG DE ATRIBUIÇÃO DE INDICAÇÃO (?ref=) — parceiro não-consultor não era registrado.
--
-- O trigger de criação de conta (on_auth_user_created → handle_new_user) só gravava o
-- upline (indicado_por) quando o parceiro dono do código tinha role='consultor'. Mas o
-- programa de parceiros passou a permitir que QUALQUER usuário indique (ex.: um explorador
-- que virou parceiro e tem codigo_indicacao, como o Kaique/AC08B6). Resultado: quem entrava
-- pelo link desses parceiros NÃO tinha a indicação registrada no servidor — a atribuição
-- dependia só do RPC client-side (vincular_upline), que é frágil (roda pós-login, pode falhar
-- por rede/propagação e perder o vínculo).
--
-- Correção: registrar o upline JÁ na criação da conta, server-side e atômico, aceitando o
-- código de indicação de QUALQUER parceiro OU o uuid do link (?ref=<uid>, usado quando o
-- código curto ainda não existia). Mesma lógica do vincular_upline, com guarda anti-autoindicação.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  up_id   uuid;
  ref_raw text;
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

  insert into public.perfis (id, nome, telefone, endereco, role, lgpd_aceito, lgpd_data, indicado_por)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    coalesce(new.raw_user_meta_data->>'role', 'explorador'),
    coalesce((new.raw_user_meta_data->>'lgpd_aceito')::boolean, false),
    (new.raw_user_meta_data->>'lgpd_data')::timestamptz,
    up_id
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
