/**
 * Parser puro da plataforma "LeilãoPro Core" (artisticweb/leilaodetran, SSR) — usada por
 * leffaleiloes e oscarleiloes. SEM deps de supabase/brightdata: é importado TANTO pelo
 * scraper de produção QUANTO pelo validador de recon (mesma lógica nos dois lados).
 *
 * ESTRUTURA (recon 20/08, lote leffa 7208 — apto em Torres/RS, golden record):
 *   • Listagem por categoria: /leilao/lotes/imoveis (SSR, página única, sem ?pagina).
 *   • Lote:  /leilao/<slug>/lote_id/<ID>.
 *   • og:title / og:description = título COMPLETO com área e "…CIDADE DE <cidade>/<UF>".
 *   • og:image = foto.
 *   • PREÇO POR RÓTULO (não adivinhar — lição emiliomatos):
 *       "LANCE INICIAL"            → 1º leilão  = avaliação   (ex.: R$ 1.180.000,00)
 *       "LANCE INICIAL 2º LEILÃO"  → 2º leilão  = lance mínimo (ex.: R$ 590.000,00 ≈ 50%)
 *       "INCREMENTO MÍNIMO" (R$ 1.000) e a CAUÇÃO de 10% (R$ 118.000) → IGNORADOS.
 *     Sem 2º leilão → mínimo = avaliação (desconto 0).
 *   • Modalidade: "Processo"/"Judicial"/"Juiz" → judicial; "venda direta" → venda_direta.
 *   • Docs: /uploads/media/documentos_leilao/… (edital) e /documentos_bem/… (matrícula/laudo).
 */
import { fazendaEhNome } from '../../api/_tipo.js';
import { extrairGenerico, checarQualidade } from './scraper-core.mjs';
import { decodificarEntidades, extrairAreaM2 } from '../../api/_texto-imovel.js';
import MUNICIPIOS from '../../api/_municipios.js';
import { normCidade, inferirUF } from './inferir-uf.mjs';

