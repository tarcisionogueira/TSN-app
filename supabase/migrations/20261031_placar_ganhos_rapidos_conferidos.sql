-- 31/10: os 8 "plataforma com leitor, falta ligar" do placar conferidos ao vivo — nenhum era ganho rápido.
--  • BH Leiloaria, BRF, Leiloeiro Denis, Muniz: vitrines da rede Bom Valor (NÃO INTEGRAR, decisão do dono) — ficam.
--  • Mauro Zukerman: domínio gravado errado ("zukerman.com.br -www.portalzuk.com.br"); é o Portal Zuk (fonte ZUK, 869
--    ativos em 31/10) → coletado.
--  • auctio.com.br (Rodolfo Batista de Lima/SC): não é site de leiloeiro, é AGREGADOR ("Inteligência em Leilões de
--    Imóveis | Filtros e Análise de Risco", vitrine Superbid) — sem leitor a ligar.
--  • Delano (SP): plataforma Externo, mas "Não existem leilões cadastrados" (WebFetch 31/10).
--  • Via Leilões (MS): o "DEFAULTCLEAN" do fingerprint é só o tema ASP.NET — os lotes são /leilao/<vara>/<id>, não o
--    sitemap /lote/<cidade>/<id> do scraper-pecini. 2 imóveis abertos (1 terreno, 1 parte ideal) — leitor novo não paga.
update public.leiloeiro_junta
   set dominio = 'portalzuk.com.br', coletado_status = 'coletado', coletado_via = 'host:ZUK ; dominio corrigido 31/10'
 where id = 2267 and coletado_status = 'nao_coletado';

update public.leiloeiro_triagem set parser_existente = null,
       catalogo_ok = 'conferido_3110: agregador (não é site de leiloeiro) — vitrine Superbid com filtros/análise de risco'
 where dominio = 'auctio.com.br';
update public.leiloeiro_triagem
   set catalogo_ok = 'conferido_3110: plataforma Externo, sem leilão cadastrado ("Não existem leilões cadastrados")'
 where dominio = 'delanoleiloes.com.br';
update public.leiloeiro_triagem set parser_existente = null,
       catalogo_ok = 'conferido_3110: NÃO é Pecini (lotes /leilao/<vara>/<id>, IIS recusa pg_net); 2 imóveis abertos (1 terreno MS, 1 parte ideal) — leitor próprio não compensa hoje'
 where dominio = 'vialeiloes.com.br';
