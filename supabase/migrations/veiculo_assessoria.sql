-- RASTREIO DE VEÍCULO ARREMATADO + ASSESSORIA DE VEÍCULO (23/11, pedido do dono).
--
-- O dono arrematou uma Tracker na Superbid e quis acompanhar no sistema "assim como temos para o imóvel".
-- O fluxo do imóvel (casos/arrematacoes/Caso.jsx) é amarrado a imóvel: `arrematacoes.imovel_id` tem FK
-- para imoveis_leilao, as etapas são jurídico/carta/posse e o termo fala em imissão na posse. Pendurar um
-- carro ali mostraria etapas que não existem para ele. Por isso o veículo tem trilha própria, com as
-- etapas REAIS do leilão de pátio: pagamento → documentos de retirada → retirada liberada → agendada →
-- retirado → vistoria → transferência no DETRAN → documento em nome do arrematante.
--
-- ASSESSORIA DE VEÍCULO (dono, 23/11): 5% sobre o arremate, mínimo de R$ 2.000. Os números moram em
-- `regra_negocio['assessoria_veiculo.honorario']` (dado, não comentário) e quem aplica é
-- `veiculo_honorario()`. SÓ LANÇAMENTO MANUAL: o dono ainda não quer o produto aberto ao público, então
-- não há checkout, plano nem botão para o cliente — só a equipe (admin/analista) cria e mexe nos casos
-- (`regra_negocio['assessoria_veiculo.lancamento_manual']`, aplicada por `veiculo_assessoria_pode_lancar()`,
-- que as políticas de RLS usam). O cliente só LÊ o próprio caso.
--
-- Apagar caso não tem política de propósito: caso desistido vira etapa 'cancelado' (o rastro fica).

create table if not exists public.veiculo_casos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references auth.users(id) on delete set null,
  veiculo_id uuid references public.veiculos_leilao(id) on delete set null,
  titulo text not null check (char_length(titulo) >= 3),
  marca text, modelo text, ano_fabricacao integer, ano_modelo integer, cor text,
  placa text, chassi text, renavam text,
  leiloeiro text, plataforma text, evento text, lote text, comitente text, link_lote text,
  valor_arremate numeric check (valor_arremate is null or valor_arremate > 0),
  valor_total_pago numeric check (valor_total_pago is null or valor_total_pago > 0),
  data_arremate date, pago_em date,
  local_retirada text, retirada_desde date,
  estadia_a_partir date, estadia_diaria numeric,
  etapa text not null default 'arrematado',
  etapa_em timestamptz not null default now(),
  assessoria boolean not null default false,
  honorario_pct numeric, honorario_minimo numeric, honorario_valor numeric,
  honorario_status text not null default 'nao_se_aplica',
  termo_url text, cobranca_id uuid references public.cobrancas_avulsas(id) on delete set null,
  observacoes text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint veiculo_casos_etapa_ck check (etapa in ('arrematado', 'pagamento_confirmado', 'documentos_retirada',
    'retirada_liberada', 'retirada_agendada', 'retirado', 'vistoria', 'transferencia', 'documentado', 'concluido', 'cancelado')),
  constraint veiculo_casos_honorario_status_ck check (honorario_status in ('nao_se_aplica', 'pendente', 'cobrado', 'pago', 'isento'))
);
comment on table public.veiculo_casos is
  'Veículo arrematado acompanhado pela equipe (rastreio do pátio até o documento em nome do arrematante). Lançamento SÓ manual (assessoria de veículo não está aberta ao público).';

create index if not exists veiculo_casos_cliente_idx on public.veiculo_casos (cliente_id);
create index if not exists veiculo_casos_etapa_idx on public.veiculo_casos (etapa) where etapa not in ('concluido', 'cancelado');

create table if not exists public.veiculo_caso_eventos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.veiculo_casos(id) on delete cascade,
  etapa text,
  titulo text not null check (char_length(titulo) >= 2),
  observacao text,
  data_evento date not null default current_date,
  prazo date,
  origem text not null default 'manual',
  visivel_cliente boolean not null default true,
  autor_id uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists veiculo_caso_eventos_caso_idx on public.veiculo_caso_eventos (caso_id, data_evento desc);

-- ── Regras de negócio (dado) ───────────────────────────────────────────────────────────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values
  ('assessoria_veiculo.honorario', '{"pct": 5, "minimo": 2000}'::jsonb,
   'Assessoria de veículo: honorário de 5% sobre o valor do arremate, mínimo de R$ 2.000 (dono, 23/11).',
   array['veiculo_honorario'], true),
  ('assessoria_veiculo.lancamento_manual', '{"publico": false}'::jsonb,
   'Assessoria de veículo só por lançamento manual da equipe (admin/analista) — não está aberta ao público (dono, 23/11).',
   array['veiculo_assessoria_pode_lancar'], true)
on conflict (chave) do nothing;