// Tenants da plataforma (fonte por LEILOEIRO — o monitor aprende baseline por fonte).
export const TENANTS = {
  leffa: { fonte: 'LEFFA', leiloeiro: 'Leffa Leilões', base: 'https://www.leffaleiloes.com.br' },
  oscar: { fonte: 'OSCAR', leiloeiro: 'Oscar Leilões', base: 'https://www.oscar.leilao.br' },
  // ─── JUCEMG (recon de 29/08) ───────────────────────────────────────────────────────────
  // A triagem separou estes três numa "família nova" chamada `leilao.pro` (pelas pistas
  // js.pusher.com + cdn.onesignal.com + www.leilao.pro). O recon mostrou que NÃO é família
  // nova: o menu do Versalles lista **"IMÓVEIS … → /leilao/lotes/imoveis"**, que é exatamente
  // o `catalogo` desta configuração. É a MESMA plataforma que já parseamos — a triagem só não
  // tinha como saber, porque classifica por assinatura de HTML e não abre o catálogo.
  //
  // ⚠️ O recon também mostrou o Versalles com **"IMÓVEIS 0 itens"** hoje. Isso é acervo vazio
  // no momento, não plataforma diferente — e é justamente por isso que eles entram como tenants
  // (custo zero, o `fonteVazia` do runner já trata leiloeiro sem imóvel sem soar alarme) e não
  // como parser novo. O dry-run diz quem tem lote agora; quem vier vazio fica e volta a render
  // quando publicar, como os 10 do SUPORTE.
  ileiloes:   { fonte: 'ILEILOES',  leiloeiro: 'iLeilões',          base: 'https://www.ileiloes.com.br' },
  luis:       { fonte: 'LUISLEIL',  leiloeiro: 'Luis Leiloeiro',    base: 'https://www.luisleiloeiro.com.br' },
  versalles:  { fonte: 'VERSALLES', leiloeiro: 'Versalles Leilões', base: 'https://www.versallesleiloes.com.br' },
  // 24/10 — varredura de não cobertos (leiloeiro_site_descoberto, JUCESP): Hasta Pública Leilões (Giovanni
  // Wersdoerfer, SC/PR). NÃO é a fonte HASTAPUBLICA (hastapublica.com.br, outra empresa, SP/DF): domínio, leiloeiro e
  // UFs diferentes, e nenhum dos lotes estava no acervo. Mesma plataforma (mercure2.leilaopro.com.br + /leilao/lotes/
  // imoveis com 40 links lote_id na pág. 1), aberta pelo banco grátis.
  hastapublicalel: { fonte: 'HASTAPUBLICALEL', leiloeiro: 'Hasta Pública Leilões (Giovanni Wersdoerfer)', base: 'https://www.hastapublica.lel.br', sufixo: 'Hasta Pública Leilões' },
  // 24/10 — levantamento das Juntas Comerciais (leiloeiro_triagem `junta_2410`): leiloeiros NÃO coletados na mesma
  // plataforma. Catálogo + 3–5 lotes de cada pelo banco (grátis), passados no parser em seco. `sufixo` = nome do site
  // no og:title, que sai do título (ver limparTitulo). Conferidos contra a página: renovar_10335 Joinville/SC
  // 1º R$ 700.000 → 2º R$ 630.000; raupp_6457 Porto Alegre/RS avaliação R$ 230.000, lance R$ 161.000.
  // saleiloes.lel.br NÃO entra: é o MESMO catálogo de nsleiloes.leilao.br (16 de 16 lote_id iguais; dois leiloeiros
  // da Junta, uma empresa "NS Leilões"). luciverareisleiloes.com.br ficou de fora (3 lotes, não validado no seco).
  raupp: { fonte: 'RAUPP', leiloeiro: 'Raupp Leilões (Naio de Freitas Raupp)', base: 'https://rauppleiloes.com.br', sufixo: 'Raupp Leilões' },
  renovar: { fonte: 'RENOVAR', leiloeiro: 'Renovar Leilões (Corrêa e Alegranzzi)', base: 'https://renovarleiloes.com.br', sufixo: 'Renovar Leilões' },
  qleilao: { fonte: 'QLEILAO', leiloeiro: 'QLeilão (José Fernando de Quina)', base: 'https://qleilao.lel.br', sufixo: 'QLeilão' },
  nsleiloes: { fonte: 'NSLEILOES', leiloeiro: 'NS Leilões', base: 'https://nsleiloes.leilao.br', sufixo: 'NS Leilões' },
  jac: { fonte: 'JACLEILOES', leiloeiro: 'JAC Leilões (Jefferson Adriano da Costa)', base: 'https://jacleiloes.com.br', sufixo: 'JAC Leilões' },
  bidgo: { fonte: 'BIDGO', leiloeiro: 'Bid GO Leilões', base: 'https://bidgo.com.br', sufixo: 'Bid GO' },
  soleiloes: { fonte: 'SOLEILOES', leiloeiro: 'Só Leilões', base: 'https://soleiloes.com.br', sufixo: 'Só Leilões' },
  // 24/10 (2ª leva, triagem575 — leiloeiros ATIVOS das Juntas ainda não coletados; quase todos JUCISRS). Mesma
  // plataforma (js.pusher.com + cdn.onesignal.com + www.leilao.pro na home), /leilao/lotes/imoveis aberto pelo banco
  // (grátis) com ≥1 link lote_id, 1–2 lotes de cada no parser em seco. Base = destino final do redirect (www.).
  // Nenhum lote destes domínios estava no acervo (conferido por host do url_lote) e nenhum par de catálogos se repete
  // (slugs comparados). `sufixo` = nome do site no <title>/og:title. Entre parênteses: lotes na listagem em 24/10.
  // Domínios da Junta que só redirecionam para o site abaixo: leiloes.rs → scottoleiloes.com.br; rzleiloes.com.br →
  // rz.leilao.br; blmleiloes.com.br → blm.leilao.br; scholante.com.br → scholanteleiloes.com.br; eduardovivian.com →
  // .com.br; mpleilao.com → .com.br; pietosoleiloes.lel.br → .com.br; leiloeiros.lel.br → jritta.lel.br;
  // mercadoleiloes.com.br (WordPress) → catálogo em mercadoleiloes.leilao.br; scheidleiloes.com.br → leilao.scheid….
  // Os que vieram com /leilao/lotes/imoveis VAZIO nesta leva (aurora, beltrame, bis, ck, cpk, deboramuller, eleva,
  // fernanda, butiá, lipinski, lottermann, rangel, rogerserafim, amt — rubemgarcia.com.br redireciona p/ ele —, sr, sw,
  // veronica, zaccarias) e o santayana entraram em 26/10: bloco "LIGADOS COM CATÁLOGO VAZIO" no fim da lista.
  // (agenciadeleiloes já é o CHAIEBLEIL; bsbleiloes não está mais entre os não coletados da Junta.)
  santoseborin: { fonte: 'SANTOSBORIN', leiloeiro: 'Santos & Borin Leilões', base: 'https://www.santoseborinleiloes.com.br', sufixo: 'Santos & Borin Leilões' }, // 40+
  grandes: { fonte: 'GRANDESLEIL', leiloeiro: 'Grandes Leilões (Jochims)', base: 'https://www.grandesleiloes.com.br', sufixo: 'Grandes Leilões' }, // 40+
  mercado: { fonte: 'MERCADOLEIL', leiloeiro: 'Mercado Leilões (José Lázaro Ribeiro Menezes)', base: 'https://www.mercadoleiloes.leilao.br', sufixo: 'Mercado Leilões' }, // 38
  pietoso: { fonte: 'PIETOSO', leiloeiro: 'Pietoso Leilões', base: 'https://www.pietosoleiloes.com.br', sufixo: 'Pietoso Leilões' }, // 35
  mpleilao: { fonte: 'MPLEILAO', leiloeiro: 'MP Leilão (Pereira de Oliveira)', base: 'https://www.mpleilao.com.br', sufixo: 'MP Leilão' }, // 33
  santamaria: { fonte: 'SANTAMARIALEIL', leiloeiro: 'Santa Maria Leilões', base: 'https://www.santamarialeiloes.com.br', sufixo: 'Santa Maria Leilões' }, // 25
  scholante: { fonte: 'SCHOLANTE', leiloeiro: 'Sérgio Scholante Leiloeiro', base: 'https://www.scholanteleiloes.com.br', sufixo: 'Sérgio Scholante' }, // 23
  regional: { fonte: 'REGIONALLEIL', leiloeiro: 'Regional Leilões (Alessandro Fahrion Pinto)', base: 'https://www.regionalleiloes.com.br', sufixo: 'Regional Leilões' }, // 21
  schonardie: { fonte: 'SCHONARDIE', leiloeiro: 'Marcelo Schonardie Leiloeiro', base: 'https://www.marceloleiloeiro.com.br', sufixo: 'Marcelo Schonardie' }, // 18
  vsleiloes: { fonte: 'VSLEILOES', leiloeiro: 'VS Leilões (Valdinei Generoso Silveira)', base: 'https://www.vsleiloes.com', sufixo: 'VS Leilões' }, // 17
  bartmann: { fonte: 'BARTMANN', leiloeiro: 'Ivan Bartmann Leiloeiro', base: 'https://www.bartmannleiloes.com.br', sufixo: 'Ivan Bartmann' }, // 15
  rz: { fonte: 'RZLEILOES', leiloeiro: 'Roberta Zago Leilões', base: 'https://www.rz.leilao.br', sufixo: 'Roberta Zago Leilões' }, // 13
  gabrielrosa: { fonte: 'GABRIELROSA', leiloeiro: 'Gabriel Rosa Leilões', base: 'https://www.gabrielleiloes.com.br', sufixo: 'Gabriel Rosa Leilões' }, // 12
  gt: { fonte: 'GTLEILOES', leiloeiro: 'GT Leilões (Gilmar Thume)', base: 'https://www.gtleiloes.com.br', sufixo: 'GT Leilões' }, // 10
  scotto: { fonte: 'SCOTTOLEIL', leiloeiro: 'Scotto Leilões (Joseane de Avila Scotto)', base: 'https://www.scottoleiloes.com.br', sufixo: 'Scotto Leilões' }, // 10
  rabuske: { fonte: 'RABUSKE', leiloeiro: 'Rabuske Leilões (Cesar Carlos Rabuske)', base: 'https://www.rabuskeleiloes.com.br', sufixo: 'Rabuske Leilões' }, //  9
  ferronato: { fonte: 'FERRONATO', leiloeiro: 'Ferronato Leilões (Giuliano Ferronato)', base: 'https://www.ferronato.leilao.br', sufixo: 'Ferronato Leilões' }, //  8
  clademir: { fonte: 'CLADEMIR', leiloeiro: 'Clademir Leilões', base: 'https://www.clademirleiloeiro.com.br', sufixo: 'Clademir Leilões' }, //  7
  tonial: { fonte: 'TONIALLEIL', leiloeiro: 'Tonial Leilões', base: 'https://www.tonialleiloes.com.br', sufixo: 'Tonial Leilões' }, //  7
  arnoldo: { fonte: 'ARNOLDOLEIL', leiloeiro: 'Henrique Arnoldo Junior | Felipe Scholl', base: 'https://www.arnoldoleiloes.com.br', sufixo: 'Henrique Arnoldo Junior' }, //  5
  dld: { fonte: 'DLDLEILOEIRO', leiloeiro: 'Daniel Lazownik Duarte Leiloeiro', base: 'https://www.dldleiloeiro.com.br', sufixo: 'Daniel Lazownik Duarte' }, //  5
  ritta: { fonte: 'RITTALEIL', leiloeiro: 'Ritta Leilões', base: 'https://www.jritta.lel.br', sufixo: 'Ritta Leilões' }, //  5
  ju: { fonte: 'JULEILOES', leiloeiro: 'Ju Leilões (Jucenara Bordignon)', base: 'https://www.juleiloes.com.br', sufixo: 'Ju Leilões' }, //  5
  scheid: { fonte: 'SCHEIDLEIL', leiloeiro: 'Scheid Leilões (Matias Scheid)', base: 'https://leilao.scheidleiloes.com.br', sufixo: 'Scheid Leilões' }, //  5
  super: { fonte: 'SUPERLEIL', leiloeiro: 'Super Leilões', base: 'https://www.superleiloes.net', sufixo: 'Super Leilões' }, //  5
  vidal: { fonte: 'VIDALLEIL', leiloeiro: 'Vidal Leilões', base: 'https://www.vidalleiloes.com.br', sufixo: 'Vidal Leilões' }, //  5
  kirinus: { fonte: 'KIRINUSLEIL', leiloeiro: 'Leomar Kirinus Leilões', base: 'https://www.leomarkirinusleiloes.com.br', sufixo: 'Leomar Kirinus Leilões' }, //  4
  blm: { fonte: 'BLMLEILOES', leiloeiro: 'BLM Leilões (Breno Loureiro de Menezes)', base: 'https://www.blm.leilao.br', sufixo: 'BLM Leilões' }, //  3
  barbieri: { fonte: 'BARBIERILEIL', leiloeiro: 'Marciano Barbieri Leiloeiro', base: 'https://www.leiloeirobarbieri.com.br', sufixo: 'Comendador Marciano Barbieri' }, //  3
  machadors: { fonte: 'MACHADORS', leiloeiro: 'Machado Leilões RS (Fabio Samir Machado)', base: 'https://www.machadoleiloesrs.com.br', sufixo: 'Machado Leilões RS' }, //  3
  michelli: { fonte: 'MICHELLILEIL', leiloeiro: 'Michelli Leilões', base: 'https://www.michellileiloes.com.br', sufixo: 'Michelli Leilões' }, //  3
  clovis: { fonte: 'CLOVISLEIL', leiloeiro: 'Clóvis Leiloeiro (José Clóvis Vaz de Souza)', base: 'https://www.clovisleiloeiro.com.br', sufixo: 'Clóvis Leiloeiro' }, //  2
  feliperotta: { fonte: 'FELIPEROTTA', leiloeiro: 'Felipe Rotta Leilões', base: 'https://www.feliperottaleiloes.com.br', sufixo: 'Felipe Rotta Leilões' }, //  2
  eduardovivian: { fonte: 'EDUARDOVIVIAN', leiloeiro: 'Eduardo Vivian Leiloeiro', base: 'https://www.eduardovivian.com.br', sufixo: 'Eduardo Vivian' }, //  1
  farias: { fonte: 'FARIASLEIL', leiloeiro: 'Farias Leilões (Dediana Farias)', base: 'https://www.fariasleiloes.com.br', sufixo: 'Farias Leilões' }, //  1
  // 24/10 (pendência 356): Trevisan — todos os links da listagem são /lote_id/N/alienacao (venda por alienação
  // particular); entrou quando extrairUrlsDeLote passou a aceitar o sufixo (antes enumerava 0).
  trevisan: { fonte: 'TREVISANLEIL', leiloeiro: 'Marcelo Trevisan Leiloeiro', base: 'https://www.trevisanleiloes.com.br', sufixo: 'Marcelo Trevisan' }, // 27, RS/SC
  // 26/10 (3ª leva, leiloeiro_junta ATIVO nao_coletado com triagem `junta_2410` — SC/MT/ES/BA/RS). /leilao/lotes/imoveis
  // pelo banco (grátis); "N itens" do contador IMÓVEIS do próprio site × lote_id enumerados; todos os lotes no seco.
  agili: { fonte: 'AGILILEIL', leiloeiro: 'Agili Leilões', base: 'https://agilileiloes.com.br', sufixo: 'Agili Leilões' },
  bianchi: { fonte: 'BIANCHILEIL', leiloeiro: 'Bianchi Leilões', base: 'https://bianchileiloes.com.br', sufixo: 'Bianchi Leilões' },
  delzeir: { fonte: 'DELZEIRLEIL', leiloeiro: 'Cecilia Delzeir Leilões', base: 'https://ceciliadelzeirleiloes.com.br', sufixo: 'Cecilia Delzeir Leilões' },
  delucca: { fonte: 'DELUCCALEIL', leiloeiro: 'De Lucca Leilões', base: 'https://deluccaleiloes.com.br', sufixo: 'De Lucca Leilões' },
  djleilao: { fonte: 'DJLEILAO', leiloeiro: 'DJ Leilão', base: 'https://djleilao.com.br', sufixo: 'DJ Leilão' },
  lessa: { fonte: 'LESSALEIL', leiloeiro: 'Mário Lessa Freitas Filho Leiloeiro', base: 'https://lessaleiloes.com.br', sufixo: 'Mário Lessa Freitas Filho' },
  szortyka: { fonte: 'SZORTYKA', leiloeiro: 'Szortyka Leilões', base: 'https://szortykaleiloes.com.br', sufixo: 'Szortyka Leilões' },
  wendelgarcia: { fonte: 'WENDELGARCIA', leiloeiro: 'Wendel Garcia Leiloeiro', base: 'https://wendelgarcia.com.br', sufixo: 'Wendel Garcia' },
  zuccalmaglio: { fonte: 'ZUCCALMAGLIO', leiloeiro: 'Zuccalmaglio Leilões', base: 'https://zuccalmaglioleiloes.com.br', sufixo: 'Zuccalmaglio Leilões' },
  // Só VENDA DIRETA de imóvel aberta hoje (0 lote de leilão na listagem; 1 bem /venda-direta/bem_id/N em cada).
  // Os da leva com listagem vazia ou só com venda direta ENCERRADA (amt, assertiva, deborabarz, butiá, alegranzzi,
  // costasalman, fumagalli, gb, oscarleiloes.com.br, pra, aurora, beltrame, bis, ck, cpk, deboramuller, eleva, lipinski,
  // rangel, rogerserafim, sr, veronica, zaccarias, lottermann, sw) entraram em 26/10 — ver o bloco abaixo.
  michelesandor: { fonte: 'MICHELESANDOR', leiloeiro: 'Michele Sandor Leilões', base: 'https://michelesandorleiloes.com.br', sufixo: 'Michele Sandor Leilões' },
  moresco: { fonte: 'MORESCOLEIL', leiloeiro: 'Cesar Moresco Leiloeiro', base: 'https://morescoleiloes.com.br', sufixo: 'Cesar Moresco Leiloeiro' },
  agencia: { fonte: 'CHAIEBLEIL', leiloeiro: 'Agência de Leilões (Daniel Chaieb)', base: 'https://www.agenciadeleiloes.com.br', sufixo: 'Agência de Leilões' },
  // ── LIGADOS COM CATÁLOGO VAZIO (26/10, regra do dono: leiloeiro ATIVO em família que já lemos fica ligado mesmo sem
  // imóvel hoje — o coletor pega no dia em que publicar). Prova, pelo banco (pg_net, grátis): /leilao/lotes/imoveis HTTP
  // 200, <title> "IMÓVEIS - <site>", js.pusher/leilao.pro na página e o contador do próprio site "IMÓVEIS 0 itens" — o
  // mesmo HTML do tenant com lote, sem nenhum link lote_id. Fonte que nunca teve lote fica de fora de
  // fonte_baseline_aprendida (só aprende de status ok com total > 0): sem `zerou`/`regressao`/`medicao_velha` possível.
  // Os marcados VD têm venda direta na listagem, hoje toda ENCERRADA (o parser lê e descarta como encerrada).
  // oscarleiloes.com.br (BA) ≠ OSCAR (oscar.leilao.br, com lote): mesmo nome, catálogos distintos (um vazio, outro não).
  alegranzzi: { fonte: 'ALEGRANZZI', leiloeiro: 'Alegranzzi Leilões', base: 'https://www.alegranzzileiloes.com.br', sufixo: 'Alegranzzi Leilões' },
  amt: { fonte: 'AMTLEILOES', leiloeiro: 'Álvaro Marques Teixeira Leiloeiro', base: 'https://www.amtleiloes.com.br', sufixo: 'Álvaro Marques Teixeira' }, // VD 2
  assertiva: { fonte: 'ASSERTIVALEIL', leiloeiro: 'Assertiva Leilões', base: 'https://www.assertivaleiloes.com.br', sufixo: 'Assertiva Leilões' }, // VD 4
  aurora: { fonte: 'AURORALEIL', leiloeiro: 'Aurora Leilões', base: 'https://www.auroraleiloes.com.br', sufixo: 'Aurora Leilões' },
  beltrame: { fonte: 'BELTRAMELEIL', leiloeiro: 'Beltrame Leilões', base: 'https://www.beltrameleiloes.com.br', sufixo: 'Beltrame Leilões' },
  bis: { fonte: 'BISLEILOEIRO', leiloeiro: 'Bis Leiloeiro', base: 'https://www.bisleiloeiro.com.br', sufixo: 'Bis Leiloeiro' },
  ck: { fonte: 'CKLEILOES', leiloeiro: 'CK Leilões', base: 'https://www.ckleiloes.com.br', sufixo: 'CK Leilões' },
  costasalman: { fonte: 'COSTASALMAN', leiloeiro: 'Costa Salman Leilões', base: 'https://www.costasalmanleiloes.com.br', sufixo: 'Costa Salman Leilões' },
  cpk: { fonte: 'CPKLEILOES', leiloeiro: 'CPK Leilões', base: 'https://www.cpkleiloes.com.br', sufixo: 'CPK Leilões' },
  deborabarz: { fonte: 'DEBORABARZ', leiloeiro: 'Débora Barz Leilões', base: 'https://www.deborabarzleiloes.com.br', sufixo: 'Débora Barz Leilões' }, // VD 3
  deboramuller: { fonte: 'DEBORAMULLER', leiloeiro: 'Débora Müller Leiloeira', base: 'https://www.deboramullerleiloes.com.br', sufixo: 'Débora Müller' },
  eleva: { fonte: 'ELEVALEIL', leiloeiro: 'Eleva Leilões', base: 'https://www.elevaleiloes.com.br', sufixo: 'Eleva Leilões' },
  fernanda: { fonte: 'FERNANDALEIL', leiloeiro: 'Fernanda Leilões', base: 'https://www.fernandaleiloes.lel.br', sufixo: 'Fernanda Leilões' }, // VD 5
  fumagalli: { fonte: 'FUMAGALLI', leiloeiro: 'Fumagalli Leilões', base: 'https://www.fumagallileiloes.com.br', sufixo: 'Fumagalli Leilões' },
  gb: { fonte: 'GBLEILOES', leiloeiro: 'GB Leilões', base: 'https://www.gbleiloes.com.br', sufixo: 'GB Leilões' },
  butia: { fonte: 'LEILAOBUTIA', leiloeiro: 'Leilão Butiá', base: 'https://www.leilaobutia.com.br', sufixo: 'Leilão Butiá' }, // VD 5
  lipinski: { fonte: 'LIPINSKI', leiloeiro: 'Lipinski Leilões', base: 'https://www.lipinskileiloes.com.br', sufixo: 'Lipinski Leilões' },
  lottermann: { fonte: 'LOTTERMANN', leiloeiro: 'Lottermann Leilões', base: 'https://www.lottermannleiloes.com.br', sufixo: 'Lottermann Leilões' },
  oscarba: { fonte: 'OSCARBA', leiloeiro: 'Oscar Leilões (BA)', base: 'https://www.oscarleiloes.com.br', sufixo: 'Oscar Leilões' },
  pra: { fonte: 'PRALEILOES', leiloeiro: 'Pra Leilões', base: 'https://www.praleiloes.com.br', sufixo: 'Pra Leilões' },
  rangel: { fonte: 'RANGELLEIL', leiloeiro: 'Rangel Machado Leiloeiro', base: 'https://www.rangelleiloes.com.br', sufixo: 'Rangel Machado' },
  rogerserafim: { fonte: 'ROGERSERAFIM', leiloeiro: 'Roger Serafim Leilões', base: 'https://www.rogerserafimleiloes.com.br', sufixo: 'Roger Serafim Leilões' },
  sr: { fonte: 'SRLEILOES', leiloeiro: 'SR Leilões', base: 'https://www.srleiloes.com.br', sufixo: 'SR Leilões' },
  // SW: 1 venda direta aberta (pavilhão, R$ 3 mi); o parser lê preço e foto, mas a página não fecha o bloco DESCRIÇÃO
  // antes do rodapé e o lote sai SEM cidade (não aparece em /leiloes até alguém completar) — ligado assim mesmo pela regra.
  sw: { fonte: 'SWLEILOES', leiloeiro: 'SW Leilões', base: 'https://www.swleiloes.com.br', sufixo: 'SW Leilões' }, // VD 1 de 1, sem cidade
  veronica: { fonte: 'VERONICALEIL', leiloeiro: 'Veronica Telles Leiloeira', base: 'https://www.veronicaleiloes.com.br', sufixo: 'Veronica Telles' },
  zaccarias: { fonte: 'ZACCARIAS', leiloeiro: 'Zaccarias Leiloeiro Oficial', base: 'https://www.zaccariasleiloes.com.br', sufixo: 'Zaccarias Leiloeiro Oficial' },
  // ── 26/10, com lote hoje (todos os lotes no parser em seco; contador "IMÓVEIS N itens" × enumerados).
  // Luci Vera: 11 de 11 enumerados → 10 prontos + 1 não-imóvel (silos). Santayana: 10 lotes + 3 VD (o contador diz 11 —
  // conta só os abertos) → 7 prontos, 4 box descartados, 2 encerrados. Os dois têm lote cujo título é só "APARTAMENTO"/
  // "CASA"/"TERRENO COM ÁREA…" sem cidade no texto (Luci 3 de 10, Santayana 3 de 7): a cidade está no SLUG do leilão
  // ("…-em-campo-bom-rs", "imovel-porto-alegre-rs-…"), que o parser ainda não lê — achado para o parser, não bloqueio.
  luciverareis: { fonte: 'LUCIVERAREIS', leiloeiro: 'Luci Vera Primaz dos Reis Leiloeira', base: 'https://www.luciverareisleiloes.com.br', sufixo: 'Luci Vera Primaz dos Reis' }, // 11 de 11
  // JUCESP/JUCEMG/SC (triagem pelo banco `tri2610`): contador "IMÓVEIS N itens" × lote_id enumerados.
  goldenbrazil: { fonte: 'GOLDENBRAZIL', leiloeiro: 'Golden Brazil Leilões (Anderson Luchtenberg)', base: 'https://www.goldenbrazilleiloes.com.br', sufixo: 'Golden Brazil Leilões' }, // 2 + 1 VD (contador 2)
  sandro: { fonte: 'SANDROLEIL', leiloeiro: 'Melhores Leilões (Sandro Rodrigues Pinto)', base: 'https://www.sandroleiloeiro.com.br', sufixo: 'Melhores Leilões' }, // 14 de 14
  santayana: { fonte: 'SANTAYANA', leiloeiro: 'Santayana Leilões', base: 'https://www.santayanaleiloes.com.br', sufixo: 'Santayana Leilões' }, // 13 de 13 (contador 11)
};

