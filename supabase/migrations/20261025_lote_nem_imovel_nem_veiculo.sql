-- SÓ IMÓVEL E VEÍCULO NO ACERVO (25/10, print do dono: cotas de consórcio, cromatógrafo/analisador da Petrobras e
-- "reboque área de vivência" aparecendo na busca de veículos).
--
-- Causa: a Superbid CLASSIFICA ERRADO e o coletor confiava na categoria dela — consórcio vem como "Carros & Motos /
-- Consórcio autos", trailer sanitário como "Caminhões & Ônibus / Sanitário", equipamento de laboratório da
-- Petrobras como "Mini-Motos". Junto entravam PEÇAS e EQUIPAMENTOS soltos (motor, cabine, carroceria, caçamba,
-- eixo, container, compactador de lixo, munck, miniaturas). Medido no acervo ativo: 62 veículos (61 SUPERBID,
-- 1 LJUD) e 16 "imóveis" SUPERBID que são cota de consórcio.
--
-- Regra pelo INÍCIO do título (o substantivo do lote), não por palavra solta: "CAMINHÃO ... com carroceria" fica,
-- "CARROCERIA METÁLICA BASCULANTE" sai. Gatilho no banco (vale para TODO coletor, como a fração ideal e a vaga),
-- com nome zz para rodar depois dos outros BEFORE. Os já gravados saem na próxima escrita do coletor.
create or replace function public.lote_nao_e_veiculo(p_titulo text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  with t as (select btrim(regexp_replace(lower(coalesce(p_titulo,'')), '^(lote\s*\d+\s*[-:.]?\s*|ve[íi]culo\s*:\s*)', '')) as s)
  select s ~ '^(cota\y|cotas\y|carta de cr[eé]dito|container|cont[eê]iner|\d*\s*miniaturas?|motor(es)?\y|cabine\y|carroceria\y|caixa\y|caixote|eixos?\y|bal[ãa]o\y|equipamento|compactador|cromat|analisador|cadeiras?\y|patinete|pe[çc]as?\y|kit\y|pneus?\y|rodas?\y|sucata de (estrutura|diferencial|motor|pe[çc]as))'
      or s ~ '[aá]rea de viv[eê]ncia|cons[oó]rcio'
  from t;
$function$;

create or replace function public.lote_e_cota_consorcio(p_titulo text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(p_titulo,'') ~* '(^|\W)(cotas? de cons[oó]rcio|carta de cr[eé]dito)';
$function$;

create or replace function public.veiculo_barrar_nao_veiculo()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.ativo and public.lote_nao_e_veiculo(new.titulo) then
    new.ativo := false;
    new.suprimido_motivo := 'nao_veiculo';
  end if;
  return new;
end;
$function$;

create or replace function public.imovel_barrar_consorcio()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.ativo and public.lote_e_cota_consorcio(new.titulo) then
    new.ativo := false;
    new.suprimido_motivo := 'nao_imovel';
  end if;
  return new;
end;
$function$;

create or replace trigger trg_zz_veiculo_nao_veiculo before insert or update on public.veiculos_leilao
  for each row execute function public.veiculo_barrar_nao_veiculo();

create or replace trigger trg_zz_imovel_consorcio before insert or update on public.imoveis_leilao
  for each row execute function public.imovel_barrar_consorcio();
