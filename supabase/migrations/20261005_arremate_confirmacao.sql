-- FLUXO DE ARREMATE (05/10, #34 — decisões do dono): o cliente DECLARA ("Arrematei"); a EQUIPE
-- confirma (com comprovante: auto/carta de arrematação ou comprovante de pagamento) ou recusa com
-- motivo. Sem linha aqui = "declarado". Escrita só pelo servidor (api/arremate-confirmacao.js).
create table if not exists public.arremate_confirmacao (
  arrematado_id uuid primary key references public.arrematados(id) on delete cascade,
  status text not null check (status in ('confirmado', 'recusado')),
  por uuid references auth.users(id),
  em timestamptz not null default now(),
  motivo text,
  comprovante_anexo_id uuid
);
alter table public.arremate_confirmacao enable row level security;
create policy arremate_confirmacao_select on public.arremate_confirmacao for select to authenticated
  using (exists (select 1 from public.arrematados a where a.id = arrematado_id and a.user_id = (select auth.uid()))
      or exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role in ('admin','analista','advogado','consultor')));

-- UM ARREMATANTE POR LOTE do acervo (imovel_id uuid). Recusado: o registro é apagado e o lote libera.
create unique index if not exists arrematados_um_por_imovel on public.arrematados (imovel_id)
  where imovel_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- CONFIRMADO É REGISTRO DO NEGÓCIO: o cliente só apaga enquanto não foi confirmado.
-- Via função SECURITY DEFINER: consultar arremate_confirmacao direto na política criava LAÇO de RLS
-- (a política de select dela lê arrematados) — "infinite recursion detected", pego no teste em
-- transação desfeita antes de qualquer cliente tocar (05/10).
create or replace function public.arremate_esta_confirmado(p_arrematado_id uuid)
 returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.arremate_confirmacao c where c.arrematado_id = p_arrematado_id and c.status = 'confirmado');
$$;
revoke all on function public.arremate_esta_confirmado(uuid) from public, anon;
grant execute on function public.arremate_esta_confirmado(uuid) to authenticated;
alter policy arrematados_delete_consolidada on public.arrematados
  using ((select auth.uid()) = user_id and not public.arremate_esta_confirmado(id));

-- SÓ ASSESSORADO/CLUB DECLARA (desenho aprovado). Admin para teste e operação.
alter policy arrematados_insert_consolidada on public.arrematados
  with check ((select auth.uid()) = user_id
              and exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role in ('assessorado','clube','admin')));
