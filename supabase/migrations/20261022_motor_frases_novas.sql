-- 22/10 (dono: "há muito poucos carros com motor funcionando, está correto?"). Medido: 79% dos ativos
-- (10.129 de 12.796) não dizem nada do motor no anúncio — SUPERBID 77%, LJUD 82%: isso é a fonte, não
-- leitura. Mas ~200 sem classificação tinham pista no texto e escapavam por forma de frase:
--   funciona   "(funcionando)" · "em bom estado funcionando" · "completo funcionando tudo" ·
--              "funcionando perfeitamente" · "partida e engrena" · "04 portas, funcionando, conforme auto" ·
--              "em funcionamento e bom estado" · "motor e cambio funcionameto normal"
--   nao_func.  "parou funcionando" · "que não está em funcionamento" (sem sujeito) ·
--              "péssimo estado de conservação e funcionamento" · "ruim estado de funcionamento"
-- Ficam de fora de propósito: "ar-condicionado funcionando", "implementos não funciona" (não é o motor) e
-- o texto-padrão "sem garantia de funcionamento" / "desconhecimento de suas condições ... funcionamento".
create or replace function public.motor_status_do_texto(p text)
 returns text
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
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
     or t ~ 'avarias\s+n[ãa]o\s+funcionando|n[ãa]o\s+est[áa]\s+funcionando|\msem\s+funcionamento\M(?!\s+d[oae]s?\s)'
     -- 22/10
     or t ~ '\mparou\s+(de\s+)?funciona(ndo|r)\M|(que|\()\s*n[ãa]o\s+est[áa]\s+em\s+funcionamento|(p[ée]ssimo|ruim|mau)\s+estado\s+de\s+(conserva[çc][ãa]o\s+e\s+)?funcionamento' then
    return 'nao_funciona';
  end if;
  if t ~ '(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+(funcionando|em funcionamento|funciona\M(?!\s*\?))|motor\s+(e\s+c[âa]mbio\s+)?funciona(l|is)\M|motor\s+e\s+c[âa]mbio\s+funcionando|motor\s+(d[áa]|dando)\s+partida|liga e anda|anda e liga|est[áa] andando|motor\s+ok\M|motoriza[çc][ãa]o\s+funcionando|bom\s+estado\s+de\s+(uso|conserva[çc][ãa]o)\s+e\s+funcionamento|bom\s+estado\s+de\s+funcionamento|funcionamento\s*-\s*(bom|regular)\M|todos\s+os\s+sistemas\s+em\s+funcionamento'
     or t ~ 'avarias\s+funcionando|(bom|[óo]timo|regular|excelente)\s+estado\s+de\s+(?:(?!garantia|sem\s|n[ãa]o\s)[^.;:]){0,35}\mfuncionamento\M|estado\s+(bom|[óo]timo|regular)\s+de\s+(?:(?!garantia|sem\s|n[ãa]o\s)[^.;:]){0,35}\mfuncionamento\M|teste\s+de\s+funcionamento[^.]{0,40}n[ãa]o\s+tendo\s+sido\s+constatad[oa]s\s+anormalidades|:\s*em\s+funcionamento\M'
     -- 22/10
     or t ~ '\(funcionando\)|(bom\s+estado|completo)\s*,?\s+funcionando\M|(?<!ar[- ]condicionado )(?<!ar )funcionando\s+perfeitamente|\mpartida\s+e\s+engrena|portas\s*,\s*funcionando\M|\mem\s+funcionamento\s+e\s+(bom|[óo]timo|regular)\s+estado|motor\s+e\s+c[âa]mbio\s+funcionam[e]?to' then
    return 'funciona';
  end if;
  if nao_testado or t ~ 'motor\s+n[ãa]o\s+testado|n[ãa]o\s+(foi|[ée]|sendo)?\s*poss[íi]vel\s+(aferir|verificar|realizar\s+testes?\s+de|avaliar(\s+as\s+condi[çc][õo]es\s+de)?)\s+(o\s+)?funcionamento|sistema\s+de\s+partida\s+n[ãa]o\s+testado|parte\s+mec[âa]nica\s+n[ãa]o\s+testada|n[ãa]o\s+foram\s+realizad[oa]s\s+testes|mec[âa]nica\s+sem\s+test|n[ãa]o\s+tiveram\s+funcionamento\s+informado'
     or t ~ 'n[ãa]o\s+foi\s+constatado\s+o\s+funcionamento|n[ãa]o\s+foi\s+poss[íi]vel\s+dar\s+partida'
     -- 22/10: "não foi possível certificar o seu devido funcionamento"
     or t ~ 'n[ãa]o\s+foi\s+poss[íi]vel\s+certificar\s+o\s+(seu\s+)?(devido\s+)?funcionamento' then
    return 'nao_testado';
  end if;
  if t ~ 'motor\s+serv[íi]vel' then return 'servivel'; end if;
  return null;
end
$function$;

-- Reclassifica só o que muda (mesma expressão do trg_veiculo_motor_status).
update public.veiculos_leilao
   set motor_status = coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                               public.motor_nao_funciona_do_documento(motor_doc_texto))
 where ativo and motor_status is distinct from coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                                                        public.motor_nao_funciona_do_documento(motor_doc_texto));
