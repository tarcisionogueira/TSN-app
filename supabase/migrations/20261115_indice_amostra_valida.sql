-- 15/11 — link morto (404/410, domínio inexistente, página genérica no lugar do anúncio — indice_link_prova) não
-- sustenta número: sai também das leituras SQL do Índice (a consulta da tela já filtra em api/indice-consulta.js).
create or replace view public.indice_amostra_valida with (security_invoker = true) as
  select * from public.indice_amostra_indep where prova <> 'morto';
revoke all on public.indice_amostra_valida from public, anon, authenticated;
grant select on public.indice_amostra_valida to service_role;

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
    def := regexp_replace(def, 'public\.indice_amostra_indep(?![a-z_])', 'public.indice_amostra_valida', 'g');
    execute def;
  end loop;
end $$;
