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
import { normCidade } from './inferir-uf.mjs';

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
  // Ficaram FORA com /leilao/lotes/imoveis VAZIO hoje (LeilãoPro confirmado; entram com uma linha quando publicarem
  // imóvel): agenciadeleiloes, auroraleiloes (DF), beltrameleiloes (RO), bisleiloeiro, bsbleiloes (DF), ckleiloes,
  // cpkleiloes, deboramullerleiloes, elevaleiloes, fernandaleiloes.lel.br, leilaobutia, lipinskileiloes,
  // lottermannleiloes, rangelleiloes, rogerserafimleiloes, amtleiloes (rubemgarcia.com.br redireciona p/ ele),
  // srleiloes (DF), swleiloes, veronicaleiloes, zaccariasleiloes.
  // santayanaleiloes.com.br (10 na listagem) também: hoje só boxes de estacionamento e massa falida — 0 pronto no seco.
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
    try { urls.set(m[2], new URL(decodificarEntidades(m[1]), base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lote_id\/(\d+)/) || [])[1] || null;

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
export function cidadeDoCorpo(txt = '') {
  const t = String(txt || '');
  const loc = t.match(/\bLocaliza[çc][ãa]o\s+([A-Za-zÀ-ÿ'.\- ]{2,50}?)\s*\/\s*([A-Z]{2})\b/);
  if (loc) {
    const c = sufixoMunicipio(loc[1], loc[2].toUpperCase());
    if (c) return { cidade: c, estado: loc[2].toUpperCase() };
  }
  const bloco = (t.match(/\bDESCRI[ÇC][ÃA]O\s+keyboard_arrow_down\s+([\s\S]{20,4000}?)\s+(?:[ÚU]LTIMOS LANCES|INFORMA[ÇC][ÕO]ES JUDICIAIS|LOCALIZA[ÇC][ÃA]O \/|EDITAL E DOCUMENTOS)/) || [])[1];
  if (!bloco) return { cidade: null, estado: null };
  const r = cidadeUF('', bloco);
  if (r.cidade && r.estado && ehMunicipioUF(r.cidade, r.estado)) return r;
  for (const m of bloco.matchAll(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+[A-Za-zÀ-ÿ'.\-]+){0,4}),\s*([A-Z]{2})\b/g)) {
    const c = sufixoMunicipio(m[1], m[2]);
    if (c) return { cidade: c, estado: m[2] };
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

  // GATE DE PRAÇA (09/09, mesmo achado do BAYIT: praça com data ⇒ nunca venda direta, regra
  // literal do dono). p1/p2 (lance do 1º/2º leilão, já extraídos acima) são o sinal — achar
  // um valor de leilão numerado é a assinatura de praça formal, incompatível com venda direta.
  const temPraca = !!(p1 || p2);
  const modalidade = /processo\s*n|\bju[íi]z\b|judicial/i.test(txt) && !/extrajudicial/i.test(txt) ? 'judicial'
    : /extrajudicial/i.test(txt) ? 'extrajudicial'
    : (!temPraca && /venda\s*direta/i.test(txt)) ? 'venda_direta' : 'extrajudicial';
  const area = extrairArea(titulo, descricao) || extrairArea(txt.slice(0, 400));
  let { cidade, estado } = cidadeUF(titulo, descricao);
  if (!cidade) ({ cidade, estado } = cidadeDoCorpo(txt));
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
    titulo: titulo.slice(0, 180) || null,
    cidade, estado, link_foto: base.link_foto || null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    // 20/09 (pedido do dono: descrição completa, como o leiloeiro publica): parser
    // compartilhado por vários tenants (JELEILOES/KLEILOES etc.) — 500 truncava no meio.
    descricao: (descricao || '').slice(0, 8000) || null,
    data_leilao: proximaData(txt),
    numero_matricula: mat,
    link_edital, link_matricula, anexos,
    encerrado: estaEncerrado(txt),
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
