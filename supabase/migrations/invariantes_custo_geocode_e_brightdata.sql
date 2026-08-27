-- Três vigias para que os erros de custo de 26/08 não se repitam. Consertar o consumo de
-- hoje não impede o de amanhã — o que impede é alguém perceber ANTES da fatura.
--   1. brightdata_proposito_sem_teto — propósito consumindo sem freio (o buraco de hoje:
--      'geral' e 'pecini' comeram 162 das 530 chamadas da semana).
--   2. geocode_acima_da_cota — consumo do mês PROJETADO contra os 10.000 gratuitos, para
--      acusar no meio do mês e não no fim.
--   3. geocode_retentativa_infinita — se o teto de tentativas for removido ou furado.
-- Inserção pelo texto da função, sem redigitar 22 KB de SQL: é assim que se perde um
-- invariante antigo sem ninguém notar.
do $do$
declare
  v_src text;
  v_ancora text := $anc$     ('lote_sem_area_nem_matricula','Lote sem metragem E sem matricula para recupera-la','Captura','gap',$anc$;
  v_novos text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes' limit 1;
  if v_src is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('brightdata_proposito_sem_teto' in v_src) > 0 then return; end if;

  v_novos := $novos$     ('brightdata_proposito_sem_teto','Proposito do Bright Data consumindo sem teto cadastrado','Captura','bug',
       (select count(*) from brightdata_uso_proposito p
         where p.semana = date_trunc('week', now())::date
           and not exists (select 1 from brightdata_reserva r where r.proposito = p.proposito)), 0),
     ('geocode_acima_da_cota','Geocoding do Google projetado acima dos 10.000 gratuitos do mes','Captura','gap',
       (select coalesce(round(sum(requests) * 30.0 /
                greatest(extract(day from now())::int, 1))::bigint, 0)
          from uso_integracoes
         where provedor = 'google_geocode' and dia >= date_trunc('month', now())::date), 10000),
     ('geocode_retentativa_infinita','Imovel re-geocodificado 3+ vezes e ainda impreciso (teto de tentativas furado)','Captura','bug',
       (select count(*) from imoveis_leilao
         where ativo and geocod_nivel in ('cidade','falhou') and coalesce(geocod_tentativas,0) > 3), 0),
$novos$;
  v_src := replace(v_src, v_ancora, v_novos || v_ancora);
  execute v_src;
end
$do$;
