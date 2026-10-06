-- 06/10: data do pregão lida do edital em texto BR ("09/10/2026") foi gravada no padrão americano
-- (2026-09-10) — `new Date("09/10/2026")`. Efeito: "Leilão encerrado em 10/09/2026" a 4 dias do leilão,
-- geração recusada e a análise na mira da retenção (15 dias após o leilão). Código corrigido em
-- api/_data-br.js; aqui só as linhas já gravadas (medido: 2, o Alphaville manual).
set local lock_timeout = '8s';
update analises_mercado
   set data_leilao = (to_date(substring(coalesce(imovel->>'dataLeilao', inputs->'parecerInputs'->'d'->>'dataLeilao') from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY')::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
 where coalesce(imovel->>'dataLeilao', inputs->'parecerInputs'->'d'->>'dataLeilao') ~ '^\d{1,2}/\d{1,2}/\d{4}'
   and data_leilao is not null
   and (data_leilao at time zone 'America/Sao_Paulo')::date
       <> to_date(substring(coalesce(imovel->>'dataLeilao', inputs->'parecerInputs'->'d'->>'dataLeilao') from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY');
update analises_documental
   set data_leilao = (to_date(substring(imovel->>'dataLeilao' from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY')::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
 where imovel->>'dataLeilao' ~ '^\d{1,2}/\d{1,2}/\d{4}'
   and data_leilao is not null
   and (data_leilao at time zone 'America/Sao_Paulo')::date
       <> to_date(substring(imovel->>'dataLeilao' from '^\d{1,2}/\d{1,2}/\d{4}'), 'DD/MM/YYYY');
