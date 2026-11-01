-- 01/11 — ajuste de 20261101_classificacao_veiculo_titulo_decide: "Frota: 11065" num Gol (PORTALDOSLEILOES) casava com
-- o padrão de modelo VW de 5 dígitos (11.xxx) e o carro virava caminhão. O número de 5 dígitos agora só vale colado em
-- "VW/" ou seguido da linha (Titan, Constellation, Worker, Delivery, Robust). E "SPRINTERF" (sem espaço) é Sprinter.
do $do$
declare def text; n int;
  v1 text := $v$|\y(8|9|11|13|15|17|19|24|25|26|31)\d{3}\y(?=.*\y(vw|volkswagen|titan|constellation|worker|delivery)\y)|$v$;
  n1 text := $v$|\y(vw|volkswagen)\s*/?\s*(8|9|11|13|15|17|19|24|25|26|31)\d{3}\y|\y(8|9|11|13|15|17|19|24|25|26|31)\d{3}\s*(titan|constellation|worker|delivery|robust)\y|$v$;
  v2 text := $v$(sprinter|master|$v$;
  n2 text := $v$(sprinter\w*|master|$v$;
begin
  def := pg_get_functiondef('public.classificar_tipo_veiculo_titulo(text,text,text,text)'::regprocedure);
  n := (length(def) - length(replace(def, v1, ''))) / length(v1);
  if n <> 1 then raise exception 'âncora 1 encontrada % vezes — NÃO aplico às cegas', n; end if;
  n := (length(def) - length(replace(def, v2, ''))) / length(v2);
  if n <> 1 then raise exception 'âncora 2 encontrada % vezes — NÃO aplico às cegas', n; end if;
  execute replace(replace(def, v1, n1), v2, n2);
end $do$;

update public.veiculos_leilao v
   set tipo_veiculo = n.novo
  from (select id, coalesce(public.classificar_tipo_veiculo_titulo(titulo, descricao, marca, modelo), tipo_veiculo,
                            public.classificar_tipo_veiculo_descricao(descricao)) novo
          from public.veiculos_leilao where ativo) n
 where v.id = n.id and v.tipo_veiculo is distinct from n.novo;
