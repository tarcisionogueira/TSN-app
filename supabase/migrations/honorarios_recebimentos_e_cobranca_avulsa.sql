-- 17/09, pedido do dono: um honorário de êxito pode ser quitado em PARTES, com métodos
-- diferentes (Pix recebido direto na conta pessoal, fora do sistema; cheque; saldo no
-- cartão pelo mesmo link de sempre). Hoje `arrematacoes.honorarios_status` é um evento
-- único (pendente→pago) — não existe onde registrar "recebi X por fora e isso abate contra
-- esta cobrança". Caso real: Marcos pagou ~R$2.000 em Pix direto na conta do dono, vai pagar
-- ~R$19.000 em cheque, e o saldo no cartão (à vista sem juros ou parcelado, juros por conta
-- dele — isso já existe em PagamentoServico.calcParcelaMaisJuros, nada muda aí).
--
-- Em paralelo, pedido de uma ferramenta de COBRANÇA AVULSA: hoje `api/mp-checkout.js` só
-- aceita 6 propósitos fechados (PROPOSITOS), sempre com preço vindo de uma tabela própria —
-- não existe como o admin cobrar algo fora desse catálogo sem sujar o schema com nova coluna
-- a cada motivo novo.

-- ── HONORÁRIOS EM PARTES ──────────────────────────────────────────────────────────────
create table if not exists public.honorarios_recebimentos (
  id uuid primary key default gen_random_uuid(),
  arrematacao_id uuid not null references public.arrematacoes(id) on delete cascade,
  metodo text not null check (metodo in ('pix_externo','cheque','cartao_mp','dinheiro','transferencia')),
  valor numeric(15,2) not null check (valor > 0),
  -- 'aguardando_compensacao': p.ex. cheque físico recebido, ainda não confirmado no banco —
  -- não entra na soma que fecha o honorário (só 'confirmado' conta, ver trigger abaixo).
  status text not null default 'confirmado' check (status in ('confirmado','aguardando_compensacao','estornado')),
  justificativa text not null check (char_length(justificativa) >= 5),
  comprovante_url text,
  -- só preenchido quando metodo='cartao_mp' (gravado pelo webhook) — idempotência do lado
  -- do gateway; único COM nulos permitidos (recebimento manual nunca tem payment_id).
  gateway_payment_id text unique,
  registrado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_honorarios_recebimentos_arrematacao on public.honorarios_recebimentos(arrematacao_id);

alter table public.honorarios_recebimentos enable row level security;

-- Leitura: equipe do caso (admin/analista/advogado) — cliente nunca vê comprovante/
-- justificativa de terceiro. Escrita: só admin — é quem decide se um recebimento por fora
-- é válido, mesmo padrão de config_honorarios (admin-only).
create policy honorarios_recebimentos_select on public.honorarios_recebimentos
  for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','analista','advogado')));
create policy honorarios_recebimentos_write on public.honorarios_recebimentos
  for insert with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
create policy honorarios_recebimentos_update on public.honorarios_recebimentos
  for update using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
create policy honorarios_recebimentos_delete on public.honorarios_recebimentos
  for delete using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));

-- Trava: soma dos recebimentos 'confirmado' de uma arrematação nunca pode passar do valor
-- total do honorário — impede lançamento em dobro (Pix + cartão do mesmo saldo, por engano).
create or replace function public.honorarios_recebimentos_valida_teto()
returns trigger language plpgsql as $$
declare
  v_total numeric(15,2); v_somado numeric(15,2);
begin
  if new.status <> 'confirmado' then return new; end if;
  select honorarios_valor into v_total from public.arrematacoes where id = new.arrematacao_id;
  select coalesce(sum(valor),0) into v_somado from public.honorarios_recebimentos
    where arrematacao_id = new.arrematacao_id and status = 'confirmado' and id <> new.id;
  if (v_somado + new.valor) > (coalesce(v_total,0) + 0.01) then
    raise exception 'Recebimento de R$ % ultrapassa o saldo de honorários (R$ % já confirmado de R$ % total).', new.valor, v_somado, v_total;
  end if;
  return new;
end $$;

create trigger honorarios_recebimentos_valida_teto
  before insert or update on public.honorarios_recebimentos
  for each row execute function public.honorarios_recebimentos_valida_teto();

-- Quando a soma das partes 'confirmado' bate o total, fecha o honorário sozinho (mesmo
-- efeito que o webhook do MP já fazia para pagamento integral — agora alcançável em
-- pedaços). Ao contrário também: se um recebimento é estornado/apagado e a soma cai abaixo
-- do total de um honorário já 'pago' (mas ainda não 'distribuido'), reabre para 'pendente' —
-- nunca mexe em 'distribuido' (dinheiro já repassado à equipe, requer conferência manual,
-- mesma régua de reverterHonorarioEstornado em api/mp-webhook.js).
create or replace function public.honorarios_recebimentos_fecha_se_completo()
returns trigger language plpgsql as $$
declare
  v_arr uuid := coalesce(new.arrematacao_id, old.arrematacao_id);
  v_total numeric(15,2); v_somado numeric(15,2); v_status text;
begin
  select honorarios_valor, honorarios_status into v_total, v_status from public.arrematacoes where id = v_arr;
  if v_status = 'distribuido' or v_total is null or v_total <= 0 then return coalesce(new, old); end if;
  select coalesce(sum(valor),0) into v_somado from public.honorarios_recebimentos
    where arrematacao_id = v_arr and status = 'confirmado';
  if v_somado >= (v_total - 0.01) and v_status <> 'pago' then
    update public.arrematacoes set honorarios_status = 'pago', honorarios_pago_em = now() where id = v_arr;
  elsif v_somado < (v_total - 0.01) and v_status = 'pago' then
    update public.arrematacoes set honorarios_status = 'pendente', honorarios_pago_em = null where id = v_arr;
  end if;
  return coalesce(new, old);
end $$;

create trigger honorarios_recebimentos_fecha_se_completo
  after insert or update or delete on public.honorarios_recebimentos
  for each row execute function public.honorarios_recebimentos_fecha_se_completo();

-- ── COBRANÇA AVULSA ────────────────────────────────────────────────────────────────────
-- Link genérico pra qualquer motivo fora do catálogo fixo de PROPOSITOS — mesma trava de
-- segurança dos outros (preço sempre lido desta tabela pelo servidor, nunca do body).
create table if not exists public.cobrancas_avulsas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null check (char_length(descricao) >= 5),
  valor numeric(15,2) not null check (valor > 0),
  destinatario_nome text,
  destinatario_email text,
  status text not null default 'aberta' check (status in ('aberta','paga','cancelada')),
  criado_por uuid references auth.users(id),
  pago_em timestamptz,
  gateway_payment_id text unique,
  criado_em timestamptz not null default now()
);

alter table public.cobrancas_avulsas enable row level security;

create policy cobrancas_avulsas_select on public.cobrancas_avulsas
  for select using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role in ('admin','analista')));
create policy cobrancas_avulsas_write on public.cobrancas_avulsas
  for insert with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
create policy cobrancas_avulsas_update on public.cobrancas_avulsas
  for update using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
