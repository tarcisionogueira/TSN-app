-- Comprovação de integridade dos ACEITES DE TERMO (pedido do dono, 30/07):
-- cada aceite de compra ganha um HASH SHA-256 gravado NO MOMENTO do aceite, calculado
-- sobre os campos canônicos (usuário|e-mail|plano|valor|versão do termo|IP|data-hora).
-- O comprovante imprimível do Admin exibe o hash; qualquer alteração posterior no
-- registro quebra a verificação (recalcular ≠ armazenado). Trigger cobre TODO caminho
-- de insert (registrar-aceite e futuros) sem depender do código da API.
alter table public.aceites_plano add column if not exists aceite_hash text;

create or replace function public.aceites_plano_hash() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.aceito_em := coalesce(new.aceito_em, now());
  new.aceite_hash := encode(extensions.digest(
    coalesce(new.user_id::text,'') || '|' || coalesce(new.user_email,'') || '|' ||
    coalesce(new.plano_key,'') || '|' || coalesce(new.valor::text,'') || '|' ||
    coalesce(new.termos_versao,'') || '|' || coalesce(new.ip,'') || '|' ||
    new.aceito_em::text, 'sha256'::text), 'hex');
  return new;
end $$;

drop trigger if exists trg_aceites_plano_hash on public.aceites_plano;
create trigger trg_aceites_plano_hash before insert on public.aceites_plano
for each row execute function public.aceites_plano_hash();

-- Backfill dos aceites já existentes (mesma fórmula — verificável desde já).
update public.aceites_plano set aceite_hash = encode(extensions.digest(
  coalesce(user_id::text,'') || '|' || coalesce(user_email,'') || '|' ||
  coalesce(plano_key,'') || '|' || coalesce(valor::text,'') || '|' ||
  coalesce(termos_versao,'') || '|' || coalesce(ip,'') || '|' ||
  aceito_em::text, 'sha256'::text), 'hex')
where aceite_hash is null;