-- Honorário da assessoria de veículo. Sem a regra ativa NÃO inventa preço: lança erro (falha fechada).
create or replace function public.veiculo_honorario(p_valor numeric)
returns numeric language plpgsql stable set search_path = public as $$
declare v jsonb;
begin
  select valor into v from public.regra_negocio where chave = 'assessoria_veiculo.honorario' and ativo;
  if v is null or (v->>'pct') is null then
    raise exception 'regra assessoria_veiculo.honorario ausente ou inativa — honorário não calculado';
  end if;
  if p_valor is null or p_valor <= 0 then return null; end if;
  return greatest(round(p_valor * (v->>'pct')::numeric / 100, 2), coalesce((v->>'minimo')::numeric, 0));
end $$;

-- Quem pode lançar/mexer num caso de veículo. Enquanto `assessoria_veiculo.lancamento_manual` disser
-- publico=false (ou não existir), só admin/analista. Se um dia abrir ao público, é aqui que muda.
create or replace function public.veiculo_assessoria_pode_lancar()
returns boolean language sql stable set search_path = public as $$
  -- Regra 'assessoria_veiculo.lancamento_manual' (publico=false): só a equipe que opera a assessoria
  -- lança. Abrir ao público exige mudar ESTA função junto com a regra — não basta virar o jsonb.
  select public.eh_funcao('admin') or public.eh_funcao('analista');
$$;

-- Carimbos + honorário calculado pelo servidor (o número da tela nunca é a fonte).
create or replace function public.veiculo_casos_antes()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then new.etapa_em := now(); end if;
  if new.assessoria then
    if new.honorario_status = 'nao_se_aplica' then new.honorario_status := 'pendente'; end if;
    if new.honorario_status not in ('pago', 'isento') then
      select (valor->>'pct')::numeric, (valor->>'minimo')::numeric into new.honorario_pct, new.honorario_minimo
        from public.regra_negocio where chave = 'assessoria_veiculo.honorario' and ativo;
      new.honorario_valor := public.veiculo_honorario(new.valor_arremate);
    end if;
  else
    new.honorario_status := 'nao_se_aplica';
    new.honorario_valor := null; new.honorario_pct := null; new.honorario_minimo := null;
  end if;
  return new;
end $$;

create trigger veiculo_casos_antes before insert or update on public.veiculo_casos
  for each row execute function public.veiculo_casos_antes();

-- Mudou de etapa → entra na linha do tempo sozinho (o rastro não depende de alguém lembrar).
create or replace function public.veiculo_casos_registra_etapa()
returns trigger language plpgsql set search_path = public as $$
declare rotulo text;
begin
  if tg_op = 'UPDATE' and new.etapa is not distinct from old.etapa then return new; end if;
  rotulo := case new.etapa
    when 'arrematado' then 'Arrematado' when 'pagamento_confirmado' then 'Pagamento confirmado'
    when 'documentos_retirada' then 'Documentos de retirada enviados' when 'retirada_liberada' then 'Retirada liberada'
    when 'retirada_agendada' then 'Retirada agendada' when 'retirado' then 'Veículo retirado do pátio'
    when 'vistoria' then 'Vistoria' when 'transferencia' then 'Transferência no DETRAN'
    when 'documentado' then 'Documento em nome do arrematante' when 'concluido' then 'Concluído'
    when 'cancelado' then 'Cancelado' else new.etapa end;
  insert into public.veiculo_caso_eventos (caso_id, etapa, titulo, origem)
  values (new.id, new.etapa, rotulo, 'etapa');
  return new;
end $$;

create trigger veiculo_casos_registra_etapa after insert or update of etapa on public.veiculo_casos
  for each row execute function public.veiculo_casos_registra_etapa();

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────
alter table public.veiculo_casos enable row level security;
alter table public.veiculo_caso_eventos enable row level security;

create policy veiculo_casos_le on public.veiculo_casos for select to authenticated
  using (public.eh_equipe() or cliente_id = (select auth.uid()));
create policy veiculo_casos_lanca on public.veiculo_casos for insert to authenticated
  with check (public.veiculo_assessoria_pode_lancar());
create policy veiculo_casos_edita on public.veiculo_casos for update to authenticated
  using (public.veiculo_assessoria_pode_lancar()) with check (public.veiculo_assessoria_pode_lancar());

create policy veiculo_eventos_le on public.veiculo_caso_eventos for select to authenticated
  using (public.eh_equipe() or (visivel_cliente and exists (
    select 1 from public.veiculo_casos c where c.id = caso_id and c.cliente_id = (select auth.uid()))));
create policy veiculo_eventos_lanca on public.veiculo_caso_eventos for insert to authenticated
  with check (public.veiculo_assessoria_pode_lancar());
create policy veiculo_eventos_edita on public.veiculo_caso_eventos for update to authenticated
  using (public.veiculo_assessoria_pode_lancar()) with check (public.veiculo_assessoria_pode_lancar());
create policy veiculo_eventos_apaga on public.veiculo_caso_eventos for delete to authenticated
  using (public.veiculo_assessoria_pode_lancar() and origem = 'manual');
