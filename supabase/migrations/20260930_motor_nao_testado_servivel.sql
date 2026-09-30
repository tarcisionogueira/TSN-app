-- 30/09 (dono: "muitos veículos não estão classificados se o motor funciona ou não").
-- Medido no acervo ativo: 8.766 sem classificação. Duas declarações REAIS caíam em "não informado":
--   • "Motor: Não testado" / "Sem teste" / "possui motor não testado" / "não sendo possível aferir o
--     funcionamento" / "sistema de partida não testado" (SUPERBID, 254+) → 'nao_testado'
--   • "Sucata — Motor Servível" (classificação DETRAN/PRF, 1.029 motos) → 'servivel' (motor
--     aproveitável como peça; NÃO quer dizer que o veículo funciona)
-- e frases de funcionamento que a regra não lia: "funcionamento - bom/regular" (estado geral),
-- "motor e câmbio funcionando", "todos os sistemas em funcionamento", "está andando; está engrenando",
-- "em bom estado de funcionamento e conservação". Texto padrão ("sem garantia de funcionamento",
-- "verificação do funcionamento do motor, câmbio…") continua SEM classificar — não é declaração.
-- O restante sem classificação (LJUD 1.327 sem nenhuma menção a motor na descrição, etc.) é, de fato,
-- não informado pelo leiloeiro.

alter table public.veiculos_leilao drop constraint if exists veiculos_leilao_motor_status_check;
alter table public.veiculos_leilao add constraint veiculos_leilao_motor_status_check
  check (motor_status in ('funciona', 'nao_funciona', 'nao_testado', 'servivel'));

create or replace function public.motor_status_do_texto(p text) returns text
language plpgsql immutable set search_path = public as $f$
declare t text := lower(coalesce(p, '')); v text; nao_testado boolean := false;
begin
  v := substring(t from 'motor\s*:\s*([^:]{1,45})');
  if v is not null then
    if v ~ '^\s*(n[ãa]o informado|sem informa)' then v := null;
    -- "Motor: não testado" NÃO encerra: a mesma descrição pode dizer "motor não funciona" depois
    -- (medido 30/09 — a versão anterior devolvia null aqui e perdia a frase forte).
    elsif v ~ '^\s*(n[ãa]o testado|n[ãa]o verificado|sem teste|possui motor n[ãa]o testado)' then nao_testado := true;
    elsif v ~ '^\s*(avariad|n[ãa]o funciona|travad|fundid|sem funcionamento|danificad|desmontad|faltando|inexistente|ausente|retirad|com defeito|quebrad|inserv[íi]vel|queimad)' then return 'nao_funciona';
    elsif v ~ '^\s*(funcionando|funciona\M|em funcionamento|ok\M|bom\M|regular\M)' then return 'funciona';
    end if;
  end if;
  if t ~ '\msem motor\M(?!\s+de\s+arranque)|motor\s+(fundido|fundindo|travado|avariado|danificado|desmontado|batido|inserv[íi]vel|queimad[oa])|motor\s+parado\s+sem\s+funcionamento|(ve[íi]culo|motor)[^.;]{0,30}parado\s+sem\s+funcionar|sem\s+funcionamento\s+h[áa]\s|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+n[ãa]o\s+(funciona|liga|d[áa] partida|pega)|n[ãa]o se encontra funcionando|motor\s+n[ãa]o\s+funciona' then
    return 'nao_funciona';
  end if;
  if t ~ '(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+(funcionando|em funcionamento|funciona\M(?!\s*\?))|motor\s+e\s+c[âa]mbio\s+funcionando|motor\s+(d[áa]|dando)\s+partida|liga e anda|anda e liga|est[áa] andando|motor\s+ok\M|motoriza[çc][ãa]o\s+funcionando|bom\s+estado\s+de\s+(uso|conserva[çc][ãa]o)\s+e\s+funcionamento|bom\s+estado\s+de\s+funcionamento|funcionamento\s*-\s*(bom|regular)\M|todos\s+os\s+sistemas\s+em\s+funcionamento' then
    return 'funciona';
  end if;
  if nao_testado or t ~ 'motor\s+n[ãa]o\s+testado|n[ãa]o\s+(sendo\s+)?poss[íi]vel\s+aferir\s+o\s+funcionamento|sistema\s+de\s+partida\s+n[ãa]o\s+testado|parte\s+mec[âa]nica\s+n[ãa]o\s+testada' then
    return 'nao_testado';
  end if;
  if t ~ 'motor\s+serv[íi]vel' then return 'servivel'; end if;
  return null;
end $f$;

-- Reaplica no acervo (o gatilho só roda em insert/update de título/descrição/trecho do documento).
update public.veiculos_leilao v
   set motor_status = coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                               public.motor_nao_funciona_do_documento(motor_doc_texto))
 where motor_status is distinct from coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                                              public.motor_nao_funciona_do_documento(motor_doc_texto));
