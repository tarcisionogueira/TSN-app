/**
 * PARSER plataforma LEILÕESBR (27/10) — "Powered by LeilõesBR" (leiloesbr.com.br, ASP clássico em IIS). 44 leiloeiros
 * da junta (triagem 26/10, plataforma LEILOESBR). É a plataforma de ARTE, ANTIGUIDADES e COLECIONISMO: a taxonomia da
 * própria plataforma (categorias de leiloesbr.com.br, medida em 27/10) não tem tipo de imóvel nem de veículo — a busca
 * global por "terreno" devolveu 39 peças, todas miniatura/revista/folheto. Por isso este leitor NÃO abre peça por peça:
 * ele lê, de cada catálogo ATIVO, o total de peças que o site declara e a contagem por TIPO, e só considera candidato a
 * imóvel/veículo o que estiver num tipo que pareça imóvel/veículo. Hoje: zero em todos — o leiloeiro fica CONECTADO
 * (fonte_saude registra a medição) e, no dia em que um catálogo trouxer um tipo de imóvel, a lista sai CORTADA com o
 * nome do tipo no log em vez de virar "0 lotes" calado (este leitor não sabe enumerar peças desse tipo — ainda).
 *
 * Dois moldes convivem (o rodapé diz a versão):
 *   • V7.x — /listacatalogo.asp traz em HTML as seções "Leilões em Andamento"/"em captação" antes de "Leilões
 *     finalizados"; o catálogo /catalogo.asp?Num=N traz `<span class="find-numb">222</span> Itens encontrados` e o
 *     filtro "Escolha pelo Tipo" com `Tipo (n)` por tipo.
 *   • V8.x — /listacatalogo.asp traz `listacatalogoData = '{ "Leiloes": [...] }'` (ou {"MENSAGEM_ERRO":"Nenhum leilão
 *     ativo foi encontrado"}); o catálogo carrega os números por AJAX: templates/catalogo/asp/catalogo-tiposload.asp
 *     (tipos com TOT_PECAS) e catalogocontentload.asp?iscalc=1 ({"TOTAL":"222"}). O motor (fetch-leiloesbr.mjs) busca
 *     os dois e anexa ao HTML do catálogo num comentário `<!--LBR-NUMEROS {...}-->`.
 * Catálogo de PARCEIRO (galeria que o leiloeiro conduz, em outro domínio da mesma plataforma) entra: é leilão dele.
 */
import { checarQualidade } from './leilaopro-parse.mjs';