const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
const titleCase = s => String(s || '').toLowerCase().replace(/(^|\s|'|-)([a-zà-ú])/g, (_, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Do|Da|Dos|Das|E)\b/g, m => m.toLowerCase()).replace(/^\w/, c => c.toUpperCase());

export function inferirTipo(titulo = '', url = '') {
  const t = (titulo + ' ' + url).toLowerCase();
  if (/apartament|apto|flat|kitnet|studio|cobertura/.test(t)) return 'apartamento';
  // "Fazenda Tamboré Residencial 2 - Casa" (15/10): fazenda é nome de lugar quando o texto nomeia unidade urbana.
  if (/s[íi]tio|ch[áa]cara|rural|gleba/.test(t) || (/fazenda/.test(t) && !fazendaEhNome(titulo))) return 'rural';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/sala|loja|comercial|gal[pã]|pr[ée]dio|escrit[óo]rio|andar|industrial|barrac/.test(t)) return 'comercial';
  if (/terreno|lote|[áa]rea\s+de\s+terra|\bterra\b/.test(t)) return 'terreno';
  return 'outros';
}

// Links de lote na listagem: /leilao/<slug>/lote_id/<ID>. Retorna Map id→url absoluta.
// Sufixo de modalidade aceito (24/10, Trevisan): venda por alienação particular sai como
// /leilao/<slug>/lote_id/<ID>/alienacao — é o único link do lote na listagem, então a URL guardada
// mantém o sufixo. Exigir o id no fim do href enumerava 0 lotes num catálogo de 27.
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of html.matchAll(/href=["'](\/leilao\/[^"']*?\/lote_id\/(\d+)(?:\/alienacao)?)["']/gi)) {
    // Leilão de SIMULAÇÃO/teste da plataforma (26/10, Cecilia Delzeir: /leilao/leilao-simulacao-31-07-2023…/lote_id/7,
    // praça em 2050) aparece na listagem como lote de verdade. O slug do leilão é a prova; fica fora já aqui.
    if (/\/leilao\/(?:[^/]*-)?(?:simulacao|simulado|teste|treinamento)(?:-[^/]*)?\/lote_id\//i.test(m[1])) continue;
    try { urls.set(m[2], new URL(decodificarEntidades(m[1]), base).href); } catch { /* skip */ }
  }
  // VENDA DIRETA (26/10): a mesma página /leilao/lotes/imoveis tem, abaixo dos lotes de leilão, a seção "IMÓVEIS EM
  // VENDA DIRETA" com /venda-direta/bem_id/<N> — bem à venda sem praça, que o regex acima nunca via. Medido no dia:
  // Agili 1 lote + 1 VD, Lessa 7 + 2, Wendel Garcia 2 + 4, MP Leilão 33 + 7, Hasta Pública .lel.br 76 + 7. A chave
  // leva o prefixo `vd` porque bem_id e lote_id são numerações diferentes no mesmo site (colidiriam no fonte_id).
  for (const m of html.matchAll(/href=["'](\/venda-direta\/bem_id\/(\d+))["']/gi)) {
    try { urls.set(`vd${m[2]}`, new URL(decodificarEntidades(m[1]), base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => {
  const s = String(url);
  const vd = s.match(/\/venda-direta\/bem_id\/(\d+)/);
  if (vd) return `vd${vd[1]}`;
  return (s.match(/\/lote_id\/(\d+)/) || [])[1] || null;
};

// Cidade/UF do TÍTULO. Formato LeilãoPro: "…CIDADE DE <cidade>/<UF>" ou "…MUNICÍPIO DE <cidade>/<UF>".
// Fallback: último "<Cidade>/<UF>" solto (1–3 palavras), sem conector inicial. O foro ("Comarca…/UF")
// é raro no título (mora no corpo), mas o filtro abaixo o evita mesmo assim.
export function cidadeUF(titulo = '', descricao = '') {
  // Classe de palavra de cidade inclui HÍFEN — senão "Xangri-Lá/RS" capturava só "Lá" (20/08).
  const fontes = [titulo, descricao];
  for (const s of fontes) {
    const m = String(s || '').match(/(?:cidade|munic[íi]pio)\s+de\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+[A-Za-zÀ-ÿ'.\-]+){0,4}?)\s*\/\s*([A-Z]{2})\b/i);
    if (m) return { cidade: titleCase(m[1].trim()).slice(0, 60), estado: m[2].toUpperCase() };
  }
  for (const s of fontes) {
    // 16/09 — achado em produção (KLEILOES): matrícula cita "2º CRI de Maringá/PR" (Cartório
    // de Registro de Imóveis) antes da cidade REAL do lote (Paicandu/PR); sem filtrar "CRI"
    // igual já filtra Comarca/Vara/Tribunal, essa referência de cartório vencia como "última
    // Cidade/UF do texto" e a cidade gravada saía errada. `cri` como palavra isolada (\b…\b),
    // não substring — não risca nomes de cidade que por acaso contenham essas letras juntas.
    const limpo = String(s || '').replace(/\b(?:comarca|vara|tribunal|foro|ju[íi]zo|cri|circunscri[çc][ãa]o|cart[óo]rio)[^/]{0,40}?\/\s*[A-Z]{2}\b/gi, ' ');
    // `\/{1,2}` (24/10, Raupp): "(TRAMANDAÍ//RS) UMA CASA…" — barra dobrada de digitação deixava o lote sem cidade.
    const ms = [...limpo.matchAll(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+(?:de|do|da|dos|das|e|[A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+)){0,3})\s*\/{1,2}\s*([A-Z]{2})\b/g)];
    if (ms.length) {
      const m = ms[ms.length - 1];
      // Sufixo que EXISTE no IBGE (24/10, QLeilão): "…NA ENTRADA DE GAROPABA/SC" saía "Entrada de Garopaba". Fica o
      // maior sufixo que é município daquela UF; sem nenhum, segue a regra antiga (não inventa cidade).
      const uf = m[2].toUpperCase();
      const pal = m[1].trim().split(/\s+/);
      const ehMunicipio = (c) => Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`);
      if (!ehMunicipio(m[1])) {
        for (let i = 1; i < pal.length; i++) {
          if (ehMunicipio(pal.slice(i).join(' '))) return { cidade: titleCase(pal.slice(i).join(' ')).slice(0, 60), estado: uf };
        }
      }
      // `em|no|na…` (24/10, Hasta Pública .lel.br): título em CAIXA ALTA "…TRITÍCULA, EM FREI ROGÉRIO/SC" — o "EM"
      // maiúsculo passa como palavra de cidade e saía "Em Frei Rogério".
      return { cidade: titleCase(m[1].trim().replace(/^(?:(?:de|do|da|dos|das|e|em|no|na|nos|nas)\s+)+/i, '')).slice(0, 60), estado: m[2].toUpperCase() };
    }
    // "Cidade - UF" no TÍTULO (24/10, JAC/Renovar): "SALA COMERCIAL EM MEDIANEIRA - PR …", "IMÓVEL URBANO … EM
    // JOINVILLE - SC". Sem isto a busca descia para a descrição e pegava o endereço do LEILOEIRO ("Cascavel/PR") como
    // cidade do lote. Hífen é separador comum demais para aceitar sem prova: só vale o sufixo que é município da UF.
    if (s === titulo) {
      // `\s*[-–]\s*` (24/10, Clóvis): "…EDIFICIO CAMILA, ALEGRETE- RS" e "…CRI DE ROSÁRIO DO SUL-RS" — o IBGE abaixo é a prova.
      for (const h of String(s || '').matchAll(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]*(?:\s+[A-Za-zÀ-ÿ'.\-]+){0,5}?)\s*[-–]\s*([A-Z]{2})\b/g)) {
        const uf = h[2];
        const pal = h[1].trim().split(/\s+/);
        for (let i = 0; i < pal.length; i++) {
          const c = pal.slice(i).join(' ');
          if (Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`)) return { cidade: titleCase(c).slice(0, 60), estado: uf };
        }
      }
    }
  }
  return { cidade: null, estado: null };
}

// Área: primeiro m² do título/descrição ("ÁREA REAL PRIVATIVA DE 103,250M²", "MEDINDO 1.575,00m²",
// "ÁREA DE 300M²"). Comma = decimal; ponto = milhar (num() cuida das duas).
export function extrairArea(titulo = '', descricao = '') {
  const s = `${titulo} ${descricao}`;
  // 29/09: o 1º "N m²" do texto nem sempre é o imóvel — JELEILOES gravou 300 m² (resto de
  // "Barracão … 1.300,00 m²") num sítio de "8,5013 ha". O extrator central prioriza área
  // ROTULADA, entende hectare e só usa o m² solto por último; o regex abaixo fica de reserva.
  const central = extrairAreaM2(s);
  if (central > 0) return central;
  // Sem \b no fim: "²" é não-palavra, então \b nunca assertaria após "m²" e a área saía 0.
  const m = s.match(/([\d]{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*m\s*[²2]/i);
  return m ? num(m[1]) : 0;
}

// O og:title é "<lote> - <nome do site>". O nome do site sai pelo `sufixo` do tenant (24/10): sem isto o título
// carregava "… - JAC Leilões | Site do leiloeiro oficial de Cascavel/PR …" e cidadeUF() lia o "Cascavel/PR" do
// LEILOEIRO como cidade de lote em Medianeira e Campinas.
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const limparTitulo = (t, url = '') => {
  let host = ''; try { host = new URL(url).host.replace(/^www\./, ''); } catch { /* sem url: só o sufixo fixo */ }
  const ten = Object.values(TENANTS).find(x => x.sufixo && new URL(x.base).host.replace(/^www\./, '') === host);
  let r = decodificarEntidades(t || '').replace(/\s*[-–|]\s*(?:LEFFA|OSCAR)\s+LEIL[ÕO]ES.*$/i, '');
  if (ten) r = r.replace(new RegExp(`\\s*[-–|]\\s*${escRe(ten.sufixo)}.*$`, 'i'), '');
  return r.replace(/\s+/g, ' ').trim();
};

// Datas de praça (dd/mm/20aa) para o status. (Só 20xx — evita "1º"/CEPs.)
function datasPraca(txt) {
  const ds = [];
  for (const m of txt.matchAll(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/g)) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]); if (!isNaN(d)) ds.push(d);
  }
  return ds;
}
// true = leilão morto. DATA MANDA: praça futura → vivo (ainda que a 1ª já tenha passado).
export function estaEncerrado(txt, agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const datas = datasPraca(txt);
  if (datas.some(d => d >= hoje)) return false;
  const arrematado = /arrematad|vendido|deserto|cancelad|suspenso/i.test(txt);
  const temAberto = /recebendo\s*lances|em\s*andamento|aberto\s*para\s*lances|aceita(?:ndo)?\s*lances|agendad/i.test(txt);
  if (arrematado && !temAberto) return true;
  if (datas.length && !datas.some(d => d >= hoje)) return true;
  return /encerrad/i.test(txt) && !temAberto;
}
// Data do próximo leilão: a mais próxima no futuro; se todas passadas, a mais recente.
// (Exportada: os parsers `dom` do Passo 2 — alfa/hasta/nordeste — usam a mesma régua.)
export function proximaData(txt, agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const datas = datasPraca(txt).sort((a, b) => a - b);
  if (!datas.length) return null;
  const fut = datas.find(d => d >= hoje);
  const d = fut || datas[datas.length - 1];
  return d.toISOString().slice(0, 10);
}

// CIDADE PELO CORPO (24/10, 2ª leva das Juntas — RS): título e og:description sem "Cidade/UF" ("CASA 2 DORM GRAVATAI
// COM 44,41M2", "APTO 201 - TV ANTÔNIO XAVIER, Nº 15") deixavam 11 de 14 lotes do seco sem cidade nem UF — e lote sem
// UF some de /leiloes. Só entra quando título/og:description não resolveram, e só com município que EXISTE no IBGE:
//   1º o campo estruturado "Localização TRAMANDAI / RS" (tema novo da plataforma);
//   2º o bloco DESCRIÇÃO do lote (só ele — não o rodapé, que traz o endereço do LEILOEIRO): "Cidade/UF" com as mesmas
//      exclusões de Comarca/CRI do cidadeUF, ou "…, Gravataí, RS". O bloco NÃO vira a `descricao` gravada (a
//      calibração da fração ideal continua no og:description — ver o comentário em parseDetalhe).
const ehMunicipioUF = (c, uf) => Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`);
function sufixoMunicipio(trecho, uf) {
  const pal = String(trecho || '').trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < pal.length; i++) {
    const c = pal.slice(i).join(' ').replace(/^(?:(?:de|do|da|dos|das|e|em|no|na|nos|nas)\s+)+/i, '');
    if (c && ehMunicipioUF(c, uf)) return titleCase(c).slice(0, 60);
  }
  return null;
}
// CIDADE DO SLUG DO LEILÃO (26/10, achado na ligação de Luci Vera/Santayana/SW): lote cujo título é só "CASA"/"TERRENO
// COM ÁREA…" e cujo corpo não nomeia cidade tem a cidade no slug da URL — "…/leilao/imovel-porto-alegre-rs-25-09-2026-
// 16-21-36/lote_id/3165", "…-em-campo-bom-rs-…", "comarca-de-crissiumal-rs-imovel-humaita-rs". Regra: o par "<cidade>-
// <uf>" MAIS PERTO DO FIM do slug (o lugar do bem vem depois da comarca), conferido no IBGE; sem UF não vale nada —
// "comarca-de-crissiumal-imovel-rural" fica sem cidade (comarca não é a cidade do bem, mesma regra do cidadeUF).
const UFS_SLUG = new Set(['ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms','mg','pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','sp','se','to']);
export function cidadeDoSlugLeilao(url = '') {
  const slug = (String(url).match(/\/leilao\/([^/?#]+)\/lote_id\//i) || [])[1];
  if (!slug) return { cidade: null, estado: null };
  const t = decodeURIComponent(slug).toLowerCase().replace(/(?:-\d{1,2}){3,6}$/, '').replace(/-\d{2}-\d{2}-\d{4}.*$/, '').split('-').filter(Boolean);
  for (let j = t.length - 1; j >= 1; j--) {
    if (!UFS_SLUG.has(t[j])) continue;
    const uf = t[j].toUpperCase();
    for (let n = Math.min(5, j); n >= 1; n--) {
      const c = t.slice(j - n, j).join(' ');
      if (Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`)) return { cidade: titleCase(c).slice(0, 60), estado: uf };
    }
  }
  // "…-localizado-na-rodovia-sc-434-em-garopaba": "em <cidade>" no FIM do slug, sem UF — só nome que existe em UMA UF.
  const iEm = t.lastIndexOf('em');
  if (iEm >= 0 && iEm < t.length - 1 && t.length - iEm - 1 <= 4) {
    const c = t.slice(iEm + 1).join(' ');
    const x = inferirUF({ cidade: c });
    if (x?.via === 'cidade_unica') return { cidade: titleCase(c).slice(0, 60), estado: x.uf };
  }
  return { cidade: null, estado: null };
}

