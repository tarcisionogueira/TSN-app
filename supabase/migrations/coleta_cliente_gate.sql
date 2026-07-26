-- Coleta client-side (staff): gate que garante ~2x/semana e só 1 disparo por janela.
-- Os leiloeiros Vlance têm API JSON com CORS aberto → o navegador do STAFF coleta (IP real,
-- sem Bright Data) e o endpoint api/coleta-cliente.js grava no acervo. Este gate evita coleta
-- em duplicidade (vários staff logados) e respeita o intervalo. Aplicada via MCP.
create table if not exists public.coleta_cliente (
  fonte text primary key,
  ultima_em timestamptz,
  tentativa_em timestamptz,
  intervalo_horas int not null default 84,   -- ~3,5 dias => 2x/semana
  ativo boolean not null default true
);
insert into public.coleta_cliente (fonte) values ('VLANCE') on conflict (fonte) do nothing;

-- Claim atômico: devolve true (e trava por 15 min) se está na hora e ninguém pegou ainda.
create or replace function public.coleta_cliente_claim(p_fonte text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.coleta_cliente%rowtype;
begin
  select * into v from public.coleta_cliente where fonte = p_fonte and ativo for update;
  if not found then return false; end if;
  if v.ultima_em is not null and now() - v.ultima_em < make_interval(hours => v.intervalo_horas) then return false; end if;
  if v.tentativa_em is not null and now() - v.tentativa_em < interval '15 minutes' then return false; end if;
  update public.coleta_cliente set tentativa_em = now() where fonte = p_fonte;
  return true;
end $$;

-- Conclui a janela (sucesso): marca ultima_em = now e libera a trava de tentativa.
create or replace function public.coleta_cliente_concluir(p_fonte text)
returns void language plpgsql security definer set search_path = public as $$
begin update public.coleta_cliente set ultima_em = now(), tentativa_em = null where fonte = p_fonte; end $$;

-- Service-only (o endpoint chama com service key; o gate nunca é exposto ao cliente direto).
alter table public.coleta_cliente enable row level security;
revoke execute on function public.coleta_cliente_claim(text)    from anon, public;
revoke execute on function public.coleta_cliente_concluir(text) from anon, public;
grant  execute on function public.coleta_cliente_claim(text)    to service_role;
grant  execute on function public.coleta_cliente_concluir(text) to service_role;
