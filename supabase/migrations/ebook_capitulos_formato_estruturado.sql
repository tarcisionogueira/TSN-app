-- ============================================================================
-- Formato ESTRUTURADO de eBook (docx -> capitulos -> leitor responsivo), ADITIVO
-- ao formato PDF legado. Nenhum eBook existente muda de comportamento:
-- tipo_conteudo nasce 'pdf' em todas as linhas atuais (default), e so produtos
-- novos passam a 'estruturado' quando o admin salva capitulos pela tela
-- /admin/ebook-editor/:id.
-- ============================================================================

-- ── 1. Discriminador em ebooks_admin ────────────────────────────────────────
alter table public.ebooks_admin
  add column if not exists tipo_conteudo text not null default 'pdf';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ebooks_admin_tipo_conteudo_check') then
    alter table public.ebooks_admin
      add constraint ebooks_admin_tipo_conteudo_check check (tipo_conteudo in ('pdf','estruturado'));
  end if;
end $$;

comment on column public.ebooks_admin.tipo_conteudo is
  'pdf = legado (arquivo_url + leitor PDF/pdf.js); estruturado = ebook_capitulos + leitor responsivo novo. Aditivo: nao migra ebooks existentes.';

-- Caminho do .docx ORIGINAL no bucket privado `documentos` (permite reprocessar/
-- redetectar capitulos sem pedir novo upload ao admin). Nao e exposto a cliente final.
alter table public.ebooks_admin add column if not exists docx_storage_path text;

-- ── 2. Tabela de capitulos ───────────────────────────────────────────────────
create table if not exists public.ebook_capitulos (
  id              uuid default gen_random_uuid() primary key,
  ebook_id        uuid not null references public.ebooks_admin(id) on delete cascade,
  ordem           integer not null,
  titulo          text not null default '',
  conteudo_texto  text not null default '',
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (ebook_id, ordem)
);
create index if not exists idx_ebook_capitulos_ebook on public.ebook_capitulos(ebook_id, ordem);

alter table public.ebook_capitulos enable row level security;

-- SEM policy de leitura publica, DE PROPOSITO: capitulo e o CONTEUDO PAGO do
-- produto. Ao contrario de ebooks_admin (metadados, "leitura publica dos ativos"),
-- aqui ninguem le direto - so via obter_capitulos_ebook (SECURITY DEFINER, com
-- checagem de entitlement). Fecha desde o nascimento o mesmo tipo de brecha que
-- existe hoje em arquivo_url para authenticated (achado lateral, fora de escopo
-- desta migracao corrigir).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ebook_capitulos' and policyname='Admin gerencia capitulos') then
    create policy "Admin gerencia capitulos" on public.ebook_capitulos for all
      using (exists (select 1 from public.perfis where id = auth.uid() and role = 'admin'));
  end if;
end $$;

-- ── 3. Entitlement compartilhado (evita duplicar a regra em duas RPCs) ──────
create or replace function public.ebook_tem_acesso(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_preco numeric; v_ativo boolean; v_gratis text[]; v_role text;
begin
  select preco, ativo, coalesce(planos_gratis, '{}')
    into v_preco, v_ativo, v_gratis
    from ebooks_admin where id = p_id;
  if v_ativo is distinct from true then return false; end if;
  if coalesce(v_preco, 0) = 0 then return true; end if;            -- gratuito p/ todos
  if auth.uid() is null then return false; end if;                  -- pago exige login
  if exists (select 1 from compras_produtos
             where user_id = auth.uid() and produto_tipo = 'ebook'
               and produto_id = p_id and status = 'ativo') then return true; end if;
  select coalesce(role, 'explorador') into v_role from perfis where id = auth.uid();
  if v_role in ('top2','assessorado','clube','consultor','analista','advogado','admin') then return true; end if;
  if v_role = any(v_gratis) then return true; end if;
  return false;
end;
$function$;

-- Helper INTERNO: nunca chamavel direto por anon/authenticated (so de dentro de
-- outra SECURITY DEFINER function, que roda como o dono).
revoke all on function public.ebook_tem_acesso(uuid) from public, anon, authenticated;

-- ── 4. obter_arquivo_ebook agora DELEGA pro helper (comportamento identico ao de hoje) ──
create or replace function public.obter_arquivo_ebook(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_url text;
begin
  if not public.ebook_tem_acesso(p_id) then return null; end if;
  select arquivo_url into v_url from ebooks_admin where id = p_id;
  return v_url;
end;
$function$;
-- grants desta funcao ja existem (anon, authenticated) de ebook_entitlement_planos_gratis.sql - mantidos.

-- ── 5. RPC nova: capitulos do eBook estruturado ─────────────────────────────
create or replace function public.obter_capitulos_ebook(p_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $function$
  select case when public.ebook_tem_acesso(p_id)
    then (select jsonb_agg(jsonb_build_object('ordem', ordem, 'titulo', titulo, 'conteudo_texto', conteudo_texto) order by ordem)
          from public.ebook_capitulos where ebook_id = p_id)
    else null end;
$function$;

revoke all on function public.obter_capitulos_ebook(uuid) from public;
grant execute on function public.obter_capitulos_ebook(uuid) to anon, authenticated;

-- ── 6. RPC de gravacao (admin): substitui os capitulos ATOMICAMENTE ─────────
-- Uma funcao so = uma transacao: nunca fica com tipo_conteudo='estruturado' e
-- zero capitulos gravados no meio do caminho.
create or replace function public.salvar_capitulos_ebook(p_ebook_id uuid, p_capitulos jsonb, p_docx_path text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.perfis where id = auth.uid() and role = 'admin') then
    raise exception 'apenas admin pode salvar capitulos';
  end if;
  if p_capitulos is null or jsonb_array_length(p_capitulos) = 0 then
    raise exception 'informe ao menos um capitulo';
  end if;

  delete from public.ebook_capitulos where ebook_id = p_ebook_id;
  insert into public.ebook_capitulos (ebook_id, ordem, titulo, conteudo_texto)
    select p_ebook_id, (elem->>'ordem')::int, coalesce(elem->>'titulo',''), coalesce(elem->>'conteudo_texto','')
    from jsonb_array_elements(p_capitulos) as elem;

  update public.ebooks_admin
     set tipo_conteudo = 'estruturado',
         docx_storage_path = coalesce(p_docx_path, docx_storage_path)
   where id = p_ebook_id;
end;
$function$;

revoke all on function public.salvar_capitulos_ebook(uuid, jsonb, text) from public;
grant execute on function public.salvar_capitulos_ebook(uuid, jsonb, text) to authenticated;

comment on column public.leitura_progresso.pagina is
  'Pagina de PDF (leitor paginado) ou numero do capitulo 1-based (leitor estruturado) - o significado depende de ebooks_admin.tipo_conteudo do item referenciado por item_id. Sem coluna nova: a tabela ja nasceu generica por item_tipo.';