export function cidadeDoCorpo(txt = '') {
  const t = String(txt || '');
  const loc = t.match(/\bLocaliza[çc][ãa]o\s+([A-Za-zÀ-ÿ'.\- ]{2,50}?)\s*\/\s*([A-Z]{2})\b/);
  if (loc) {
    const c = sufixoMunicipio(loc[1], loc[2].toUpperCase());
    if (c) return { cidade: c, estado: loc[2].toUpperCase() };
  }
  const bloco = (t.match(/\bDESCRI[ÇC][ÃA]O\s+keyboard_arrow_down\s+([\s\S]{20,4000}?)\s+(?:[ÚU]LTIMOS LANCES|OBSERVA[ÇC][ÕO]ES|INFORMA[ÇC][ÕO]ES JUDICIAIS|LOCALIZA[ÇC][ÃA]O \/|EDITAL E DOCUMENTOS)/) || [])[1];
  if (!bloco) return { cidade: null, estado: null };
  const r = cidadeUF('', bloco);
  if (r.cidade && r.estado && ehMunicipioUF(r.cidade, r.estado)) return r;
  for (const m of bloco.matchAll(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+[A-Za-zÀ-ÿ'.\-]+){0,4}),\s*([A-Z]{2})\b/g)) {
    const c = sufixoMunicipio(m[1], m[2]);
    if (c) return { cidade: c, estado: m[2] };
  }
  // 3º (26/10, Bianchi/RS): corpo que só diz "…desta cidade de Horizontina" / "situado no município de X", sem UF.
  // Vale só quando o nome existe em UMA única UF do IBGE (inferirUF 'cidade_unica'); "CRI de"/"Comarca de" NÃO entram
  // (cartório e foro podem ser de outra cidade — ver o caso Paiçandu × Maringá no cidadeUF).
  for (const m of bloco.matchAll(/\b(?:cidade|munic[íi]pio)\s+de\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+(?:de|do|da|dos|das|[A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+)){0,3})/g)) {
    const pal = m[1].trim().split(/\s+/);
    for (let n = pal.length; n >= 1; n--) {
      const c = pal.slice(0, n).join(' ').replace(/[.,;:]+$/, '').replace(/-[A-Z]{2}$/, ''); // "cidade de Suzano-SP"
      const x = inferirUF({ cidade: c });
      if (x?.via === 'cidade_unica') return { cidade: titleCase(c).slice(0, 60), estado: x.uf };
    }
  }
  return { cidade: null, estado: null };
}

export function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  const titulo = limparTitulo(base.titulo, url);
  // DESCRIÇÃO do og:description (nível do título: endereço + área), NÃO do corpo. O corpo do
  // LeilãoPro traz a matrícula inteira, e todo APARTAMENTO cita "com a fração ideal de terreno"
  // (a parte comum do condomínio — inerente a qualquer unidade). Usar o corpo fazia o detector
  // de fração ideal EXCLUIR apartamentos inteiros (falso positivo: 7208/7246 em Torres/RS, com
  // "área real privativa de 103m²"). O og:description casa com a calibração do RE_FRACAO_IDEAL
  // nas outras fontes (título/desc curta) e ainda é uma descrição mais limpa para o cliente.
  const ogDesc = (html.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i) || [])[1];
  const descricao = decodificarEntidades(ogDesc || base.descricao || '');
  const txt = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  // PREÇO POR RÓTULO: "LANCE INICIAL" (1º) e "LANCE INICIAL 2º LEILÃO" (2º). Nunca max/min cego.
  // "1ª/2ª DATA" e "2ª PRAÇA" são o mesmo rótulo em outro tema (24/10, NS Leilões: 2ª DATA R$ 90.000 era ignorada).
  const precos = [];
  for (const m of txt.matchAll(/lance\s*inicial(?:\s*(\d)\s*[º°ª]?\s*(?:leil[ãa]o|data|pra[çc]a))?[^R]{0,30}R\$\s*([\d.]+,\d{2})/gi)) {
    precos.push({ leilao: m[1] ? Number(m[1]) : 0, valor: num(m[2]) });
  }
  // "LANCE INICIAL" sem número (leilao 0) é o lance VIGENTE do card. Só vale como 1º leilão quando a página não
  // numera os leilões (layout do Leffa). 24/10, Renovar 10335: card "LANCE INICIAL R$ 630.000" (2º em curso) +
  // "1º LEILÃO R$ 700.000" + "2º LEILÃO R$ 630.000" — o card vencia o rótulo numerado e a avaliação saía 630 mil.
  const atual = precos.find(p => p.leilao === 0);
  const p1 = precos.find(p => p.leilao === 1) || atual;
  const p2 = precos.find(p => p.leilao === 2);
  let avaliacao = plaus(p1?.valor || 0);
  // Rótulo "Avaliação" explícito tem prioridade sobre o lance inicial do 1º leilão, se existir.
  const avalExpl = plaus(num((txt.match(/avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  if (avalExpl) avaliacao = avalExpl;
  // Sem 2º leilão, o lance vigente ABAIXO da avaliação é o mínimo (24/10, Raupp 6457: "LANCE INICIAL R$ 161.000 ·
  // AVALIAÇÃO R$ 230.000" saía com mínimo = avaliação, desconto 0 sobre um lote a 70%).
  const atualAbaixo = atual && plaus(atual.valor) && atual.valor < avaliacao ? atual.valor : 0;
  let minimo = plaus(p2?.valor || 0) || atualAbaixo || avaliacao;
  if (!avaliacao && minimo) avaliacao = minimo;
  // VENDA DIRETA (/venda-direta/bem_id/N): sem praça; o preço é o rótulo "VALOR R$ X" (a COMISSÃO logo ao lado é
  // ignorada). Avaliação só se o texto a declara e ela fica ACIMA do preço (Lessa 297: "Avaliação: R$ 155.000" e
  // VALOR R$ 75.950); senão avaliação = preço, desconto 0 — nunca inventado.
  const ehVendaDireta = /\/venda-direta\/bem_id\/\d+/.test(String(url));
  if (ehVendaDireta) {
    const valor = plaus(num((txt.match(/\bVALOR\s+R\$\s*([\d.]+,\d{2})/) || [])[1]));
    minimo = valor;
    avaliacao = avalExpl && avalExpl > valor ? avalExpl : valor;
  }

  // GATE DE PRAÇA (09/09, mesmo achado do BAYIT: praça com data ⇒ nunca venda direta, regra
  // literal do dono). p1/p2 (lance do 1º/2º leilão, já extraídos acima) são o sinal — achar
  // um valor de leilão numerado é a assinatura de praça formal, incompatível com venda direta.
  const temPraca = !!(p1 || p2) && !ehVendaDireta;
  const modalidade = ehVendaDireta ? 'venda_direta' : /processo\s*n|\bju[íi]z\b|judicial/i.test(txt) && !/extrajudicial/i.test(txt) ? 'judicial'
    : /extrajudicial/i.test(txt) ? 'extrajudicial'
    : (!temPraca && /venda\s*direta/i.test(txt)) ? 'venda_direta' : 'extrajudicial';
  let { cidade, estado } = cidadeUF(titulo, descricao);
  if (!cidade) ({ cidade, estado } = cidadeDoCorpo(txt));
  if (!cidade) ({ cidade, estado } = cidadeDoSlugLeilao(url));
  // TÍTULO QUE É O NOME DO JUÍZO (26/10, Cecilia Delzeir 515): og:title "3ª VARA CÍVEL DO FORO DA COMARCA DE SUZANO/SP"
  // e o og:description igual — o portão lia "nem imóvel nem veículo" e um terreno de 5.338 m² saía do acervo. Só
  // nesse caso o título e a descrição vêm do início do bloco DESCRIÇÃO do lote; a cidade acima já foi lida.
  let tituloOut = titulo, descricaoOut = descricao;
  if (/^\s*(?:\d+\s*[ªºa°]?\s*)?(?:vara|foro|ju[íi]zo|tribunal|comarca|cart[óo]rio)\b/i.test(titulo)) {
    const bloco = (txt.match(/\bDESCRI[ÇC][ÃA]O\s+keyboard_arrow_down\s+([\s\S]{20,4000}?)\s+(?:[ÚU]LTIMOS LANCES|OBSERVA[ÇC][ÕO]ES|INFORMA[ÇC][ÕO]ES JUDICIAIS|EDITAL E DOCUMENTOS)/) || [])[1];
    if (bloco) {
      tituloOut = bloco.slice(0, 160).replace(/\s+\S*$/, '').replace(/[,;:]$/, '');
      descricaoOut = bloco.slice(0, 600);
    }
  }
  const area = extrairArea(tituloOut, descricaoOut) || extrairArea(txt.slice(0, 400));
  const mat =(txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{4,})/i) || [])[1] || null;

  // Docs: PDFs de /uploads/media/documentos_leilao (edital) e /documentos_bem (matrícula/laudo).
  const anexos = [];
  let link_edital = null, link_matricula = null;
  for (const m of html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)) {
    let abs; try { abs = new URL(decodificarEntidades(m[1]), url).href; } catch { continue; }
    const low = abs.toLowerCase();
    const tipo = /documentos_leilao|edital/.test(low) ? 'edital'
      : /documentos_bem|matr[íi]cula|laudo/.test(low) ? 'matricula' : 'outro';
    if (anexos.some(a => a.url === abs)) continue;
    anexos.push({ tipo, nome: tipo === 'edital' ? 'Edital' : tipo === 'matricula' ? 'Matrícula / Laudo do bem' : 'Documento', url: abs });
    if (tipo === 'edital' && !link_edital) link_edital = abs;
    if (tipo === 'matricula' && !link_matricula) link_matricula = abs;
  }

  return {
    titulo: tituloOut.slice(0, 180) || null,
    cidade, estado, link_foto: base.link_foto || null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    // 20/09 (pedido do dono: descrição completa, como o leiloeiro publica): parser
    // compartilhado por vários tenants (JELEILOES/KLEILOES etc.) — 500 truncava no meio.
    descricao: (descricaoOut || '').slice(0, 8000) || null,
    data_leilao: ehVendaDireta ? null : proximaData(txt),
    numero_matricula: mat,
    link_edital, link_matricula, anexos,
    // Venda direta não tem praça: a única data da página é "Disponibilizado em: 28/06/2025" (passada), e o
    // estaEncerrado leria todo bem à venda como morto. Vale só o status do bloco do preço (entre a data de publicação
    // e a DESCRIÇÃO).
    encerrado: ehVendaDireta
      ? /vendid|indispon[íi]vel|negociad|encerrad|arrematad/i.test((txt.match(/Disponibilizado em[\s\S]{0,600}?DESCRI[ÇC][ÃA]O/i) || [''])[0])
      : estaEncerrado(txt),
  };
}

export function montarRow(url, det, tenant) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url) || String(url).split('/').filter(Boolean).pop();
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro} ${id}`,
    tipo: inferirTipo(det.titulo || '', url),
    modalidade: det.modalidade,
    cidade: det.cidade || null, estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url, url_lote: url, link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula, link_matricula: det.link_matricula, anexos: det.anexos,
    leiloeiro: tenant.leiloeiro, data_leilao: det.data_leilao || null, forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

export { checarQualidade };
