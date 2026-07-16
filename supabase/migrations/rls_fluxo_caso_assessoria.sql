-- ═══ Fecha os gaps de RLS do fluxo de assessoria (src/pages/Caso.jsx) ═══
-- Auditoria confirmou mutações client-side (JWT do usuário → RLS) sem política.
-- Correção SEGURA: políticas de dono + triggers que impedem o cliente de tocar em
-- colunas sensíveis (honorários / atribuição de equipe). Servidor (service_role) e
-- gestores (admin/analista/advogado) permanecem livres.

-- ── 1) casos: participante atualiza o próprio caso (certidões, avanço de etapa) ──
drop policy if exists casos_participante_update on public.casos;
create policy casos_participante_update on public.casos
  for update to public
  using (cliente_id = auth.uid() or analista_id = auth.uid() or advogado_id = auth.uid())
  with check (cliente_id = auth.uid() or analista_id = auth.uid() or advogado_id = auth.uid());

-- Trava: o cliente mexe no fluxo, mas NUNCA reatribui titular/equipe (evita vazar o
-- caso a terceiros via analista_id/advogado_id). Gestor e servidor passam livres.
create or replace function public.casos_protege_atribuicao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' or public.app_role() in ('admin','analista','advogado') then
    return new;
  end if;
  new.cliente_id  := old.cliente_id;
  new.analista_id := old.analista_id;
  new.advogado_id := old.advogado_id;
  return new;
end $$;
drop trigger if exists trg_casos_protege_atribuicao on public.casos;
create trigger trg_casos_protege_atribuicao
  before update on public.casos
  for each row execute function public.casos_protege_atribuicao();

-- ── 2) arrematacoes: o arrematante (cliente) registra/atualiza a própria ──
drop policy if exists arrematacoes_arrematante_ins on public.arrematacoes;
create policy arrematacoes_arrematante_ins on public.arrematacoes
  for insert to public with check (arrematante_id = auth.uid());
drop policy if exists arrematacoes_arrematante_upd on public.arrematacoes;
create policy arrematacoes_arrematante_upd on public.arrematacoes
  for update to public using (arrematante_id = auth.uid()) with check (arrematante_id = auth.uid());

-- Trava financeira: só servidor/gestor controla honorários. O cliente nunca marca
-- 'distribuido' (que faria a distribuição do servidor pular → calote) nem grava split.
create or replace function public.arrematacoes_protege_honorarios()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' or public.app_role() in ('admin','analista') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.honorarios_status := 'pendente';
    new.honorarios_split  := null;
  else
    new.honorarios_status := old.honorarios_status;
    new.honorarios_split  := old.honorarios_split;
  end if;
  return new;
end $$;
drop trigger if exists trg_arrematacoes_protege_honorarios on public.arrematacoes;
create trigger trg_arrematacoes_protege_honorarios
  before insert or update on public.arrematacoes
  for each row execute function public.arrematacoes_protege_honorarios();

-- ── 3) procuracoes: o titular (cliente) gera e assina a própria ──
drop policy if exists procuracoes_cliente_ins on public.procuracoes;
create policy procuracoes_cliente_ins on public.procuracoes
  for insert to public with check (cliente_id = auth.uid());
drop policy if exists procuracoes_cliente_upd on public.procuracoes;
create policy procuracoes_cliente_upd on public.procuracoes
  for update to public using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());

-- ── 4) analise_juridica: o analista do caso encaminha ao jurídico (insert) ──
drop policy if exists juridica_analista_insert on public.analise_juridica;
create policy juridica_analista_insert on public.analise_juridica
  for insert to public
  with check (exists (select 1 from public.casos c where c.id = caso_id and c.analista_id = auth.uid()));
