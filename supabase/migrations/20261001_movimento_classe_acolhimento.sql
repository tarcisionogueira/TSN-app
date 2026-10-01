-- movimento_classe (SQL) alinhada a classeMovimento (api/_previsao-processo.js, 01/10): código 200
-- e "acolhimento" (de embargos) são DECISÃO do juiz. Sem isto a estatística da base e a previsão
-- de cada processo classificavam o mesmo movimento de jeitos diferentes (forma 7b do CLAUDE.md).
CREATE OR REPLACE FUNCTION public.movimento_classe(p_codigo integer, p_descricao text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_codigo in (51, 15101) or p_descricao ~* '^conclus' then 'conclusao'
    when p_codigo in (22, 848, 246) or p_descricao ~* 'baixa defini|tr[âa]nsito em julgado|arquivamento defini' then 'encerramento'
    when p_codigo in (12164, 11010, 12185, 193, 12444, 219, 898, 12266, 220, 11009, 11021, 200)
      or p_descricao ~* 'decis[ãa]o|despacho|mero expediente|julgament|senten[çc]a|deferi|indeferi|homolog|proced[eê]n|acolhimento' then 'decisao'
    when p_codigo in (92, 1061, 928) or p_descricao ~* 'publica[çc][ãa]o|disponibiliza[çc][ãa]o no di[áa]rio' then 'publicacao'
    when p_codigo in (1051) or p_descricao ~* 'decurso de prazo' then 'prazo'
    when p_codigo in (85, 118) or p_descricao ~* 'peti[çc][ãa]o' then 'peticao'
    when p_codigo in (60, 12265, 12282, 106) or p_descricao ~* 'expedi|mandado|carta' then 'expedicao'
    when p_codigo in (123, 982, 132) or p_descricao ~* 'remessa|recebimento' then 'remessa'
    when p_codigo in (11383) or p_descricao ~* 'ato ordinat' then 'ato_ordinatorio'
    else 'outro' end
$function$;
