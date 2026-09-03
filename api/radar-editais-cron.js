/**
 * /api/radar-editais-cron — Radar de Editais (CNJ). Monitora editais de leilão de imóvel
 * publicados no DJEN (Diário de Justiça Eletrônico Nacional) via a API pública "Comunica"
 * do CNJ, para TJSP e TRT-15 (SP). Popula public.editais_leilao (dedup por djen_id).
 *
 * Objetivo: saber o quanto antes quando sai um edital novo e a QUAL LEILOEIRO foi designado
 * (amplia acervo + controle). Ver docs/RADAR_EDITAIS_CNJ.md.
 *
 * Fonte: GET https://comunicaapi.pje.jus.br/api/v1/comunicacao (pública, sem token, diária).
 * ROBUSTO/ADITIVO: se o endpoint bloquear/mudar (o CNJ pode impor rate-limit/auth sem aviso),
 * loga o erro em monitor_runs e retorna 200 sem quebrar nada. Autorizado por CRON_SECRET.
 *
 * ⚠️ VALIDAÇÃO: o proxy do ambiente de dev bloqueia *.pje.jus.br (403); em produção (Vercel)
 * o egresso é aberto. Conferir o 1º run em monitor_runs (itens_vistos > 0).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { buscarViaBrightData, ErroBrightData, brightDataDisponivel } from './_brightdata.js';
import { iaGeminiPrimary } from './_claude.js';
import { hostExternoSeguro, fetchExternoSeguro } from './_allowed-hosts.js';

const DJEN_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
// Tribunais monitorados — CONFIGURÁVEL por env RADAR_TRIBUNAIS.
// ⚠️ ABERTO PARA MG, PR, ES em 03/09 (pedido do dono), escolhidos pelo cruzamento medido
// nesta mesma sessão: acervo ativo por estado tinha RJ 8.976 · SP 4.630 · GO 4.547 muito à
// frente, enquanto os CLIENTES moram em SP (46) · MG (9) · PR (9) · ES (8) · RJ (8) — ou
// seja, RJ e GO já têm cobertura grande (abrir lá é sobretudo duplicata), e MG/PR/ES têm
// cliente e pouco acervo — é onde o mesmo custo de captura rende mais. Os pré-requisitos
// (combo≠run, UF validada, sem default 'SP', dedup por matrícula/cidade) foram resolvidos
// antes de abrir. Para o Brasil inteiro, ex.:
//   TJSP,TJRJ,TJMG,TJRS,TJPR,TJSC,TJBA,TJGO,TJDFT,TJPE,TJCE,TJES,TJMT,TJMS,TJPA,TJMA,TJPB,
//   TJRN,TJAL,TJSE,TJPI,TJAM,TJRO,TJAC,TJAP,TJRR,TJTO,TRT1,TRT2,TRT15 ... (DJEN é nacional).
const TRIBUNAIS = (process.env.RADAR_TRIBUNAIS || 'TJSP,TRT15,TJMG,TJPR,TJES').split(',').map(s => s.trim()).filter(Boolean);
// Termos jurídicos que referenciam LEILÃO/VENDA de imóvel no DJEN. CONFIGURÁVEL por env
// RADAR_TERMOS (o agente de captura/monitor APRENDE o rendimento de cada termo — quantos viram
// edital REAL vs ruído — e liga/desliga termos sem deploy; ver docs/RADAR_EDITAIS_CNJ.md).
// Mais termos = mais recall; o filtro duro (ehEditalReal) + a IA (nao_edital) cortam o ruído.
// 'alienação judicial' = termo moderno do CPC art.879; 'alvará de venda' = venda em inventário.
const TERMOS = (process.env.RADAR_TERMOS ||
  'edital de leilão,leilão judicial,leilão eletrônico,hasta pública,alienação judicial,alvará de venda')
  .split(',').map((s) => s.trim()).filter(Boolean);
// O WAF do DJEN devolve 403 p/ UA de bot vindo de datacenter (Vercel). O frontend público
// comunica.pje.jus.br consome ESTA MESMA API — então imitamos o navegador dele (UA real +
// Origin/Referer do frontend oficial + Accept-Language) p/ passar pela proteção sem custo.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DJEN_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Referer': 'https://comunica.pje.jus.br/',
  'Origin': 'https://comunica.pje.jus.br',
};
const MAX_PAGINAS = 8;           // teto por (tribunal×termo): 8×100 = 800 itens
const HARD_MS = 200000;          // teto do PULL (~200s) — garante fatia p/ a IA depois
const BD_RETRIES = 2;            // re-tentativas do Bright Data qdo o DJEN dá 403/5xx (instável)
// RE-TENTATIVAS DO CAMINHO DIRETO (29/08, medido na 1ª rodada residencial de verdade).
// Eu tinha escrito o `transporteDireto` sem retry NENHUM enquanto o caminho pago tinha 2 — e a
// assimetria estava no sentido errado: link doméstico oscila MAIS que datacenter, não menos.
// O resultado apareceu na primeira rodada: `vistos=2093 novos=98` (o pull funcionou e gravou
// 98 editais) e mesmo assim o run foi carimbado como FALHA por UM combo em 12 —
// `TRT15/edital de leilão: fetch failed`, erro de rede, não do DJEN. Sem retry, quase toda
// rodada de casa teria um combo caindo, o residencial NUNCA registraria sucesso e o Bright Data
// voltaria a cada 7 dias para fazer o que já tinha sido feito de graça.
const DIRETO_RETRIES = Number(process.env.RADAR_DIRETO_RETRIES || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// AS 27 UFs, E POR QUE UMA LISTA E NÃO UM REGEX (03/09).
// A validação era `/^[A-Za-z]{2}$/`: ela conferia o FORMATO e chamava isso de UF. Passaram 89
// editais com estado impossível — ME (41), CR (31), AN, CG, LA, LO, DO, CL, AI, DI, CB, MF, VW
// —, todos fragmentos de frase que a regex de "Cidade/UF" mordeu ("...ME", "...CR"). Enquanto
// o radar era só de SP isso era ruído; ao abrir para o Brasil, `imovel_uf` vira O filtro por
// estado, e um filtro sujo é pior que filtro nenhum — ele RESPONDE. É a forma nº 8 do
// CLAUDE.md: contar não-nulos (ou casar um formato) não é validar.
const UFS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
/** A UF, ou `null`. Nulo é a resposta honesta ("não sei de que estado é"); "ME" é uma
 *  afirmação falsa que um filtro por estado obedeceria. */
export const ufValida = (v) => { const u = String(v || '').trim().toUpperCase(); return UFS.has(u) ? u : null; };

// A UF do TRIBUNAL, deduzida da sigla — usada como a UF do EDITAL (a comarca), nunca como a do
// imóvel. Um TJ estadual carrega a UF no nome; TRT e TRF não são mapeáveis assim e ficam nulos,
// que é melhor do que chutar.
export const ufDoTribunal = (sigla) => ufValida(String(sigla || '').replace(/^TJ/i, '').slice(0, 2));

