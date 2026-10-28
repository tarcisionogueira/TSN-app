/**
 * Scraper MULTI-TENANT da plataforma SOLEON — imóveis de vários leiloeiros do backlog
 * TRT-15 que rodam a MESMA base white-label (Bootstrap 4.1.3 + soleon.s3 + /lotes/…).
 * ────────────────────────────────────────────────────────────────────────────
 * Por que existe: o recon (23/07) classificou calil/vegas/3torres como a MESMA
 * plataforma que o RJ Leilões (scripts/scraper-rj.mjs) — cujo parser já é validado em
 * produção. Aqui GENERALIZAMOS aquele parser p/ N tenants, um `fonte`/`leiloeiro` por
 * domínio (catálogos independentes; NÃO é backend compartilhado como o cluster PHP).
 *
 * ECONOMIA ("grátis primeiro"): só o 3torres está atrás de Cloudflare. Então cada fetch
 * tenta a via GRÁTIS (fetch direto, egress do Actions) e SÓ cai no Bright Data Web
 * Unlocker (pago, com teto) quando barrado/challenge. calil/vegas custam ~US$0.
 *
 * SEGURANÇA DE CUSTO:
 *   - SOLEON_MAX_LOTES (default 40): teto de lotes NOVOS por execução (por tenant).
 *   - SOLEON_DRYRUN (default '1'): NÃO grava — busca, parseia e LOGA o que inseriria.
 *   - SOLEON_DEBUG  (default '0'): dumpa a estrutura (listagem + 1 detalhe/tenant) p/
 *     confirmar os padrões de URL e o parser ANTES de gravar (método recon-first).
 *   - Bright Data via buscarViaBrightData(proposito='soleon') → sub-cota + teto global.
 *   - SOLEON_TENANTS: csv de fontes p/ rodar um subconjunto (ex.: "CALIL,VEGAS").
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { matriculaDoTexto } from './lib/matricula-texto.mjs';
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { decodificarEntidades, extrairAreaM2 } from '../api/_texto-imovel.js';
import { enderecoSoleon } from './lib/endereco-pagina.mjs';
import { idAnuncioComprei, urlVisitarComprei, fichaComprei } from './lib/comprei-pgfn.mjs';
// NOTA (11/08, REVISTA EM 12/08): a decisão anterior era manter o `null` do
// `fetchViaBrightData` como fallback deliberado — grátis primeiro, pago como segunda
// chance. O fallback continua certo; o `null` é que era cego. Em 12/08 a cota semanal
// saturou e as três fontes foram para o `fonte_saude` como
// "REGRESSÃO: caiu de 6 para 0" — mandando procurar um bug de parser que não existia,
// quando a ação correta era liberar orçamento. Agora usa `buscarViaBrightData`, que LANÇA
// com o motivo, e o `semCota` chega até o registro de saúde.
// Segue valendo o resto: coleta com zero lote sai com código 1 e grava 'falhou', e o gate
// só carimba "coletei" com linha no acervo.
import { buscarViaBrightData, ErroBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { viaBanco } from './lib/motor/fetch-fonte.mjs';
import { extrairGenerico, extrairData, checarQualidade } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';
// `planejarAlvo` (10/09): reaproveita o planejador novos+releitura já testado (8 cenários em
// planejar-alvo.test.mjs) que o runner.mjs ganhou em 29/08 pela MESMA razão descrita aqui —
// ver o comentário completo acima de `coletarTenant`.
import { planejarAlvo } from './lib/motor/runner.mjs';
import { siteDeclaraVazio, MOTIVO_VAZIO_DECLARADO } from './lib/vazio-declarado.mjs';
import { galeriaDoHtml, montarFotos, FONTES_PASTA_DA_CAPA } from './lib/galeria-veiculo.mjs';
import { veiculoDoLote } from './lib/veiculo-do-lote.mjs';
import { UFS } from './lib/dom-parse-util.mjs';
import { patioPreservado } from './lib/patio-veiculo.mjs';

// Tenants SOLEON confirmados no recon (23/07). fonte = chave única no acervo/monitor;
// o baseline auto-aprendido (monitor-fontes-cron) passa a vigiar cada um após alguns runs.
//
// ── OS 12 DA JUCEMG (29/08): PROMOVIDOS PELO DRY-RUN, NÃO PELA ASSINATURA ────────────────
// A triagem residencial destravou 53 sites que a CI não lia e classificou 17 como SOLEON pela
// assinatura da HOME. Assinatura não é catálogo — em 29/08, 11 sites classificados como
// Superbid enumeraram ZERO lotes: linkavam para a plataforma sem RODAR o catálogo dela.
// Então nenhum entrou aqui sem antes provar `/lotes/imovel` num dry-run (SOLEON_DRYRUN=1,
// SOLEON_NO_BD=1) rodado do IP residencial do dono. Estes 12 provaram, com o total de lotes
// que o catálogo devolveu na medição:
const TODOS_TENANTS = [
  { fonte: 'CALIL',        leiloeiro: 'Calil Leilões',              base: 'https://www.calilleiloes.com.br' },
  { fonte: 'VEGAS',        leiloeiro: 'Vegas Leilões',              base: 'https://www.vegasleiloes.com.br' },
  { fonte: 'TORRES3',      leiloeiro: '3 Torres Leilões',           base: 'https://www.3torresleiloes.com.br' },
  // ── JUCEMG, aprovados no dry-run de 29/08 (catálogo medido entre parênteses) ──
  { fonte: 'FERREIRALEIL', leiloeiro: 'Priscilla Lopes R. Ferreira', base: 'https://www.ferreiraleiloes.com.br' },       // 180
  { fonte: 'JOAOEMILIO',   leiloeiro: 'João Emílio de Oliveira Filho', base: 'https://www.joaoemilio.com.br' },          // 171
  { fonte: 'DANIELGARCIA', leiloeiro: 'Daniel Elias Garcia',        base: 'https://www.danielgarcialeiloes.com.br' },    //  83
  { fonte: 'ISAIAS',       leiloeiro: 'Isaías Rosa Ramos Júnior',   base: 'https://www.isaiasleiloes.com.br' },          //  78
  { fonte: 'APICE',        leiloeiro: 'Fábio Prando Fagundes Góes', base: 'https://www.apiceleiloes.com.br' },           //  47
  { fonte: 'CERULI',       leiloeiro: 'Flávio Duarte Ceruli',       base: 'https://www.leiloesceruli.com.br' },          //  38
  { fonte: 'LANCEJA',      leiloeiro: 'Cristiane B. Moraes Lopes',  base: 'https://www.lanceja.com.br' },                //  11
  { fonte: 'TMLEILOES',    leiloeiro: 'Thais Silva Moreira de Sousa', base: 'https://www.tmleiloes.com.br' },            //  10
  { fonte: 'PURCENA',      leiloeiro: 'Carla Karine Santos Agostinho', base: 'https://www.purcenaleiloes.com.br' },      //   9
  { fonte: 'AGOSTINHO',    leiloeiro: 'Paulo César Agostinho',      base: 'https://www.agostinholeiloes.com.br' },       //   6
  // Acervo mínimo na medição (1 lote), mas o parser LEU e produziu ficha pronta — é acervo
  // pequeno no momento, não falha de catálogo. O baseline aprendido acompanha daqui.
  { fonte: 'CASAMARTILLO', leiloeiro: 'Casa Martillo Leilões',      base: 'https://www.casamartillo.com.br' },           //   1
  { fonte: 'INFINITY',     leiloeiro: 'Carlos Augusto Ribeiro Lima', base: 'https://www.infinityleiloes.com.br' },       //   1
  // 28/09 — da fila do Radar de editais. Recon pelo servidor do banco: meta author "SOLEON
  // Soluções para Leilões Online", /lotes/imovel com 7 links /item/N/detalhes (pág. 2 declara
  // "nenhum lote encontrado") — mesmo formato dos tenants acima.
  { fonte: 'ALEXANDREPEDROSA', leiloeiro: 'Alexandre Reis Pedrosa', base: 'https://www.alexandrepedrosaleiloeiro.com.br' }, //   7
  // 24/10 — varredura de não cobertos (triagem JUCESP/JUCEMG). Pelo banco (grátis, HTTP 200): /lotes/imovel com 30
  // /item/N/detalhes por página (pág. 2 também cheia) + 13 em /lotes/veiculo. Dry-run sobre as páginas reais: 30 lidos
  // → 23 prontos e 7 descartados por regra de negócio (4 fração ideal, 3 vaga/box) — nenhum por falha de leitura.
  // No acervo só havia 1 lote dela (EDITAL_DJEN).
  { fonte: 'GOLDLEILOES',  leiloeiro: 'Gold Leilões',               base: 'https://www.leiloesgold.com.br' },         //  60+
  // 24/10 — levantamento das Juntas Comerciais (leiloeiro_junta/leiloeiro_triagem `junta_2410`): leiloeiros NÃO
  // coletados que rodam SOLEON. Catálogo e 3–5 lotes de cada baixados pelo banco (grátis) e passados no coletor
  // real em seco: todos com cidade/UF/valor/data/link batendo com a página (conferidos: alemaoleil_14702 Erechim/RS
  // R$ 190.000 → 2ª R$ 85.000; winleiloes_7687 Maringá/PR R$ 380.892,88 → 2ª R$ 284.088; machadoleil_15555
  // Maravilha/SC; hammerleil_18080 Camaçari/BA CAIXA, lance R$ 172.605,05 acima da avaliação R$ 132.000 — é a regra
  // da CAIXA, não erro). Nenhum lote deles estava no acervo. Contagem = lotes na pág. 1 do catálogo (30+ = há pág. 2).
  // PATIOROCHALEIL não é ROCHALEILOES (rochaleiloes.com.br, PR/SP) nem o PATIOROCHA morto do scraper.js; CASSIANOLEIL
  // (Cassiano Ricardo, PE) não é CASSIANO (Glener Brasil Cassiano, leiloesbrasilcassiano.com.br). HAMMER só abre com
  // `www.` — sem ele /lotes/imovel devolve a home e o /item/N/detalhes também (30 lotes clones no seco).
  { fonte: 'PATIOROCHALEIL', leiloeiro: 'Pátio Rocha Leilões', base: 'https://patiorochaleiloes.com.br' }, // 30+
  { fonte: 'LEILOPAR', leiloeiro: 'Leilopar (Eduardo Jesus Bordignon)', base: 'https://leilopar.com.br' }, // 30+
  { fonte: 'WINLEILOES', leiloeiro: 'Win Leilões', base: 'https://winleiloes.com.br' }, // 30+
  { fonte: 'CASSIANOLEIL', leiloeiro: 'Cassiano Leilões (Cassiano Ricardo Dall’Ago e Silva)', base: 'https://cassianoleiloes.com.br' }, // 30+
  { fonte: 'ALEMAOLEIL', leiloeiro: 'Alemão Leiloeiro (Francisco Hillesheim)', base: 'https://alemaoleiloeiro.com.br' }, // 30+
  { fonte: 'JVLEILOES', leiloeiro: 'Juliana Vettorazzo Leiloeira', base: 'https://jvleiloes.lel.br' }, // 30+
  { fonte: 'MULLERLEIL', leiloeiro: 'Müller Leilões (Diego Costa Muller)', base: 'https://mullerleiloes.com.br' }, // 30+
  { fonte: 'WMSLEILOES', leiloeiro: 'WMS Leilões (Wilkerson Machado dos Santos)', base: 'https://wmsleiloes.com.br' }, // 30+
  { fonte: 'HAMMERLEIL', leiloeiro: 'Hammer Casa de Leilões (Rodrigo Schmitz)', base: 'https://www.hammer.lel.br' }, // 30+
  { fonte: 'RAICHER', leiloeiro: 'Raicher Leilões (Sami Raicher)', base: 'https://raicherleiloes.com.br' }, //  25
  { fonte: 'VICTORDORTA', leiloeiro: 'Victor Dorta Leilões', base: 'https://victordortaleiloes.com.br' }, //  18
  { fonte: 'NOGARI', leiloeiro: 'Nogari Leilões', base: 'https://nogarileiloes.com.br' }, //  17
  { fonte: 'LEILAOPE', leiloeiro: 'Leilão Pernambuco', base: 'https://leilaopernambuco.com.br' }, //  15
  { fonte: 'CRAVOLEIL', leiloeiro: 'Cravo Leilões (Viriato Domingues Cravo)', base: 'https://cravoleiloes.com.br' }, //  13
  { fonte: 'ISABELLEIL', leiloeiro: 'Isabel Leilões (Maria Isabel Soeiro)', base: 'https://isabelleiloes.com.br' }, //  13
  { fonte: 'MGLEILOESRS', leiloeiro: 'MG Leilões RS (Maurício Gehm)', base: 'https://mgleiloes-rs.com.br' }, //  10
  { fonte: 'RAFAELARIBEIRO', leiloeiro: 'Rafaela Ribeiro Leilões', base: 'https://rafaelaribeiroleiloes.com.br' }, //  10
  { fonte: 'AGENCIALEILAO', leiloeiro: 'Agência de Leilão (Vicente Alves Pereira Neto)', base: 'https://agencialeilao.com.br' }, //  10
  { fonte: 'MACHADOLEIL', leiloeiro: 'Fábio Marlon Machado Leiloeiro', base: 'https://machadoleiloeiro.com.br' }, //   9
  { fonte: 'PIMENTELLEIL', leiloeiro: 'Pimentel Leilões', base: 'https://pimentelleiloes.com.br' }, //   9
  // 24/10 (2ª leva, triagem575 — leiloeiros ATIVOS das Juntas de RS/SE/PI/RN/DF/TO/AC/RO ainda não coletados).
  // Mesmo procedimento: home e /lotes/imovel pelo banco (grátis, HTTP 200), 2–3 lotes de cada no coletor real em seco.
  // Nenhum lote destes domínios estava no acervo (conferido por host do url_lote). LEVYLEIL (John Levy Zago Amaral)
  // e ZAGOLEIL (Cleci Levy Zago) são da mesma família mas catálogos distintos (ids não se repetem).
  // Os que vieram com /lotes/imovel vazio nesta leva (argleiloes, jgcargneluttileiloes, leilaosantos, lopesleiloes,
  // pereiraleiloesce, portelaleiloes, realizaleiloes, sydneyleiloes, natalialeiloes, leiloestocantins) entraram em
  // 26/10 — ver o bloco "LIGADOS COM CATÁLOGO VAZIO" no fim da lista.
  { fonte: 'CARGNELUTTI', leiloeiro: 'Cargnelutti Leilões', base: 'https://cargneluttileiloes.com.br' }, // 30+ (RS)
  { fonte: 'LEILOESRN', leiloeiro: 'Leilões RN (Stella Araújo Zanatta)', base: 'https://leiloesrn.com.br' }, // 30+ (RN)
  { fonte: 'OROLEIL', leiloeiro: 'Öro Leilões (Erni Carlos Oro)', base: 'https://oroleiloes.lel.br' }, // 30+ (RS)
  { fonte: 'RECHLEIL', leiloeiro: 'Rech Leilões (Alexandre Rech)', base: 'https://rechleiloes.com.br' }, // 30+ (RS)
  { fonte: 'BRONZATTO', leiloeiro: 'Bronzatto Leilões', base: 'https://bronzattoleiloes.com.br' }, //  21 (RS)
  { fonte: 'AGUIAROLIANI', leiloeiro: 'Leilões Aguiar e Oliani', base: 'https://leiloesaguiar.com.br' }, //  21 (AC/RO)
  { fonte: 'ITALOLEIL', leiloeiro: 'Ítalo Leilões (Ítalo Trindade Moura)', base: 'https://italoleiloes.com' }, //  20 (PI)
  { fonte: 'MORAESLEIL', leiloeiro: 'Moraes Leilões', base: 'https://moraesleiloes.com.br' }, //  20 (RS)
  { fonte: 'LANCESE', leiloeiro: 'Lance Leilões (SE)', base: 'https://lancese.com.br' }, //  18 (SE)
  { fonte: 'LEVYLEIL', leiloeiro: 'Levy Leilões (John Levy Zago Amaral)', base: 'https://levyleiloes.com.br' }, //  14 (RS)
  { fonte: 'ZAGOLEIL', leiloeiro: 'Zago Leilões (Cleci Levy Zago)', base: 'https://zagoleiloes.com.br' }, //   7 (RS)
  { fonte: 'BACKLEIL', leiloeiro: 'Back Leilões (Maurício Rodrigo Back)', base: 'https://backleiloes.com.br' }, //   5 (RS)
  { fonte: 'NIEWINSKI', leiloeiro: 'Bruno Niewinski Leilões', base: 'https://brunoniewinskileiloes.com.br' }, //   2 (RS)
  { fonte: 'LEILBRASILIA', leiloeiro: 'Leiloeiros de Brasília (Borba Assunção)', base: 'https://leiloeirosdebrasilia.com.br' }, //   1 (DF)
  { fonte: 'SANTIAGOLEIL', leiloeiro: 'Santiago Leilões (André Viana Hemann)', base: 'https://santiagoleiloes.com.br' }, //   1 (RS)
  // 26/10 (3ª leva — leiloeiro_junta ATIVO nao_coletado, triagem `junta_2410`: PE/SC/BA/ES/GO/MT/MA/RJ/PR). /lotes/imovel
  // pelo banco (grátis); "Total N Lotes" do próprio site = itens enumerados em todos (página única, sem ?page=2); TODOS
  // os lotes lidos no coletor real em seco (fetch simulado, nada gravado). Nenhum lote destes domínios estava no acervo.
  // Entre parênteses: Total do site em 26/10. Os de /lotes/imovel vazio nesta leva (conceito, felfili, foco,
  // gutembergaraujo, kildare, lumina, macedo, machado) entraram depois — bloco "LIGADOS COM CATÁLOGO VAZIO" abaixo.
  // FORA: leiloeironacif.com (1 lote listado, mas a página /item/N/detalhes só abre com LOGIN — 1 KB de texto;
  // reconferido em 26/10 à tarde, mesmo resultado).
  { fonte: 'ARAGAOLEIL', leiloeiro: 'Aragão Leilões', base: 'https://aragaoleiloes.com.br' }, //   7 (PE)
  { fonte: 'BESTLEIL', leiloeiro: 'Best Leilões', base: 'https://bestleiloes.com.br' }, //   3 (SC)
  { fonte: 'BRASILSULLEIL', leiloeiro: 'Brasil Sul Leilões', base: 'https://brasilsulleiloes.com.br' }, //   8 (SC)
  { fonte: 'CENTRALDOSLEIL', leiloeiro: 'Central dos Leilões', base: 'https://centraldosleiloes.com.br' }, //   1 (BA)
  { fonte: 'COLODETE', leiloeiro: 'Colodete Leilões', base: 'https://colodeteleiloes.com.br' }, //   5 (ES)
  { fonte: 'DIEGOLEIL', leiloeiro: 'Diego Leilões', base: 'https://diegoleiloes.com.br' }, //   2 (GO/PR/SC)
  { fonte: 'FALEILOES', leiloeiro: 'FA Leilões', base: 'https://faleiloes.com.br' }, //   9 (MT)
  { fonte: 'GRLEILOES', leiloeiro: 'GR Leilões', base: 'https://grleiloes.com' }, //   1 (ES/MA)
  { fonte: 'GUARIGLIA', leiloeiro: 'Guariglia Leilões', base: 'https://guariglialeiloes.com.br' }, //   1 (BA)
  { fonte: 'JUNKESLEIL', leiloeiro: 'Junkes Leilões', base: 'https://junkesleiloes.com.br' }, //   1 (SC)
  { fonte: 'VARONESLEIL', leiloeiro: 'Varones Leilões', base: 'https://leiloeirojudicial.com.br' }, //   7 (SC)
  { fonte: 'LKLEILOES', leiloeiro: 'LK Leilões', base: 'https://lkleiloes.com.br' }, //   4 (GO)
  { fonte: 'PLUSLEIL', leiloeiro: 'Plus Leilões', base: 'https://plusleiloes.lel.br' }, //   2 (SC)
  { fonte: 'QUADRADOLEIL', leiloeiro: 'Quadrado Leilões', base: 'https://quadradoleiloes.com.br' }, //   1 (SC)
  { fonte: 'ROSENTALLEIL', leiloeiro: 'Rosental Leilões', base: 'https://rosentalleiloes.com.br' }, //   3 (SC)
  { fonte: 'VALDEIRPEREIRA', leiloeiro: 'Valdeir Pereira Leiloeiro', base: 'https://valdeirpereiraleiloeiro.com.br' }, //   1 (MT)
  // ── LIGADOS COM CATÁLOGO VAZIO (26/10, regra do dono: leiloeiro ATIVO em família que já lemos fica ligado mesmo sem
  // lote hoje — o coletor pega no dia em que publicar). Prova de cada um, pelo banco (pg_net, grátis): /lotes/imovel
  // HTTP 200, título "Busca de Imóveis :: <site>", assinatura SOLEON e o texto "NENHUM LOTE ENCONTRADO" — o mesmo HTML
  // que o tenant com lote devolve, só que sem /item/N/detalhes. No seco (coletor real, fetch simulado) cada um sai
  // "0 lotes enumerados" com o vazio DECLARADO pelo site, o que grava `vazio` em fonte_saude sem alarme: fonte que
  // nunca teve lote não entra em fonte_baseline_aprendida (só aprende de status ok com total > 0), então não há
  // `zerou`/`regressao`/`medicao_velha` possível para ela. ARGLEILOES e REALIZALEIL têm a mesma leiloeira (Cristiane
  // Góis, SE) em sites distintos; se um dia listarem os mesmos ids, sai um dos dois.
  { fonte: 'CONCEITOLEIL', leiloeiro: 'Conceito Leilões (Miriam A. Trindade Gir)', base: 'https://conceitoleiloes.com.br' }, // 0 (PE/SP)
  { fonte: 'FELFILILEIL', leiloeiro: 'Felfili Leilões (Icaro Felfili Jardim)', base: 'https://felfilileiloes.com.br' }, // 0 (MT)
  { fonte: 'FOCOLEIL', leiloeiro: 'Foco Leilões (Anna Karoline do Amaral)', base: 'https://focoleiloes.com.br' }, // 0 (BA/MT/RJ)
  { fonte: 'GUTEMBERGLEIL', leiloeiro: 'Gutemberg Araújo Leilões', base: 'https://gutembergaraujoleiloes.com.br' }, // 0 (BA)
  { fonte: 'KILDARELEIL', leiloeiro: 'Kildare Leilões (Josecelli Kildare Fraga Gomes)', base: 'https://kildareleiloes.com.br' }, // 0 (PR)
  { fonte: 'LUMINALEIL', leiloeiro: 'Lumina Leilões (Marcelo Drechsel)', base: 'https://luminaleiloes.com.br' }, // 0 (SC)
  { fonte: 'MACEDOLEIL', leiloeiro: 'Macêdo Leilões (José Sérgio Della Giustina)', base: 'https://macedoleiloes.com.br' }, // 0 (ES/SC)
  { fonte: 'MACHADORJ', leiloeiro: 'Machado Leilões RJ (Norma Maria Machado)', base: 'https://machadoleiloes.com.br' }, // 0 (RJ)
  { fonte: 'ARGLEILOES', leiloeiro: 'ARG Leilões (Cristiane Góis)', base: 'https://argleiloes.com.br' }, // 0 (SE)
  { fonte: 'JGCARGNELUTTI', leiloeiro: 'João Guilherme Cargnelutti Leilões', base: 'https://jgcargneluttileiloes.com.br' }, // 0 (RS)
  { fonte: 'LEILAOSANTOS', leiloeiro: 'Leilão Santos (Luiz Carlos Dale Nogari dos Santos)', base: 'https://leilaosantos.com.br' }, // 0 (RS)
  { fonte: 'LOPESLEILCE', leiloeiro: 'Lopes Leilões (João Lopes Cavalcante)', base: 'https://lopesleiloes.net.br' }, // 0 (CE)
  { fonte: 'PEREIRALEILCE', leiloeiro: 'Pereira Leilões (Francisco das Chagas Pereira Júnior)', base: 'https://pereiraleiloesce.com.br' }, // 0 (CE)
  { fonte: 'PORTELARO', leiloeiro: 'Portela Leilões (Francisco Portela Aguiar)', base: 'https://portelaleiloes.com.br' }, // 0 (RO) ≠ PORTELLA
  { fonte: 'REALIZALEIL', leiloeiro: 'Realiza Leilões (Rabelo Góis)', base: 'https://realizaleiloes.com.br' }, // 0 (SE)
  { fonte: 'SYDNEYLEIL', leiloeiro: 'Sydney Leilões (Eduardo Sydney Bezerra de Girão)', base: 'https://sydneyleiloes.com.br' }, // 0 (CE)
  { fonte: 'LOUCOPORLEIL', leiloeiro: 'Louco por Leilões (Matheus Werneck)', base: 'https://leiloarialoucoporleiloes.com.br' }, // 0 (MG)
  { fonte: 'UNIVERSOLEIL', leiloeiro: 'Universo dos Leilões (Alexsander Pretti Domingos)', base: 'https://universodosleiloes.com.br' }, // 0 (MG)
  // agilleiloes.com.br redireciona para cá (mesmo leiloeiro, André Fonseca Dias); /lotes/imovel responde 200 e vazio declarado.
  { fonte: 'MARAURZEDO', leiloeiro: 'Mara Urzedo Leilão (André Fonseca Dias)', base: 'https://maraurzedoleilao.com.br' }, // 0 (MG)
  // ── 26/10, com lote hoje: TODOS os lotes no coletor real em seco; Total do site × enumerados entre parênteses.
  { fonte: 'NATALIALEIL', leiloeiro: 'Natália Nunes Leilões', base: 'https://www.natalialeiloes.com.br' }, // 1 de 1 (DF, só com www.)
  { fonte: 'CARSTENSLEIL', leiloeiro: 'Carstens Leiloeiros (Rosa Lúcia Lopes Carstens)', base: 'https://leiloeiro.online' }, // 1 de 1 (SC)
  { fonte: 'ALVESLEIL', leiloeiro: 'Alves Leilões (Érica Cristina Alves)', base: 'https://www.alvesleiloes.com.br' }, // 1 de 1 (MG)
  // Tocantins: o único lote é fração ideal (25%) — sai pela regra de negócio; fica ligado pelo próximo.
  { fonte: 'TOCANTINSLEIL', leiloeiro: 'Leilões Tocantins (Lucas Fernandes Almeida)', base: 'https://leiloestocantins.com' }, // 1 de 1, 0 pronto (TO)
  // SCHMITZ Leiloeiros (Eduardo Schmitz, GO/MG/MT/PR/SC): "Total 560 Lotes" = 19 páginas de 30 (+20); a pág. 20
  // declara vazio. Os ids (22010, 22607–23165) não se repetem com o HAMMERLEIL (17915–18093, Total 604) — catálogos
  // distintos apesar do sobrenome. Era CLICLEILOES no bloco de reprovados de 29/08 (1 lote naquele dia).
  { fonte: 'SCHMITZLEIL', leiloeiro: 'Schmitz Leiloeiros Oficiais (Eduardo Schmitz)', base: 'https://clicleiloes.com.br' }, // 560 de 560
  // ── 26/10, JUCESP (triagem pelo banco de 26/10, `tri2610`): mesma prova dos blocos acima. Base com `www.` (url_final
  // medida). Cada site tem a sua CDN de bens (dxxxx.cloudfront.net) e faixa de ids própria — nenhum catálogo repetido.
  // Vazios hoje ("NENHUM LOTE ENCONTRADO" no /lotes/imovel; o Nosso Leilão mostra "Imóveis 0" na home e "RELAÇÃO EM
  // BREVE" na busca — vazio sem a frase-padrão, grava `vazio` igual):
  { fonte: 'ANDRADELEIL', leiloeiro: 'Andrade Leilões (Luis Alexandre Andrade)', base: 'https://www.andradeleiloes.com.br' }, // 0 (SP)
  { fonte: 'BENOZZATI', leiloeiro: 'Benozzati Leilões (George H. R. Benozzati)', base: 'https://www.benozzati.com.br' }, // 0 (SP)
  { fonte: 'DAMASIOLEIL', leiloeiro: 'Damásio Leilões (Rogério Damásio de Oliveira)', base: 'https://www.damasioleiloes.com.br' }, // 0 (SP)
  { fonte: 'DESANTILEIL', leiloeiro: 'De Santi Leilões (Farah C. V. de Santi)', base: 'https://www.desantileiloes.com.br' }, // 0 (SP)
  { fonte: 'EDITALLEIL', leiloeiro: 'Edital Leilões (Silvio Cesar de Jesus Santos)', base: 'https://www.editalleiloes.com.br' }, // 0 (SP)
  { fonte: 'GLLEILOES', leiloeiro: 'GL Leilões (Mauricio Gomes Leiteiro)', base: 'https://www.glleiloes.com.br' }, // 0 (SP)
  { fonte: 'LANCELEILSP', leiloeiro: 'Lance Leilões (Galvez Gonçalves)', base: 'https://www.lanceleiloes.com.br' }, // 0 (SP)
  { fonte: 'TESSARINI', leiloeiro: 'Tessarini Leilões (Adriano Tessarini de Carvalho)', base: 'https://www.tessarinileiloes.com.br' }, // 0 (SP)
  { fonte: 'PAVANILEIL', leiloeiro: 'Pavani Leilões (Luis Renato Pavani)', base: 'https://www.pavanileiloes.com.br' }, // 0 (SP)
  { fonte: 'NOSSOLEILAO', leiloeiro: 'Nosso Leilão (Paulo Cesar de Carvalho)', base: 'https://www.nossoleilao.com.br' }, // 0 (SP)
  // Com lote hoje ("Total N Lotes" do site × enumerados; amostra de lotes no coletor real em seco):
  { fonte: 'AMARALLEIL', leiloeiro: 'Amaral Leilões (Eder Amaral de Oliveira)', base: 'https://www.amaralleiloes.com.br' }, // 2 de 2 (SP)
  { fonte: 'BIDMAX', leiloeiro: 'Bidmax Leilões (Ligia Seixas)', base: 'https://www.bidmax.com.br' }, // 11 de 11 (SP)
  { fonte: 'CARDOSOLEIL', leiloeiro: 'Cardoso Leilões (Emerson Lopes Cardoso)', base: 'https://www.cardosoleiloes.com.br' }, // 5 de 5 (SP)
  { fonte: 'CENCIN', leiloeiro: 'Cencin Leilões (André Cencin)', base: 'https://www.cencin.com.br' }, // 8 de 8 (SP)
  { fonte: 'LECAPE', leiloeiro: 'Lecape Leilões (Leonardo de Campos Penin)', base: 'https://www.lecapeleiloes.com.br' }, // 14 de 14 (SP)
  { fonte: 'LOTTILEIL', leiloeiro: 'Lotti Leilões (Wagner Lotti)', base: 'https://www.lottileiloes.com.br' }, // 23 de 23 (SP)
  { fonte: 'OCTAVIOLEIL', leiloeiro: 'Octavio Leilões (Octavio de Azevedo Marques)', base: 'https://www.octavioleiloes.com.br' }, // 1 de 1 (SP)
  { fonte: 'RICOLEIL', leiloeiro: 'Rico Leilões (Marcello Lemos da Cruz e outros)', base: 'https://www.ricoleiloes.com.br' }, // 6 de 6 (SP)
  { fonte: 'SITELEILOES', leiloeiro: 'Site Leilões (José Luiz Donizete da Silva)', base: 'https://www.siteleiloes.com.br' }, // 595 (SP)
  { fonte: 'TKLLEILOES', leiloeiro: 'TKL Leilões (Wendell Marcel Calixto Felix)', base: 'https://www.tkl.com.br' }, // 21 de 21 (SP)
  { fonte: 'TRIBUNALEIL', leiloeiro: 'Tribuna Leilões (Eduardo da Silva Pinto)', base: 'https://www.tribunaleiloes.com.br' }, // 14 de 14 (SP)
  { fonte: 'WSPLEILOES', leiloeiro: 'WSP Leilões (Wanderley Samuel Pereira)', base: 'https://www.wspleiloes.com.br' }, // 18 de 18 (SP)
  // FORA: guariglia.com.br (SP) — o banco recusa o certificado TLS do site ("SSL peer certificate"); sem página lida não
  // há prova de catálogo. Não confundir com GUARIGLIA (guariglialeiloes.com.br, BA), que já coleta.
];

// ── REPROVADOS NO DRY-RUN DE 29/08 — histórico. Em 26/10 os cinco foram REMEDIDOS e entraram (bloco "LIGADOS COM
// CATÁLOGO VAZIO" e SCHMITZLEIL acima): os quatro "0 enumerados" hoje declaram "nenhum lote encontrado" no próprio
// /lotes/imovel (vazio legítimo, não catálogo ausente), o CLICLEILOES virou SCHMITZ com 560 lotes e o MARAURZEDO
// responde 200 pelo banco. O texto abaixo fica como registro do que foi medido naquele dia:
//   ALVESLEIL     (alvesleiloes.com.br)              0 lotes enumerados via grátis
//   LOUCOPORLEIL  (leiloarialoucoporleiloes.com.br)  0 lotes enumerados via grátis
//   UNIVERSOLEIL  (universodosleiloes.com.br)        0 lotes enumerados via grátis
//   CLICLEILOES   (clicleiloes.com.br)               1 enumerado, 0 prontos (reprovado na qualidade)
//   MARAURZEDO    (maraurzedoleilao.com.br)          0 enumerados, e `via null` — nem chegou a
//                 acessar, diferente dos outros zeros. É o site para onde `agilleiloes.com.br`
//                 redireciona; merece recon próprio antes de qualquer nova tentativa.
// Os quatro primeiros rodam SOLEON na home mas o catálogo `/lotes/imovel` não devolve nada —
// exatamente o caso dos 11 Superbid de 29/08. Subi-los custaria pior que nada: fontes varridas
// toda semana trazendo vazio, poluindo log e saúde com silêncio permanente.

// Mecanismo de CANDIDATOS — reutilizável para a próxima junta (JUCESP, JUCERJA, JUCEES…).
// Ponha os novos aqui, rode com SOLEON_CANDIDATOS=1 e SOLEON_DRYRUN=1, e só promova para
// `TODOS_TENANTS` o que provar catálogo. Vazio agora porque a leva da JUCEMG já foi julgada.
const CANDIDATOS = [];

const POOL = process.env.SOLEON_CANDIDATOS === '1' ? [...TODOS_TENANTS, ...CANDIDATOS] : TODOS_TENANTS;
const filtro = (process.env.SOLEON_TENANTS || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const TENANTS = filtro.length ? POOL.filter(t => filtro.includes(t.fonte)) : POOL;

const MAX_LOTES = Number(process.env.SOLEON_MAX_LOTES || 40);
const MAX_PAGES = Number(process.env.SOLEON_MAX_PAGES || 6);
// TETO SÓ PARA A ROTA PAGA (08/10, #180). O teto de 6 páginas (×30 = 180 lotes) existe pelo custo do Bright
// Data, mas valia também para quem lista de graça: FERREIRALEIL enumerava EXATAMENTE 180 em toda rodada (185
// ativos), a enumeração nunca terminava "pelo fim da lista" e varrerSumidos() era PULADA para sempre — 11 lotes
// sem data com a página em 404 desde setembro seguiam na vitrine. Grátis (direto/banco) vai até o fim.
const MAX_PAGES_GRATIS = Number(process.env.SOLEON_MAX_PAGES_GRATIS || 25);
// FREIO PRÓPRIO PRA TORRES3 (18/09, pedido do dono): é o único tenant deste cluster atrás de
// Cloudflare — toda enumeração e todo detalhe dele caem no Bright Data pago (CALIL/VEGAS são
// grátis). O freio de GRUPO do workflow (coleta-recente.mjs SOLEON 7, `scraper-soleon.yml`)
// só olha se o cluster inteiro está "velho" — TORRES3 acaba pagando na mesma cadência que
// CALIL/VEGAS pedem por serem grátis, sem necessidade nenhuma (achado 18/09, revisando a
// proposta de espaçamento: só TORRES3 é `custo=misto` em leiloeiro_conhecimento; os outros
// dois são gratis+sem anti-bot). Piso PRÓPRIO, mais largo — desacoplado do freio do grupo.
const TORRES3_FRESCOR_DIAS = Number(process.env.SOLEON_TORRES3_FRESCOR_DIAS || 14);
const DRYRUN = process.env.SOLEON_DRYRUN !== '0';
const DEBUG = process.env.SOLEON_DEBUG === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Cidade/UF robusta: 1º pelo rótulo estruturado do SOLEON ("Cidade: X/UF"); 2º "…em X/UF"
// pegando só 1-3 palavras antes da /UF (evita frases inteiras como "comercial no Centro de
// Vitoria" que o regex ganancioso capturava). estado sempre pela sigla após a barra.
function cidadeUF(txt, titulo = '') {
  const fonte = `${titulo} ${txt}`;
  // Só UF que EXISTE (23/10): título de veículo "HONDA/CG 125 FAN", "VOLVO/FH 440" casava o 3º padrão como Cidade/UF
  // (JOAOEMILIO, 7 lotes) — cada padrão agora varre os candidatos e pula o par cuja sigla não é estado.
  const primeiro = (re) => { for (const x of fonte.matchAll(re)) if (UFS.has((x[2] || '').toUpperCase())) return x; return null; };
  const m = primeiro(/\bCidade:\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]{1,28}?)\s*[\/-]\s*([A-Z]{2})\b/gi)
    || primeiro(/\b(?:em|de|no|na)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,2})\s*\/\s*([A-Z]{2})\b/g)
    || primeiro(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,2})\s*\/\s*([A-Z]{2})\b/g);
  if (!m) return { cidade: null, estado: null };
  return { cidade: m[1].trim().replace(/\s+/g, ' ').slice(0, 60), estado: (m[2] || '').toUpperCase() || null };
}

// Título sem o "sufixo de preço" que o og:title do SOLEON cola ("… - Lance Inicial: R$…").
function limparTitulo(t) {
  return (t || '').replace(/\s*[-–]\s*(?:Lance Inicial|Avalia[çc][ãa]o|Valor)\b.*$/i, '').replace(/\s+/g, ' ').trim();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = h => !h || /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(h.slice(0, 4000));

// Fetch "grátis primeiro": tenta direto (egress do Actions); se barrado/challenge/erro,
// cai no Web Unlocker (pago, com teto). Retorna { html, via } ou { html:null }.
const BANCO_FALHAS = new Map();
async function fetchTenant(url, { timeoutMs = 45000 } = {}) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', 'Accept': 'text/html,application/xhtml+xml' } });
    clearTimeout(t);
    if (r.ok) {
      const html = await r.text().catch(() => '');
      if (html && !ehChallenge(html)) return { html, via: 'gratis' };
    }
  } catch { /* direto falhou — tenta a via banco e depois o Bright Data */ }
  // VIA BANCO (30/09): o pg_net do Supabase (AWS) recebe 200 onde o IP do Actions é barrado —
  // medido na JOAOEMILIO, que ficou 3 dias "zerou" sem ninguém conseguir medir: o direto falhava,
  // o Bright Data estava sem cota e o residencial parado. Grátis; mesmo helper do motor DOM
  // (Uberlândia, GLOBO). Disjuntor por host: 2 falhas no banco → não tenta mais nesta execução.
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  if ((BANCO_FALHAS.get(host) || 0) < 2) {
    const b = await viaBanco(url);
    if (b.html) return { html: b.html, via: 'banco' };
    BANCO_FALHAS.set(host, (BANCO_FALHAS.get(host) || 0) + 1);
    console.log(`  ⚠️ via banco falhou em ${host}: ${b.motivo}`);
  }
  // Runner RESIDENCIAL (SOLEON_NO_BD=1): o fetch direto já funciona do IP residencial (o SOLEON
  // bloqueia só datacenter, não tem Cloudflare) → NUNCA cair no Bright Data. Pula a página se
  // por acaso o direto falhar (evita gasto surpresa de BD numa coleta que deveria ser grátis).
  if (process.env.SOLEON_NO_BD === '1') return { html: null, via: 'sem-bd' };
  // `buscarViaBrightData` (que LANÇA com o motivo) no lugar do `fetchViaBrightData` (que
  // devolve null para quatro causas diferentes). Motivo, medido em 12/08: a cota semanal
  // saturou (450/450, com a reserva do 'rj' derrubando o teto efetivo dos demais para 420),
  // as três fontes saíram com 0 lotes em 0,6 s e foram gravadas como
  // "REGRESSÃO: caiu de 6 para 0" — decisão de ORÇAMENTO lida como quebra do leiloeiro.
  // É a forma #5 do CLAUDE.md, e aqui ela contaminava o próprio painel de saúde.
  try {
    const bd = await buscarViaBrightData(url, { proposito: 'soleon', timeoutMs, exigirOk: false });
    if (!bd.ok) return { html: null, via: 'bloqueado' };
    const html = await bd.text().catch(() => null);
    return { html, via: 'brightdata' };
  } catch (e) {
    if (e instanceof ErroBrightData) {
      // `semCota` = o sistema decidiu não gastar. Não é o site que mudou.
      return { html: null, via: e.semCota ? 'sem-cota' : 'bloqueado', semCota: !!e.semCota, motivoBD: e.motivo };
    }
    throw e;
  }
}

