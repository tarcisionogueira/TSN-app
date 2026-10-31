-- 31/10 — medição `medicao_3110` dos 63 domínios `nao_coletado` das Juntas que não tinham medição útil (32 nunca
-- triados + 29 só com a contagem crua da home de 24/10 + Rui Pinto + bsbleiloes.com.br, que estava gravado como
-- "ww.bsbleiloes"). Home de cada um pelo banco (pg_net, grátis; www e, se o DNS falhou, sem www), lista de leilões/imóveis
-- dos que responderam, e WebFetch (grátis) nos que montam a página por JS ou recusam o pg_net.
-- Resultado: NENHUM candidato com volume de imóvel. 6 entram vazios em família que já lemos (regra do dono), 1 com
-- 3 imóveis pequenos fica na fila, o resto é site fora do ar, não-leilão ou leilão sem imóvel hoje.
insert into public.leiloeiro_triagem (dominio, status_http, plataforma, parser_existente, medido_em, catalogo_ok)
select d, s, p, pe, now(), 'medicao_3110 ' || c from (values
  -- fora do ar (DNS morto ou certificado inválido com e sem www; Capixaba: timeout de 25 s nas duas)
  ('albinoqueiroz.com.br', 0, 'SSL_INVALIDO', null, 'fora: certificado inválido (www e sem www)'),
  ('ccjeliloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('dapenhaleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('emleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('gomesleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('granleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('hleiloes.com', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('jotaerreleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('lamurleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('leiloescapixaba.com.br', 0, 'TIMEOUT', null, 'fora: timeout de 25 s (www e sem www)'),
  ('leiloesfreitas.lel.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('liderancaleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('mmleiloes.com', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('organizacaodeleiloes.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('papaleoneto.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve'),
  ('paulobrasil.com.br', 0, 'SSL_INVALIDO', null, 'fora: erro de SSL (www e sem www)'),
  ('srleiloes.judicial.bomvalor.com.br', 0, 'DNS_MORTO', null, 'fora: DNS não resolve (vitrine Bom Valor extinta)'),
  ('esmg.com.br', 200, 'DESCONHECIDA', null, 'fora: "Página não encontrada" da hospedagem'),
  ('leiloescruz.com.br', 200, 'DESCONHECIDA', null, 'fora: "SISTEMA INDISPONIVEL"'),
  ('manaleiloes.com.br', 200, 'DESCONHECIDA', null, 'fora: página de 722 bytes, sem conteúdo'),
  -- não é site de leilão (domínio caído/revendido, escritório, rede social)
  ('arremateleiloes.com.br', 200, 'DESCONHECIDA', null, 'nao_leilao: agregador ("Inteligência para leilões imobiliários"), não leiloeiro'),
  ('robertoalexandre.com.br', 200, 'DESCONHECIDA', null, 'nao_leilao: escritório de advocacia'),
  ('almeidacunha.com', 200, 'WORDPRESS', null, 'nao_leilao: escritório de advocacia'),
  ('mnadvogados.com.br', 200, 'SPA', null, 'nao_leilao: escritório de advocacia'),
  ('advgoias.com.br', 200, 'SPA', null, 'nao_leilao: escritório de advocacia (agronegócio)'),
  ('euroleiloes.com.br', 200, 'WORDPRESS', null, 'nao_leilao: domínio caído, hoje página de IPTV'),
  ('donhaleiloes.com', 200, 'WORDPRESS', null, 'nao_leilao: domínio caído, hoje página de apostas'),
  ('oab-sc.org.br', 200, 'NEXTJS', null, 'nao_leilao: site da OAB/SC'),
  ('linktr.ee', 200, 'NEXTJS', null, 'nao_leilao: Linktree genérico'),
  -- leilão sem imóvel hoje
  ('celsocunhaleiloes.com.br', 200, 'DESCONHECIDA', null, 'sem_imovel: único leilão de imóvel é revenda Comprei/PGFN (entra pela fonte COMPREI); o outro é consórcio municipal'),
  ('coliseumleiloes.com.br', 200, 'MIDTECH', null, 'sem_imovel: agenda com 1 leilão aberto, de veículos e equipamentos'),
  ('cliqueleiloes.com.br', 400, 'DEGRAU', null, 'sem_imovel: IIS recusa pg_net; WebFetch mostra só leilão de máquinas pesadas (Itaúna/MG)'),
  ('usadaomaquinas.com.br', 200, 'NEXTJS', null, 'sem_imovel: leilão de máquinas agrícolas'),
  ('galeriaalphaville.com.br', 200, 'NUXT', null, 'sem_imovel: galeria de arte'),
  ('favaretoleiloes.com.br', 200, 'DESCONHECIDA', null, 'sem_imovel: home sem imóvel (0 menções)'),
  ('burleleiloes.com', 200, 'DESCONHECIDA', null, 'sem_imovel: leilão de arte'),
  ('thaisalexandreleiloeira.com.br', 200, 'LEILOESBR', null, 'sem_imovel: catálogo em leilaothaisalexandre.com.br, plataforma LeilõesBR (arte), sem lote'),
  -- leilão com página viva e nenhum lote aberto hoje
  ('leiloesbrasilpe.com.br', 200, 'LEILOESBRASIL_UF', null, 'vazio: /imoveis "Nenhum bem aberto para lances"'),
  ('sergiooliveiraleiloes.com.br', 200, 'DESCONHECIDA', null, 'vazio: /lotes "Nenhum item encontrado"'),
  ('faustleiloes.com.br', 200, 'NEXTJS', null, 'vazio: "Nenhum leilão publicado no momento"'),
  ('leiloesfreire.com.br', 200, 'ZAIFUSION', null, 'vazio: /leiloes sem leilão aberto (AL/PE/SE)'),
  ('eustacio.com.br', 200, 'WORDPRESS', null, 'vazio: leilões de 2024–mai/2026, os de imóvel marcados VENDIDO'),
  ('camilagaialeiloes.com.br', 200, 'DESCONHECIDA', null, 'vazio: 1 leilão judicial (Cantagalo/PR, 01/12) sem dizer se é imóvel — rever'),
  ('leilofacil.lel.br', 200, 'WORDPRESS', null, 'vazio: /leiloes sem leilão'),
  ('ghisimachadoleiloes.com.br', 200, 'WORDPRESS', null, 'vazio: /leiloes sem leilão'),
  ('mcleilao.com.br', 200, 'DESCONHECIDA', null, 'vazio: só aviso de cookies, sem catálogo'),
  ('portalax.com.br', 200, 'DESCONHECIDA', null, 'vazio: home sem catálogo'),
  ('aguialeiloes.com.br', 200, 'DESCONHECIDA', null, 'vazio: home sem catálogo (ícone da Martha Helena, a mesma da BSB)'),
  ('robertohaddad.com.br', 200, 'DESCONHECIDA', null, 'vazio: home só com redes sociais'),
  ('rubenshcastro.com.br', 200, 'DESCONHECIDA', null, 'vazio: home só com Instagram'),
  ('ajleiloes.com.br', 200, 'DESCONHECIDA', null, 'vazio: home sem link de catálogo'),
  ('walterrezende.com.br', 200, 'WIX', null, 'vazio: Wix, /leilao-online sem lote no HTML'),
  ('djanirleiloes.com.br', 200, 'SUPORTE', null, 'sem_imovel: buscador devolve a home, só sucata de veículo (ver scraper-puppeteer, 26/10)'),
  -- pouco imóvel, leitor próprio não compensa hoje
  ('daux.com.br', 200, 'EQUIPEDIGITAL', null, 'pouco_imovel: 3 (vaga de garagem em São José/SC no leilão de 17/11; venda direta de fração ideal em União da Vitória/PR e área rural em Rio do Campo/SC)'),
  -- bloqueado (403 no pg_net e no WebFetch)
  ('leilance.com.br', 403, 'BLOQUEADO', null, 'bloqueado: 403 no banco e no WebFetch'),
  ('lmleiloes.com.br', 403, 'BLOQUEADO', null, 'bloqueado: 403 no banco e no WebFetch'),
  ('ruipintoleiloeiro.com.br', 403, 'CLOUDFLARE', null, 'bloqueado: Cloudflare "Just a moment" no banco e no WebFetch'),
  -- LIGADOS VAZIOS em família que já lemos (regra do dono)
  ('rochasulleiloes.com.br', 200, 'LEILAOPRO', 'leilaopro:rochasul', 'conectado_vazio: LeilãoPro, IMÓVEIS sem lote, 2 vendas diretas'),
  ('gestorleiloes.com.br', 200, 'LEILAOPRO', 'leilaopro:gestor', 'conectado_vazio: LeilãoPro, "IMÓVEIS 0 itens"'),
  ('bsbleiloes.com.br', 200, 'LEILAOPRO', 'leilaopro:bsb', 'conectado_vazio: LeilãoPro, "IMÓVEIS 0 itens" (DIVERSOS 397)'),
  ('vincileiloes.com.br', 200, 'LEILOAR', 'leiloar:vinci', 'conectado_vazio: Plataforma Leiloar, "Não existem leilões cadastrados"'),
  ('taniagrimaldileiloes.com.br', 200, 'SUPERBID_EXCHANGE', 'sbidloja:taniagrimaldi', 'conectado_vazio: loja Superbid storeId 16240, 0 ofertas abertas'),
  ('leiloesmaia.com.br', 200, 'SUPERBID_EXCHANGE', 'sbidloja:maia', 'conectado_vazio: loja Superbid storeId 16539, 0 ofertas abertas')
) v(d, s, p, pe, c)
on conflict (dominio) do update set status_http = excluded.status_http, plataforma = excluded.plataforma,
  parser_existente = coalesce(excluded.parser_existente, leiloeiro_triagem.parser_existente),
  medido_em = excluded.medido_em, catalogo_ok = excluded.catalogo_ok;

-- o domínio da Martha Helena estava gravado com typo ("ww.") — corrige e marca os 6 ligados como código sem lote,
-- o mesmo estado dos outros ligados vazios (zaccarias, adring, brasilia…).
update public.leiloeiro_junta set dominio = 'bsbleiloes.com.br' where dominio = 'ww.bsbleiloes.com.br';
update public.leiloeiro_junta set coletado_status = 'codigo_sem_lote', coletado_via = 'codigo'
 where coletado_status = 'nao_coletado'
   and lower(regexp_replace(regexp_replace(dominio, '^https?://', ''), '^www\.', '')) in
       ('rochasulleiloes.com.br', 'gestorleiloes.com.br', 'bsbleiloes.com.br', 'vincileiloes.com.br',
        'taniagrimaldileiloes.com.br', 'leiloesmaia.com.br');
