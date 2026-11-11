-- Explicações de 11/11 em fonte_regressao_explicada (abertura de sessão). Dado operacional, com prazo:
-- vencido o prazo, a fonte volta sozinha para fonte_regressao_pendente() se o motivo continuar.

-- 1) Família LeilãoPro (scraper-leilaopro.yml): coleta SEMANAL de propósito (quinta 10:50 UTC, teto do
--    propósito 'leilaopro' no Bright Data; o runner residencial NÃO cobre esta família). Última medição real
--    05/11 ~18h. A cadência aprendida (1,5 × mediana dos intervalos, fonte_regressao_frescor_pela_cadencia.sql)
--    ainda sai ~132 h porque 2 dos 3 intervalos vêm dos disparos manuais de 25-26/10 (10 h e 88 h). Com a
--    rodada de 12/11 o 4º intervalo (~161 h) entra e o limite sobe para ~187 h, que cobre a semana: o alarme
--    deixa de acender toda semana sem ninguém mexer no piso. Vence 13/11 para voltar se a rodada de 12/11 falhar.
insert into public.fonte_regressao_explicada (fonte, motivo, explicacao, explicado_ate)
select p.fonte, 'medicao_velha',
       '11/11: tenant LeilaoPro, coleta SEMANAL (quinta 10:50 UTC); ultima medicao 05/11. Cadencia aprendida ainda '
       || 'curta (~132 h) por causa dos disparos manuais de 25-26/10; com a rodada de 12/11 sobe para ~187 h e cobre a '
       || 'semana sozinha. Nao e parser parado. Vence 13/11 para voltar se a rodada de 12/11 falhar.',
       date '2026-11-13'
  from public.fonte_regressao_pendente() p
 where p.motivo = 'medicao_velha'
   and p.medido_em between timestamptz '2026-11-05 18:00+00' and timestamptz '2026-11-05 19:00+00'
on conflict (fonte) do update set motivo = excluded.motivo, explicacao = excluded.explicacao,
       explicado_em = now(), explicado_ate = excluded.explicado_ate;

-- 2) Sites que trocaram de plataforma (recon pelo pg_net em 11/11) — pedem parser novo (pendências abertas).
insert into public.fonte_regressao_explicada (fonte, motivo, explicacao, explicado_ate) values
  ('KLEILOES', 'zerou',
   '11/11: kleiloes.com.br trocou de plataforma (Next.js) em 09/11: /imoveis e /veiculos dao 404; agora /leiloes, '
   || '/leilao/<id>-<slug> e /lotes (server-rendered, 24 cards, links /lote/<id>-<slug>). Parser jeleiloes-parse nao '
   || 'serve mais para este tenant (o JELEILOES segue na plataforma antiga). Precisa de parser novo.', date '2026-11-25'),
  ('KLEILOES_VEICULOS', 'zerou',
   '11/11: mesma troca de plataforma do KLEILOES (09/11): /veiculos da 404. Vem junto com o parser novo do KLEILOES.',
   date '2026-11-25'),
  ('WRLEILOES', 'zerou',
   '11/11: wrleiloes.com.br trocou de plataforma em 09/11 (app novo, renderizado no navegador): /agenda-de-leiloes da '
   || '404 e /leiloes vem sem lote no HTML. Precisa achar a API do app novo e reescrever o parser.', date '2026-11-25'),
  ('LEJE', 'regressao',
   '11/11: leje.com.br responde 403 "Acesso Negado" ao runner e ao banco desde 07/11 (antes: desafio Cloudflare). '
   || 'Coleta so pelo Firecrawl (09/11 leu 24). Caminho = feed do leiloeiro (pendencia 386, dono).', date '2026-12-07'),
  ('FLEXLEILOES', 'regressao',
   '11/11: estavel em 10 imoveis desde 06/11 em todas as medicoes; os 5 que sairam foram por praca vencida ate 06/11 '
   || '(leilao aconteceu). Proxima praca dos ativos 16/11. Piso de 28 vem da janela antiga e cai sozinho.', date '2026-11-25'),
  -- 3) Falha de rede pontual na rodada de 11/11 (uma só, depois de dias verdes): prazo curto, volta se repetir.
  ('JORGEBRASIL', 'zerou',
   '11/11: rodada de 16:57 UTC nao abriu o catalogo (ETIMEDOUT na rede e timeout de 25 s pelo banco), depois de dias '
   || 'verdes. Os 10 que sairam foram por praca vencida em 10/11 (leilao aconteceu; 14 -> 4). Falha pontual de rede.',
   date '2026-11-13'),
  ('CALIL_VEICULOS', 'zerou',
   '11/11: a coleta leu e falhou ao GRAVAR (upsert no nosso banco: "fetch failed"), depois de 11 veiculos estaveis. '
   || 'Falha pontual de rede do runner, nao do site.', date '2026-11-13')
on conflict (fonte) do update set motivo = excluded.motivo, explicacao = excluded.explicacao,
       explicado_em = now(), explicado_ate = excluded.explicado_ate;
