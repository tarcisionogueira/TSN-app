-- 01/11 — mesma regra da Busca.jsx nas RPCs de raio: o balde 'imovel' deixa de entrar em todo filtro de tipo (quem pedia
-- "Apartamento" recebia os lotes sem tipo). Quem quiser os genéricos usa o botão "Tipo não informado" (tipos_filtro={imovel}).
do $do$
declare f text; def text; n int; velho text := $v$ or i.tipo = 'imovel')$v$; novo text := ')';
begin
  foreach f in array array['public.buscar_por_raio_v2(double precision,double precision,double precision,integer,integer,text[],text,text[],text[],double precision,double precision,double precision,text,text,boolean,text,text)',
                           'public.buscar_por_raio_v2_sem_geocode_count(text,text[],text,text[],text[],double precision,double precision,double precision,text,text,boolean,text)'] loop
    def := pg_get_functiondef(f::regprocedure);
    n := (length(def) - length(replace(def, velho, ''))) / length(velho);
    if n = 0 and position('tipos_filtro' in def) > 0 then raise notice '% já aplicado', f; continue; end if;
    if n <> 1 then raise exception 'âncora em % encontrada % vezes — NÃO aplico às cegas', f, n; end if;
    execute replace(def, velho, novo);
  end loop;
end $do$;
