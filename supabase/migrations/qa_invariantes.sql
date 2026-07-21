-- QA — Invariantes de funcionalidade (Camada 1 do "bug bounty de funcionalidades").
-- Asserções determinísticas por botão/feature: cada linha é um invariante com um LIMITE
-- calibrado p/ 0 falso-positivo hoje (alerta quando REGRIDE/cresce). O monitor diário lê
-- e alerta; a aba admin "Qualidade" mostra tudo. Cheap (só SQL), seguro (service_role/admin).
-- gravidade: 'bug' = deveria ser ~0 (defeito) · 'gap' = lacuna de captura (backlog vigiado).
create or replace function public.qa_invariantes()
returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text)
language sql set search_path to 'public' as $function$
  with inv(chave, titulo, categoria, gravidade, valor, limite) as (
    values
     ('edital_eq_matricula','Botão Edital abre a Matrícula','Documentos','bug',
       (select count(*) from imoveis_leilao where ativo and link_edital is not null and link_edital = link_matricula), 8),
     ('matricula_eq_lote','Matrícula aponta p/ a página do lote','Documentos','bug',
       (select count(*) from imoveis_leilao where ativo and link_matricula is not null and link_matricula = url_lote), 8),
     ('aval_incoerente','Avaliação > 10× o lance (mis-read)','Relatório','bug',
       (select count(*) from imoveis_leilao where ativo and valor_avaliacao>0 and valor_minimo>0 and valor_avaliacao > valor_minimo*10), 30),
     ('valor_sentinela','Valor sentinela gravado','Relatório','bug',
       (select count(*) from imoveis_leilao where ativo and (valor_minimo in (999999999,99999999,9999999999,111111111,123456789) or valor_avaliacao in (999999999,99999999,9999999999,111111111,123456789))), 0),
     ('perfil_sem_role','Perfil sem role definido','Conta','bug',
       (select count(*) from perfis where coalesce(role,'')=''), 0),
     ('aval_ausente_com_doc','Lote com edital/anexo mas SEM avaliação','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(valor_avaliacao,0)=0
          and ((case when jsonb_typeof(anexos)='array' then jsonb_array_length(anexos) else 0 end) > 0 or coalesce(link_edital,'') ~* '\.pdf')), 3800),
     ('desconto_ge90','Desconto ≥ 90% (suspeito de mis-read)','Relatório','gap',
       (select count(*) from imoveis_leilao where ativo and desconto_percentual >= 90), 200),
     ('sem_foto','Lote ativo sem foto','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(link_foto,'')=''), 1600),
     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)
  )
  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,
    case when valor > limite then 'alerta' else 'ok' end
  from inv;
$function$;
revoke execute on function public.qa_invariantes() from public, anon, authenticated;
grant execute on function public.qa_invariantes() to service_role;

-- Wrapper admin (definer, admin-gated) para a aba admin "Qualidade".
create or replace function public.admin_qa_invariantes()
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;
  return coalesce((select jsonb_agg(to_jsonb(t)) from public.qa_invariantes() t), '[]'::jsonb);
end $fn$;
revoke execute on function public.admin_qa_invariantes() from public, anon;
grant execute on function public.admin_qa_invariantes() to authenticated;
