-- 15/11 — CONTAR EVIDÊNCIA, NÃO LINHAS (arena 15/11, P1; pendência #484).
--
-- A mesma unidade entrava várias vezes: um relatório gravou "R$ 440 mil / 55 m², Rua Jorge Augusto" 4× no mesmo dia;
-- em Salvador o Porto Trapiche (R$ 4,2 mi / 97 m²) 3× por portais diferentes; em Osasco a mesma casa de 480 m² 4× —
-- a mediana da cidade mudava até +115% ao deduplicar. Regra CONSERVADORA de "mesma unidade": mesma cidade/UF, tipo,
-- espécie, BAIRRO, preço total e área. Bairro diferente NÃO funde (o mesmo "440 mil / 55 m²" no Mandaqui, no Centro e
-- em Perdizes vem de relatórios diferentes e sem link — o problema dessas é prova, não duplicidade). Amostra sem preço
-- total ou área nunca é fundida. Medido: 384 repetidas em 4.912.
--
-- View (nada é apagado; a gravação não muda). Representante: a cópia com link, depois com coordenada geocodificada,
-- depois a mais recente. `n_copias` vai para o selo de prova.
create or replace view public.indice_amostra_indep with (security_invoker = true) as
select distinct on (k.grupo) k.*, count(*) over (partition by k.grupo) as n_copias
from (
  select a.*,
    coalesce(
      case when a.valor_total > 0 and a.area_m2 > 0 then
        a.cidade_norm||'|'||a.uf||'|'||coalesce(a.tipo,'')||'|'||a.especie||'|'||coalesce(a.bairro_norm,'')||'|'||round(a.valor_total)::text||'|'||round(a.area_m2)::text
      end, 'id:'||a.id::text) as grupo
  from public.indice_amostra a
) k
order by k.grupo, (k.url is not null) desc, (k.coord_origem = 'geocodificada') desc nulls last, k.data_ref desc nulls last, k.criado_em desc;

revoke all on public.indice_amostra_indep from public, anon, authenticated;
grant select on public.indice_amostra_indep to service_role;

-- As leituras do Índice passam a contar unidades independentes. Mesma função, só a fonte muda (o corpo é o vigente).
do $$
declare f text; def text;
begin
  foreach f in array array[
    'public.indice_regiao_ponderado(text,text,text,double precision,double precision,text)',
    'public.indice_bairros_cidade(text,text,text)',
    'public.indice_composicao(text,text,text,double precision,double precision,text)',
    'public.indice_valorizacao_anual(text,text,text,text,text,integer)',
    'public.indice_estado_ponderado(text,text)'
  ] loop
    def := pg_get_functiondef(f::regprocedure);
    def := regexp_replace(def, 'public\.indice_amostra(?![a-z_])', 'public.indice_amostra_indep', 'g');
    execute def;
  end loop;
end $$;
