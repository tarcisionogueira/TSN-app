/**
 * PARSER plataforma LABASOFT (PHP, "desenvolvido por www.labasoft.com.br") — pendência 356, 25/10.
 * Tenants (RJ): Schulmann Leilões (Leonardo Schulmann), Karla Pepe e Leilões Braga (Fernando Moreira Braga).
 * HTML estático, sem Cloudflare, dois níveis:
 *   home / categorias (`thumbs.php?tipo=…` no Schulmann, `index.php?tipo=…` na Karla e no Braga) → `detalhe.php?id=<N>`
 *   detalhe → <h1 class="… labasoft_h1">TÍTULO - Eletrônico|Online - Judicial|Extrajudicial</h1>
 *             <div class="detalhe_1_data"> … Término: dd/mm/aaaa hh:mm … A partir de R$ X </div> (e detalhe_2_data)
 *             fotos `upload/leilao/<id>_P.jpg`; texto do bem na coluna `texto` (Karla/Braga) ou o EDITAL inteiro
 *             inline em <div id="edital"> (Schulmann); edital em PDF `/upload/edital/<id>_edital.pdf` (Karla/Braga).
 * Praça riscada (<strike>) = vencida; "Leilão Online Finalizado" = encerrado. A avaliação só existe no texto.
 * Os dois layouts (Schulmann × Karla/Braga) diferem no miolo, não nos marcadores acima — um parser só.
 * O Braga hoje só tem lote de teste da própria Labasoft ("Labasoft testando", processo 123456789): fica fora.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, montarRowDom, cidadeNestaCidade } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2 } from '../../api/_texto-imovel.js';
import { normCidade } from './inferir-uf.mjs';
import { tipoDoTexto, tituloDe, matriculaDe, cidadeComAcento, ehTeste } from './leiloar-parse.mjs';
import MUNICIPIOS from '../../api/_municipios.js';

// `uf`: estado do leiloeiro — só para conferir no IBGE uma cidade escrita sem UF ("situado no 3º distrito de Maricá").
export const TENANTS = {
  schulmann: { fonte: 'SCHULMANN', leiloeiro: 'Leonardo Schulmann (JUCERJA 116)', base: 'https://www.schulmannleiloes.com.br', uf: 'RJ' },
  karlapepe: { fonte: 'KARLAPEPE', leiloeiro: 'Karla Ludmila Pepe Aguiar (JUCERJA 159)', base: 'https://www.karlapepe.lel.br', uf: 'RJ' },
  braga: { fonte: 'LEILOESBRAGA', leiloeiro: 'Fernando Moreira Braga (JUCERJA 74)', base: 'https://www.leiloesbraga.lel.br', uf: 'RJ' },
};

const limpar = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const existe = (uf, nome) => !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(nome)}`);
const host = (u) => new URL(u).host.replace(/^www\./, '');

// Categorias de imóvel (veículo fica fora; "agora" é a própria home).
const CATEGORIA_FORA = /ve[íi]cul|agora/i;
export function extrairUrlsDeEvento(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']\/?((?:thumbs|index)\.php\?tipo=([a-z-]+))["']/gi)) {
    if (CATEGORIA_FORA.test(m[2]) || urls.has(m[2])) continue;
    urls.set(m[2], new URL(`/${m[1]}`, base).href);
  }
  return urls;
}
// `detalhe.php?id=<N>&imovel=<slug>` → `${base}/detalhe.php?id=<N>` (o slug é opcional; o href às vezes vem com o
// domínio sem www — a URL canônica é a do tenant).
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']((?:https?:\/\/[^/"']+)?\/?detalhe\.php\?id=(\d+)[^"']*)["']/gi)) {
    if (/^https?:/i.test(m[1]) && host(m[1]) !== host(base)) continue;
    if (!urls.has(m[2])) urls.set(m[2], `${base}/detalhe.php?id=${m[2]}`);
  }
  return urls;
}
export const idDaUrl = (url) => (String(url).match(/detalhe\.php\?id=(\d+)/) || [])[1] || null;

const dataHora = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(20\d{2})\s*(\d{2}):(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00` : null;
};

// Praças: cada bloco `detalhe_N_data` → { fim, valor, riscada }.
function pracas(h) {
  const out = [];
  for (const m of h.matchAll(/<div class="detalhe_(\d)_data"[^>]*>([\s\S]*?)(?=<div class="detalhe_\d_data"|<br class="limpa"|<div class="botao_salvar"|<div id="box_lances"|<\/section>)/gi)) {
    const t = limpar(m[2]);
    const fim = dataHora((t.match(/T[ée]rmino:\s*([\d/]+\s*\d{2}:\d{2})/i) || [])[1]);
    const valor = plaus(num((t.match(/A partir de\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
    if (fim || valor) out.push({ n: Number(m[1]), fim, valor, riscada: /<strike>/i.test(m[2]) });
  }
  return out.sort((a, b) => a.n - b.n);
}

// Avaliação só no texto. O TOTAL rotulado ganha; depois o primeiro "avaliado/avaliação … R$" plausível (≥ R$ 10 mil:
// custas e incrementos também têm "R$").
function avaliacaoDoTexto(t) {
  for (const re of [/(?:valor\s+da\s+avalia[çc][ãa]o(?:\s+total)?|avalia[çc][ãa]o\s+total(?:\s+do\(?s?\)?\s+bem\(?n?s?\)?)?(?:\s+foi\s+estipulada)?)[^\d]{0,80}?R\$\s*([\d.]{1,15},\d{2})/gi,
    /avalia(?:do|da|dos|das|[çc][ãa]o|[çc]ao)[^\d]{0,100}?R\$\s*([\d.]{1,15},\d{2})/gi]) {
    for (const m of String(t || '').matchAll(re)) {
      const v = num(m[1]);
      if (v >= 10_000 && v <= 500_000_000) return v;
    }
  }
  return 0;
}

// Cidade do bem, sempre conferida no IBGE (UF do texto ou, sem ela, a do leiloeiro):
//   1. "Cidade/UF" no título ("Casa Maricá/RJ");
//   2. "situado/localizado … (no município|na cidade|no distrito) de X" e "Cidade/UF" no texto do bem;
//   3. matrícula "nesta cidade" + cartório ("Registro de Imóveis de X");
//   4. "N° Ofício de Registro de Imóveis do Rio de Janeiro" / "RGI de X" — o cartório de registro de imóveis é o do
//      município do bem.
export function cidadeDoBem(titulo, texto, ufPadrao) {
  const cands = [];
  // Título que É a cidade ("ANGRA DOS REIS", "MACAÉ", "IMÓVEL EM ANGRA DOS REIS").
  const soCidade = String(titulo || '').replace(/^.*\b(?:em|no|na)\s+/i, '').trim();
  if (soCidade && existe(ufPadrao, soCidade)) cands.push([soCidade, ufPadrao]);
  for (const src of [titulo, texto]) {
    for (const m of String(src || '').matchAll(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?|[A-ZÀ-Ý][A-Za-zÀ-ÿ']+)){0,4})\s*[/-]\s*([A-Z]{2})\b/g)) cands.push([m[1], m[2]]);
    if (src === titulo) continue;
    for (const m of String(src || '').matchAll(/\b(?:munic[íi]pio|cidade|distrito)\s+d[eo]\s+([A-ZÀ-Ýa-zà-ÿ' ]{3,40}?)\s*(?:[/-]\s*([A-Z]{2})\b|\(([A-Z]{2})\)|[,.;:]|$)/gi)) cands.push([m[1], m[2] || m[3]]);
  }
  const nc = cidadeNestaCidade(texto);
  if (nc.cidade) cands.push([nc.cidade, nc.estado]);
  for (const m of String(texto || '').matchAll(/(?:registro\s+(?:geral\s+)?de\s+im[óo]veis|\bRGI)\s+(?:da\s+comarca\s+)?d[eoa]s?\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?|[A-ZÀ-Ý][A-Za-zÀ-ÿ']+)){0,4})/gi)) cands.push([m[1], null]);
  for (const [nome, ufTexto] of cands) {
    const uf = ufTexto || ufPadrao;
    const p = String(nome).trim().split(/\s+/);
    for (let i = 0; i < p.length; i++) { // o maior sufixo que existe ("Casa Maricá" → "Maricá")
      const c = p.slice(i).join(' ');
      if (existe(uf, c)) return { cidade: cidadeComAcento(c.toUpperCase(), `${titulo} ${texto}`), estado: uf };
    }
  }
  return { cidade: null, estado: null };
}

export function parseDetalhe(html, url, { agora = new Date(), tenant } = {}) {
  const h = String(html || '');
  const cab = limpar((h.match(/<h1[^>]*labasoft_h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  if (!cab) return null; // não é a página de detalhe
  // "VENDA DIRETA - LOJA EM IPANEMA - Eletrônico - Judicial": só os segmentos FINAIS de forma/natureza são flags.
  const segs = cab.split(/\s+-\s+/);
  const flagsArr = [];
  while (segs.length > 1 && /^(?:eletr[ôo]nico|online|presencial|simult[âa]neo|judicial|extrajudicial)$/i.test(segs[segs.length - 1].trim())) flagsArr.unshift(segs.pop().trim());
  const titulo = segs.join(' - ').trim();
  const flags = flagsArr.join(' ');
  // Texto do bem: a coluna `texto` (Karla/Braga) ou o edital inline (Schulmann); sem os dois, o alt da foto.
  const textoCol = limpar((h.match(/<div class="col-sm-6 texto">([\s\S]*?)(?=<p align="center" class="erro"|<button|<p align="center" style)/i) || [])[1]);
  const edital = limpar((h.match(/<div id="edital"[^>]*>([\s\S]*?)(?=<div class="botao_salvar"|<\/article>|<div id="box_lances")/i) || [])[1]);
  const regras = limpar((h.match(/<div id="regras"[^>]*>([\s\S]*?)(?=<div class="botao_salvar"|<\/article>)/i) || [])[1]);
  const texto = [textoCol, edital].filter(Boolean).join(' ') || regras;
  if (ehTeste(titulo) || /labasoft\s+testando|processo:\s*123456789\b/i.test(`${titulo} ${texto}`)) return { encerrado: true, teste: true };

  const ps = pracas(h);
  const abertas = ps.filter((p) => !p.riscada && (!p.fim || Date.parse(p.fim) >= agora));
  const finalizado = /class="erro"[^>]*>\s*(?:<b>)?\s*Leil[ãa]o\s+(?:Online\s+)?(?:Finalizado|Encerrado|Cancelado|Suspenso)/i.test(h)
    && !abertas.length;
  const atual = abertas[0] || null;
  const proxima = abertas[1] || null;

  // Imóvel: no Schulmann o bem está no meio do edital ("IMÓVEL: Lote 1 do PA nº 43.585…"); a descrição curta é o
  // trecho a partir daí. Tipo pelo TÍTULO primeiro ("SALAS NO CENTRO", "Casa Maricá/RJ"), depois pelo bem.
  // Marcador do bem no edital: "IMÓVEL:", "BEM:", ou "IMÓVEL Sala 602 do Edifício…" / "Imóvel remanescente da Fazenda…".
  const iBem = texto.search(/\bIM[ÓO]VE(?:L|IS)\s*:|\bBEM\s*:|\bDESCRI[ÇC][ÃA]O DO\(?S?\)? BE|\bIM[ÓO]VEL\s+(?:sala|lote|apartamento|casa|loja|terreno|pr[ée]dio|remanescente|situad|localizad|rua|av)/i);
  const bem = (iBem >= 0 ? texto.slice(iBem) : texto).slice(0, 1500);
  const tipoTitulo = tipoDoTexto(titulo);
  const tipo = tipoTitulo !== 'Bem' && tipoTitulo !== 'Imóvel' ? tipoTitulo : tipoDoTexto(bem);
  // O cartório ("…Registro de Imóveis do Rio de Janeiro") às vezes só aparece fora do trecho do bem: vale o texto todo.
  const { cidade, estado } = cidadeDoBem(titulo, `${bem} ${texto.match(/(?:registro\s+(?:geral\s+)?de\s+im[óo]veis|\bRGI)\s+(?:da\s+comarca\s+)?d[eoa]s?\s+[A-ZÀ-Ý][^;,.]{2,40}/i)?.[0] || ''}`, tenant?.uf || 'RJ');
  const avaliacao = avaliacaoDoTexto(texto);
  const minimo = atual?.valor || 0;
  const venda = /venda\s+direta|iniciativa\s+particular/i.test(`${titulo} ${flags}`);

  const pdf = (h.match(/['"](\/upload\/edital\/[^'"]+\.pdf)['"]/i) || [])[1];
  const fotos = [...new Set([...h.matchAll(/href="([^"]*\/upload\/leilao\/\d+_[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => new URL(m[1], url).href))];
  const linkEdital = pdf ? new URL(pdf, url).href : null;

  return {
    titulo: tipo !== 'Bem' ? tituloDe(tipo === tipoTitulo ? titulo : bem, cidade, estado) : tituloDe(bem, cidade, estado),
    cidade, estado,
    // Nada de imóvel no título nem no começo do texto do bem ("Carro VECTRA MILENIUM") = não é imóvel.
    naoImovel: tipo === 'Bem',
    valor_avaliacao: avaliacao, // só do texto: o "A partir de" da 1ª praça do Schulmann já é 50% da avaliação
    valor_minimo: minimo,
    valor_minimo_2: proxima?.valor && proxima.valor !== minimo ? proxima.valor : null,
    modalidade: venda ? 'venda_direta' : /extrajudicial/i.test(flags) ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(bem) || 0,
    descricao: [titulo, bem].filter(Boolean).join('. ').slice(0, 8000) || null,
    data_leilao: atual?.fim || null,
    data_leilao_2: proxima?.fim || null,
    link_foto: fotos.find((f) => /_P\.\w+$/i.test(f)) || fotos[0] || null, fotos,
    link_edital: linkEdital || url,
    anexos: linkEdital ? [{ tipo: 'edital', nome: 'Edital', url: linkEdital }] : [],
    numero_matricula: matriculaDe(bem),
    encerrado: finalizado || !atual,
  };
}

export const montarRow = (url, det, tenant) => {
  const row = { ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo), valor_minimo_2: det.valor_minimo_2 || null };
  if (det.fotos?.length > 1) row.fotos = det.fotos;
  return row;
};
export { checarQualidade };