const t = (fonte, leiloeiro, base, uf) => ({ fonte, leiloeiro, base, uf });
// Bases = url_final da triagem (26/10), conferidas pelo banco em 27/10. Exceções medidas: ERNANI responde a lista só
// em br.ernanileiloeiro.com.br (www dá 500); MARIA PIA mora em mariapialeiloes.com.br (o .lel.br dá 404 na lista).
export const TENANTS = {
  albertolopes: t('LBR_ALBERTOLOPES', 'Alberto Cristiano Ramos Lopes da Silva', 'https://www.albertolopesleiloeiro.com.br', 'RJ'),
  amelia: t('LBR_AMELIA', 'Amelia Amaral Levy', 'https://www.amelialeiloeira.com.br', 'SP'),
  anaclara: t('LBR_ANACLARA', 'Ana Clara de Mello e Silva', 'https://www.anaclaraleiloes.lel.br', 'SP'),
  caminhoto: t('LBR_CAMINHOTO', 'Cristiane Medina Amorim Caminhoto', 'https://www.antiquariocaminhoto.com.br', 'SP'),
  bastos: t('LBR_BASTOS', 'Breno Ribeiro Penna Bastos', 'https://www.bastosleiloes.com.br', 'RJ'),
  antonioferreira: t('LBR_ANTONIOFERREIRA', 'Antonio Carlos da Costa Ferreira', 'https://br.antonioferreira.lel.br', 'RJ'),
  brancoperon: t('LBR_BRANCOPERON', 'Jose Antonio Peron', 'https://www.brancoperonleiloeiro.com.br', 'SP'),
  budano: t('LBR_BUDANO', 'Francesco Budano Junior', 'https://www.budanoleiloeiro.com.br', 'SP'),
  casaamarela: t('LBR_CASAAMARELA', 'Fernando Pelloni Barros da Silveira', 'https://www.casaamarelaleiloes.net.br', 'DF'),
  cristinanegreiros: t('LBR_CRISTINANEGREIROS', 'Cristina Cruz de Negreiros', 'https://www.cristinanegreirosleiloes.com.br', 'SP'),
  dagsaboya: t('LBR_DAGSABOYA', 'Luiz Sergio Pereira', 'https://www.dagsaboya.com.br', 'RJ'),
  diegoaraujo: t('LBR_DIEGOARAUJO', 'Diego Gonçalves Araujo', 'https://www.diegoaraujoleiloeiro.com.br', 'RS'),
  duze: t('LBR_DUZE', 'Lucas de Oliveira Mangualde', 'https://www.du-ze.com', 'MG'),
  dupla: t('LBR_DUPLA', 'Bernardo Cunha de Aguiar', 'https://www.duplaleiloes.com.br', 'RJ'),
  ernani: t('LBR_ERNANI', 'Horacio Ernani Rodrigues de Mello', 'https://br.ernanileiloeiro.com.br', 'SP'),
  errolflynn: t('LBR_ERROLFLYNN', 'Flynn Lopes Pereira dos Reis', 'https://www.errolflynnleiloes.com.br', 'MG'),
  evanioalves: t('LBR_EVANIOALVES', 'Evanio Alves Pereira', 'https://www.evanioalvesleiloeiro.com.br', 'RJ'),
  filatelicajunges: t('LBR_FILATELICAJUNGES', 'Bruno Henrique Junges', 'https://www.filatelicajungesleiloes.com.br', 'RS'),
  flaviacardoso: t('LBR_FLAVIACARDOSO', 'Flavia Cardoso Soares', 'https://www.flaviacardososoaresleiloes.com.br', 'SP'),
  gabrielrota: t('LBR_GABRIELROTA', 'Gabriel Rota Gots Guimaraes', 'https://www.gabrielrota.com.br', 'SP'),
  jonas: t('LBR_JONAS', 'Jonas Rosa Pereira', 'https://www.jonas.lel.br', 'SP'),
  jpjoias: t('LBR_JPJOIAS', 'Adriana Rodrigues Conrado', 'https://www.jpjoiasepedrasleiloes.com.br', 'SP'),
  levy: t('LBR_LEVY', 'Franklin Levy / Patricia Pereira de Lima Levy', 'https://www.levyleiloeiro.com.br', 'RJ'),
  marciopinho: t('LBR_MARCIOPINHO', 'Marcio Pinho Pereira', 'https://www.marciopinho.com.br', 'RJ'),
  mariapia: t('LBR_MARIAPIA', 'Maria da Piedade Fernandes Athayde de Moraes', 'https://www.mariapialeiloes.com.br', 'RJ'),
  marthapadilha: t('LBR_MARTHAPADILHA', 'Martha Isolda Tenório Padilha', 'https://www.marthapadilhaleiloeira.lel.br', 'RJ'),
  melo: t('LBR_MELO', 'Rafael Cunha Melo', 'https://www.meloleiloeiro.com.br', 'RJ'),
  mouraazevedo: t('LBR_MOURAAZEVEDO', 'Guilherme de Moura Azevedo', 'https://www.mouraazevedoleiloes.lel.br', 'SP'),
  mozart: t('LBR_MOZART', 'Mozart Melo', 'https://www.mozartleiloeiro.com.br', 'RJ'),
  panda: t('LBR_PANDA', 'Sarita Ana Giacomazzi Araujo', 'https://www.pandacolecoes.com.br', 'SC'),
  prh: t('LBR_PRH', 'Paulo Renato Humor', 'https://www.prhleiloes.com.br', 'RS'),
  raulbarbosa: t('LBR_RAULBARBOSA', 'Raul Barbosa Cesar Filho', 'https://www.raulbarbosa.com.br', 'RJ'),
  rezendeguimaraes: t('LBR_REZENDEGUIMARAES', 'Renato Rezende Guimarães', 'https://www.rezendeguimaraes.com.br', 'MG'),
  rf: t('LBR_RF', 'Rafael Gavino Figueiredo', 'https://www.rfleiloes.com.br', 'SP'),
  romano: t('LBR_ROMANO', 'Sergio Romano Vieira Junior', 'https://www.romanoleiloes.com.br', 'SP'),
  sb302: t('LBR_SB302', 'Severino Barbosa', 'https://www.sbleiloeiro302.com.br', 'RJ'),
  stipp: t('LBR_STIPP', 'Vinicius Jorge Stipp', 'https://www.stippleiloeiro.com.br', 'SP'),
  tamiris: t('LBR_TAMIRIS', 'Tamiris Feital da Silva Carvalho', 'https://www.tamiriscarvalholeiloeira.com.br', 'RJ'),
  tavares: t('LBR_TAVARES', 'Jean Fillipe Mattos Tavares / Bruna de Melo dos Santos', 'https://www.tavaresleiloes.com.br', 'RJ'),
  tbaracaju: t('LBR_TBARACAJU', 'Thiago Barros Cardoso', 'https://www.tbaracajuleiloes.com.br', 'SE'),
  thomazaquino: t('LBR_THOMAZAQUINO', 'José Elmir Thomaz Aquino', 'https://www.thomazdeaquinoleiloes.com.br', 'SP'),
  valdirteixeira: t('LBR_VALDIRTEIXEIRA', 'Valdir Alexandre Gomes Teixeira', 'https://www.valdirteixeiraleiloeiro.com.br', 'RJ'),
  veratostes: t('LBR_VERATOSTES', 'Vera Lucia Bottrel Tostes', 'https://www.veratostesleiloes.com.br', 'RJ'),
  yankous: t('LBR_YANKOUS', 'Andre Luiz Oliveira Yankous', 'https://www.yankous.com.br', 'MG'),
};

