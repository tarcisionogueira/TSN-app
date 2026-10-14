-- 14/10 (dono: "carros sem FIPE" e "falha no motor funcionando — são os dois dados com que decido").
--
-- (1) FIPE DA FICHA DA SUPERBID. A oferta traz `valortabelafipe` (~54% dos carros, amostra de 500 em 14/10).
--     O coletor grava em `valor_fipe_leiloeiro`; este trigger só o usa quando NÃO há FIPE consultada por nós
--     (valor nulo ou status sem_match/sem_dados), marcando fipe_status = 'leiloeiro' — a tela e o relatório
--     dizem "informada pelo leiloeiro, não conferida". FIPE consultada ('ok'/'aproximado') nunca é sobrescrita.
--     Segundo trigger (e não troca do existente) para não precisar de DROP: os dois chamam a mesma função.
alter table public.veiculos_leilao add column if not exists valor_fipe_leiloeiro numeric;

create or replace function public.veiculo_desconto_fipe()
returns trigger language plpgsql set search_path = public as $$
declare d integer;
begin
  if new.valor_fipe_leiloeiro > 0
     and (new.valor_fipe is null or coalesce(new.fipe_status, '') in ('', 'sem_match', 'sem_dados', 'leiloeiro')) then
    if new.valor_fipe is distinct from new.valor_fipe_leiloeiro then new.fipe_atualizado_em := now(); end if;
    new.valor_fipe := new.valor_fipe_leiloeiro;
    new.fipe_status := 'leiloeiro';
  end if;
  d := null;
  if new.valor_fipe > 0 and new.valor_minimo > 0 and new.valor_minimo < new.valor_fipe then
    d := round((1 - new.valor_minimo::numeric / new.valor_fipe) * 100);
    if d <= 0 or d > 95 then d := null; end if;
  end if;
  new.desconto_fipe_percentual := d;
  return new;
end $$;

create trigger trg_veiculo_fipe_leiloeiro
  before insert or update of valor_fipe_leiloeiro on public.veiculos_leilao
  for each row execute function public.veiculo_desconto_fipe();

