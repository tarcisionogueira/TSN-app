-- PROXIMIDADES — reparo do "vazio falso" e invariante que impede a volta (10/08).
--
-- SINTOMA RELATADO PELO DONO: a página do imóvel dizia "Nenhum ponto de interesse mapeado
-- nas proximidades" e continuava dizendo isso mesmo depois de aberta havia um tempo.
--
-- CAUSA: o Overpass sinaliza erro de RUNTIME (query estourou o timeout, sobrecarga) com
-- **HTTP 200** e um campo `remark` no corpo, com `elements: []`. O helper checava `res.ok` —
-- que passa — e tratava o vazio como resposta legítima: gravava `pontos_proximos = '{}'` e
-- `proximidades_em`, o que tirava o imóvel da fila do cron PARA SEMPRE. Pior, `Promise.any`
-- corre os espelhos em paralelo e premia o mais RÁPIDO: um espelho que desiste na hora ganha
-- de um que responderia com dados. A otimização de latência passou a PREFERIR a falha.
--
-- TAMANHO DO ESTRAGO (medido antes do reparo): 15.764 de 31.022 imóveis ativos (51%) com
-- `{}` gravado. Não era "não há nada por perto": 82% dos lotes de São Paulo capital e 92%
-- dos de Brasília estavam assim — num raio de 4 km que sempre tem escola ou farmácia. E as
-- execuções recentes do cron vinham dando 100% de vazio, hora após hora.
--
-- Correção do código em api/_proximidades.js (lança em `remark`; vazio só é aceito com
-- corroboração de um 2º espelho), api/enriquecer-proximidades.js e api/proximidades-imovel.js
-- (o vazio passa a ter validade de 30 dias em vez de valer para sempre).

-- 1) REPARO: devolve à fila todo imóvel com o vazio suspeito. `pontos_proximos = null` +
--    `proximidades_em = null` é exatamente o estado "nunca calculado", que o cron já sabe
--    tratar — não é preciso caminho novo. `proximidades_tentativas = 0` porque o histórico
--    de falhas anterior não diz nada sobre a consulta corrigida.
--    Só mexe em quem está com `{}`: imóvel com pontos bons não é tocado.
update public.imoveis_leilao
   set pontos_proximos = null,
       proximidades_em = null,
       proximidades_tentativas = 0
 where ativo
   and pontos_proximos = '{}'::jsonb;

-- 2) INVARIANTE: o vazio falso volta a ser VISÍVEL se o defeito reaparecer.
--    A asserção se auto-calibra e não depende de lista de cidades: conta os imóveis com
--    `{}` numa cidade onde ALGUM outro imóvel ativo TEM pontos. Se a região está mapeada no
--    OSM para o vizinho, o vazio do lote ao lado é falha de consulta, não ausência de POI.
--    Gleba rural genuinamente vazia não entra, porque lá nenhum vizinho tem pontos.
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
     -- NOVO (10/08): proximidades vazias onde o vizinho tem pontos = consulta que falhou em
     -- silêncio. Limite 300: depois do reparo acima o valor cai a ~0 e volta a subir só se o
     -- vazio falso reaparecer; a folga absorve o transitório de quem ainda está na fila.
     ('proximidades_vazio_falso','Proximidades vazias em cidade já mapeada','Relatório','bug',
       (select count(*) from imoveis_leilao i where i.ativo and i.pontos_proximos = '{}'::jsonb
          and coalesce(i.cidade,'') <> ''
          and exists (select 1 from imoveis_leilao v
                       where v.ativo and v.cidade = i.cidade and v.estado is not distinct from i.estado
                         and v.pontos_proximos is not null and v.pontos_proximos <> '{}'::jsonb)), 300),
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
