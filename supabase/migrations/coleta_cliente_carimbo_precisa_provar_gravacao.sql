-- COLETA RESIDENCIAL — o carimbo dizia "coletei" sem ter gravado nada (11/08).
--
-- SINTOMA: RJLEILOES parado em 5 lotes ativos desde 30/07 (12 dias), sem UM alerta.
--
-- O QUE ACONTECE. O runner residencial (grátis) chama `coleta_cliente_concluir(fonte)` ao
-- terminar — SEMPRE, tenha gravado 50 lotes ou zero. O comentário em api/coleta-cliente.js
-- diz isso com todas as letras: "fecha a janela (mesmo com 0 gravados)". Para FECHAR A
-- JANELA (anti-overlap, 2x/semana) isso está certo: a tentativa aconteceu.
--
-- O problema é que `ultima_em` passou a ser lido como PROVA DE COLETA por quem decide gastar
-- dinheiro. `scripts/coleta-recente.mjs` é o freio do cron pago (Bright Data): ele pula a
-- coleta paga se a residencial rodou nos últimos 7 dias. RJ Leilões está 100% atrás de
-- Cloudflare — é exatamente por isso que existe o caminho pago. A coleta residencial tenta,
-- é barrada, grava zero e carimba `ultima_em`; o freio lê o carimbo, conclui "já foi
-- coletado de casa" e desliga a rede de segurança que existia para esse caso. Verificado
-- hoje: workflow `scraper-rj.yml` das 11:38 UTC → step "Rodar scraper RJ" = **skipped**,
-- com `coleta_cliente.RJ.ultima_em = 10/08 01:06` e o acervo intocado desde 30/07.
--
-- E os dois vigias não veem: o monitor seção B2 lê o MESMO carimbo (fresco → silêncio), e a
-- tolerância de frescor do acervo para RJLEILOES é de 16 dias (só acusaria em 15/08).
--
-- É a família de 10/08 outra vez — sucesso declarado sobre resultado vazio — com o agravante
-- de que aqui o carimbo falso DESLIGA a correção automática.
--
-- CORREÇÃO: o carimbo continua fechando a janela (o gate depende disso), mas deixa de ser
-- aceito como prova. Quem decide gastar passa a conferir o ACERVO. Para isso o gate precisa
-- saber a que fonte(s) do acervo ele corresponde — os nomes não batem (gate 'RJ' → acervo
-- 'RJLEILOES'; gate 'SOLEON' → três tenants) e essa tradução vivia só na cabeça de quem leu
-- os scrapers.

alter table public.coleta_cliente
  add column if not exists fontes_acervo text[];

comment on column public.coleta_cliente.fontes_acervo is
  'Fonte(s) de imoveis_leilao que esta coleta alimenta. O nome do gate nao e o nome do '
  'acervo (gate RJ -> RJLEILOES; gate SOLEON -> CALIL/VEGAS/TORRES3). Serve para conferir '
  'se a coleta GRAVOU, em vez de confiar no carimbo ultima_em, que so diz que a janela '
  'fechou — ver coleta_cliente_carimbo_precisa_provar_gravacao.sql.';

update public.coleta_cliente set fontes_acervo = '{RJLEILOES}'              where fonte = 'RJ';
update public.coleta_cliente set fontes_acervo = '{PECINI}'                 where fonte = 'PECINI';
update public.coleta_cliente set fontes_acervo = '{GESTAOLEILOES}'          where fonte = 'GESTAO';
update public.coleta_cliente set fontes_acervo = '{VLANCE}'                 where fonte = 'VLANCE';
update public.coleta_cliente set fontes_acervo = '{CALIL,VEGAS,TORRES3}'    where fonte = 'SOLEON';
