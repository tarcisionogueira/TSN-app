-- 10/10 (dono: "muitos veículos sem identificação do funcionamento do motor — estamos filtrando certo?").
-- O FILTRO está certo (/veiculos lê motor_status); o que faltava era TEXTO e algumas formas de dizer.
--   · A causa grande era o coletor: LJUD gravava `descricao = título` em 1.608 de 1.635 veículos (sem
--     texto, nada a classificar) — corrigido em scripts/scraper-puppeteer.mjs (nm_descricao da API).
--   · Formas reais que escapavam (medidas no acervo sem classificação, ~150 lotes):
--       funciona     — "motor funcional", "motor e câmbio funcionais"
--       nao_funciona — "não está / não se encontra em funcionamento"
--       nao_testado  — "não foi possível aferir/verificar/realizar testes de/avaliar as condições de
--                       funcionamento", "não foram realizados testes", "mecânica sem teste",
--                       "não tiveram funcionamento informado"
-- Cláusula padrão ("sem garantia de funcionamento", "recomenda-se verificar o funcionamento do motor")
-- continua SEM classificar — não é declaração sobre o lote.
create or replace function public.motor_status_do_texto(p text)
 returns text language plpgsql immutable set search_path to 'public'
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
  if t ~ '\msem motor\M(?!\s+de\s+arranque)|motor\s+(fundido|fundindo|travado|avariado|danificado|desmontado|batido|inserv[íi]vel|queimad[oa])|motor\s+parado\s+sem\s+funcionamento|(ve[íi]culo|motor)[^.;]{0,30}parado\s+sem\s+funcionar|sem\s+funcionamento\s+h[áa]\s|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+n[ãa]o\s+(funciona|liga|d[áa] partida|pega)|n[ãa]o se encontra funcionando|motor\s+n[ãa]o\s+funciona|(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus|equipamento)\s+n[ãa]o\s+(est[áa]|se\s+encontra)\s+em\s+funcionamento|n[ãa]o\s+est[áa]\s+em\s+funcionamento\s+conforme\s+informado' then
    return 'nao_funciona';
  end if;
  if t ~ '(ve[íi]culo|motor|carro|moto|caminh[ãa]o|[ôo]nibus)\s+(funcionando|em funcionamento|funciona\M(?!\s*\?))|motor\s+(e\s+c[âa]mbio\s+)?funciona(l|is)\M|motor\s+e\s+c[âa]mbio\s+funcionando|motor\s+(d[áa]|dando)\s+partida|liga e anda|anda e liga|est[áa] andando|motor\s+ok\M|motoriza[çc][ãa]o\s+funcionando|bom\s+estado\s+de\s+(uso|conserva[çc][ãa]o)\s+e\s+funcionamento|bom\s+estado\s+de\s+funcionamento|funcionamento\s*-\s*(bom|regular)\M|todos\s+os\s+sistemas\s+em\s+funcionamento' then
    return 'funciona';
  end if;
  if nao_testado or t ~ 'motor\s+n[ãa]o\s+testado|n[ãa]o\s+(foi|[ée]|sendo)?\s*poss[íi]vel\s+(aferir|verificar|realizar\s+testes?\s+de|avaliar(\s+as\s+condi[çc][õo]es\s+de)?)\s+(o\s+)?funcionamento|sistema\s+de\s+partida\s+n[ãa]o\s+testado|parte\s+mec[âa]nica\s+n[ãa]o\s+testada|n[ãa]o\s+foram\s+realizad[oa]s\s+testes|mec[âa]nica\s+sem\s+test|n[ãa]o\s+tiveram\s+funcionamento\s+informado' then
    return 'nao_testado';
  end if;
  if t ~ 'motor\s+serv[íi]vel' then return 'servivel'; end if;
  return null;
end $function$;

-- Reaplica no acervo ativo (o gatilho só roda quando título/descrição mudam).
update public.veiculos_leilao v
   set motor_status = coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                               public.motor_nao_funciona_do_documento(motor_doc_texto))
 where ativo and motor_status is distinct from coalesce(public.motor_status_do_texto(coalesce(titulo, '') || ' ' || coalesce(descricao, '')),
                                              public.motor_nao_funciona_do_documento(motor_doc_texto));