// Palavras que NUNCA aparecem num nome próprio de leiloeiro, mas aparecem quando a regex/IA
// pega um FRAGMENTO de frase do edital ("para os encargos de avaliação e leilão", "a
// publicação do edital na forma do art", "inviável", "credenciado"…). Guard forte.
const NOME_BLOQ = /(edital|públic|public|encargo|comiss|avalia|necessidade|d[ée]bito|trabalhist|\bforma\b|artigo|\bart\b|invi[áa]vel|credenciad|oficial|cadastrad|nomead|portal|auxiliar|processo|im[óo]vel|penhora|arremat|hasta|pra[çc]a|leil[ãa]o|expe[çc]a|intima|despach|senten|ju[íi]z|\bvara\b|autos|partes|advogad|requerid|exequ|execut|\bfls\b|plat[ao]|apura|imputa|realizada|\bbem\b|\bfato\b)/i;
// ⚠️ AMPLIADO (03/09), depois de medir as "cidades" dos 87 editais elegíveis para virar lote:
// "Detran", "IBAPE", "OAB", "INTIME", "TRATANDO", "Justiça do Estado de São Paulo TJ",
// "Portal de Auxiliares da Justiça do TJ", "Tabela Prática do TJ", "Vistos. CADASTRE",
// "SECRETARIA CONJUNTA DE ARARAQUARA" — a mesma regex `cidadeUf` que serve para achar
// "Cidade/UF" morde texto institucional que só PARECE "Nome/UF" na superfície. É a mesma
// família de defeito do leiloeiro (`NOME_BLOQ`), só que aqui o dano é maior: uma cidade
// inventada vira um LOTE na vitrine, com endereço que não existe em lugar nenhum.
const CIDADE_BLOQ = /(cpf|cnpj|ltda|\bs\/?a\b|\bcri\b|cart[óo]rio|registro|of[íi]cio|expe[çc]a|matr[íi]cula|processo|edital|comarca|\bvara\b|\bforo\b|detran|ibape|\boab\b|intime|tratando|divis[ãa]o|secretaria|justi[çc]a|tribunal|\btj\b|portal|auxiliares?|tabela|\bvistos\b|cadastre|execu[çc][ãa]o)/i;
// Prefixo institucional que PRECEDE uma cidade real ("Município de Mogi das Cruzes",
// "Imóveis de Santa Cruz do Rio Pardo") — o mesmo texto aparece nos DOIS formatos no
// acervo (com e sem o prefixo) porque o edital cita a cidade mais de uma vez. Remover o
// prefixo RECUPERA a cidade real em vez de descartá-la; sem isto a mesma cidade contava
// como "boa" numa menção e "lixo" na outra, e a segunda derrubava o edital sem necessidade.
const CIDADE_PREFIXO = /^(munic[íi]pio\s+de|im[óo]veis\s+de|comarca\s+de)\s+/i;
const CONECTORES = new Set(['da', 'de', 'do', 'dos', 'das', 'e', 'di', 'del', 'la']);
function tituloNome(s) {
  return String(s).toLowerCase().split(' ').filter(Boolean)
    .map((w, i) => (i > 0 && CONECTORES.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
// Valida (e normaliza p/ Título) um nome de leiloeiro. Devolve o nome limpo ou null.
function nomeLeiloeiroValido(s) {
  let nome = String(s || '').replace(/\s+/g, ' ').trim();
  nome = nome.replace(/^(sr|sra|dr|dra|exm[oa]|ilm[oa]|dd|me|excelent[íi]ssim[oa])\.?\s+/i, ''); // tira pronome de tratamento
  if (nome.length < 6 || nome.length > 70) return null;
  const palavras = nome.split(' ').filter(Boolean);
  if (palavras.length < 2 || palavras.length > 6) return null; // nome próprio: 2–6 palavras
  if (/\d/.test(nome)) return null;                            // nomes não têm números
  if (NOME_BLOQ.test(nome)) return null;                       // é fragmento de frase, não nome
  return tituloNome(nome).slice(0, 120);
}
/**
 * O NOME DO LEILOEIRO — preâmbulo + janela + validador, em vez de uma regex só (03/09).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * A versão anterior era uma regex única que tentava fazer as três coisas de uma vez:
 *   /leiloeir[ao]\s*(?:oficial|público)?\s*[:\-]?\s*(NOME)(?:,|\.|\s+JUCESP|…)/
 * e falhava em 128 editais REAIS — medidos, não estimados: de 314 editais de verdade no
 * acervo, 212 estavam sem nome, e em 128 deles o texto CITA o leiloeiro. Os outros 84 não
 * citam nome nenhum, e para esses não há o que consertar (a distinção importa: "o parse
 * falhou" e "o edital não nomeia ninguém" são coisas diferentes que se parecem numa contagem
 * de nulos — forma nº 10).
 *
 * OS QUATRO JEITOS QUE O DJEN ESCREVE, e por que cada um quebrava:
 *   • "Leiloeira(o) Oficial nomeada(o) MARCOS ROBERTO TORRES," — 11 ocorrências, o maior
 *     bloco. Os `(o)` e o `nomeada(o)` não estavam previstos entre a palavra e o nome.
 *   • "leiloeiro Gilson Keniti Inumaru - JUCESP nº 762/2007" — o terminador era `\s+JUCESP`,
 *     mas aqui vem `- JUCESP`; e como `-` não entra na classe do nome, o match morria.
 *   • "Leiloeiro: VICTOR ALBERTO SEVERINO FRAZÃO - Endereço Eletrônico" — mesmo hífen.
 *   • "leiloeiro(a) CASSIA NEGRETE NUNES BALBINO," e "leiloeira oficial \"Hugo Alexandre
 *     Pedro Além - Jucesp 935" — o `(a)` e a aspa.
 *
 * A TROCA: em vez de uma expressão que precisa acertar preâmbulo, nome e terminador ao mesmo
 * tempo, três passos com uma responsabilidade cada — o preâmbulo é consumido, a janela é
 * cortada no primeiro delimitador forte, e quem julga se aquilo é um nome continua sendo
 * `nomeLeiloeiroValido`. Regex que faz três coisas quebra nas três.
 *
 * ⚠️ A EXIGÊNCIA DE INICIAL MAIÚSCULA É O QUE SEGURA O FALSO POSITIVO, e por isso ela não é
 * cosmética: "leiloeiro oficial credenciado perante este Tribunal", "leiloeiro a ser nomeado
 * por este juízo", "leiloeira informou o recebimento" e "leiloeiro (art. 883, do CPC)" todos
 * morrem aqui, antes mesmo do `NOME_BLOQ` — o que vem depois da palavra é minúsculo ou
 * pontuação. Afrouxar isso troca 128 acertos por centenas de frases com nome de gente.
 */
const RE_PREAMBULO = new RegExp(
  'leiloeir[ao]' +
  '(?:\\([ao]\\))?' +                                   // leiloeiro(a)
  '(?:\\s+(?:p[uú]blic[ao]|oficial|judicial|nomead[ao]|designad[ao]|credenciad[ao])(?:\\([ao]\\))?)*' +
  '(?:\\s+o\\([ao]\\))?' +                              // "o(a)"
  '(?:\\s+sr[ao]?\\.?(?:\\([ao]\\))?\\.?)?' +          // "Sr.", "Sra.", "Sr(a)"
  "\\s*[:\\-–\"“']?\\s*", 'i');
/** Delimitador FORTE: onde o nome termina, em qualquer uma das formas vistas no DJEN. */
const RE_CORTE = /[,.;:()"“”'\/\n\-–—0-9]|\s\be-?mail\b|\s\bendere[çc]o\b|\s\bjucesp\b|\s\binscrit|\s\bmatr[íi]cula\b/i;

export function extrairLeiloeiro(texto) {
  const t = String(texto || '');
  // Percorre TODAS as menções, não só a primeira: o edital costuma citar a função antes de
  // nomear a pessoa ("nomeio leiloeiro oficial o(a) Sr(a) FULANO"), e parar na primeira
  // ocorrência devolvia a frase em vez do nome.
  const re = /leiloeir[ao]/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const resto = t.slice(m.index);
    const pre = resto.match(RE_PREAMBULO);
    if (!pre || pre.index !== 0) continue;
    const janela = resto.slice(pre[0].length, pre[0].length + 80).replace(/\s+/g, ' ');
    const corte = janela.search(RE_CORTE);
    const cand = (corte >= 0 ? janela.slice(0, corte) : janela).trim();
    // ⚠️ A INICIAL MAIÚSCULA É CHECADA AQUI, e a primeira versão desta função esqueceu.
    // O comentário acima já dizia que ela é o guard — mas `nomeLeiloeiroValido` NUNCA exigiu
    // maiúscula (ele confere tamanho, nº de palavras, dígitos e `NOME_BLOQ`, e só então
    // capitaliza); quem exigia era a regex antiga, no `[A-ZÀ-Ý]` que abria o grupo de captura.
    // Ao trocar a regex pela janela, o guard foi junto e o teste devolveu quatro frases com
    // cara de nome: "Perante Este Tribunal", "Informou A Ocorrência de Lance Vencedor",
    // "Sobre A Manutenção do Certame Designado", "Informou O Recebimento de Cinco Propostas".
    // `tituloNome` capitaliza no fim, então o lixo SAI parecendo nome próprio — é o defeito
    // mais caro possível aqui, porque passa despercebido na revisão.
    if (!/^[A-ZÀ-Ý]/.test(cand)) continue;
    const nome = nomeLeiloeiroValido(cand);
    if (nome) return nome;
  }
  return null;
}

export function cidadeValida(s) {
  let c = String(s || '').replace(/\s+/g, ' ').trim();
  c = c.replace(CIDADE_PREFIXO, '').trim();
  if (c.length < 3 || c.length > 40) return null;
  if (/\d/.test(c)) return null;
  if (CIDADE_BLOQ.test(c)) return null;
  if (!/[a-zà-ÿ]/i.test(c)) return null; // precisa ter letra (evita siglas soltas)
  return c;
}

function ymd(d) { return d.toISOString().slice(0, 10); }
function parseBRL(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}
function parseDataBR(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const ano = yy.length === 2 ? '20' + yy : yy;
  const iso = `${ano}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const dt = new Date(iso + 'T12:00:00Z');
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Extrai o que der do texto do edital (regex conservador; o texto integral fica guardado
// p/ refinar/plugar IA depois). Falha de parse NÃO descarta o edital (status='erro_parse').
function parseEdital(texto) {
  const t = String(texto || '');
  const pega = (re) => { const m = t.match(re); return m ? (m[1] || '').replace(/\s+/g, ' ').trim() : null; };
  const leiloeiro = extrairLeiloeiro(t);
  const jucesp = pega(/JUCESP[^\dA-Za-z]{0,6}(?:n[ºo.]?\s*)?([\d./-]{2,12})/i);
  const av = pega(/avalia[çc][ãa]o[^\dR]{0,25}R\$\s*([\d.]+,\d{2})/i);
  const lance = pega(/(?:lance|valor)\s+m[íi]nimo[^\dR]{0,25}R\$\s*([\d.]+,\d{2})/i);
  const praca1 = pega(/(?:1[ªa]?|primeir[ao])\s*(?:pra[çc]a|leil[ãa]o|data)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const praca2 = pega(/(?:2[ªa]?|segund[ao])\s*(?:pra[çc]a|leil[ãa]o|data)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const matricula = pega(/matr[íi]cula\s*(?:n[ºo.]?\s*)?([\d.\-]{3,15})/i);
  const plataforma = pega(/https?:\/\/([a-z0-9.\-]+\.(?:com|net|br)[^\s"'<>)]*)/i);
  // Info ADICIONAL do edital (o DJEN não traz a certidão da matrícula, mas o edital descreve
  // o imóvel/ônus): área, ocupação, cartório (CRI), débitos, endereço, cidade/UF.
  const area = pega(/[áa]rea\s*(?:total|constru[íi]da|privativa|do\s+terreno|de)?\s*[:\-]?\s*([\d.]+,\d{2})\s*m/i);
  const ocupacao = /desocupad|livre\s+de\s+ocupa|n[ãa]o\s+ocupad/i.test(t) ? 'desocupado' : (/ocupad/i.test(t) ? 'ocupado' : null);
  const cartorio = pega(/(\d{0,2}[ºoª°]?\s*(?:cart[óo]rio|of[íi]cio)\s+de\s+registro\s+de\s+im[óo]veis[^,.\n]{0,35})/i);
  const debitos = /d[ée]bito|IPTU|condom[íi]ni|ônus|onus|hipotec|penhora/i.test(t) ? 'edital menciona débitos/ônus (IPTU/condomínio/hipoteca/penhora) — conferir no texto' : null;
  const endereco = pega(/(?:situad[oa]|localizad[oa])\s+(?:[àa]|na|no|em)\s+([A-ZÀ-Ý0-9][^,\n]{6,90})/i);
  const cidadeUf = t.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ.'\s]{2,40})\s*[\/\-]\s*([A-Z]{2})\b/);
  const leiloeiroLimpo = nomeLeiloeiroValido(leiloeiro);
  const cidadeLimpa = cidadeUf ? cidadeValida(cidadeUf[1]) : null;
  const parsedAlgo = !!(leiloeiroLimpo || jucesp || av || lance || praca1);
  return {
    leiloeiro_nome: leiloeiroLimpo, leiloeiro_jucesp: jucesp,
    valor_avaliacao: parseBRL(av), lance_minimo: parseBRL(lance),
    data_praca_1: parseDataBR(praca1), data_praca_2: parseDataBR(praca2),
    imovel_matricula: matricula, leilao_plataforma_url: plataforma ? ('https://' + plataforma) : null,
    imovel_area_m2: area ? (parseFloat(area.replace(/\./g, '').replace(',', '.')) || null) : null,
    ocupacao, cartorio, debitos,
    imovel_endereco: endereco ? endereco.replace(/\s+/g, ' ').trim().slice(0, 200) : null,
    imovel_cidade: cidadeLimpa,
    imovel_uf: cidadeUf ? ufValida(cidadeUf[2]) : null,
    status: parsedAlgo ? 'processado' : 'erro_parse',
  };
}

// FILTRO DURO: a busca por texto no DJEN traz MUITO despacho/decisão que só CITA "leilão"
// (validação: de 612 comunicações, só ~14-30 eram editais reais). Só entra o que é EDITAL DE
// LEILÃO de verdade: tipoDocumento=Edital OU (estrutura de praça/hasta + um valor em R$). A IA
// depois confirma (marca 'nao_edital' o que passar por engano). Corta ~97% do ruído na origem.
function ehEditalReal(texto, tipoDoc) {
  const t = String(texto || '');
  if (/edital/i.test(String(tipoDoc || ''))) return true; // tipoDocumento é o sinal autoritativo
  const temEstrutura = /(1[ªa]|primeir|2[ªa]|segund)[^.\n]{0,25}(pra[çc]a|leil[ãa]o|hasta)/i.test(t)
                    || /hasta\s+p[úu]blica/i.test(t)
                    || /leil[ãa]o\s+(?:p[úu]blico|judicial|eletr[ôo]nico|extrajudicial)/i.test(t);
  const temValor = /(lance|valor)\s+(?:m[íi]nim|inicial)[^\dR]{0,25}R\$\s*[\d.]+,\d{2}/i.test(t)
                || /avalia(?:d[oa]|[çc][ãa]o)[^\dR]{0,25}R\$\s*[\d.]+,\d{2}/i.test(t);
  return temEstrutura && temValor;
}

// Extração por IA (Gemini-primário / Claude-Haiku fallback — barato, não-crítico) do texto do
// edital: robusta onde a regex falha (leiloeiro, avaliação). Só nos editais REAIS e poucos por
// run (economia). Devolve o objeto ou null.
async function extrairEditalIA(texto) {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return null;
  const prompt = `Abaixo há uma COMUNICAÇÃO JUDICIAL sobre LEILÃO/HASTA de IMÓVEL (pode ser o edital, ou uma intimação/despacho que designa ou relata o leilão). Extraia os campos e responda APENAS um JSON válido (sem markdown, sem comentários) com estas chaves (use null quando não houver):
{"leiloeiro_nome":string|null,"valor_avaliacao":number|null,"lance_minimo":number|null,"data_praca_1":"YYYY-MM-DD"|null,"data_praca_2":"YYYY-MM-DD"|null,"imovel_matricula":string|null,"imovel_endereco":string|null,"imovel_cidade":string|null,"imovel_uf":string|null,"ocupacao":"ocupado"|"desocupado"|null,"area_m2":number|null}
Regras: valores como número puro (ex: 150000.50, sem "R$" nem pontos de milhar). leiloeiro_nome = APENAS o NOME PRÓPRIO da pessoa/empresa leiloeira, em Caixa Alta e Baixa (ex: "João da Silva" ou "Zaccarino Leilões"), de 2 a 5 palavras — NUNCA uma frase, verbo ou trecho do edital; se o texto só disser "leiloeiro oficial"/"cadastrado no Portal dos Auxiliares" SEM nomear, use null (nunca o juiz, as partes ou advogados). Se o texto NÃO tratar de leilão/hasta pública de um IMÓVEL, responda exatamente {"nao_edital":true}.

TEXTO:
${String(texto || '').slice(0, 8000)}`;
  const res = await iaGeminiPrimary({
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
  });
  // 19/08: `anthropicFetch` DEVOLVE a Response não-ok depois dos retries — não lança. Sem
  // checar `.ok`, um 429/529 virava `data.content` undefined → return null, e o chamador
  // carimbava `ia_extraido: true` assim mesmo: janela de indisponibilidade da IA queimava o
  // lote de 10 editais PARA SEMPRE (a fila filtra por ia_extraido=false). Indisponível
  // LANÇA com marca própria; null passa a significar "a IA respondeu e não veio edital".
  if (!res || !res.ok) {
    const err = new Error(`ia_http_${res?.status || 'rede'}`);
    err.indisponivel = true;
    throw err;
  }
  const data = await res.json().catch(() => null);
  const txt = String(data?.content?.[0]?.text || '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const IA_LOTE = 10;        // teto de editais por run (economia; drena a fila em poucos runs)
const IA_HARD_MS = 285000; // corte da IA (~285s do início) — o log do monitor_runs já ocorreu antes

// Enriquece por IA os editais ainda não extraídos (fila via flag ia_extraido). Best-effort:
// roda MESMO quando o pull do dia foi pulado (auto-ajuste), então a fila drena a cada 4h.
async function enriquecerEditaisComIA(supabase, ehIntegrado, t0) {
  if (!process.env.CLAUDE_KEY) return 0;
  let feitos = 0;
  let pend;
  try {
    ({ data: pend } = await supabase.from('editais_leilao')
      .select('id, texto_integral').eq('ia_extraido', false)
      .order('data_disponibilizacao', { ascending: false }).limit(IA_LOTE));
  } catch { return 0; }
  const numOk = (v) => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  const dataOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? new Date(s + 'T12:00:00Z').toISOString() : null;
  for (const e of pend || []) {
    if (Date.now() - t0 > IA_HARD_MS) break;
    let out = null;
    try { out = await extrairEditalIA(e.texto_integral); }
    catch (err) {
      // IA indisponível (429/529/rede): NÃO carimba e para o lote — insistir nos próximos
      // só queimaria requests contra o mesmo muro. A fila fica intacta para o próximo run.
      if (err?.indisponivel) { console.error(`[radar] IA indisponível (${err.message}) — lote interrompido sem carimbar`); break; }
    }
    const upd = { ia_extraido: true };
    if (out && out.nao_edital) {
      upd.status = 'nao_edital'; // IA confirmou que é despacho/decisão, não edital → telas ignoram
    } else if (out) {
      // Só NOME PRÓPRIO válido (2–6 palavras, sem fragmento de frase) — normaliza p/ Título.
      // Sobrescreve SEMPRE (limpa também o lixo herdado da regex: "oficial", "para os encargos…").
      const nomeReal = nomeLeiloeiroValido(out.leiloeiro_nome);
      upd.leiloeiro_nome = nomeReal;
      upd.leiloeiro_nome_norm = nomeReal ? norm(nomeReal) : null;
      upd.leiloeiro_integrado = nomeReal ? ehIntegrado(nomeReal) : false; // null quando o cruzamento está cego
      if (numOk(out.valor_avaliacao)) upd.valor_avaliacao = out.valor_avaliacao;
      if (numOk(out.lance_minimo)) upd.lance_minimo = out.lance_minimo;
      if (numOk(out.area_m2)) upd.imovel_area_m2 = out.area_m2;
      if (dataOk(out.data_praca_1)) upd.data_praca_1 = dataOk(out.data_praca_1);
      if (dataOk(out.data_praca_2)) upd.data_praca_2 = dataOk(out.data_praca_2);
      if (out.imovel_matricula) upd.imovel_matricula = String(out.imovel_matricula).slice(0, 40);
      if (out.imovel_endereco) upd.imovel_endereco = String(out.imovel_endereco).slice(0, 200);
      { const cid = cidadeValida(out.imovel_cidade); if (cid) upd.imovel_cidade = cid; else if (out.imovel_cidade) upd.imovel_cidade = null; }
      { const uf = ufValida(out.imovel_uf); if (uf) upd.imovel_uf = uf; else if (out.imovel_uf) upd.imovel_uf = null; }
      if (out.ocupacao === 'ocupado' || out.ocupacao === 'desocupado') upd.ocupacao = out.ocupacao;
      upd.status = 'processado';
    }
    // 19/08: `feitos++` contava mesmo com o update falho (resultado descartado).
    try {
      const { error: eUpd } = await supabase.from('editais_leilao').update(upd).eq('id', e.id);
      if (!eUpd) feitos++;
      else console.error(`[radar] update do edital ${e.id} falhou:`, eUpd.message);
    } catch { /* segue */ }
  }
  return feitos;
}

// Campos do item DJEN vêm com nomes variados entre versões — pega o 1º que existir.
const g = (o, ...ks) => { for (const k of ks) { if (o && o[k] != null && o[k] !== '') return o[k]; } return null; };

/**
 * Marcador para abortar o PULL INTEIRO quando a recusa é de ORÇAMENTO.
 * Existe porque "não tenho cota" não é uma propriedade deste combo tribunal×termo — é do
 * sistema. Tentar os outros 11 combos depois dela é gastar 4,5 s de backoff por combo para
 * receber exatamente a mesma resposta.
 */
export class SemCotaRadar extends Error {
  constructor(detalhe) { super(detalhe || 'cota Bright Data esgotada'); this.name = 'SemCotaRadar'; }
}

// ─── OS DOIS TRANSPORTES ────────────────────────────────────────────────────────────────────
// A ÚNICA diferença entre coletar o DJEN pela Vercel e coletar de casa é o transporte. Todo o
// resto — janela, filtro duro, parser do edital, dedup, upsert — é idêntico, e por isso vive
// numa função só (`pullDJEN`). Duplicar o parser num script residencial seria repetir o defeito
// que o `roteiarDatasPraca` consertou em 29/08: a mesma regra em três cópias deixou o bug passar
// nas três.
//
// Cada transporte devolve o JSON da página ou LANÇA. Nenhum devolve `null` — `null` foi
// exatamente o que transformou "cota estourada" em "HTTP 403 do CNJ" por quatro dias.

/** Vercel/CI: IP de datacenter é barrado pelo DJEN, então vai pelo Bright Data (IP residencial). */
async function transporteBrightData(url, t0, hardMs) {
  // O DJEN bloqueia o IP de datacenter da Vercel (403 PERSISTENTE — validado: nem UA nem
  // Origin/Referer de navegador resolvem). Então vai DIRETO no Bright Data, sem gastar ~23s/página
  // em tentativas diretas fadadas ao 403. A tentativa direta fica só para BD não configurado.
  //
  // ─── 29/08: O "403 DO DJEN" ERA O FREIO DE CUSTO USANDO O CRACHÁ DO CNJ ────────────────
  // Isto usava `fetchViaBrightData`, que devolve **null** para quatro coisas diferentes: sem
  // config, teto global, sub-cota e erro de rede. Com a cota estourada:
  //   null → `transiente = !resp` → dorme 1,5 s + 3 s → null de novo → fetch DIRETO
  //        → o DJEN 403 o IP da Vercel → `throw new Error('HTTP 403')`
  // Medido: `brightdata_uso_proposito_dia` não tem UMA linha de `radar` em 26–29/08 (o BD nunca
  // foi chamado) e o `duracao_ms` dos 24 runs bate em ~61 s = 12 combos × 4,5 s de `sleep` puro.
  // Forma nº 5 e nº 10 do CLAUDE.md na mesma linha.
  let json, ultimoStatus = 0, bdIndisponivel = !brightDataDisponivel();
  if (!bdIndisponivel) {
    // O DJEN é instável: alguns combos devolvem 403/5xx MESMO via Bright Data, mas voltam no
    // retry segundos depois. Backoff curto (1,5s→3s). 200/404 NÃO re-tenta (resposta definitiva).
    for (let tent = 0; tent <= BD_RETRIES; tent++) {
      let resp = null;
      try {
        resp = await buscarViaBrightData(url, { headers: DJEN_HEADERS, proposito: 'radar', timeoutMs: 30000, exigirOk: false });
      } catch (e) {
        if (!(e instanceof ErroBrightData)) throw e;
        // ORÇAMENTO: sobe e aborta o pull inteiro. Não dorme, não tenta direto, não tenta os
        // outros combos — nada disso mudaria a resposta, e o custo seria só tempo de função.
        if (e.semCota) throw new SemCotaRadar(e.detalhe || e.message);
        if (e.motivo === 'sem_config') { bdIndisponivel = true; break; }
        // `rede`/`http`: falha de verdade, e essa SIM costuma passar no retry.
      }
      if (resp && resp.ok) { try { json = JSON.parse(await resp.text()); } catch { /* corpo não-JSON */ } break; }
      if (resp) ultimoStatus = resp.status;
      const transiente = !resp || resp.status === 403 || resp.status === 429 || resp.status >= 500;
      if (!transiente || tent === BD_RETRIES || Date.now() - t0 > hardMs) break;
      await sleep(1500 * (tent + 1));
    }
  }
  // ÚLTIMO recurso: só faz sentido com o Bright Data INDISPONÍVEL (sem credencial) — com cota
  // estourada já saímos acima, e era esta tentativa que fabricava o "403 do DJEN".
  if (!json && bdIndisponivel) json = await transporteDireto(url).catch(() => null);
  if (!json) throw new Error(`HTTP ${ultimoStatus || 'sem resposta'}`);
  return json;
}

/**
 * Runner RESIDENCIAL: fetch direto, R$ 0. O bloqueio do DJEN é por CLASSE DE IP (datacenter),
 * não por assinatura de requisição — é exatamente por isso que o Bright Data, que sai por IP
 * residencial, sempre passou. De casa o IP já é residencial, então o intermediário é dispensável.
 */
export async function transporteDireto(url, _t0, _hardMs, tentativas = DIRETO_RETRIES) {
  let ultimo;
  for (let tent = 0; tent <= tentativas; tent++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    let definitivo = false;
    try {
      const resp = await fetch(url, { headers: DJEN_HEADERS, signal: ctrl.signal });
      if (resp.ok) return await resp.json();
      ultimo = new Error(`HTTP ${resp.status}`);
      // 4xx que não seja 429 é resposta DEFINITIVA: re-tentar só gasta tempo.
      definitivo = resp.status < 500 && resp.status !== 429;
    } catch (e) {
      ultimo = e;   // rede/timeout/JSON inválido — transiente, vale re-tentar
    } finally { clearTimeout(to); }
    if (definitivo || tent === tentativas) break;
    await sleep(1500 * (tent + 1)); // 1,5s, depois 3s — igual ao caminho pago
  }
  throw ultimo || new Error('sem resposta');
}

async function buscarDJEN(tribunal, termo, ini, fim, t0, transporte, hardMs) {
  const out = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = `${DJEN_BASE}?siglaTribunal=${encodeURIComponent(tribunal)}&texto=${encodeURIComponent(termo)}`
      + `&dataDisponibilizacaoInicio=${ini}&dataDisponibilizacaoFim=${fim}&itensPorPagina=100&pagina=${pagina}`;
    const json = await transporte(url, t0, hardMs);
    const items = json?.items || json?.content || json?.comunicacoes || [];
    if (!items.length) break;
    out.push(...items);
    const count = Number(json?.count ?? json?.totalElements ?? 0);
    if (count && pagina * 100 >= count) break;
  }
  return out;
}

/**
 * O PULL DO DJEN — um só, para os dois caminhos (Vercel/Bright Data e runner residencial).
 * A única coisa que varia entre eles é o `transporte`; janela, filtro duro, parser, dedup e
 * upsert são idênticos. Manter isto numa função só é decisão consciente: em 29/08 o
 * `roteiarDatasPraca` nasceu porque a MESMA regra em três cópias deixou o defeito passar nas
 * três, e um radar residencial com parser próprio repetiria o erro em escala maior.
 *
 * Não grava `monitor_runs` — quem chama grava, porque a ORIGEM (`vercel` ou `residencial`) é
 * do chamador e precisa aparecer na linha.
 */
export async function pullDJEN({ supabase, ini, fim, ehIntegrado, t0, transporte, hardMs = HARD_MS, tribunais = TRIBUNAIS, termos = TERMOS }) {
  let vistos = 0, novos = 0, descartados = 0, erroGeral = null, cortadoPorTempo = false, semCota = false;
  // COMBO ≠ RUN (03/09). Um combo (tribunal × termo) que cai NÃO é o pull falhando: são 12
  // chamadas independentes, e a janela deslizante recupera na rodada seguinte o que uma delas
  // perdeu. Medido: o run de 29/08 18:53 trouxe 98 editais novos e viu 2.093 itens — e foi
  // carimbado FALHA porque `TRT15/edital de leilão` deu `fetch failed`. Consequências, as
  // duas silenciosas: o freio da rede de segurança lê `erro is null` e concluía "o residencial
  // nunca teve sucesso", chamando o Bright Data para refazer o que já tinha sido feito de
  // graça; e o invariante `radar_editais_sem_pull` (criado hoje) passaria a gritar sobre um
  // pipeline saudável. Com 27 tribunais, a chance de os 12+ combos passarem todos numa mesma
  // rodada cai a quase zero — este conserto é pré-requisito de abrir `RADAR_TRIBUNAIS`.
  let combosOk = 0, combosFalha = 0;
  const avisos = [];
  // RENDIMENTO POR COMBO (03/09). O cabeçalho deste arquivo diz que "o agente APRENDE o
  // rendimento de cada termo — quantos viram edital REAL vs ruído"; era ASPIRACIONAL: nada no
  // código media isso, e o termo que achou cada edital nem era gravado. Terceira documentação
  // de mecanismo inexistente encontrada hoje.
  //
  // ⚠️ E A MÉTRICA ÓBVIA SERIA ENVIESADA. Gravar "qual termo achou este edital" dá crédito
  // sempre ao termo que roda PRIMEIRO no laço, porque o dedup por `djen_id` descarta as
  // descobertas seguintes: 'edital de leilão' abriria a lista todo dia e pareceria o melhor
  // termo do mundo. O que NÃO tem esse viés é a razão do próprio combo — quantos itens ele
  // trouxe e quantos passaram no filtro duro —, porque as duas contagens acontecem antes de
  // qualquer dedup. É essa que fica gravada.
  const porCombo = [];
 try {
  for (const tribunal of tribunais) {
    if (cortadoPorTempo || semCota) break;
    for (const termo of termos) {
      // 19/08: o break por HARD_MS só saía do laço de TERMOS (reentrava a cada tribunal) e
      // NÃO setava erroGeral — o run parcial gravava `erro: null` e o gate do dia
      // (`.is('erro', null)`) fazia TODOS os runs seguintes pularem o pull: 3 de N
      // tribunais coletados encerravam a captura do dia inteiro anunciando sucesso.
      if (Date.now() - t0 > hardMs) { cortadoPorTempo = true; break; }
      let items = [];
      try { items = await buscarDJEN(tribunal, termo, ini, fim, t0, transporte, hardMs); }
      catch (e) {
        // ORÇAMENTO ≠ FALHA DA FONTE. Sem cota, o pull inteiro para aqui: os 11 combos
        // restantes dariam a mesma recusa, e é essa distinção que faltava no log — quatro
        // dias apareceram como "o CNJ nos bloqueou" quando ninguém tinha chamado o CNJ.
        if (e instanceof SemCotaRadar) {
          semCota = true;
          erroGeral = `SEM COTA Bright Data — pull não tentado (decisão de orçamento, não bloqueio do DJEN): ${String(e.message).slice(0, 90)}`;
          break;
        }
        combosFalha++;
        avisos.push(`${tribunal}/${termo}: ${String(e.message).slice(0, 60)}`);
        continue;
      }
      combosOk++;
      vistos += items.length;
      const comboAtual = { tribunal, termo, vistos: items.length, reais: 0 };
      porCombo.push(comboAtual);
      if (!items.length) continue;

      // Monta linhas; dedup por djen_id (só insere as inéditas).
      const linhas = items.map((it) => {
        const djenId = String(g(it, 'id', 'numeroComunicacao', 'hash', 'idComunicacao') || '');
        const texto = String(g(it, 'texto', 'inteiroTeor', 'teor', 'conteudo') || '');
        const tipoDoc = g(it, 'tipoDocumento', 'tipoComunicacao', 'tipo');
        if (!ehEditalReal(texto, tipoDoc)) return null; // FILTRO DURO: fora despacho/decisão que só cita "leilão"
        const p = parseEdital(texto);
        const orgao = g(it, 'nomeOrgao', 'orgao', 'nomeVara');
        const nomeLeiloeiro = p.leiloeiro_nome;
        return {
          djen_id: djenId || null,
          fonte: 'djen',
          tribunal: g(it, 'siglaTribunal', 'tribunal') || tribunal,
          numero_processo: g(it, 'numeroProcesso', 'numero_processo', 'numeroprocessocommascara'),
          orgao, comarca: orgao, uf: ufDoTribunal(g(it, 'siglaTribunal', 'tribunal') || tribunal),
          classe: g(it, 'nomeClasse', 'classe'),
          tipo_documento: tipoDoc,
          data_disponibilizacao: (String(g(it, 'data_disponibilizacao', 'dataDisponibilizacao', 'datadisponibilizacao') || fim)).slice(0, 10),
          data_praca_1: p.data_praca_1, data_praca_2: p.data_praca_2,
          leiloeiro_nome: nomeLeiloeiro, leiloeiro_nome_norm: nomeLeiloeiro ? norm(nomeLeiloeiro) : null,
          leiloeiro_jucesp: p.leiloeiro_jucesp, leilao_plataforma_url: p.leilao_plataforma_url,
          leiloeiro_integrado: nomeLeiloeiro ? ehIntegrado(nomeLeiloeiro) : false, // null quando o cruzamento está cego
          valor_avaliacao: p.valor_avaliacao, lance_minimo: p.lance_minimo,
          imovel_matricula: p.imovel_matricula, imovel_area_m2: p.imovel_area_m2,
          // ⚠️ ERA `p.imovel_uf || 'SP'` (03/09). Com o radar só em SP o default era invisível;
          // com `RADAR_TRIBUNAIS` aberto para o Brasil, todo edital do TJBA ou do TJMG cujo
          // parse não achasse a UF entraria como SÃO PAULO — dado inventado com cara de dado.
          imovel_cidade: p.imovel_cidade, imovel_uf: p.imovel_uf, imovel_endereco: p.imovel_endereco,
          debitos: p.debitos, ocupacao: p.ocupacao, cartorio: p.cartorio,
          texto_integral: texto.slice(0, 20000),
          hash_dedup: djenId ? null : norm(`${tribunal}|${g(it, 'numeroProcesso') || ''}|${texto.slice(0, 200)}`),
          payload: it,
          status: p.status,
        };
      }).filter((r) => r && (r.djen_id || r.hash_dedup));
      // ANTES do dedup: é isso que torna a razão comparável entre termos.
      comboAtual.reais = linhas.length;
      descartados += items.length - linhas.length;

      // Só as inéditas (evita reprocessar): confere djen_id já existentes.
      const ids = linhas.map((r) => r.djen_id).filter(Boolean);
      const existentes = new Set();
      for (let i = 0; i < ids.length; i += 200) {
        try {
          const { data } = await supabase.from('editais_leilao').select('djen_id').in('djen_id', ids.slice(i, i + 200));
          for (const r of data || []) existentes.add(r.djen_id);
        } catch { /* aditivo */ }
      }
      const inserir = linhas.filter((r) => !r.djen_id || !existentes.has(r.djen_id));
      if (inserir.length) {
        const { error } = await supabase.from('editais_leilao').upsert(inserir, { onConflict: 'djen_id', ignoreDuplicates: true });
        if (!error) novos += inserir.length;
        else erroGeral = `upsert: ${String(error.message).slice(0, 80)}`;
      }
    }
  }
 } catch (e) {
  erroGeral = String(e.message).slice(0, 120);
 }
  // O VEREDITO DO RUN. Falha total (nenhum combo respondeu) é erro; falha parcial é AVISO —
  // e o aviso não pode virar `erro`, senão volta a reprovar um pull que funcionou. `semCota` e
  // corte por tempo continuam sendo erro: ali o pull não completou por decisão nossa, e o
  // gate do dia precisa re-tentar.
  if (!erroGeral && combosFalha > 0) {
    if (combosOk === 0) erroGeral = `nenhum combo respondeu (${combosFalha}): ${avisos[0] || 'sem detalhe'}`;
  }
  const avisoParcial = (combosFalha > 0 && combosOk > 0)
    ? `parcial: ${combosOk} de ${combosOk + combosFalha} combos ok — ${avisos.slice(0, 3).join(' · ')}`
    : null;
  return { vistos, novos, descartados, erroGeral, avisoParcial, combosOk, combosFalha, porCombo, cortadoPorTempo, semCota };
}

/**
 * Leiloeiros que JÁ raspamos (nome normalizado) → marca `leiloeiro_integrado` no edital.
 * Exportado porque o runner residencial precisa do MESMO critério: se cada caminho decidisse
 * "integrado" por conta própria, o mesmo edital entraria diferente conforme quem coletou.
 */
export async function construirEhIntegrado(supabase) {
  const integrados = new Set();
  let falhou = null;
  try {
    // ⚠️ ERA `.from('imoveis_leilao').select('leiloeiro').eq('ativo',true).limit(5000)`, SEM
    // `order` — e o campo `leiloeiro_integrado` passou a medir outra coisa (03/09).
    // `imoveis_leilao` tem 29.875 linhas ativas e **76% são da Caixa**. Medida a amostra REAL
    // dessas 5.000 primeiras: **4.570 são "Caixa Econômica Federal"** e sobram **30 dos 106
    // leiloeiros**. A lista de integrados nascia com 72% faltando, e o resultado era
    // `leiloeiro_integrado = false` em 477 de 477 editais — inclusive para leiloeiro que a
    // gente raspa todo dia. É a forma nº 9 do CLAUDE.md (janela de cache virando janela de
    // dados) desaguando na nº 10 (o número mede o truncamento e se chama "integração").
    // Rodando a MESMA regra sobre o acervo completo: 35 dos 121 editais com nome casam.
    //
    // A RPC devolve os nomes DISTINTOS (106 linhas): não há o que truncar, e o critério fica
    // auditável no banco em vez de depender de quantas linhas couberam.
    const { data, error } = await supabase.rpc('leiloeiros_do_acervo');
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error('leiloeiros_do_acervo devolveu corpo inesperado');
    for (const r of data) { const n = norm(r.leiloeiro); if (n.length >= 4) integrados.add(n); }
    // Lista vazia NÃO é "nenhum leiloeiro integrado": é leitura que não trouxe nada. Com o
    // acervo em 40 fontes ativas, zero só acontece se algo quebrou.
    if (!integrados.size) throw new Error('lista de leiloeiros veio vazia');
  } catch (e) {
    // ⚠️ ESTE CATCH ERA VAZIO, e o comentário dele já admitia o defeito ("sem a lista, nenhum
    // edital sai marcado"): falha de leitura virava "não integrado" para todo mundo, calada.
    // Agora o motivo sobrevive — quem chama grava em `monitor_runs.erro` (ver `ehIntegradoErro`).
    falhou = String(e?.message || e).slice(0, 120);
    console.error('[radar-editais] lista de leiloeiros NÃO construída:', falhou);
  }
  const fn = (nome) => {
    // ⚠️ TRI-STATE (03/09). `null` = "não consegui conferir", e é diferente de `false`
    // = "conferi e não casa". Enquanto a coluna era boolean com default false, uma falha ao
    // montar a lista marcava TODO edital como "leiloeiro a integrar" — inclusive gente que a
    // gente raspa todo dia — e o backlog de aquisição passava a mentir sem dar erro.
    if (falhou) return null;
    const n = norm(nome);
    if (n.length < 4) return false;
    for (const i of integrados) { if (i.includes(n) || n.includes(i)) return true; }
    return false;
  };
  // O chamador precisa distinguir "conferi e não é integrado" de "não consegui conferir".
  fn.erro = falhou;
  fn.tamanhoDaLista = integrados.size;
  return fn;
}

/**
 * A JANELA DESLIZANTE, e por que ela não é fixa em 3 dias.
 *
 * 3 dias cobre a coleta DIÁRIA (pega item carregado com atraso; o dedup resolve a repetição).
 * Mas o caminho pago virou rede de segurança SEMANAL (decisão do dono, 29/08: "caso fique 7
 * dias sem rodar no residencial, pode rodar pelo Bright Data") — e uma janela de 3 dias numa
 * passada semanal **perderia 4 dias de editais em silêncio**, com o run saindo verde.
 * Então a janela acompanha o buraco real: `dias desde o último sucesso + 1`, nunca menos que 3.
 * Teto de 15 para o custo não explodir depois de uma ausência longa (cada dia a mais é mais
 * página por combo) — e a perda além disso é registrada, não escondida.
 */
export function janelaDJEN(diasDesdeSucesso, tetoDias = 15) {
  const dias = Math.min(tetoDias, Math.max(3, Math.ceil(Number(diasDesdeSucesso) || 0) + 1));
  const hoje = new Date();
  return { ini: ymd(new Date(hoje.getTime() - dias * 86400000)), fim: ymd(hoje), dias };
}

/**
 * RE-PARSE dos editais que ficaram sem leiloeiro, com a régua nova.
 *
 * De graça: regex sobre `texto_integral` que já está no banco — nenhuma chamada de rede,
 * nenhum token de IA. E é uma FILA que se esgota: cada rodada corrige o que consegue, e
 * quando não sobrar edital sem nome a consulta volta vazia.
 *
 * O `.limit()` aqui NÃO é o caso da forma nº 9 do CLAUDE.md (janela de cache virando janela
 * de dados): nada aqui é CRUZADO com outra leitura truncada — é um lote de trabalho, e o que
 * não couber nesta rodada vem na próxima, porque a condição de entrada (`leiloeiro_nome is
 * null`) some quando o item é resolvido.
 */
/**
 * ITEM 4 DO PEDIDO DO DONO (03/09): "no edital tem o link do leiloeiro, com isso vamos ter
 * o acesso ao leiloeiro e conectar com ele para pegar os documentos caso não estejam já
 * disponibilizados."
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * MELHOR ESFORÇO GENÉRICO, e é preciso dizer isso com todas as letras: isto não é um
 * scraper por leiloeiro (como `scripts/scraper-puppeteer.mjs`, que tem código dedicado por
 * site). É um fetch simples + regex sobre HTML — funciona em sites que renderizam o link do
 * documento no HTML estático, e NÃO funciona em sites que só desenham o link via JavaScript
 * (SPA). A taxa de acerto real só se mede rodando; não prometo aqui.
 *
 * Usa `fetchExternoSeguro`/`hostExternoSeguro` — a MESMA proteção anti-SSRF que
 * `gerar-analise.js`, `gerar-documental.js` e `enriquecer-lote.js` já usam para alcançar
 * documento em site de leiloeiro (não a allowlist exata de `hostPermitido`, que é para
 * outro propósito — servir documento AO CLIENTE por `baixar-doc.js`/`fetch-url.js`).
 */
export async function descobrirDocumentosNoSite(url) {
  if (!hostExternoSeguro(url)) return null;
  let html;
  try {
    const r = await fetchExternoSeguro(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    html = await r.text();
  } catch { return null; }
  // Teto de tamanho: não processa página gigante (custo de regex + memória à toa).
  if (!html || html.length > 2_000_000) return null;

  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)]
    .map(([, href, texto]) => ({ href, texto: texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));

  const acha = (re) => {
    const cand = links.find((l) => re.test(l.href) || re.test(l.texto));
    if (!cand) return null;
    try {
      const abs = new URL(cand.href, url).toString();
      // O achado também passa pelo MESMO anti-SSRF — um <a href> na página de um leiloeiro
      // pode apontar pra qualquer lugar, inclusive rede interna se a página for hostil/mal
      // configurada. Nunca devolve um link que a checagem de destino não aprove.
      return hostExternoSeguro(abs) ? abs : null;
    } catch { return null; }
  };
  const matricula = acha(/matr[íi]cula/i);
  const edital = acha(/\bedital\b/i);
  if (!matricula && !edital) return null;
  return { matricula, edital };
}

/**
 * Percorre os lotes nascidos do Radar (`fonte='EDITAL_DJEN'`) que ainda não têm documento e
 * têm `url_lote` (o link do leiloeiro que veio do edital) para tentar achar matrícula/edital
 * no site. Negative-cache PRÓPRIO (`doc_descoberta_em`/`doc_descoberta_tentativas`) — não
 * reaproveita `matricula_checada_em`/`matricula_scan_em`, que já significam outra coisa em
 * outros pipelines (ver comentário da coluna na migração).
 */
async function buscarDocumentosPendentes(supabase, teto = 15) {
  const limite = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data, error } = await supabase.from('imoveis_leilao')
    .select('id, url_lote, link_matricula, link_edital, doc_descoberta_tentativas')
    .eq('fonte', 'EDITAL_DJEN').eq('ativo', true)
    .or('tem_matricula_doc.eq.false,tem_edital_doc.eq.false')
    .not('url_lote', 'is', null)
    .or(`doc_descoberta_em.is.null,doc_descoberta_em.lt.${limite}`)
    .order('doc_descoberta_em', { ascending: true, nullsFirst: true })
    .limit(teto);
  if (error) return { erro: error.message.slice(0, 120), tentados: 0, achados: 0 };

  let tentados = 0, achados = 0;
  for (const im of data || []) {
    tentados++;
    const doc = await descobrirDocumentosNoSite(im.url_lote).catch(() => null);
    const patch = {
      doc_descoberta_em: new Date().toISOString(),
      doc_descoberta_tentativas: (im.doc_descoberta_tentativas || 0) + 1,
    };
    if (doc?.matricula && !im.link_matricula) patch.link_matricula = doc.matricula;
    if (doc?.edital && !im.link_edital) patch.link_edital = doc.edital;
    if (doc?.matricula || doc?.edital) achados++;
    // `.select()` prova que a gravação alcançou a linha — sem isso, "achei o documento" e
    // "não gravei" ficariam indistinguíveis, e o lote seguiria sem doc pra sempre.
    const { data: upd, error: eUpd } = await supabase.from('imoveis_leilao')
      .update(patch).eq('id', im.id).select('id');
    if (eUpd || !upd?.length) console.error('[radar-editais] doc_descoberta não gravou', im.id, eUpd?.message);
  }
  return { tentados, achados };
}

async function reparsarLeiloeirosPendentes(supabase, ehIntegrado, teto = 300) {
  const { data, error } = await supabase.from('editais_leilao')
    .select('id, status, texto_integral')
    .is('leiloeiro_nome', null)
    .in('status', ['processado', 'erro_parse'])   // `nao_edital` fica de fora: é ruído da busca
    .not('texto_integral', 'is', null)
    .limit(teto);
  // Leitura que falhou NÃO pode virar "não havia o que corrigir": os dois desfechos são
  // `corrigidos: 0` e levam a conclusões opostas sobre o parser.
  if (error) return { erro: error.message.slice(0, 120), vistos: 0, corrigidos: 0 };

  let corrigidos = 0, falhasGravacao = 0;
  for (const e of data || []) {
    const nome = extrairLeiloeiro(e.texto_integral);
    if (!nome) continue;
    const upd = {
      leiloeiro_nome: nome,
      leiloeiro_nome_norm: norm(nome),
      leiloeiro_integrado: ehIntegrado(nome),
      atualizado_em: new Date().toISOString(),
    };
    // Achar o leiloeiro É extrair algo útil: quem estava em `erro_parse` deixou de estar.
    if (e.status === 'erro_parse') upd.status = 'processado';
    const { error: eUpd } = await supabase.from('editais_leilao').update(upd).eq('id', e.id);
    if (eUpd) { falhasGravacao++; console.error('[radar-editais] re-parse não gravou', e.id, eUpd.message); continue; }
    corrigidos++;
  }
  return { vistos: (data || []).length, corrigidos, falhas_gravacao: falhasGravacao || undefined };
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const t0 = Date.now();
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Bypass manual de todos os freios abaixo: ?forcar=1.
  // ── FREIO DO CAMINHO PAGO (29/08, decisão do dono) ─────────────────────────────────────
  // "Vou rodar diariamente [o residencial]; caso fique 7 dias sem rodar no residencial, pode
  // rodar pelo Bright Data." A captura do DJEN passou a ser do runner de casa (grátis, IP
  // residencial — `scripts/radar-editais-residencial.mjs`), e ESTE cron virou rede de
  // segurança SEMANAL, não diária.
  //
  // O sinal é o ACERVO DE RUNS, não um carimbo de "rodei": um pull bem-sucedido de QUALQUER
  // caminho grava `monitor_runs` com `erro: null`, e é isso que conta. Mesma virada que o
  // `coleta-recente.mjs` fez em 11/08 — carimbo de execução mente quando o script sai com
  // exit 0 sem ter trazido nada; a evidência do resultado, não.
  const DIAS_REDE_SEGURANCA = Number(process.env.RADAR_DIAS_REDE_SEGURANCA || 7);
  const MAX_TENTATIVAS_DIA = Number(process.env.RADAR_MAX_TENTATIVAS_DIA || 2);
  const forcar = /[?&]forcar=1/.test(req.url || '');
  let pulouPull = false; // pull já resolvido → pula a captura, mas a IA ainda enriquece
  let motivoPulo = null, jaRegistrado = false;
  let diasDesdeSucesso = Infinity;
  if (!forcar) {
    try {
      const { data: ultimoOk, error: eOk } = await supabase.from('monitor_runs')
        .select('ran_at').eq('fonte', 'radar-editais-djen').is('erro', null)
        .order('ran_at', { ascending: false }).limit(1);
      // `{ data, error }` do postgrest-js NÃO lança (forma nº 2): sem checar `error`, uma
      // leitura falha viraria "nunca houve sucesso" e o cron pago rodaria por engano — o
      // oposto exato do que este freio existe para fazer.
      if (eOk) throw new Error(eOk.message);
      if (ultimoOk?.[0]?.ran_at) diasDesdeSucesso = (Date.now() - Date.parse(ultimoOk[0].ran_at)) / 86400000;
      if (diasDesdeSucesso < DIAS_REDE_SEGURANCA) {
        pulouPull = true;
        motivoPulo = `residencial em dia — último pull bem-sucedido há ${diasDesdeSucesso.toFixed(1)} dia(s), rede de segurança só em ${DIAS_REDE_SEGURANCA}`;
      }
    } catch {
      // FAIL-OPEN: não consegui ler o histórico ≠ "está tudo em dia". Melhor pagar uma coleta
      // do que ficar sem editais em silêncio — a mesma postura do `coleta-recente.mjs`.
      diasDesdeSucesso = Infinity;
    }
  }

  // ── DISJUNTOR DE TENTATIVAS PAGAS (29/08) ──────────────────────────────────────────────
  // Quando o freio acima LIBERA (7+ dias sem sucesso), o gate do dia volta a valer: re-tenta a
  // cada 4 h até um pull passar. Só que, com bloqueio PERSISTENTE, nenhum run sai sem erro e
  // TODOS os 6 do dia refazem o pull inteiro pagando Bright Data — **uma fonte que custa MAIS
  // quanto mais falha**. Medido em 26–29/08: 6/6 runs em 403, `itens_vistos = 0`, e `radar` é o
  // 2º maior consumidor da cota (88 requests num único dia).
  //
  // Duas tentativas cobrem a queda passageira para a qual o gate existe; da terceira em diante
  // só se paga para ouvir o mesmo não. Vale só para o PULL — a IA da fila já capturada segue.
  if (!forcar && !pulouPull) {
    try {
      const desdeMeiaNoite = ymd(new Date()) + 'T00:00:00Z';
      const { data: runsHoje, error: eHoje } = await supabase.from('monitor_runs')
        .select('erro').eq('fonte', 'radar-editais-djen').gte('ran_at', desdeMeiaNoite);
      if (eHoje) throw new Error(eHoje.message);
      const runs = runsHoje || [];
      // O disjuntor conta TENTATIVAS PAGAS, não linhas. Um run que saiu por SEM COTA não
      // chamou o Bright Data (custa uma RPC e < 1 s), então contá-lo travaria o dia inteiro
      // por causa do freio de custo — o freio virando a razão de não coletar quando a cota
      // voltasse. Linha de SEM COTA no log é informação (é assim que `fonte_saude` registra as
      // fontes pagas todo dia), não tentativa gasta.
      const tentativasPagas = runs.filter((r) => !/^SEM COTA/.test(String(r.erro || ''))
        && !/^disjuntor/.test(String(r.erro || '')));
      if (tentativasPagas.length >= MAX_TENTATIVAS_DIA) {
        pulouPull = true;
        motivoPulo = `disjuntor: ${tentativasPagas.length} tentativa(s) paga(s) falharam hoje (teto ${MAX_TENTATIVAS_DIA}) — não se paga Bright Data para ouvir o mesmo erro`;
        // Um registro por dia basta: os runs 3º ao 6º repetiriam a mesma linha e o log viraria
        // ruído — e log ruidoso é o que treina o dono a não ler o log.
        jaRegistrado = runs.some((r) => String(r.erro || '').startsWith('disjuntor'));
      }
    } catch { /* se a checagem falhar, roda o pull normalmente (fail-open) */ }
  }

  // O pulo por DISJUNTOR precisa deixar rastro: um dia inteiro sem edital com o log em branco
  // é indistinguível de um dia sem publicação. `erro` preenchido mantém o dia como NÃO
  // resolvido — a contagem já barra novas tentativas, então isso não reabre o gasto.
  // O pulo por FREIO não grava nada, de propósito: ali o sucesso do residencial JÁ está no log,
  // e uma linha por run apagaria o sinal que o próprio freio lê.
  if (motivoPulo && motivoPulo.startsWith('disjuntor') && !jaRegistrado) {
    try {
      // Se a gravação falhar, o pior efeito é o dia perder o rastro do pulo; derrubar o cron
      // por causa do log trocaria um problema barato por um caro (o enriquecimento por IA
      // abaixo pararia junto).
      // padrao-ok: log best-effort do disjuntor — nunca pode derrubar o cron
      await supabase.from('monitor_runs').insert({
        fonte: 'radar-editais-djen', itens_vistos: 0, itens_novos: 0, origem: 'vercel',
        duracao_ms: Date.now() - t0, erro: motivoPulo.slice(0, 200),
      });
    } catch { /* nunca quebra por causa do log */ }
  }

  // A janela ACOMPANHA O BURACO: numa rede de segurança semanal, 3 dias fixos perderiam 4 dias
  // de editais em silêncio, com o run saindo verde. Ver `janelaDJEN`.
  const { ini, fim } = janelaDJEN(diasDesdeSucesso === Infinity ? 15 : diasDesdeSucesso);
  const ehIntegrado = await construirEhIntegrado(supabase);

  let vistos = 0, novos = 0, descartados = 0, erroGeral = null, enriquecidos = 0, cortadoPorTempo = false, semCota = false;
  let avisoParcial = null, combosOk = 0, combosFalha = 0, porCombo = null;
  if (!pulouPull) {
    ({ vistos, novos, descartados, erroGeral, avisoParcial, combosOk, combosFalha, porCombo, cortadoPorTempo, semCota } = await pullDJEN({
      supabase, ini, fim, ehIntegrado, t0, transporte: transporteBrightData,
    }));

    // INGESTÃO: usa os editais p/ preencher avaliação faltante do acervo (chave forte: lance ==
    // valor mínimo do lote). Conservador; nunca sobrescreve avaliação existente. Aditivo.
    try { const { data } = await supabase.rpc('editais_enriquecer_acervo'); enriquecidos = Number(data) || 0; } catch { /* aditivo */ }

    try {
      await supabase.from('monitor_runs').insert({
        fonte: 'radar-editais-djen', janela_inicio: ini, janela_fim: fim, origem: 'vercel',
        itens_vistos: vistos, itens_novos: novos, duracao_ms: Date.now() - t0,
        // Run CORTADO POR TEMPO não é sucesso: ali o pull não terminou de varrer a janela, e o
        // gate do dia precisa re-tentar. Já um combo que caiu com os outros respondendo é
        // AVISO, não erro — ver o comentário em `pullDJEN`.
        erro: erroGeral || (cortadoPorTempo ? 'corte_por_tempo (run parcial — repuxar)' : null),
        aviso: avisoParcial,
        por_combo: porCombo && porCombo.length ? porCombo : null,
      });
    } catch { /* nunca quebra por causa do log */ }
  }

  // RE-PARSE DO ACERVO com a régua nova de leiloeiro (03/09). Roda SEMPRE, é de graça (regex
  // sobre texto já guardado — zero rede, zero IA) e se esgota sozinho: quando não sobrar
  // edital sem nome, a consulta volta vazia e o passo custa uma leitura. Sem isto o conserto
  // do parser só valeria para editais FUTUROS e os 477 já capturados seguiriam sem leiloeiro
  // — que é justamente o acervo sobre o qual o backlog de aquisição decide.
  let reparse = null;
  try { reparse = await reparsarLeiloeirosPendentes(supabase, ehIntegrado); }
  catch (e) { reparse = { erro: String(e?.message || e).slice(0, 120) }; console.error('[radar-editais] re-parse falhou', reparse.erro); }

  // ENRIQUECIMENTO POR IA — roda SEMPRE (mesmo com o pull pulado), best-effort, capado e
  // time-boxed: drena a fila de editais reais ainda não extraídos, a cada 4h, barato.
  let iaExtraidos = 0;
  try { iaExtraidos = await enriquecerEditaisComIA(supabase, ehIntegrado, t0); } catch { /* best-effort */ }

  // EDITAL VIRA LOTE (03/09, pedido do dono). Roda SEMPRE, depois do re-parse (o parser novo
  // de leiloeiro pode ter acabado de destravar um edital que estava sem identificação) e
  // depois do enriquecimento por IA (que preenche cidade/uf/valor em editais que a regex
  // sozinha não pegou) — nessa ordem, cada passo alimenta o seguinte. `editais_promover_pendentes`
  // faz o dedup pelo que temos (matrícula forte, cidade+valor/data médio) e nunca cria lote
  // com foto. Best-effort: uma falha aqui não pode derrubar o cron que já coletou.
  let promocao = null;
  try {
    const { data, error } = await supabase.rpc('editais_promover_pendentes');
    if (error) throw new Error(error.message);
    promocao = data;
  } catch (e) { promocao = { erro: String(e?.message || e).slice(0, 120) }; console.error('[radar-editais] promoção não rodou', promocao.erro); }

  // BUSCA DE DOCUMENTO NO SITE DO LEILOEIRO (item 4 do pedido). Melhor esforço genérico —
  // ver o comentário de `descobrirDocumentosNoSite`. Roda por último e com teto pequeno: é
  // rede de verdade (fetch no site de terceiro), então o custo por rodada fica baixo mesmo
  // que a lista de pendentes cresça.
  let buscaDocs = null;
  try { buscaDocs = await buscarDocumentosPendentes(supabase); } catch (e) { buscaDocs = { erro: String(e?.message || e).slice(0, 120) }; }

  const pullDesfecho = pulouPull ? `pulado (${motivoPulo || 'já resolvido'})` : (semCota ? 'não tentado (sem cota Bright Data)' : 'executado');
  // A SAÚDE DA LISTA DE LEILOEIROS SAI NA RESPOSTA, e NÃO em `monitor_runs.erro` — de propósito.
  // O freio da rede de segurança lê `erro is null` para decidir se paga Bright Data; marcar
  // erro aqui faria uma falha do CRUZAMENTO cancelar um pull que deu certo, e o caminho pago
  // seria acionado por engano. Duas coisas diferentes não podem compartilhar o mesmo sinal —
  // foi assim que `sem_cota` já virou "a fonte não tem nada" uma vez (forma nº 5).
  const listaLeiloeiros = { tamanho: ehIntegrado.tamanhoDaLista, erro: ehIntegrado.erro || null };
  if (ehIntegrado.erro) console.error('[radar-editais] cruzamento CEGO nesta rodada:', ehIntegrado.erro);
  return new Response(JSON.stringify({ ok: true, pull: pullDesfecho, sem_cota: semCota, vistos, novos, descartados, enriquecidos, iaExtraidos, erro: erroGeral, aviso: avisoParcial, combos: { ok: combosOk, falha: combosFalha }, lista_leiloeiros: listaLeiloeiros, reparse, promocao, busca_docs: buscaDocs, janela: [ini, fim], tribunais: TRIBUNAIS }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
