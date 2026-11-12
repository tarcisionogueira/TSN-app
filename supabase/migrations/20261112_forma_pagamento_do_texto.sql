-- forma_pagamento lida do TEXTO do lote (12/11)
--
-- Por que existe: o dono viu o lote SUPERBID sbid_5084689 (casa em Alphaville, R$ 4,6 mi)
-- marcado "a_vista" no app, enquanto o título do próprio lote diz "Entrada 30% e Saldo em
-- até 240x" e a descrição "Financiado: Sinal de 30% + Saldo de 24 a 240 parcelas".
--
-- Causa-raiz: ~30 coletores gravam `forma_pagamento: 'a_vista'` FIXO (src/data/pagamento.js
-- documenta: "Superbid → a_vista por padrão (hardcoded até integração real)"). A única
-- correção existente roda em api/gerar-analise.js — ou seja, só para quem gera relatório, e
-- lendo doc_fatos/título, nunca a descrição. Pior: o coletor reenvia 'a_vista' a cada rodada
-- e DESFAZ essa correção.
--
-- Conserto num lugar só (cobre JS e Python, e sobrevive ao re-scrape): gatilho que, em lote
-- NÃO judicial com forma null/'a_vista', lê título+descrição e grava 'financiado' quando o
-- texto AFIRMA a condição e não a nega. Judicial continua com o gatilho próprio
-- (`default_forma_pagamento_judicial` → 'hipotecado', art. 895 CPC) — este roda DEPOIS dele
-- (ordem alfabética de nome) e não mexe em judicial.
--
-- Precisão antes de cobertura (medido em seco sobre o acervo ativo, 12/11). Armadilhas reais
-- que o padrão evita: boilerplate "possibilidade de realizar oferta parcelada" (COMPREI),
-- "não é aceito ... financiamento bancário" (DESTAK), nome de vendedor "Creditas Soluções
-- Financeiras" (ZUK), dívida do contrato "282 parcelas a vencer" (SUPERBID), e IPTU "em até
-- 12 parcelas" (LEILAOELETRONICO). Texto que afirma E nega fica como está (ambíguo).

create or replace function public.inferir_forma_pagamento_texto(p_titulo text, p_descricao text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  with t as (
    select translate(lower(coalesce(p_titulo, '') || ' ' || coalesce(p_descricao, '')),
                     'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as s
  )
  select case
    when s ~ (
           -- "saldo em até 240x", "saldo financiado em até 120 parcelas"
           'saldo (financiado |parcelado )?(em|de) (ate )?([2-9]|[0-9]{2,3}) ?(x\M|vezes|parcelas|prestacoes|meses)'
           -- "financiamento até 420 meses", "parcelamento em até 59x" (exige palavra de COMPRA antes: IPTU fica de fora)
        || '|(financiamento|financiado|parcelamento|parcelado|pagamento)[^.;]{0,25}\mate [0-9]{2,3} ?(x\M|vezes|parcelas|prestacoes|meses)'
        || '|(aceita|permite|admite|disponivel para|possibilidade de) (o |a )?(financiamento|parcelamento|fgts)'
        || '|a vista ?(,|ou|/|e) ?(ou )?(financiad|financiamento|parcelad)'
        || '|\mou (financiamento|financiado|parcelado|parcelamento)'
        || '|formas? de pagamento[^.]{0,60}(parcelad|financiamento)'
        || '|(sinal|entrada) (minim[oa] |a partir )?(de )?[0-9]{1,2} ?%[^.]{0,60}saldo'
         )
     and s !~ (
           'nao (e |sera |sao )?(aceit[oa]s?|admite|admitid[oa]|permite|permitid[oa]|preve|previst[oa]|possui|ha)[^.)]{0,45}(financ|parcel)'
        || '|sem (possibilidade de )?(financiamento|parcelamento)'
        || '|(somente|apenas|exclusivamente|unicamente) a vista'
        || '|vedad[oa][^.)]{0,30}(financ|parcel)'
         )
    then 'financiado'
  end
  from t
$$;

comment on function public.inferir_forma_pagamento_texto(text, text) is
  'Devolve ''financiado'' quando título/descrição AFIRMAM financiamento/parcelamento da compra e não o negam; senão null. Ver migração 20261112_forma_pagamento_do_texto.';

create or replace function public.forma_pagamento_do_texto()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  pg jsonb;
begin
  if coalesce(new.modalidade, '') = 'judicial' then
    return new;  -- judicial é do gatilho default_forma_pagamento_judicial
  end if;

  if new.forma_pagamento is null or new.forma_pagamento = 'a_vista' then
    -- (1) o coletor reenviou 'a_vista' sobre um 'financiado' que a análise já provou pelo
    --     DOCUMENTO (api/gerar-analise.js grava doc_fatos.pagamento): não desfaz.
    if tg_op = 'UPDATE' and old.forma_pagamento = 'financiado' then
      pg := new.doc_fatos -> 'pagamento';
      if pg is not null and (
           pg ->> 'financiavel' = 'true' or pg ->> 'fgts' = 'true' or pg ->> 'parcelamentoPermitido' = 'true'
           or (pg ->> 'parcelas' ~ '^[0-9]+(\.[0-9]+)?$' and (pg ->> 'parcelas')::numeric >= 2)) then
        new.forma_pagamento := 'financiado';
        return new;
      end if;
    end if;
    -- (2) o próprio texto do lote diz que é financiável/parcelável.
    if public.inferir_forma_pagamento_texto(new.titulo, new.descricao) = 'financiado' then
      new.forma_pagamento := 'financiado';
    end if;
  end if;
  return new;
end $$;

-- Gatilho NOVO (não recria o antigo: trocar a lista de colunas exigiria DROP TRIGGER).
-- Nome 'trg_forma_pagamento_texto' > 'trg_default_...' → roda depois do judicial.
create trigger trg_forma_pagamento_texto
  before insert or update of forma_pagamento, modalidade, titulo, descricao
  on public.imoveis_leilao
  for each row execute function public.forma_pagamento_do_texto();

-- Correção do acervo em lotes (sem UPDATE solto na sessão): reaplica o gatilho tocando a
-- coluna. Devolve quantos mudaram; chame até voltar 0.
create or replace function public.corrigir_forma_pagamento_texto(p_limite int default 300)
returns int
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare n int;
begin
  with alvo as (
    select id from public.imoveis_leilao
     where ativo and coalesce(modalidade, '') <> 'judicial'
       and (forma_pagamento is null or forma_pagamento = 'a_vista')
       and public.inferir_forma_pagamento_texto(titulo, descricao) = 'financiado'
     limit greatest(1, least(p_limite, 1000))
  ), mud as (
    update public.imoveis_leilao i set forma_pagamento = 'financiado'
      from alvo where i.id = alvo.id
    returning 1
  )
  select count(*) into n from mud;
  return n;
end $$;
-- SECURITY INVOKER de propósito: chamada por anon/authenticated esbarra na RLS da tabela.
