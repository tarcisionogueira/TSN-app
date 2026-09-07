-- 05/09 — Backfill de leilao_plataforma_url/url_lote para o padrão "WWW.SITE.COM.BR" sem
-- protocolo, que o parser (api/radar-editais-cron.js) não reconhecia antes desta sessão.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Achado a partir de um imóvel real reportado pelo dono (Alameda Rio Negro — Barueri/SP,
-- fonte EDITAL_DJEN): sem site do leiloeiro, sem foto, sem "Ir ao leiloeiro". O texto do
-- edital TEM o site ("...NO SITE WWW.LEJE.COM.BR..."), só que sem "https://" na frente —
-- e a regex de extração só reconhecia URL com protocolo.
--
-- Medido antes de mexer: 772 editais no total, 83 já tinham leilao_plataforma_url, 178
-- tinham "www.*.com.br" no texto SEM tê-lo extraído. Amostra dos 40 domínios mais
-- frequentes conferida uma a uma: zero falso positivo (só nome de leiloeiro/leilão — texto
-- formal de edital judicial não cita site alheio à toa). O código-fonte (parseEdital) ganhou
-- o mesmo padrão nesta sessão, para editais NOVOS; esta migração é o backfill do que já
-- estava no banco.
--
-- ⚠️ `regexp_matches` não pode ir dentro de um SET de UPDATE (Postgres recusa: "set-returning
-- functions are not allowed in UPDATE") — daí `substring(... from '(?i)padrão')`, que devolve
-- escalar. E as DUAS atualizações precisam ser instruções SEPARADAS, não dois UPDATE dentro
-- do mesmo WITH: CTEs de escrita no mesmo comando enxergam a MESMA foto do banco (a de antes
-- de qualquer uma delas rodar) — a segunda não veria o que a primeira acabou de gravar, e o
-- backfill de imoveis_leilao sairia zerado (medido: foi exatamente o que aconteceu na
-- primeira tentativa).

-- 1) editais_leilao: preenche o que o parser já teria extraído com a regra nova.
update public.editais_leilao
   set leilao_plataforma_url = 'https://' || lower(substring(texto_integral from '(?i)www\.([a-z0-9][a-z0-9.\-]*\.com\.br)'))
 where leilao_plataforma_url is null
   and texto_integral ~* 'www\.[a-z0-9][a-z0-9.\-]*\.com\.br';

-- 2) imoveis_leilao: para editais JÁ promovidos (imovel_id preenchido), o lote nasceu antes
-- deste backfill e ficou com url_lote nulo para sempre, já que a promoção só copia o valor
-- UMA vez. Propaga agora, só preenchendo o que está vazio — nunca sobrescreve url_lote que
-- já veio de outro lugar (ex.: dedup ligou a um lote de fonte já integrada).
update public.imoveis_leilao i
   set url_lote = e.leilao_plataforma_url
  from public.editais_leilao e
 where e.imovel_id = i.id
   and i.url_lote is null
   and e.leilao_plataforma_url is not null;
