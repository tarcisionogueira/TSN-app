-- Região de interesse derivada da cidade do cadastro (14/08).
--
-- RELATADO PELO DONO acompanhando o cadastro do João Paulo: "criou a conta e não puxou
-- automaticamente o estado e a cidade dele".
--
-- O QUE ACONTECIA. A cidade ERA capturada — `perfis.endereco_cidade` = 'Santana de Parnaíba',
-- `endereco_uf` = 'SP', gravadas pelo `CompletarCadastroModal`, que no mesmo patch também
-- preenchia `cidades_interesse`. O que apagava era o passo SEGUINTE: a triagem de perfil tinha
-- uma última pergunta OPCIONAL de "cidade/região de interesse" e, ao concluir, salvava sempre
--     cidades_interesse: f.cidade.trim() ? [{...}] : []
-- Ou seja: quem pulava a pergunta opcional — o comportamento natural, já que a cidade tinha
-- acabado de ser informada — fazia a triagem sobrescrever com ARRAY VAZIO o que o cadastro
-- tinha preenchido dois minutos antes. Pergunta opcional em branco não deveria apagar dado; ali
-- apagava. Medido no acervo: **7 perfis** com cidade conhecida e interesse vazio.
--
-- A pergunta opcional já saiu da triagem (mesmo dia, a pedido do dono, por ser redundante com a
-- cidade do cadastro). Isto aqui fecha os outros dois lados:
--   1. BACKFILL dos 7 que já foram apagados;
--   2. TRIGGER que deriva a região da cidade sempre que ela for conhecida e o interesse estiver
--      vazio — assim não depende de qual tela gravou a cidade, nem de a pessoa responder nada.
--      É o "puxar automaticamente" que o dono pediu.
--
-- O trigger NÃO sobrescreve interesse já preenchido: quem escolheu suas regiões manda. E o raio
-- de 50 km é o mesmo padrão que as duas telas já usavam.

create or replace function public.perfis_preencher_regiao_interesse()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if coalesce(btrim(new.endereco_cidade), '') <> ''
     and coalesce(btrim(new.endereco_uf), '') <> ''
     and coalesce(jsonb_array_length(new.cidades_interesse), 0) = 0 then
    new.cidades_interesse := jsonb_build_array(jsonb_build_object(
      'cidade', btrim(new.endereco_cidade),
      'uf', upper(btrim(new.endereco_uf)),
      'raio_km', 50));
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_perfis_regiao_interesse on public.perfis;
create trigger trg_perfis_regiao_interesse
  before insert or update of endereco_cidade, endereco_uf, cidades_interesse on public.perfis
  for each row execute function public.perfis_preencher_regiao_interesse();

-- Backfill dos que já tinham sido esvaziados. Idempotente.
update public.perfis
   set cidades_interesse = jsonb_build_array(jsonb_build_object(
         'cidade', btrim(endereco_cidade), 'uf', upper(btrim(endereco_uf)), 'raio_km', 50))
 where coalesce(btrim(endereco_cidade), '') <> ''
   and coalesce(btrim(endereco_uf), '') <> ''
   and coalesce(jsonb_array_length(cidades_interesse), 0) = 0;
