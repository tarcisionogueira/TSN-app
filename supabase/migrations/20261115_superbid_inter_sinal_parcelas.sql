-- 15/11 (#485) — Lotes SUPERBID do Banco Inter gravados como 'financiado' só com fgts:true no doc_fatos. Conferido na
-- página de cada oferta (pg_net, bastidor.req tarefa 'fgts485'): 106 de 109 anunciam no TÍTULO "Entrada de 30% + Saldo em
-- 240x" / "Sinal a partir de 30% e Saldo Financiado em até 240x" — o FGTS é verdadeiro ("Aceita FGTS") e o financiado está
-- certo; faltavam sinal e parcelas (o extrator não lia "a partir de" nem "de 24 a 240 parcelas" — corrigido em
-- api/_doc-extracao.js no mesmo commit). Complementa só com a prova lida da página, e marca a origem.
-- Os 3 restantes ficam como estão: 2 dizem só "Aceita FGTS" (Goiânia) e 1 página respondeu 400.
with r as (
  select b.lote_id, substring(left(x.content, 200000) from '<title>([^<]{0,250})') tit,
         substring(x.content from position('PAGAMENTO DO LEIL' in upper(x.content)) for 400) cond
    from bastidor.req b join net._http_response x on x.id = b.req
   where b.tarefa = 'fgts485' and x.status_code = 200
), k as (
  select lote_id,
    coalesce(substring(tit from '(?i)(?:sinal|entrada)\s+(?:de\s+|a partir de\s+)?(\d{1,2})\s*%'),
             substring(cond from '(?i)sinal\s+de\s+(\d{1,2})\s*%'))::int sinal,
    coalesce(substring(tit from '(?i)(?:em\s+at[ée]|\+|em)\s*(\d{1,3})\s*x'),
             substring(cond from '(?i)\ma\s+(\d{1,3})\s+parcelas'))::int parc
  from r
)
update public.imoveis_leilao i
   set doc_fatos = jsonb_set(i.doc_fatos, '{pagamento}',
         coalesce(i.doc_fatos->'pagamento', '{}'::jsonb)
         || jsonb_build_object('sinalPct', k.sinal, 'parcelas', k.parc, 'financiavel', true,
                               'complemento', 'título da oferta SUPERBID conferido em 15/11 (#485)'))
  from k
 where k.lote_id = i.id and k.sinal between 5 and 90 and k.parc between 2 and 420
   and i.forma_pagamento = 'financiado' and (i.doc_fatos->'pagamento'->>'fgts') = 'true';