function inferirTipo(titulo = '') {
  const t = titulo.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  // "Lote, Residencial, Moreira Sales" (CALIL, 30/09): "Residencial" é o ZONEAMENTO do lote, não uma
  // casa — 24 lotes vazios caíram como casa e o mercadológico comparava com casas. Título que começa
  // com lote/terreno é terreno; "residência" (a casa) continua casa.
  if (/^\s*(lote|terreno|gleba)\b/.test(t) && !/casa|sobrado|resid[êe]ncia\b|edifica|constru[íi]d/.test(t)) return 'terreno';
  if (/casa|sobrado|resid[êe]ncia\b/.test(t)) return 'casa';
  if (/terreno|lote|gleba|[áa]rea/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// Detalhe do lote no SOLEON: /item/{id}/detalhes (padrão do RJ). Aceita variações
// (/lote/{id}, /lotes/{...}/{id}) como salvaguarda — o DEBUG confirma o real por tenant.
function extrairUrlsDeLote(html, base) {
  const urls = new Map(); // id → url absoluta (dedup por id)
  for (const m of html.matchAll(/\/item\/(\d+)\/detalhes/gi)) urls.set(m[1], `${base}/item/${m[1]}/detalhes`);
  if (!urls.size) for (const m of html.matchAll(/href=["'](\/lote\/(\d+)(?:\/[^"']*)?)["']/gi)) urls.set(m[2], new URL(m[1], base).href);
  if (!urls.size) for (const m of html.matchAll(/href=["'](\/lotes\/[^"']*?\/(\d+))["']/gi)) urls.set(m[2], new URL(m[1], base).href);
  return [...urls.values()];
}

function idDaUrl(url) {
  const m = String(url).match(/\/item\/(\d+)/i) || String(url).match(/\/(\d+)(?:\/(?:detalhes)?)?$/);
  return m ? m[1] : String(url).replace(/[?#].*/, '').split('/').filter(Boolean).pop();
}

// Parser SOLEON (idêntico em espírito ao scraper-rj.mjs, validado em produção):
// preços pelos RÓTULOS ("Lance Inicial", "Valor de Avaliação") p/ não pegar
// Incremento/Comissão; fallbacks robustos; cidade/UF por "CIDADE/UF".
function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  // DESCRIÇÃO INTEIRA (22/10): o genérico lê a og:description, que a plataforma CORTA em ~150 caracteres
  // com "..." — 14 tenants (CERULI, AGOSTINHO, DANIELGARCIA, FERREIRA, PURCENA, ISAIAS, APICE…) gravavam
  // a descrição pela metade. O texto completo está no corpo: `<b>Descrição: </b>…</div>`.
  const descCorpo = decodificarEntidades(String((html.match(/<b>\s*Descri[çc][ãa]o:?\s*<\/b>([\s\S]*?)<\/div>/i) || [])[1] || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (descCorpo.length > 40 && (!base.descricao || /(\.\.\.|…)\s*$/.test(base.descricao) || descCorpo.length > base.descricao.length)) {
    const praca = (String(base.descricao || '').match(/^Leil[ãa]o:[^,]{0,40},\s*/i) || [''])[0];
    base.descricao = `${praca}${descCorpo}`;
  }
  // Decodifica entidades antes de qualquer regex (18/08): `Leil&atilde;o`, `1&ordm;`,
  // `matr&iacute;cula` e `m&sup2;` nao casam com regex acentuada, e o resultado nao e erro —
  // e valor faltando com cara de ausencia. Ver `api/_texto-imovel.js`.
  const txt = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
  const rotLance = plaus(num((txt.match(/lance\s*(?:inicial|m[íi]nimo|atual)[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const rotAval = plaus(num((txt.match(/avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  // ACHADO REAL (11/09, dono comparou o app com o site de origem — DANIELGARCIA item 79771):
  // lote de VENDA DIRETA sem rótulo "Lance Mínimo" (só existe em leilão ascendente) caía no
  // balaio genérico abaixo, que pega TODO R$ da página — e "Incremento Mínimo: R$50.000,00"
  // entrou como se fosse candidato a valor mínimo, virando "economia potencial" de R$550mil
  // sobre um imóvel de R$600mil (92% de desconto, número que não existe na vida real). O
  // comentário da função já dizia a intenção ("p/ não pegar Incremento/Comissão") — só não
  // tinha sido aplicada aqui, só no `rotLance`/`rotAval` por rótulo.
  // Mesmo defeito, mesma origem (código copiado): `scraper-rj.mjs` (script-irmão, validado em
  // produção) já resolve isto com `ROTULO_NAO_PRECO` — lista bem mais ampla que só
  // incremento/comissão (caução, honorários, taxa, multa, IPTU, condomínio, débito, dívida,
  // custas, emolumentos, ITBI, depósito prévio). Reaproveitada aqui ao pé da letra, em vez de
  // uma lista nova e mais curta que deixaria a mesma classe de bug entrar por outra porta.
  const ROTULO_NAO_PRECO = /(comiss|cau[çc][ãa]o|incremento|honor[áa]r|taxa|multa|iptu|condom[íi]n|d[ée]bito|d[íi]vida|custas|emolument|itbi|dep[óo]sito\s+pr[ée]vio|lance\s+m[íi]nimo\s+de\s+incremento)/i;
  const grandes = [...txt.matchAll(/R\$\s*([\d.]+,\d{2})/g)]
    .filter(m => !ROTULO_NAO_PRECO.test(txt.slice(Math.max(0, m.index - 60), m.index)))
    .map(m => num(m[1])).filter(v => v >= 10000 && v <= 500_000_000);
  const avaliacao = rotAval || (grandes.length ? Math.max(...grandes) : 0);
  let valorMinimo = rotLance;
  if (!valorMinimo && grandes.length) {
    const semAval = grandes.filter(v => v !== avaliacao);
    valorMinimo = semAval.length ? Math.min(...semAval) : avaliacao;
  }

  // GATE DE PRAÇA (09/09, achado real em APICE — tenant desta plataforma: 2 lotes com
  // data_leilao preenchida saíam "venda_direta" pelo mesmo defeito do BAYIT — texto solto
  // decidindo sem checar se há praça datada). Regra literal do dono: praça com data ⇒ nunca
  // venda direta (venda direta é compra imediata, sem prazo, só cadastro no leiloeiro/
  // comitente). `extrairData` já é o extrator de data ANCORADO em leilão/praça (scraper-
  // core.mjs) — reaproveitado aqui como sinal, calculado 1x, e de novo no retorno.
  const dataLeilaoDetectada = base.data_leilao || extrairData(html);
  // CONFIRMADO POR RECON REAL (15/09, DANIELGARCIA 79771 — modalidade-ctx dumpado ao vivo):
  // a varredura da página INTEIRA batia primeiro em "LEILÃO JUDICIAL Online & Presencial",
  // um banner FIXO do site (aparece perto do rodapé/cabeçalho, sem relação com o lote) —
  // enquanto o texto que DE FATO qualifica ESTE lote ("Venda Direta") aparecia colado ao
  // preço 3x: "Venda Direta R$600.000,00", "Venda Direta - 4ª Vara do Trabalho de
  // Cubatão/SP" (2x, no breadcrumb). Mesmo princípio já usado em `ROTULO_NAO_PRECO` acima:
  // o que qualifica O LOTE fica perto do R$ dele, não em qualquer canto da página. Por
  // isso a janela ao redor do PREÇO PRINCIPAL (mesma âncora de `rotLance`/`rotAval`) é
  // checada PRIMEIRO; só cai na varredura da página inteira (comportamento antigo) se a
  // janela não tiver nenhuma das três palavras — nunca fica sem classificar.
  const anchorPreco = txt.match(/(?:lance\s*(?:inicial|m[íi]nimo|atual)|avalia[çc][ãa]o|venda\s*direta)[^R]{0,25}R\$\s*[\d.]+,\d{2}/i);
  const janelaModalidade = anchorPreco
    ? txt.slice(Math.max(0, anchorPreco.index - 60), anchorPreco.index + anchorPreco[0].length + 20)
    : '';
  // A janela ANCORADA no preço é sinal FORTE (o texto que qualifica ESTE lote fica colado ao
  // R$ dele — mesmo princípio do ROTULO_NAO_PRECO acima) — por isso NÃO passa pela trava de
  // data: essa trava (09/09, achado APICE) existia pra barrar "venda direta" de um match
  // SOLTO em qualquer canto da página, sinal fraco de verdade. Sinal ancorado no preço não é
  // esse caso — ela só se aplica ao fallback de página inteira (sinal fraco, comportamento
  // de antes, preservado).
  const modalidadeDeJanela = (t) => /(?<!extra)judicial/i.test(t) ? 'judicial'
    : /extrajudicial/i.test(t) ? 'extrajudicial'
    : /venda\s*direta/i.test(t) ? 'venda_direta' : null;
  const modalidadeDePagina = (t) => /(?<!extra)judicial/i.test(t) ? 'judicial'
    : /extrajudicial/i.test(t) ? 'extrajudicial'
    : (!dataLeilaoDetectada && /venda\s*direta/i.test(t)) ? 'venda_direta' : null;
  // VENDA DIRETA DA PGFN (10/10, #154). FERREIRALEIL é corretora credenciada do Comprei/PGFN: o leilão
  // "COMPREI/PGFN - IMÓVEIS NO ESTADO DE SÃO PAULO" fica "Em andamento" sem data NENHUMA (recon de casa
  // com fetch e Chromium: 0 datas nos lotes e na página do leilão). 146 dos 160 lotes "sem data" trazem
  // "alienação por iniciativa particular"/PGFN no texto — não é data faltando, é venda direta. Só sem
  // praça datada (regra do dono: praça com data nunca é venda direta; 2 lotes com data citam o termo).
  const vendaDiretaPgfn = !dataLeilaoDetectada && /comprei|pgfn|aliena[çc][ãa]o\s+por\s+iniciativa\s+particular/i.test(txt);
  const modalidade = vendaDiretaPgfn ? 'venda_direta'
    : (modalidadeDeJanela(janelaModalidade) || modalidadeDePagina(txt) || 'extrajudicial');
  // ACHADO DO BLOCO 3 (03/09): `[\d.]+,\d{2}` exige DECIMAL colado ("1.813,00"), e "1.813M²"
  // (sem decimal) caía no fallback `\d+` — que não aceita ponto, então casava só "813",
  // perdendo o "1." e reportando 1/33 da área real (confirmado em CALIL, VEGAS, FERREIRALEIL,
  // PURCENA, TMLEILOES — os 5 tenants desta plataforma Soleon). Padrão correto: 1-3 dígitos +
  // grupos de milhar de 3 dígitos, decimal opcional — o mesmo já usado em `extrairAreaM2`
  // (api/_texto-imovel.js) e no mapper do WEBLEILOES.
  // 24/09: o 1º "m²" da PÁGINA pegava o terreno ("66,14 M2 DE ÁREA PRIVATIVA, 142,5M2 DE ÁREA DO
  // TERRENO" — o "M2" das duas primeiras não casa `m²`). Agora: descrição do lote pelo extrator
  // rotulado (privativa/construída antes do terreno) → página só com rótulo → regra antiga.
  const area = extrairAreaM2(base.descricao || '')
    || extrairAreaM2(txt, { permitirSolta: false })
    || num((txt.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*m²/i) || [])[1]);
  const { cidade, estado } = cidadeUF(txt, base.titulo || '');
  // #196: a descrição do lote primeiro; data/ano no lugar do nº é rótulo do documento, não matrícula.
  const mat = matriculaDoTexto(base.descricao, txt);

  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    // FERREIRA (22/10, #284): o bloco "Documentos" leva a uma pasta do Google Drive ou à página do
    // processo no portal da PGFN/Caixa (venda direta), e "Processo" vem com download="…pdf" — o filtro
    // só via .pdf e 32 lotes ficavam sem nada. Entram como 'outro' (link útil; não é PDF legível, então
    // não acende selo). O "Arquivos" da Purcena (/leiloes/N/arquivos) leva ao LOGIN e fica fora.
    const docExterno = /(drive|docs)\.google\.com|comprei\.pgfn\.gov\.br|compreicaixa\.com\.br/i.test(href)
      || (/\sdownload\s*=/i.test(m[0]) && !/^javascript:/i.test(href));
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label) || docExterno) {
      let abs; try { abs = new URL(href, url).href; } catch { continue; }
      docs.push({ url: abs, label: label.slice(0, 60) });
    }
  }
  const findDoc = re => (docs.find(d => re.test(d.label) || re.test(d.url)) || {}).url || null;
  const anexos = docs.map(d => ({ tipo: /matr[íi]cula/i.test(d.label + d.url) ? 'matricula' : (/edital/i.test(d.label + d.url) ? 'edital' : (/laudo/i.test(d.label + d.url) ? 'laudo' : 'outro')), nome: (d.label || 'Documento').slice(0, 80), url: d.url }));

  return {
    titulo: limparTitulo(base.titulo).slice(0, 180) || null,
    cidade, estado,
    link_foto: base.link_foto,
    valor_avaliacao: avaliacao, valor_minimo: valorMinimo,
    modalidade, area_m2: area,
    // 500→2000 (17/09) →8000 (20/09, mesmo motivo do PECINI): 2000 ainda truncava em produção
    // (CALIL/VEGAS bateram exatamente no teto).
    descricao: (base.descricao || '').slice(0, 8000) || null,
    // 16/09 (achado no painel de invariantes — venda_direta_com_praca): o override de
    // `modalidadeDeJanela` (15/09, âncora no preço) pode classificar venda_direta MESMO com
    // `dataLeilaoDetectada` preenchida (é feito de propósito, pro sinal forte não ficar refém
    // da trava fraca) — mas o `data_leilao` final não tinha o mesmo guard e saía preenchido
    // junto. Regra do dono: "venda direta é compra imediata, sem prazo" — praça e venda_direta
    // são mutuamente exclusivos por definição, então a data nunca pode sobreviver aqui.
    data_leilao: modalidade === 'venda_direta' ? null : dataLeilaoDetectada,
    ...(modalidade === 'venda_direta' ? {} : segundaPracaSoleon(txt)),
    numero_matricula: mat,
    link_edital: findDoc(/edital/i), link_matricula: findDoc(/matr[íi]cula/i),
    anexos,
    // Endereço do bloco "Localização do Imóvel" (08/10, #88) — a descrição é texto de matrícula.
    local: enderecoSoleon(html),
  };
}

// 2ª PRAÇA (21/10). A página traz "Data 1º Leilão: 16/10/2026 14:00 · Lance Inicial: R$372.274,05 ·
// Data 2º Leilão: 05/11/2026 14:00 · Lance Inicial: R$223.364,43" e só a 1ª entrava. Sem
// `data_leilao_2`, a retenção desligava o lote assim que a 1ª passava — justo quando o lance cai
// ~40% (APICE 17606 inativo com a 2ª em 05/11; ~90 lotes assim em APICE/DANIELGARCIA/CALIL).
// Devolve {} quando não acha: ausência não apaga o que já está gravado (mesmo cuidado do PECINI).
function segundaPracaSoleon(txt) {
  const m = String(txt || '').match(/Data\s*2[ºo°ª]?\s*Leil[ãa]o:?\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:[àa]s\s*)?(\d{2}):(\d{2}))?/i);
  if (!m) return {};
  const [, d, mes, a, hh = '12', mm = '00'] = m;
  const out = { data_leilao_2: `${a}-${mes}-${d}T${hh}:${mm}:00-03:00` };
  const lance = String(txt).slice(m.index, m.index + 200).match(/Lance\s*Inicial:?\s*R\$\s*([\d.]+,\d{2})/i);
  if (lance) out.valor_minimo_2 = num(lance[1]);
  return out;
}

function montarRow(tenant, url, det) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url);
  return {
    fonte: tenant.fonte,
    fonte_id: `${tenant.fonte.toLowerCase()}_${id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro} ${id}`,
    tipo: inferirTipo(det.titulo || ''),
    modalidade: det.modalidade,
    cidade: det.cidade || null,
    estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm,
    area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url,
    url_lote: url,
    link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula, link_matricula: det.link_matricula,
    anexos: det.anexos,
    ...(det.local?.endereco ? { endereco: det.local.endereco } : {}),
    ...(det.local?.bairro ? { bairro: det.local.bairro } : {}),
    // CEP fica FORA: o upsert é em lote (postgrest une as colunas) e, ao contrário de endereço/bairro,
    // nenhum gatilho preserva `cep` — lote sem CEP na rodada apagaria o de outro.
    leiloeiro: tenant.leiloeiro,
    data_leilao: det.data_leilao || null,
    ...(det.data_leilao_2 ? { data_leilao_2: det.data_leilao_2 } : {}),
    ...(det.valor_minimo_2 ? { valor_minimo_2: det.valor_minimo_2 } : {}),
    forma_pagamento: 'a_vista',
    ativo: true,
    suprimido_motivo: null, // voltou a ser coletado ⇒ motivo velho (ex.: sumiu_da_fonte) não vale mais
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// Enumera lotes de imóveis de um tenant: listagem /lotes/imovel paginada (+ salvaguardas).
// Tenants cuja coleta parou por decisão de ORÇAMENTO (cota Bright Data), não por mudança
// no site. A diferença decide se `fonte_saude` recebe "regressão" ou "sem cota".
const SEM_COTA = new Set();
// Quantos lotes a LISTAGEM do tenant devolveu nesta execução — o número que mede a saúde da
// fonte de verdade. `total` (lotes processados) não serve: com `novos` vazio o coletor cai no
// fallback e re-raspa até MAX_LOTES já conhecidos, então um dia sem novidade grava 40 e um dia
// com um lote novo grava 1. Foi essa bimodalidade que acusou a VEGAS de regressão em 17/08
// (1 lote NOVO capturado corretamente × 40 re-raspagens do dia anterior). Ver `_saude-fonte.mjs`.
const ENUMERADOS = new Map();
// Quantos lotes ficaram POR BUSCAR por decisão de orçamento. Diferente de SEM_COTA, que só
// marca a fonte cuja LISTAGEM foi recusada: aqui é a coleta que começou, andou e foi cortada
// no meio — o caso que passava despercebido até 27/08 (ver o bloco em `coletarTenant`).
const COTA_NEGADA = new Map();
// `via` da ENUMERAÇÃO por tenant (10/09) — 'gratis'/'banco'/'brightdata' quando a listagem respondeu
// de verdade (mesmo que com 0 lote: leiloeiro pequeno pode legitimamente ficar sem nada por um
// tempo), `null` quando NENHUMA página chegou a devolver HTML. `coletarTenant` já calculava
// isso e só usava para um `console.log` — descartava o sinal antes de `registrarSaude` decidir
// o status. Efeito medido: 6 tenants pequenos (APICE/CERULI/ISAIAS/LANCEJA/PURCENA/TORRES3)
// caindo para 0 em 08/09 sempre gravavam `status='falhou'`, e o dashboard mostrava "Coleta
// zerada. Provável bloqueio" pra todos — mesmo quando a listagem respondeu bem e só não tinha
// lote novo (o caso que `_saude-fonte.mjs` já sabe tratar como `'vazio'`, inclusive promovendo
// pra `'degradado'` sozinho SE houver queda de verdade vs a execução anterior — a distinção só
// não chegava até lá).
const VIA_TENANT = new Map();
// ENUMERAÇÃO COMPLETA × PARCIAL (28/09). A varredura de sumidos só pode confiar numa lista que
// terminou porque a fonte acabou (página sem lote novo), nunca numa que terminou porque uma
// página FALHOU ou bateu o teto de páginas — aí o que "sumiu" pode só não ter sido lido.
const ENUM_COMPLETA = new Set();
const ENUM_IDS = new Map();
// Site que DECLARA não ter lote ("NENHUM LOTE ENCONTRADO NO MOMENTO", 28/09 — JOAOEMILIO entre
// leilões). Zero afirmado pela fonte é resposta; o motivo "site declara…" faz
// fonte_regressao_suspeita() não acusar `zerou` (ver fonte_regressao_zero_declarado_pelo_site.sql).
const VAZIO_DECLARADO = new Set();
// Freio de frescor do TORRES3 (28/09): entra em SEM_COTA (é decisão de custo, o monitor não
// acusa), mas o motivo dizia "SEM COTA Bright Data" — e há 10 dias quem lia ia procurar teto
// semanal esgotado, com a cota sobrando. Forma nº 10: o registro nomeava outra coisa.
const FREIO_FRESCOR = new Set();
const MOTIVO_SEM_COTA = (fonte) => FREIO_FRESCOR.has(fonte)
  ? `freio de frescor próprio: ${fonte} só é coletado a cada ${TORRES3_FRESCOR_DIAS} dias (decisão de custo, não regressão da fonte)`
  : 'SEM COTA Bright Data — coleta não tentada (decisão de orçamento, não regressão da fonte)';

async function enumerarLotes(tenant) {
  const setUrls = new Set();
  let via = null, completa = false;
  for (let p = 1; p <= (via === 'brightdata' ? MAX_PAGES : MAX_PAGES_GRATIS); p++) {
    // Listagem de imóveis do SOLEON: /lotes/imovel (pág 1) e ?tipo=imovel&page=N (2+).
    const url = `${tenant.base}/lotes/imovel${p > 1 ? `?tipo=imovel&page=${p}` : ''}`;
    const { html, via: v, semCota } = await fetchTenant(url);
    if (semCota) SEM_COTA.add(tenant.fonte);
    if (!html) break;
    via = via || v;
    if (p === 1 && !extrairUrlsDeLote(html, tenant.base).length && siteDeclaraVazio(html)) VAZIO_DECLARADO.add(tenant.fonte);
    const antes = setUrls.size;
    for (const u of extrairUrlsDeLote(html, tenant.base)) setUrls.add(u);
    if (DEBUG) console.log(`   [${tenant.fonte}] pág ${p} (${v}): +${setUrls.size - antes} (total ${setUrls.size})`);
    if (setUrls.size === antes) { completa = true; break; }
    await sleep(400);
  }
  ENUMERADOS.set(tenant.fonte, setUrls.size);
  if (completa && setUrls.size) ENUM_COMPLETA.add(tenant.fonte);
  return { urls: [...setUrls], via };
}

async function debugRecon() {
  console.log('🔎 SOLEON RECON — confirma padrões de URL + parser por tenant\n');
  for (const tenant of TENANTS) {
    console.log(`\n════ ${tenant.fonte} (${tenant.base})`);
    const lista = `${tenant.base}/lotes/imovel`;
    const { html, via } = await fetchTenant(lista);
    if (!html) { console.log('  listagem não veio (challenge/teto).'); continue; }
    console.log(`  listagem via ${via}, ${html.length} bytes`);
    // Dumpa TODOS os hrefs candidatos p/ ver o padrão real do lote deste tenant.
    const hrefs = [...new Set([...html.matchAll(/href=["'](\/(?:item|lote|lotes)\/[^"']+)["']/gi)].map(m => m[1]))].slice(0, 20);
    console.log(`  hrefs item/lote (${hrefs.length}): ${JSON.stringify(hrefs)}`);
    const lotes = extrairUrlsDeLote(html, tenant.base);
    console.log(`  extrairUrlsDeLote → ${lotes.length}: ${JSON.stringify(lotes.slice(0, 6))}`);
    // SOLEON_DEBUG_URL (11/09): força o detalhe de UM lote específico em vez do 1º da
    // listagem — necessário pra investigar um lote já achado com problema (ex.: o item
    // 79771 do DANIELGARCIA, achado com modalidade errada pelo dono).
    const alvoForcado = process.env.SOLEON_DEBUG_URL;
    const alvo = (alvoForcado && alvoForcado.includes(tenant.base)) ? alvoForcado : lotes[0];
    if (alvo) {
      const { html: dh, via: dv } = await fetchTenant(alvo);
      if (dh) {
        const det = parseDetalhe(dh, alvo);
        console.log(`  ── detalhe ${alvo} (via ${dv})`);
        console.log('     parseDetalhe →', JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }));
        const t = decodificarEntidades(dh.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
        console.log('     R$ ctx:', JSON.stringify([...t.matchAll(/.{0,40}R\$\s*[\d.]+,\d{2}/g)].map(m => m[0].trim()).slice(0, 8)));
        // DIAGNÓSTICO (11/09, achado real DANIELGARCIA): a modalidade é decidida varrendo a
        // página INTEIRA por /judicial|extrajudicial|venda direta/ — se o menu/rodapé do site
        // listar as três categorias como filtro, a palavra "judicial" aparece em toda página,
        // mesmo em lote que É venda direta. Dumpa contexto de cada ocorrência pra confirmar
        // antes de mudar a lógica (não supor estrutura sem checar).
        console.log('     modalidade-ctx:', JSON.stringify([...t.matchAll(/.{0,35}(?:judicial|venda\s*direta).{0,15}/gi)].map(m => m[0].trim()).slice(0, 10)));
      }
    }
    await sleep(500);
  }
  console.log('\n✅ RECON concluído.');
}

// TUDO-OU-NADA ERA O MESMO BUG JÁ CORRIGIDO NO runner.mjs, SÓ QUE AQUI (10/09).
// `alvo` era `(novos.length ? novos : urls).slice(0, MAX_LOTES)` — com QUALQUER lote novo no
// tenant, a releitura inteira era descartada e nenhum lote JÁ CONHECIDO era revisitado. Achado
// investigando por que FERREIRALEIL (110 ativos) tinha 58% de documento contra 100% em 10 dos
// 12 tenants-irmãos da mesma plataforma: os 46 lotes sem documento tinham `atualizado_em`
// TRAVADO no dia da 1ª (e única) raspagem — nunca mais revisitados, porque FERREIRALEIL é
// grande o bastante para quase sempre ter ao menos 1 lote novo por rodada, o que zera a
// releitura TODA vez. TORRES3 (178 ativos, 100% doc) escapou por sorte de tráfego: tenant mais
// maduro, roda com mais frequência a rodada "0 lote novo" que liberava a releitura completa.
// Fix: reaproveita `planejarAlvo` (mesmo módulo/mesmos 8 testes do runner.mjs) — novo lote
// sempre vem primeiro (nunca perde captação por causa de releitura), e a folga do teto que
// sobrar vai para o lote conhecido mais antigo (fila por `atualizado_em`), não é jogada fora.
async function coletarTenant(tenant) {
  if (tenant.fonte === 'TORRES3') {
    const { data: recentes } = await supabase.from('imoveis_leilao') // padrao-ok: falha de leitura vira idadeDias=Infinity abaixo, que é MAIOR que qualquer piso — fail-open pro caminho de sempre coletar, nunca pro caminho de pular por engano
      .select('atualizado_em').eq('fonte', 'TORRES3').eq('ativo', true)
      .order('atualizado_em', { ascending: false }).limit(1);
    const ultima = recentes?.[0]?.atualizado_em ? Date.parse(recentes[0].atualizado_em) : 0;
    const idadeDias = ultima ? (Date.now() - ultima) / 86400000 : Infinity;
    // 30/09: o freio existe porque TORRES3 só saía PAGO (Bright Data). A via banco (grátis) passa
    // nele (medido: /lotes/imovel 200, 127 KB) — com o banco respondendo, coleta como os demais;
    // o freio só vale quando o banco falha e a coleta cairia no pago. Sem isto a fonte ficava
    // 12+ dias sem medição e o monitor acusava `medicao_velha` por decisão, não por defeito.
    const bancoOk = idadeDias < TORRES3_FRESCOR_DIAS ? !!(await viaBanco(`${tenant.base}/lotes/imovel`)).html : false;
    if (bancoOk) console.log(`  [TORRES3] via banco respondeu — coleta grátis, freio de ${TORRES3_FRESCOR_DIAS}d não se aplica.`);
    if (idadeDias < TORRES3_FRESCOR_DIAS && !bancoOk) {
      console.log(`  [TORRES3] acervo com ${idadeDias.toFixed(1)}d — abaixo do piso de ${TORRES3_FRESCOR_DIAS}d (freio próprio, é o único tenant pago do cluster). Pulando.`);
      // Marca como SEM_COTA (mesmo Set que o freio de orçamento real usa) — não é o teto
      // semanal do Bright Data negando, mas é a MESMA classe de decisão ("não gastei de
      // propósito, não é a fonte que quebrou"): registrarSaude() já sabe não acusar
      // regressão quando semCota=true. Sem isto, o skip virava "tenant sem lote nesta
      // execução" em fonte_saude — exatamente a forma nº 5 do CLAUDE.md que este próprio
      // arquivo já corrigiu uma vez para o teto de verdade.
      SEM_COTA.add('TORRES3');
      FREIO_FRESCOR.add('TORRES3'); // o motivo tem que dizer QUAL "não" — ver MOTIVO_SEM_COTA
      return [];
    }
  }
  const { urls, via } = await enumerarLotes(tenant);
  VIA_TENANT.set(tenant.fonte, via);
  if (!urls.length) { console.log(`  [${tenant.fonte}] 0 lotes enumerados (via ${via}). Pulando.`); return []; }
  const chaveDe = u => `${tenant.fonte.toLowerCase()}_${idDaUrl(u)}`;
  const ids = urls.map(chaveDe);
  ENUM_IDS.set(tenant.fonte, new Set(ids));
  const meta = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('imoveis_leilao')
      .select('fonte_id,atualizado_em,data_fim,ativo').in('fonte_id', ids.slice(i, i + 200));
    for (const r of data || []) meta.set(r.fonte_id, r);
  }
  const { novos, releitura, alvo, iReleitura } = planejarAlvo({ urls, meta, chaveDe, maxLotes: MAX_LOTES });
  console.log(`  [${tenant.fonte}] via ${via} · enumerados ${urls.length} · no banco ${meta.size} · `
    + `novos ${novos.length} · releitura ${releitura.length} · processando ${alvo.length}`);

  const prontos = [];
  let sem = 0, reprov = 0, cotaNegada = 0, pararReleitura = false;
  for (let i = 0; i < alvo.length; i++) {
    if (pararReleitura && i >= iReleitura) break;
    const r = await fetchTenant(alvo[i]);
    // RELEITURA NUNCA PAGA (mesma garantia do runner.mjs): a folga do teto só vale enquanto for
    // grátis. No primeiro detalhe de releitura que cair no Bright Data, para — sem isto, "usar
    // a sobra" viraria gasto pago num lote que já temos, e ninguém pediu essa troca.
    if (i >= iReleitura && r?.via === 'brightdata') {
      pararReleitura = true;
      console.log(`  💰 [${tenant.fonte}] releitura caiu na via paga no lote ${i - iReleitura + 1} — abortada (releitura nunca paga).`);
      break;
    }
    // ─── O FREIO DE ORÇAMENTO NO MEIO DA COLETA (27/08) ──────────────────────────────
    // `fetchTenant` SEMPRE soube dizer qual "não" (devolve `semCota: true` quando o teto
    // recusou), e aqui o valor era jogado fora no destructuring `const { html } = …`:
    // a página recusada por ORÇAMENTO virava um `sem++` idêntico ao de um erro de rede, a
    // coleta seguia, e o run gravava `status: ok` com um total parcial — um número que não
    // mede o acervo do leiloeiro, e sim até onde o dinheiro deu. É a forma #5 do CLAUDE.md
    // DENTRO de um run bem-sucedido: a correção de 12/08 só cobria o tudo-ou-nada
    // (`prontos.length === 0`), e a coleta cortada no lote 9 de 40 passava pela fresta.
    //
    // QUEM ISTO ATINGE, aqui: o TORRES3 — é o único tenant deste cluster atrás de
    // Cloudflare, e portanto o único cujo detalhe cai no Bright Data (CALIL e VEGAS são
    // fetch grátis; ver o cabeçalho do workflow). Vale também para toda fonte do motor
    // genérico que use o caminho pago.
    //
    // NÃO é a explicação da queda do CALIL, embora tenha sido investigando o CALIL que
    // isto apareceu — e a distinção importa para quem ler depois: o ledger
    // (`brightdata_uso_proposito_dia`) mostra ZERO requisição 'soleon' tanto no dia bom
    // (20/08, 166 listados → 36 lotes) quanto no ruim (26/08, 75 → 9). Bright Data não
    // está no caminho do CALIL. A causa dele continua aberta e é de OUTRA natureza: o
    // fetch grátis falhando nas páginas de detalhe.
    //
    // Recusou uma, recusa as seguintes — insistir só gasta tempo. Para aqui e conta o que
    // ficou para trás, que é o número honesto: não é "a fonte tem 9", é "vi 9 de 40".
    if (r.semCota) {
      cotaNegada = alvo.length - i;
      COTA_NEGADA.set(tenant.fonte, cotaNegada);
      SEM_COTA.add(tenant.fonte);
      console.log(`  💰 [${tenant.fonte}] teto de orçamento no lote ${i + 1}/${alvo.length} — ${cotaNegada} por buscar. NÃO é regressão da fonte.`);
      break;
    }
    if (!r.html) { sem++; continue; }
    const row = montarRow(tenant, alvo[i], parseDetalhe(r.html, alvo[i]));
    // GALERIA (08/10): a pasta `…/bens/<id>/` da capa é exclusiva do lote (lib/galeria-veiculo.mjs).
    if (FONTES_PASTA_DA_CAPA.has(row.fonte)) {
      const gal = montarFotos(row.link_foto, galeriaDoHtml(row.fonte, r.html, { capa: row.link_foto }));
      if (gal.length > 1) row.fotos = gal;
    }
    // VENDA DIRETA DA PGFN (08/10, #185): a página aponta para o anúncio no Comprei, cuja API pública
    // traz matrícula, cartório, processo e ônus. Só endereço/bairro (gatilho preserva) e o bloco na
    // descrição: o upsert é em lote e colunas novas (cep, processo) apagariam as de outros lotes.
    const idComprei = idAnuncioComprei(r.html);
    if (idComprei) {
      try {
        const resp = await fetch(urlVisitarComprei(idComprei), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
        const ficha = resp.ok ? fichaComprei(await resp.json()) : null;
        if (ficha) {
          if (ficha.endereco && !row.endereco) row.endereco = ficha.endereco;
          if (ficha.bairro && !row.bairro) row.bairro = ficha.bairro;
          if (ficha.bloco && !String(row.descricao || '').includes('Dados do Comprei')) row.descricao = `${row.descricao || ''}\n\n${ficha.bloco}`.trim().slice(0, 9000);
          // Vendido no Comprei e ainda listado na página da leiloeira: não está à venda.
          if (ficha.vendido) { row.ativo = false; row.suprimido_motivo = 'vendido_na_fonte'; }
        } else console.log(`  [${tenant.fonte}] Comprei ${idComprei}: ${resp.ok ? 'sem ficha' : `HTTP ${resp.status}`}`);
      } catch (e) { console.log(`  [${tenant.fonte}] Comprei ${idComprei} não lido: ${String(e?.message || e).slice(0, 60)}`); }
    }
    // Lote de TESTE do próprio leiloeiro (26/10, ARAGAOLEIL 6645 "IMOVEL TESTE", R$ 10.000, praça em 31/12): a
    // plataforma o lista no catálogo como qualquer outro. Mesmo critério do RE_SUPORTE_TESTE de scraper-puppeteer.mjs.
    if (/\b(?:im[óo]vel|lote|bem|leil[ãa]o)[\s-]+(?:de[\s-]+)?teste\b|\bsomente[\s-]*teste\b/i.test(`${row.titulo || ''}`)) { reprov++; continue; }
    const q = checarQualidade(row, { estrito: false });
    if (q.descartar) { reprov++; continue; }
    prontos.push(row);
    await sleep(350);
  }
  console.log(`  [${tenant.fonte}] ${prontos.length} prontos · ${reprov} descartados · ${sem} sem detalhe · ${cotaNegada} sem cota`);
  return prontos;
}

// VARREDURA DE SUMIDOS (28/09). A família Soleon nunca desativava lote que saiu do site: a
// DANIELGARCIA tinha 9 ativos com a página em 404, um deles (59450, sem data) fora do site desde
// 08/09. Só a limpeza por DATA aposentava — e lote sem data nunca vence. Regra IGUAL à de
// salvarEFinalizar (scraper-puppeteer.mjs), com as mesmas travas:
//   · só com enumeração COMPLETA (ver ENUM_COMPLETA) e enumerando ≥ 50% do acervo ativo;
//   · leilão negativo (sem_lance/indeterminado) apurado há < 15 dias fica — é decisão do dono,
//     para a proposta de compra, igual a desativar_leiloes_encerrados();
//   · e o CAMINHO DE VOLTA: `planejarAlvo` não relê lote inativo, então um `sumiu_da_fonte` que
//     reaparece na enumeração é reativado aqui mesmo, sem custo de leitura. Sem isto, um lote
//     escondido por um dia sumiria para sempre.
async function varrerSumidos(tenant) {
  const fonte = tenant.fonte;
  const vistos = ENUM_IDS.get(fonte);
  if (!ENUM_COMPLETA.has(fonte) || !vistos?.size) { console.log(`  [${fonte}] varredura de sumidos PULADA — enumeração não terminou pelo fim da lista.`); return; }
  const { data: ativos, error: eAt } = await supabase.from('imoveis_leilao').select('fonte_id,resultado_leilao,resultado_apurado_em').eq('fonte', fonte).eq('ativo', true).limit(5000);
  if (eAt) { console.error(`  [${fonte}] varredura PULADA — não consegui ler o acervo ativo (${eAt.message}).`); return; }
  const janelaNegativo = new Date(Date.now() - 15 * 864e5).toISOString();
  // 24/10 (#277): a proporção compara com os ativos que a varredura PODE desligar. O "sem lance" retido 15 dias
  // pela regra do dono já não está no site; contá-lo no denominador pulava a varredura da CALIL (21 retidos).
  const retido = (r) => ['sem_lance', 'indeterminado'].includes(r.resultado_leilao) && r.resultado_apurado_em && r.resultado_apurado_em >= janelaNegativo;
  const varriveis = (ativos || []).filter(r => !retido(r));
  if (vistos.size < varriveis.length * 0.5) { console.error(`  🛑 [${fonte}] varredura PULADA — enumerou ${vistos.size} de ${varriveis.length} ativos varríveis (< 50%).`); return; }
  const sumidos = varriveis.map(r => r.fonte_id).filter(id => !vistos.has(id));
  let desligados = 0;
  for (let i = 0; i < sumidos.length; i += 200) {
    const { data, error } = await supabase.from('imoveis_leilao')
      .update({ ativo: false, suprimido_motivo: 'sumiu_da_fonte' })
      .eq('fonte', fonte).eq('ativo', true).in('fonte_id', sumidos.slice(i, i + 200))
      .or(`resultado_leilao.is.null,resultado_leilao.eq.vendido,resultado_apurado_em.is.null,resultado_apurado_em.lt.${janelaNegativo}`)
      .select('fonte_id');
    if (error) { console.error(`  [${fonte}] erro ao desativar sumidos: ${error.message}`); break; }
    desligados += data?.length || 0;
  }
  let religados = 0;
  const idsVistos = [...vistos];
  for (let i = 0; i < idsVistos.length; i += 200) {
    const { data, error } = await supabase.from('imoveis_leilao')
      .update({ ativo: true, suprimido_motivo: null })
      .eq('fonte', fonte).eq('ativo', false).eq('suprimido_motivo', 'sumiu_da_fonte').in('fonte_id', idsVistos.slice(i, i + 200))
      .select('fonte_id');
    if (error) { console.error(`  [${fonte}] erro ao reativar quem voltou: ${error.message}`); break; }
    religados += data?.length || 0;
  }
  console.log(`  [${fonte}] varredura: ${sumidos.length} fora da enumeração · ${desligados} desativados (sumiu_da_fonte) · ${sumidos.length - desligados} retidos (leilão negativo < 15 dias) · ${religados} reativados`);
}

// ─── VEÍCULOS (21/10, pedido do dono: "faça todos os veículos") ────────────────────────────────
// Todo tenant SOLEON tem `/lotes/veiculo` (mesmo template, mesma paginação `?tipo=veiculo&page=N`) e só
// `/lotes/imovel` era lido: ~300 veículos à venda no cluster e 0 no acervo (JOAOEMILIO 116, CERULI,
// DANIELGARCIA 29, AGOSTINHO 21, FERREIRA 18, PURCENA 17, CALIL 14, APICE 12, ISAIAS 11…). Mesmo
// `parseDetalhe`/`montarRow`; conversão e regra do pátio em lib/veiculo-do-lote.mjs. Ligado por
// SOLEON_VEICULOS=1 (o runner residencial roda com SOLEON_NO_BD=1: só via grátis, nunca Bright Data).
const MAX_VEIC = Number(process.env.SOLEON_VEIC_MAX_LOTES || 60);

function fichaVeiculoSoleon(html) {
  const txt = decodificarEntidades(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const ficha = (txt.match(/Detalhes do Lote\s*(?:Compartilhar:\s*)?(.{20,2500}?)\s*(?:Consultar Documenta|J[áa] fez seu Cadastro)/i) || [])[1] || null;
  const marcaModelo = ficha ? ((ficha.match(/Marca\/Modelo:\s*(.+?)\s+(?:Placa|Ano|Cor|Chassi|Renavam|Local|Combust)/i) || [])[1] || null) : null;
  const locs = ficha ? [...ficha.matchAll(/,\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)\s*\/\s*([A-Z]{2})\b/g)] : [];
  const loc = locs[locs.length - 1];
  return { ficha, marcaModelo, cidade: loc ? loc[1].trim() : null, estado: loc ? loc[2] : null };
}

async function enumerarVeiculos(tenant) {
  const urls = new Set(); let respondeu = false;
  for (let p = 1; p <= MAX_PAGES_GRATIS; p++) {
    const { html } = await fetchTenant(`${tenant.base}/lotes/veiculo${p > 1 ? `?tipo=veiculo&page=${p}` : ''}`);
    if (!html) break;
    respondeu = true;
    const antes = urls.size;
    for (const u of extrairUrlsDeLote(html, tenant.base)) urls.add(u);
    if (urls.size === antes) break;
    await sleep(400);
  }
  return { urls: [...urls], respondeu };
}

async function coletarVeiculosTenant(tenant) {
  const { urls, respondeu } = await enumerarVeiculos(tenant);
  const idV = (u) => `${tenant.fonte.toLowerCase()}_veic_${idDaUrl(u)}`;
  const ant = new Map();
  for (let i = 0; i < urls.length; i += 200) {
    const { data, error } = await supabase.from('veiculos_leilao').select('fonte_id,atualizado_em,status_patio,status_patio_motivo')
      .eq('fonte', tenant.fonte).in('fonte_id', urls.slice(i, i + 200).map(idV));
    if (error) { console.warn(`  [${tenant.fonte}] sem a idade dos já gravados (${error.message}) — ordem da página`); break; }
    for (const r of data || []) ant.set(r.fonte_id, r);
  }
  // Novos primeiro, depois o mais antigo; teto por rodada — o resto entra nas próximas.
  const alvo = [...urls].sort((a, b) => {
    const ia = ant.get(idV(a))?.atualizado_em ?? null, ib = ant.get(idV(b))?.atualizado_em ?? null;
    if (ia === null || ib === null) return (ia === null ? 0 : 1) - (ib === null ? 0 : 1);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }).slice(0, MAX_VEIC);
  const rows = []; const motivos = new Map(); let sem = 0;
  for (const url of alvo) {
    const { html } = await fetchTenant(url);
    if (!html) { sem++; continue; }
    const det = parseDetalhe(html, url);
    const imo = montarRow(tenant, url, det);
    // A ficha do veículo é o bloco "Detalhes do Lote" (comitente, marca/modelo, local de exposição) —
    // o parser de imóvel lê a descrição do imóvel, que aqui é só "Leilão: 22/10/2026 às 11:00".
    const f = fichaVeiculoSoleon(html);
    // O título original fica na descrição: é nele que vêm placa, chassi e renavam completos (a ficha mascara a placa).
    if (f.ficha) imo.descricao = `${imo.titulo || ''} ${imo.descricao || ''} ${f.ficha}`.trim();
    if (f.marcaModelo) imo.titulo = `${f.marcaModelo}${(imo.titulo.match(/,\s*ANO\s*\d{4}/i) || [''])[0]}`;
    if (f.cidade) { imo.cidade = f.cidade; imo.estado = f.estado; }
    const { row, motivo } = veiculoDoLote(imo, { id: idDaUrl(url), fonte: tenant.fonte });
    if (!row || motivo) { motivos.set(motivo, (motivos.get(motivo) || 0) + 1); continue; }
    const anterior = ant.get(row.fonte_id);
    if (patioPreservado(row, anterior)) { row.status_patio = anterior.status_patio; row.status_patio_motivo = anterior.status_patio_motivo; }
    rows.push(row);
    await sleep(300);
  }
  console.log(`[${tenant.fonte}] veículos: enumerados ${urls.length} · lidos ${alvo.length} · prontos ${rows.length} · sem detalhe ${sem}${[...motivos].map(([m, n]) => ` · ${m}: ${n}`).join('')}`);
  // Mesmo lote 2× na lista (22/10): upsert com fonte_id repetido no mesmo lote é recusado pelo Postgres
  // ("cannot affect row a second time") e derrubava o tenant — DANIELGARCIA nunca gravou saúde de veículo.
  const unicos = [...new Map(rows.map((r) => [r.fonte_id, r])).values()];
  if (unicos.length < rows.length) console.log(`  [${tenant.fonte}] ${rows.length - unicos.length} veículo(s) repetido(s) na lista — gravado 1 de cada`);
  rows.length = 0; rows.push(...unicos);
  if (!DRYRUN && rows.length) {
    // Em grupos de mesmas colunas: num upsert misto o PostgREST grava NULL na coluna ausente (fotos).
    const grupos = new Map();
    for (const r of rows) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
    for (const g of grupos.values()) {
      const { error } = await supabase.from('veiculos_leilao').upsert(g, { onConflict: 'fonte,fonte_id' }).select('id');
      if (error) throw new Error(`upsert veiculos ${tenant.fonte}: ${error.message}`);
    }
  }
  if (!DRYRUN) {
    await registrarSaude(supabase, `${tenant.fonte}_VEICULOS`, rows, 'soleon', {
      ok: respondeu && (rows.length > 0 || urls.length === 0), enumerados: urls.length,
      // Respondeu e não tem veículo agora (CASAMARTILLO, INFINITY): 'vazio', não 'falhou' sem motivo.
      vazio: respondeu && urls.length === 0,
      motivo: !respondeu ? 'catálogo de veículos não abriu' : (urls.length && !rows.length ? `${urls.length} enumerados e nenhum gravado` : ''),
    });
  }
  return rows.length;
}

// Os 20 da leva das Juntas (24/10) foram validados no seco só em /lotes/imovel. Ficam fora dos veículos até um seco
// próprio de /lotes/veiculo — e porque somariam até 20 × 60 detalhes à rodada residencial (ver o relatório da leva).
const VEICULOS_NAO_VALIDADOS = new Set(['PATIOROCHALEIL', 'LEILOPAR', 'WINLEILOES', 'CASSIANOLEIL', 'ALEMAOLEIL', 'JVLEILOES',
  'MULLERLEIL', 'WMSLEILOES', 'HAMMERLEIL', 'RAICHER', 'VICTORDORTA', 'NOGARI', 'LEILAOPE', 'CRAVOLEIL', 'ISABELLEIL',
  'MGLEILOESRS', 'RAFAELARIBEIRO', 'AGENCIALEILAO', 'MACHADOLEIL', 'PIMENTELLEIL',
  // 2ª leva (triagem575, 24/10) — mesma razão.
  'CARGNELUTTI', 'LEILOESRN', 'OROLEIL', 'RECHLEIL', 'BRONZATTO', 'AGUIAROLIANI', 'ITALOLEIL', 'MORAESLEIL', 'LANCESE',
  'LEVYLEIL', 'ZAGOLEIL', 'BACKLEIL', 'NIEWINSKI', 'LEILBRASILIA', 'SANTIAGOLEIL',
  // 3ª leva (26/10) — mesma razão.
  'ARAGAOLEIL', 'BESTLEIL', 'BRASILSULLEIL', 'CENTRALDOSLEIL', 'COLODETE', 'DIEGOLEIL', 'FALEILOES', 'GRLEILOES', 'GUARIGLIA',
  'JUNKESLEIL', 'VARONESLEIL', 'LKLEILOES', 'PLUSLEIL', 'QUADRADOLEIL', 'ROSENTALLEIL', 'VALDEIRPEREIRA',
  // 4ª leva (26/10 à tarde, vazios incluídos) — mesma razão.
  'CONCEITOLEIL', 'FELFILILEIL', 'FOCOLEIL', 'GUTEMBERGLEIL', 'KILDARELEIL', 'LUMINALEIL', 'MACEDOLEIL', 'MACHADORJ',
  'ARGLEILOES', 'JGCARGNELUTTI', 'LEILAOSANTOS', 'LOPESLEILCE', 'PEREIRALEILCE', 'PORTELARO', 'REALIZALEIL', 'SYDNEYLEIL',
  'LOUCOPORLEIL', 'UNIVERSOLEIL', 'MARAURZEDO', 'NATALIALEIL', 'CARSTENSLEIL', 'ALVESLEIL', 'TOCANTINSLEIL', 'SCHMITZLEIL',
  'ANDRADELEIL', 'BENOZZATI', 'DAMASIOLEIL', 'DESANTILEIL', 'EDITALLEIL', 'GLLEILOES', 'LANCELEILSP', 'TESSARINI', 'PAVANILEIL',
  'NOSSOLEILAO', 'AMARALLEIL', 'BIDMAX', 'CARDOSOLEIL', 'CENCIN', 'LECAPE', 'LOTTILEIL', 'OCTAVIOLEIL', 'RICOLEIL',
  'SITELEILOES', 'TKLLEILOES', 'TRIBUNALEIL', 'WSPLEILOES']);

async function mainVeiculos() {
  const tenantsVeic = TENANTS.filter(t => !VEICULOS_NAO_VALIDADOS.has(t.fonte) || filtro.includes(t.fonte));
  console.log(`SOLEON VEÍCULOS ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · tenants: ${tenantsVeic.map(t => t.fonte).join(', ')} · max ${MAX_VEIC}/tenant`);
  let total = 0, falhou = false;
  for (const tenant of tenantsVeic) {
    try { total += await coletarVeiculosTenant(tenant); }
    catch (e) {
      falhou = true; console.error(`[${tenant.fonte}] veículos falhou: ${e?.message || e}`);
      // O motivo ia só para o log do PC (22/10): o banco não sabia por que o tenant não gravava.
      if (!DRYRUN) await registrarSaude(supabase, `${tenant.fonte}_VEICULOS`, [], 'soleon', { ok: false, motivo: `erro: ${String(e?.message || e).slice(0, 200)}` }).catch(() => {});
    }
  }
  console.log(`\nTotal: ${total} veículos prontos.`);
  if (falhou || !total) process.exitCode = 1;   // nada gravado não é sucesso (o gate do runner não carimba)
}

async function main() {
  if (process.env.SOLEON_VEICULOS === '1') return mainVeiculos();
  if (DEBUG) {
    if (!brightDataDisponivel()) console.log('(aviso: Bright Data ausente — só a via grátis será tentada)');
    await debugRecon();
    return;
  }
  console.log(`SOLEON ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · tenants: ${TENANTS.map(t => t.fonte).join(', ')} · max ${MAX_LOTES}/tenant`);
  const prontos = [];
  for (const tenant of TENANTS) prontos.push(...await coletarTenant(tenant));

  console.log(`\nTotal: ${prontos.length} imóveis prontos.`);
  // Coleta que não coletou NADA não é sucesso — é falha que ainda não sabe que falhou.
  // Sair com 0 aqui engana três consumidores de uma vez: o check do GitHub, o `rodar()`
  // do runner residencial (que carimbava o gate) e o freio de custo, que passava a
  // bloquear o caminho pago. Foi assim que o RJ ficou 12 dias congelado, tudo verde.
  if (!prontos.length) {
    // "Não coletei porque a cota acabou" e "não coletei porque o site mudou" exigem AÇÕES
    // OPOSTAS (liberar orçamento × consertar parser). Gravar o primeiro como o segundo põe o
    // leiloeiro no banco dos réus e manda alguém procurar um bug que não existe — foi o que
    // aconteceu com CALIL, VEGAS e TORRES3 em 12/08.
    for (const tenant of TENANTS) {
      const semCota = SEM_COTA.has(tenant.fonte);
      await registrarSaude(supabase, tenant.fonte, [], 'soleon', {
        ok: false,
        semCota,
        vazio: !!VIA_TENANT.get(tenant.fonte),
        enumerados: ENUMERADOS.get(tenant.fonte) ?? null,
        metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: semCota
          ? MOTIVO_SEM_COTA(tenant.fonte)
          : VAZIO_DECLARADO.has(tenant.fonte) ? MOTIVO_VAZIO_DECLARADO
          : 'execução sem nenhum lote pronto',
      });
    }
    if (SEM_COTA.size) {
      console.error(`sem cota Bright Data para: ${[...SEM_COTA].join(', ')} — orçamento, não regressão. Saindo com erro.`);
    } else {
      console.error('nada a gravar — nenhum tenant devolveu lote. Saindo com erro.');
    }
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log('\nPara gravar, rode com SOLEON_DRYRUN=0.');
    return;
  }
  // DUPLICATA DO COMPREI (10/10, #154): o lote de venda direta PGFN é o MESMO bem que a fonte COMPREI
  // coleta na origem (108 de 160 casaram por matrícula + UF). Sai como 'duplicata_comprei' — mesma regra
  // de scraper-globo.mjs. Leitura falhou → não suprime nada (duplicar é o mal menor; sumir lote não).
  {
    const chaveBem = (uf, mat) => `${String(uf || '').toUpperCase()}|${String(mat || '').replace(/\D/g, '')}`;
    const bens = new Set();
    let falhou = null;
    for (let de = 0; ; de += 1000) {
      const { data, error: eC } = await supabase.from('imoveis_leilao').select('estado, numero_matricula')
        .eq('fonte', 'COMPREI').eq('ativo', true).not('numero_matricula', 'is', null).order('fonte_id').range(de, de + 999);
      if (eC) { falhou = eC.message; break; }
      for (const r of data || []) bens.add(chaveBem(r.estado, r.numero_matricula));
      if (!data || data.length < 1000) break;
    }
    if (falhou) console.log(`  aviso: acervo COMPREI ilegível (${falhou}) — nenhuma duplicata suprimida`);
    else {
      let dup = 0;
      for (const r of prontos) {
        if (r.modalidade !== 'venda_direta' || !r.numero_matricula) continue;
        if (bens.has(chaveBem(r.estado, r.numero_matricula))) { r.ativo = false; r.suprimido_motivo = 'duplicata_comprei'; dup++; }
      }
      if (dup) console.log(`  ${dup} lote(s) de venda direta PGFN já coletados na origem (COMPREI) → duplicata_comprei`);
    }
  }
  // EM LOTES DE 10, com 1 nova tentativa em timeout (28/10, mesmo conserto do scraper-rj de 26/10). Era UM upsert com
  // os ~1.270 lotes: desde 22/10 ele estourava o statement timeout (57014, gatilhos BEFORE UPDATE da tabela) e o
  // process.exit(1) levava junto a varredura de sumidos e a saúde dos 16 tenants — 13 fontes congeladas em 22/10 sem
  // alerta próprio (runner_falha_SOLEON rc=1). Lote pequeno cabe no tempo; o que gravou fica gravado.
  const TAM = 10;
  for (let i = 0; i < prontos.length; i += TAM) {
    const parte = prontos.slice(i, i + TAM);
    let { error } = await supabase.from('imoveis_leilao').upsert(parte, { onConflict: 'fonte_id', ignoreDuplicates: false });
    if (error && /timeout|57014/i.test(`${error.code || ''} ${error.message || ''}`)) {
      console.warn(`  upsert ${i}-${i + parte.length} estourou o tempo; nova tentativa em 5 s`);
      await new Promise((r) => setTimeout(r, 5000));
      ({ error } = await supabase.from('imoveis_leilao').upsert(parte, { onConflict: 'fonte_id', ignoreDuplicates: false }));
    }
    if (error) { console.error(`erro ao gravar (lote ${i}-${i + parte.length} de ${prontos.length}):`, error.message); process.exit(1); }
  }
  console.log(`✅ ${prontos.length} imóveis SOLEON gravados/atualizados.`);
  for (const tenant of TENANTS) await varrerSumidos(tenant);
  // Auto-aprendizado por tenant.
  for (const tenant of TENANTS) {
    const rows = prontos.filter(r => r.fonte === tenant.fonte);
    // SAÚDE POR TENANT (08/08): CALIL, VEGAS e 3 TORRES compartilham a plataforma Soleon mas são
    // fontes SEPARADAS no acervo — cada uma precisa da sua linha, senão o piso aprendido de uma
    // esconde a quebra da outra. As três estavam fora do monitor.
    //
    // O `if (!rows.length) continue` saía ANTES desta linha (corrigido 11/08): o tenant que
    // coletava zero era justamente o que não deixava rastro — o único caso em que o monitor
    // precisava de uma linha, e era o único em que ela não vinha. TORRES3 está com 1 lote ativo.
    // `enumerados` vai nos DOIS ramos: é justamente no tenant que coletou pouco (ou nada) que
    // ele decide se houve regressão de verdade. Passar só no ramo de falha deixaria de fora o
    // caso da VEGAS — que coletou 1 lote com sucesso e mesmo assim foi acusada.
    const enumerados = ENUMERADOS.get(tenant.fonte) ?? null;
    // `cotaNegada` vai no ramo de SUCESSO também, e é o ponto: a coleta cortada no meio
    // pelo orçamento devolve lotes de verdade, então cai aqui — e sem este número a linha
    // sairia como medição sadia da fonte.
    const cotaNegada = COTA_NEGADA.get(tenant.fonte) || 0;
    await registrarSaude(supabase, tenant.fonte, rows, 'soleon',
      rows.length ? { enumerados, cotaNegada } : {
        cotaNegada,
        ok: false,
        semCota: SEM_COTA.has(tenant.fonte),
        vazio: !!VIA_TENANT.get(tenant.fonte),
        enumerados,
        metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: SEM_COTA.has(tenant.fonte)
          ? MOTIVO_SEM_COTA(tenant.fonte)
          : VAZIO_DECLARADO.has(tenant.fonte) ? MOTIVO_VAZIO_DECLARADO
          : 'tenant sem lote nesta execução',
      });
    if (!rows.length) continue;
    await registrarConhecimento(supabase, {
      fonte: tenant.fonte, plataforma: 'SOLEON', acesso: 'gratis+brightdata', custo: 'misto',
      anti_bot: 'cloudflare_parcial', enumeracao: 'listagem_paginada', url_lote: '/item/{id}/detalhes',
      scraper: 'scraper-soleon.mjs', qualidade: qualidadeColeta(rows),
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
