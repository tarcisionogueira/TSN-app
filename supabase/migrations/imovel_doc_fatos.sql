-- FATOS LIDOS NO DOCUMENTO, VISÍVEIS NA FICHA DO IMÓVEL (pedido do dono, 06/08)
--
-- "Caso encontre nome de condomínio, despesas mensais, que também apareça na tela do imóvel.
--  Ao extrair a documentação, poder informar esses detalhes, pois isso gera mais credibilidade
--  ao visualizar a ficha de um imóvel."
--
-- Até aqui a leitura do edital/matrícula só existia DENTRO do relatório: quem abria a ficha do
-- lote não via nada do que o documento diz. Pior, a coluna `nomecondominio` existe desde sempre
-- e está preenchida em 0 dos 33.484 lotes ativos — nenhum leiloeiro publica esse campo; quem
-- tem o nome do empreendimento é o documento.
--
-- `doc_fatos` guarda o que a leitura determinística (regex sobre o PDF, custo zero) apurou:
--   { identidade:{nomeCondominio,logradouro,bairro}, custos:{taxaAdmPct,iptuMensal,...},
--     pagamento:{comissaoPct,parcelas,...}, matricula:{areaPrivativaM2,numeroMatricula},
--     fonte:'<url do documento>', em:'<timestamp>' }
-- Sempre MERGE por chave de topo: uma leitura de matrícula não pode apagar o que o edital
-- apurou (e vice-versa) — os dois documentos são lidos em momentos diferentes.
--
-- É dado PÚBLICO do edital: a política de leitura pública de `imoveis_leilao` já cobre a coluna,
-- e nada de PII entra aqui.

alter table public.imoveis_leilao
  add column if not exists doc_fatos jsonb,
  add column if not exists doc_fatos_em timestamptz;

comment on column public.imoveis_leilao.doc_fatos is
  'Fatos lidos do edital/matrícula (determinístico, custo zero): identidade, custos, pagamento, matrícula. Alimenta a ficha do imóvel.';

-- Só lote que TEM fato lido; o índice serve ao monitor de cobertura ("quantos lotes já têm
-- ficha enriquecida"), não à leitura da ficha (essa é por id).
create index if not exists idx_imoveis_doc_fatos
  on public.imoveis_leilao (doc_fatos_em desc)
  where doc_fatos is not null;

-- MERGE ATÔMICO. Dois relatórios do mesmo lote podem gravar ao mesmo tempo; um PATCH do
-- PostgREST sobrescreveria o objeto inteiro e o último a chegar apagaria o do outro.
-- Regra do merge:
--   • chave de topo nova entra; chave vazia (null/{}/"") NUNCA apaga fato já apurado;
--   • quando os dois lados são objeto, o merge é POR CAMPO e o campo nulo do novo não apaga
--     o valor do antigo. É o que faz edital e matrícula se COMPLETAREM: o edital costuma dar
--     os custos, a matrícula dá o nome do empreendimento e o logradouro registral — quem
--     roda por último não pode zerar o que o outro achou;
--   • `nomecondominio` do lote é preenchido quando está VAZIO — nunca sobrescreve o que a
--     fonte publicou, mesmo que hoje isso não aconteça em nenhum lote.
create or replace function public.registrar_doc_fatos(p_imovel_id uuid, p_fatos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual jsonb;
  v_novo  jsonb;
  k       text;
  v       jsonb;
  v_lim   jsonb;
  v_cond  text;
begin
  if p_imovel_id is null or p_fatos is null or jsonb_typeof(p_fatos) <> 'object' then return; end if;

  select coalesce(doc_fatos, '{}'::jsonb) into v_atual from public.imoveis_leilao where id = p_imovel_id;
  if not found then return; end if;

  v_novo := v_atual;
  for k, v in select * from jsonb_each(p_fatos) loop
    -- descarta chave vazia: null, {} ou "" não podem apagar um fato já apurado
    if v is null or v = 'null'::jsonb or v = '{}'::jsonb or v = '""'::jsonb then continue; end if;
    if jsonb_typeof(v) = 'object' then
      -- tira os campos nulos/vazios do novo antes de sobrepor
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_lim
        from jsonb_each(v) e
       where e.value is not null and e.value <> 'null'::jsonb and e.value <> '""'::jsonb;
      if v_lim = '{}'::jsonb then continue; end if;
      if jsonb_typeof(coalesce(v_atual -> k, 'null'::jsonb)) = 'object' then
        v_novo := v_novo || jsonb_build_object(k, (v_atual -> k) || v_lim);
      else
        v_novo := v_novo || jsonb_build_object(k, v_lim);
      end if;
    else
      v_novo := v_novo || jsonb_build_object(k, v);
    end if;
  end loop;

  if v_novo = v_atual then return; end if;

  v_cond := nullif(btrim(coalesce(v_novo #>> '{identidade,nomeCondominio}', '')), '');

  update public.imoveis_leilao
     set doc_fatos = v_novo,
         doc_fatos_em = now(),
         nomecondominio = case
           when coalesce(btrim(nomecondominio), '') = '' and v_cond is not null then left(v_cond, 120)
           else nomecondominio end
   where id = p_imovel_id;
end;
$$;

-- Só o backend grava (service_role). O cliente LÊ pela coluna, via a política pública que já
-- existe — não precisa (e não deve) chamar a função.
revoke all on function public.registrar_doc_fatos(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_doc_fatos(uuid, jsonb) to service_role;

-- Cobertura: quantos lotes ativos já têm ficha enriquecida pelo documento.
create or replace function public.doc_fatos_cobertura()
returns table (fonte text, ativos bigint, com_fatos bigint, com_condominio bigint, pct numeric)
language sql
stable
security definer
set search_path = public
as $$
  select i.fonte,
         count(*)                                                          as ativos,
         count(*) filter (where i.doc_fatos is not null)                    as com_fatos,
         count(*) filter (where coalesce(btrim(i.nomecondominio),'') <> '') as com_condominio,
         round(100.0 * count(*) filter (where i.doc_fatos is not null) / nullif(count(*), 0), 1) as pct
    from public.imoveis_leilao i
   where i.ativo
   group by i.fonte
   order by 2 desc;
$$;
revoke all on function public.doc_fatos_cobertura() from public, anon, authenticated;
grant execute on function public.doc_fatos_cobertura() to service_role;