-- (2) MOTOR: frases medidas no acervo que escapavam do classificador (seco em 14/10: 58 veículos mudam —
--     26 viram 'funciona', 23 'nao_funciona', 7 'nao_testado', 2 'nao_testado'→'nao_funciona').
--     Os ~4,8 mil carros SUPERBID sem classificação NÃO são falha de leitura: o anúncio não diz nada do motor
--     (texto padrão de retirada, ou só o número de série "motor nar026367").
create or replace function public.motor_status_do_texto(p text) returns text
language plpgsql immutable set search_path = public as $f$
declare t text := lower(coalesce(p, '')); v text; nao_testado boolean := false;
begin
  v := substring(t from 'motor\s*:\s*([^:]{1,45})');
  if v is not null then
    if v ~ '^\s*(n[ãa]o informado|sem informa)' then v := null;
    elsif v ~ '^\s*(n[ãa]o testado|n[ãa]o verificado|sem teste|possui motor n[ãa]o testado)' then nao_testado := true;
    elsif v ~ '^\s*(avariad|n[ãa]o funciona|travad|fundid|sem funcionamento|danificad|desmontad|faltando|inexistente|ausente|retirad|com defeito|quebrad|inserv[íi]vel|queimad)' then return 'nao_funciona';
    elsif v ~ '^\s*(funcionando|funciona\M|funcional\M|em funcionamento|ok\M|bom\M|regular\M)' then return 'funciona';
    end if;
  end if;
  if t ~ '\msem motor\M(?!\s+de\s+arranque)|motor\s+(fundido|fundindo|travado|avariado|danificado|desmontado|batido|inserv[íi]vel|queimad[oa])|motor\s+parado\s+sem\s+funcionamento|(ve[íi]culo|motor)[^.;]{0,30}parado\s+sem\s+funcionar|sem\s+funcionamento\s+h[áa]\s|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+n[ãa]o\s+(funciona|liga|d[áa] partida|pega)|n[ãa]o se encontra funcionando|motor\s+n[ãa]o\s+funciona|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus|equipamento)\s+n[ãa]o\s+(est[áa]|se\s+encontra)\s+em\s+funcionamento|n[ãa]o\s+est[áa]\s+em\s+funcionamento\s+conforme\s+informado'
     -- 14/10: frases medidas no acervo que escapavam ("Com Avarias Não Funcionando", padrão Superbid;
     -- "não está funcionando"; "veículo sem funcionamento" — mas não "sem funcionamento DO ar-condicionado")
     or t ~ 'avarias\s+n[ãa]o\s+funcionando|n[ãa]o\s+est[áa]\s+funcionando|\msem\s+funcionamento\M(?!\s+d[oae]s?\s)' then
    return 'nao_funciona';
  end if;
  if t ~ '(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+(funcionando|em funcionamento|funciona\M(?!\s*\?))|motor\s+(e\s+c[âa]mbio\s+)?funciona(l|is)\M|motor\s+e\s+c[âa]mbio\s+funcionando|motor\s+(d[áa]|dando)\s+partida|liga e anda|anda e liga|est[áa] andando|motor\s+ok\M|motoriza[çc][ãa]o\s+funcionando|bom\s+estado\s+de\s+(uso|conserva[çc][ãa]o)\s+e\s+funcionamento|bom\s+estado\s+de\s+funcionamento|funcionamento\s*-\s*(bom|regular)\M|todos\s+os\s+sistemas\s+em\s+funcionamento'
     -- 14/10: "Com Avarias Funcionando" (Superbid), "ótimo/regular estado de [uso,] conservação e funcionamento",
     -- "estado regular de uso, conservação e funcionamento", vistoria "teste de funcionamento ... não tendo sido
     -- constatadas anormalidades", oficial de justiça "Obs.: Em funcionamento".
     or t ~ 'avarias\s+funcionando|(bom|[óo]timo|regular|excelente)\s+estado\s+de\s+(?:(?!garantia|sem\s|n[ãa]o\s)[^.;:]){0,35}\mfuncionamento\M|estado\s+(bom|[óo]timo|regular)\s+de\s+(?:(?!garantia|sem\s|n[ãa]o\s)[^.;:]){0,35}\mfuncionamento\M|teste\s+de\s+funcionamento[^.]{0,40}n[ãa]o\s+tendo\s+sido\s+constatad[oa]s\s+anormalidades|:\s*em\s+funcionamento\M' then
    return 'funciona';
  end if;
  if nao_testado or t ~ 'motor\s+n[ãa]o\s+testado|n[ãa]o\s+(foi|[ée]|sendo)?\s*poss[íi]vel\s+(aferir|verificar|realizar\s+testes?\s+de|avaliar(\s+as\s+condi[çc][õo]es\s+de)?)\s+(o\s+)?funcionamento|sistema\s+de\s+partida\s+n[ãa]o\s+testado|parte\s+mec[âa]nica\s+n[ãa]o\s+testada|n[ãa]o\s+foram\s+realizad[oa]s\s+testes|mec[âa]nica\s+sem\s+test|n[ãa]o\s+tiveram\s+funcionamento\s+informado'
     or t ~ 'n[ãa]o\s+foi\s+constatado\s+o\s+funcionamento|n[ãa]o\s+foi\s+poss[íi]vel\s+dar\s+partida' then
    return 'nao_testado';
  end if;
  if t ~ 'motor\s+serv[íi]vel' then return 'servivel'; end if;
  return null;
end
$f$;

-- Reaplica só onde muda (poucas dezenas de linhas).
update public.veiculos_leilao
   set motor_status = coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                               public.motor_nao_funciona_do_documento(motor_doc_texto))
 where ativo and motor_status is distinct from coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                                                        public.motor_nao_funciona_do_documento(motor_doc_texto));
