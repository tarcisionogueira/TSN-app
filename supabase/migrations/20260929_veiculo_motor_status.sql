-- 29/09 — FILTRO "MOTOR" NOS VEÍCULOS (pedido do dono).
--
-- Medido em 29/09: só ~7% dos ~9.200 veículos ativos dizem algo sobre o motor (Superbid no bloco
-- de vistoria "motor: funcionando", Sodré em "motor: danificado"; LJUD nunca). NULL = NÃO
-- INFORMADO pelo leiloeiro — não é "funciona" nem "não funciona", e a tela diz isso.
--
-- Armadilhas que a regra evita (conferidas numa amostra de 20/20):
--   · "vendido sem garantia de funcionamento" — cláusula de todo edital, não informa nada;
--   · "motor: não testado" — é "não sei", fica NULL;
--   · "veículo funcionando, ar condicionado não funciona" — a negação é de OUTRA peça: frase livre
--     só conta com sujeito colado (veículo/motor/carro/moto/caminhão/ônibus).
-- O campo estruturado "motor: <valor>" vence a frase livre.
create or replace function public.motor_status_do_texto(p text) returns text
language plpgsql immutable set search_path = public as $f$
declare t text := lower(coalesce(p, '')); v text;
begin
  v := substring(t from 'motor\s*:\s*([^:]{1,45})');
  if v is not null then
    if v ~ '^\s*(n[ãa]o testado|n[ãa]o verificado|n[ãa]o informado|sem informa)' then return null; end if;
    if v ~ '^\s*(avariad|n[ãa]o funciona|travad|fundid|sem funcionamento|danificad|desmontad|faltando|inexistente|ausente|retirad|com defeito|quebrad)' then return 'nao_funciona'; end if;
    if v ~ '^\s*(funcionando|funciona\M|em funcionamento|ok\M|bom\M|regular\M)' then return 'funciona'; end if;
  end if;
  if t ~ '\msem motor\M|motor\s+(fundido|fundindo|travado|avariado|danificado|desmontado|batido)|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+n[ãa]o\s+(funciona|liga|d[áa] partida|pega)|n[ãa]o se encontra funcionando|motor\s+n[ãa]o\s+funciona' then
    return 'nao_funciona';
  end if;
  if t ~ '(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+(funcionando|em funcionamento|funciona\M)|motor\s+(d[áa]|dando)\s+partida|liga e anda|anda e liga|motor\s+ok\M' then
    return 'funciona';
  end if;
  return null;
end $f$;

alter table public.veiculos_leilao add column if not exists motor_status text
  check (motor_status in ('funciona', 'nao_funciona'));

create or replace function public.trg_veiculo_motor_status() returns trigger
language plpgsql set search_path = public as $f$
begin
  new.motor_status := public.motor_status_do_texto(coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, ''));
  return new;
end $f$;

drop trigger if exists trg_veiculo_motor_status on public.veiculos_leilao;
create trigger trg_veiculo_motor_status before insert or update of titulo, descricao
  on public.veiculos_leilao for each row execute function public.trg_veiculo_motor_status();

create index if not exists veiculos_leilao_motor_status on public.veiculos_leilao (motor_status) where ativo;

-- Acervo: grava direto (sem reescrever título/descrição, para não disparar os outros triggers à toa).
update public.veiculos_leilao
   set motor_status = public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, ''))
 where ativo and motor_status is distinct from public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, ''));