export const CATALOGO = '/listacatalogo.asp';

// Tipo que PODE ser imóvel ou veículo. "Itens automobilísticos", "Automodelismo", miniaturas e "Máquinas e Motores"
// (antiguidade) existem na taxonomia e NÃO são — ficam fora de propósito.
const RE_TIPO_ALVO = /im[óo]ve(?:l|is)|terren|apartament|\bcasas?\b|fazend|s[íi]tio|ch[áa]cara|galp[ãa]o|sala comercial|ve[íi]culo|autom[óo]ve(?:l|is)|\bcarros?\b|\bmotos?\b|caminh[õo]es|caminh[ãa]o/i;
const RE_TIPO_NAO = /automodel|automobil[íi]stic|miniatur|brinquedo|livro|revista|postal|selo|filatel|numism/i;
export const tipoEhAlvo = (nome) => RE_TIPO_ALVO.test(nome) && !RE_TIPO_NAO.test(nome);

const ent = (s) => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

// Lista do molde V8: `listacatalogoData = '{...}';` — devolve o objeto, ou null se a página não é desse molde.
export function dadosListaV8(html) {
  const m = String(html || '').match(/listacatalogoData\s*=\s*'([\s\S]*?)';\s*[\r\n]/);
  if (!m) return null;
  try { return JSON.parse(m[1].replace(/\\'/g, "'")); } catch { return { erroParse: true }; }
}

/**
 * Catálogos ATIVOS (em andamento e em captação) da lista do leiloeiro. Map Num → URL do catálogo.
 * V8: cada leilão do JSON (inclusive o de parceiro, em `URL_SITE`). V7: só o que vem ANTES do título "Leilões
 * finalizados" — os finalizados ficam abaixo, na mesma página.
 */
export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  const v8 = dadosListaV8(html);
  if (v8) {
    for (const l of v8.Leiloes || []) {
      const num = String(l?.IDLEILAO || '').trim();
      if (!/^\d+$/.test(num)) continue;
      const site = String(l.URL_SITE || `${base}/`).replace(/^http:/, 'https:').replace(/\/?$/, '/');
      out.set(num, `${site}catalogo.asp?Num=${num}`);
    }
    return out;
  }
  const s = String(html || '');
  const fim = s.search(/<h2>\s*Leil(?:õ|&#245;|o)es\s+finalizados\s*<\/h2>/i);
  const ativos = fim >= 0 ? s.slice(0, fim) : s;
  for (const m of ativos.matchAll(/href=["']((?:https?:\/\/[^"'\s]+\/)?catalogo\.asp\?Num=(\d+))["']/gi)) {
    const u = /^https?:/i.test(m[1]) ? m[1].replace(/^http:/i, 'https:') : `${base}/${m[1].replace(/^\//, '')}`;
    if (!out.has(m[2])) out.set(m[2], u);
  }
  return out;
}

/**
 * Números do CATÁLOGO: { num, declarados, tipos: [{tipo, n}], tipados, alvo: [{tipo, n}], alvoN, molde }.
 * V7 lê o HTML; V8 lê o comentário que o motor anexou. null = página não é catálogo da plataforma (não é "zero").
 */
export function numerosDoCatalogo(html) {
  const s = String(html || '');
  const num = s.match(/catalogo\.asp\?Num=(\d+)/i)?.[1] || s.match(/Leil(?:ã|&#227;)o\s+(\d{4,})/i)?.[1] || null;
  let declarados = null, tipos = [], molde = null;
  const anexo = s.match(/<!--LBR-NUMEROS (\{[\s\S]*?\})-->/);
  if (anexo) {
    try {
      const j = JSON.parse(anexo[1]);
      declarados = Number(j.total);
      tipos = (j.tipos || []).filter((x) => x && x.TIPO).map((x) => ({ tipo: ent(x.TIPO), n: Number(x.TOT_PECAS) || 0 }));
      molde = 'V8';
      if (j.leilao) return contar(String(j.leilao), declarados, tipos, molde);
    } catch { return null; }
  } else {
    const fn = s.match(/class=["']find-numb["'][^>]*>\s*([\d.]+)\s*</i);
    if (!fn) return null;
    declarados = Number(fn[1].replace(/\./g, ''));
    for (const m of s.matchAll(/<label\s+for=["']tipo\d+["'][^>]*>\s*<input[^>]*>\s*([^<]+?)\s*\((\d+)\)\s*<\/label>/gi)) tipos.push({ tipo: ent(m[1]).trim(), n: Number(m[2]) });
    molde = 'V7';
  }
  return contar(num, declarados, tipos, molde);
}

function contar(num, declarados, tipos, molde) {
  if (!Number.isFinite(declarados)) return null;
  const tipados = tipos.reduce((a, x) => a + x.n, 0);
  const alvo = tipos.filter((x) => tipoEhAlvo(x.tipo));
  return { num, declarados, tipos, tipados, alvo, alvoN: alvo.reduce((a, x) => a + x.n, 0), molde };
}

// Cobertura (preenchida durante a coleta) — o coletor imprime a tabela no fim. O motor marca o tenant da vez ao buscar
// a lista dele (os tenants rodam em sequência), e cada catálogo lido entra na conta desse tenant.
export const COBERTURA_LEILOESBR = new Map();   // host do tenant → { lista, catalogos: Map num → números }
export function marcarTenant(host, lista) {
  ESTADO_LBR.tenant = host;
  COBERTURA_LEILOESBR.set(host, { lista, catalogos: new Map() });
}
export const ESTADO_LBR = { tenant: null };

/**
 * Quanto o catálogo DECLARA de imóvel/veículo — o runner compara com o que foi enumerado (sempre 0 aqui: este leitor
 * não enumera peça). Se menos de 90% das peças têm tipo, a ausência não está provada: devolve o total declarado, e o
 * runner marca a lista como cortada (a varredura de sumidos não roda sobre ela).
 */
export function totalDoEvento(html) {
  const n = numerosDoCatalogo(html);
  if (!n) return null;
  const pct = n.declarados ? n.tipados / n.declarados : 1;
  COBERTURA_LEILOESBR.get(ESTADO_LBR.tenant)?.catalogos.set(n.num || '?', { ...n, pctTipado: pct });
  if (pct < 0.9) return n.declarados;
  return n.alvoN;
}

// Peça de imóvel/veículo: este leitor não enumera (ver o cabeçalho). Map vazio é a resposta medida pelos tipos acima.
export function extrairUrlsDeLote() { return new Map(); }
export function idDaUrl(url) { return String(url || '').match(/peca\.asp\?Id=(\d+)/i)?.[1] || null; }
export function parseDetalhe() { return null; }
export function montarRow() { return null; }
export { checarQualidade };

// Tabela de completude por tenant: catálogos ativos; peças declaradas × classificadas por tipo (≥ 90% prova a ausência);
// candidatos a imóvel/veículo.
export function tabelaCoberturaLeiloesBr() {
  const linhas = ['tenant | lista | catálogos ativos | peças declaradas | com tipo | % | imóvel/veículo | ok'];
  for (const [host, c] of COBERTURA_LEILOESBR) {
    const cats = [...c.catalogos.values()];
    const dec = cats.reduce((a, x) => a + x.declarados, 0), tip = cats.reduce((a, x) => a + x.tipados, 0);
    const alvo = cats.flatMap((x) => x.alvo);
    const pct = dec ? Math.round((100 * tip) / dec) : 100;
    linhas.push(`${host} | ${c.lista} | ${cats.length} | ${dec} | ${tip} | ${pct}% | ${alvo.reduce((a, x) => a + x.n, 0)}${alvo.length ? ` [${alvo.map((a) => `${a.tipo} ${a.n}`).join(', ')}]` : ''} | ${c.lista === 'ok' && pct >= 90 && !alvo.length ? 'ok' : 'VER'}`);
  }
  return linhas.join('\n');
}
