-- 07/10 (dono): serviço de cartório cobrado por BOLETO (R$ 3,49 fixo no MP, contra 1% do Pix) e, quando o
-- cartório tem tabela prévia (certidão de matrícula, inteiro teor...), as CUSTAS do cartório vão no MESMO
-- boleto da remuneração. No registro as custas só saem na devolutiva (faixa de valor do imóvel): viram uma
-- parcela 'custas' cobrada depois do protocolo — não travam a entrada, travam o 'registrado'.
alter table public.cobrancas_avulsas add column if not exists meio text check (meio in ('boleto'));
alter table public.servicos_cartorio_parcelas add column if not exists custas numeric(15,2) not null default 0 check (custas >= 0);
alter table public.servicos_cartorio_parcelas drop constraint if exists servicos_cartorio_parcelas_valor_check;
alter table public.servicos_cartorio_parcelas add constraint servicos_cartorio_parcelas_valor_check check (valor >= 0 and valor + custas > 0);

create or replace function public.servico_cartorio_trava_protocolo()
returns trigger language plpgsql as $$
begin
  -- regra_negocio 'cartorio.paga_antes_da_entrada' (dono, 07/10): parcelas do SERVIÇO pagas antes do protocolo.
  -- As custas que o cartório só informa na devolutiva (momento 'custas', ex.: registro por faixa de valor)
  -- vêm DEPOIS do protocolo: não travam a entrada, mas travam o 'registrado'.
  if old.status is distinct from new.status
     and coalesce((select (valor)::text::boolean from public.regra_negocio where chave = 'cartorio.paga_antes_da_entrada' and ativo), true) then
    if new.status = 'protocolado' and exists (select 1 from public.servicos_cartorio_parcelas p
         where p.servico_id = new.id and p.momento <> 'custas' and p.status not in ('paga','cancelada')) then
      raise exception 'Há parcela não paga: o cliente paga antes de darmos entrada no cartório.' using errcode = 'P0001';
    end if;
    if new.status = 'registrado' and exists (select 1 from public.servicos_cartorio_parcelas p
         where p.servico_id = new.id and p.status not in ('paga','cancelada')) then
      raise exception 'Há valor não pago (serviço ou custas do cartório): conclua o pagamento antes de marcar como registrado.' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'protocolado' and new.protocolado_em is null then new.protocolado_em := now(); end if;
  if new.status = 'registrado' and new.registrado_em is null then new.registrado_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;
