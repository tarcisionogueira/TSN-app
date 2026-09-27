/**
 * Parser puro — MILAN LEILÕES (milanleiloes.com.br). Front Next.js (app router) atrás de
 * Cloudflare: bloqueia até o IP residencial com challenge (27/09, recon do PC do dono) — só o
 * Web Unlocker do Bright Data passa. Recon em recon_dump ids 57 (home) e 64 (evento 15573).
 *
 * ESTRUTURA (medida, não suposta):
 *   • HOME `/` — o payload RSC traz `"agenda":[{codLeilao, categorias:" Imóveis", tituloLeilao,
 *     dataInicio,…}]` e os banners linkam `/leilao/imoveis/<cod>`. `/agenda?categoria=imoveis`
 *     NÃO serve: pelo Unlocker ela devolve a página de LOGIN (bundle app/(public)/login).
 *   • EVENTO `/leilao/imoveis/<cod>` — renderizado com TODOS os lotes em cards
 *     (`<li id="card-001">`): título "Minaçu - GO. Bairro X. Terreno. Áreas Totais. Terr.
 *     2.847,44m².", "LANCE MÍNIMO: R$ 36.000,00", status ("RECEBENDO LANCES"), foto em
 *     adm.milanleiloes.com.br/Fotos/<AAAAMMDD>_<cod>/<lote>_a.JPG. Cabeçalho: "Início: 29 SET
 *     18:00 · Encerramento: 01 OUT 12:00" e o PDF do edital.
 *
 * Por isso a coleta é SÓ por evento, sem abrir lote a lote: 1 requisição paga por evento em vez
 * de 1 por lote (evento 15573: 1 contra 16). O card já tem tudo que o acervo exige.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  milan: { fonte: 'MILAN', leiloeiro: 'Milan Leilões', base: 'https://milanleiloes.com.br' },
};

const MESES = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const ent = s => String(s || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&quot;/g, '"');
const limpar = s => ent(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Códigos de leilão de IMÓVEIS citados na home (links + agenda do RSC). */
export function extrairEventosImoveis(html) {
  const h = String(html || '');
  const cods = new Set();
  for (const m of h.matchAll(/\/leilao\/imoveis\/(\d{3,7})/g)) cods.add(m[1]);
  // Agenda do RSC vem com aspas escapadas (\" ou \\\"): normaliza antes de ler.
  const rsc = h.replace(/\\+"/g, '"');
  for (const m of rsc.matchAll(/"codLeilao":(\d{3,7})[^{}]*?"categorias":"([^"]*)"/g)) {
    if (/im[óo]ve/i.test(m[2])) cods.add(m[1]);
  }
  return [...cods];
}

// "29 SET 18:00" → 2026-09-29. O ano não aparece: vem da pasta da foto (AAAAMMDD) quando
// houver; senão o ano corrente, e um mês que já passou há mais de 6 meses é do ano seguinte.
function dataDoCabecalho(txt, anoFoto, hoje = new Date()) {
  const m = String(txt || '').match(/(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/i);
  if (!m) return null;
  const dia = Number(m[1]), mes = MESES[m[2].toUpperCase()];
  let ano = anoFoto || hoje.getFullYear();
  if (!anoFoto && mes < hoje.getMonth() + 1 - 6) ano++;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// DESAFIO do Cloudflare: só no COMEÇO da página. O Cloudflare injeta `/cdn-cgi/challenge-platform/`
// também em página BOA (medido 27/09: posição 161.291 de 187.987 na home real, 69.526 na agenda)
// — procurar no corpo inteiro reprovou a home verdadeira duas vezes e gastou 2 créditos à toa.
// O desafio de verdade se anuncia no <title> ("Just a moment…" na posição 58). Mesma janela de
// 4.000 caracteres que motor/fetch-fonte.mjs já usa.
export const ehDesafio = h => /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(String(h || '').slice(0, 4000));

const RE_ENCERRADO = /(VENDIDO|ARREMATADO|ENCERRADO|CANCELADO|RETIRADO|SUSPENSO|SEM LICITANTE|DESERTO|PREJUDICADO)/i;

/** Evento → { cod, inicio, encerramento, edital, judicial, lotes:[{lote,url,titulo,minimo,status,foto,encerrado}] } */
export function parseEvento(html, cod, base) {
  const h = String(html || '');
  const pastaFoto = h.match(/Fotos%2F(20\d{2})(\d{2})(\d{2})_|Fotos\/(20\d{2})(\d{2})(\d{2})_/);
  const anoFoto = pastaFoto ? Number(pastaFoto[1] || pastaFoto[4]) : null;
  const inicioTxt = (h.match(/<span>In[íi]cio:<\/span>\s*([^<]{3,30})</) || [])[1];
  const fimTxt = (h.match(/<span>Encerramento:<\/span>\s*([^<]{3,30})</) || [])[1];
  const edital = (h.match(/href="(https?:\/\/[^"]+\.pdf)"/i) || [])[1] || null;
  // Há 2 <h1>: o do site ("Milan Leilões") e o do evento ("Leilão de Imóveis"). O do evento é o
  // último ANTES do "Início:" do cabeçalho.
  const iIni = h.search(/<span>In[íi]cio:<\/span>/);
  const h1s = [...(iIni > 0 ? h.slice(0, iIni) : h).matchAll(/<h1>([\s\S]*?)<\/h1>/g)];
  const tituloEvento = limpar(h1s.length ? h1s[h1s.length - 1][1] : '');

  const lotes = [];
  for (const bloco of h.split(/<li id="card-/).slice(1)) {
    const lote = (bloco.match(/^(\d{1,4})"/) || [])[1];
    const href = (bloco.match(/href="(\/leilao\/\d+\/lote\/\d+)"/) || [])[1];
    if (!lote || !href) continue;
    const titulo = limpar((bloco.match(/id="card_lote_tituloGrande[^"]*">([\s\S]*?)<\/p>/) || [])[1]);
    const minimo = plaus(num((bloco.match(/LANCE M[ÍI]NIMO:<\/span>\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
    const status = limpar((bloco.match(/id="estado_lote_tag_estadoLote[^"]*"[^>]*>(?:<div[^>]*><\/div>)?([^<]{3,40})</) || [])[1]);
    const fotoEnc = (bloco.match(/url=(https%3A%2F%2Fadm\.milanleiloes\.com\.br%2FFotos%2F[^&"]+)/) || [])[1];
    const foto = fotoEnc ? decodeURIComponent(fotoEnc) : ((bloco.match(/https:\/\/adm\.milanleiloes\.com\.br\/Fotos\/[^"'&\s]+/) || [])[0] || null);
    lotes.push({ lote, url: new URL(href, base).href, titulo, minimo, status, foto, encerrado: RE_ENCERRADO.test(status),
      // Card sem "LANCE MÍNIMO" (27/09: 41 de 69 lotes, eventos 15582/15507/15379/15605) — guarda o
      // HTML enxuto para o coletor gravar uma amostra e o rótulo real ser lido, não chutado.
      htmlSemValor: minimo ? null : bloco.slice(0, 6000).replace(/ (srcset|style|sizes|decoding|data-nimg|class)="[^"]*"/g, '') });
  }
  return {
    cod: String(cod), tituloEvento,
    inicio: dataDoCabecalho(inicioTxt, anoFoto), encerramento: dataDoCabecalho(fimTxt, anoFoto),
    edital, judicial: /judicial/i.test(tituloEvento) && !/extrajudicial/i.test(tituloEvento), lotes,
  };
}

// "Minaçu - GO. Bairro Morada do Sol 1. Terreno. Áreas Totais. Terr. 2.847,44m²."
// "Curitiba – PR. Bairro Camponesa. Casa. …" (travessão) · "Porto Alegre - RS. … Apto. Área Priv. 63,47m²"
function cidadeUfTipo(titulo) {
  const m = String(titulo || '').match(/^\s*([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .]{1,60}?)\s*[-–—]\s*([A-Z]{2})\b/);
  const cidade = m ? titleCase(m[1].trim()) : null, estado = m ? m[2] : null;
  // Tipo = a PALAVRA-CHAVE do trecho, não o trecho inteiro: "Fazenda São Jorge" virava título
  // "Fazenda São Jorge - Bambui/MG" (dry-run 27/09). O nome próprio fica na descrição.
  const TIPOS = [['apto', 'Apartamento'], ['apartamento', 'Apartamento'], ['casa', 'Casa'], ['sobrado', 'Sobrado'],
    ['terreno', 'Terreno'], ['sala', 'Sala Comercial'], ['loja', 'Loja'], ['galp[ãa]o', 'Galpão'], ['pr[ée]dio', 'Prédio'],
    ['fazenda', 'Fazenda'], ['s[íi]tio', 'Sítio'], ['ch[áa]cara', 'Chácara'], ['gleba', 'Gleba'], ['lote', 'Lote'],
    ['box', 'Box'], ['vaga', 'Vaga de Garagem'], ['conjunto', 'Conjunto Comercial']];
  const partes = String(titulo || '').split(/\.\s+/).map(p => p.trim());
  let tipo = 'Imóvel';
  for (const p of partes) {
    const t = TIPOS.find(([re]) => new RegExp(`^${re}\\b`, 'i').test(p));
    if (t) { tipo = t[1]; break; }
  }
  return { cidade, estado, tipo };
}

// "Terr. 21,88ha" (rural) — extrairArea só lê m². 1 ha = 10.000 m².
function areaHectares(titulo) {
  const m = String(titulo || '').match(/([\d.]+(?:,\d+)?)\s*ha\b/i);
  return m ? Math.round(num(m[1]) * 10000 * 100) / 100 : 0;
}

export function montarRow(ev, card, tenant) {
  const { cidade, estado, tipo } = cidadeUfTipo(card.titulo);
  const det = {
    titulo: cidade ? `${tipo} - ${cidade}/${estado}` : tipo,
    cidade, estado,
    valor_avaliacao: 0, valor_minimo: card.minimo || 0,
    modalidade: ev.judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(card.titulo, '') || areaHectares(card.titulo),
    descricao: card.titulo || null,
    data_leilao: ev.inicio,
    link_edital: ev.edital, anexos: ev.edital ? [{ tipo: 'edital', nome: 'Edital do leilão', url: ev.edital }] : [],
    link_foto: card.foto,
  };
  return montarRowDom(card.url, det, tenant, `${ev.cod}_${card.lote}`, inferirTipo);
}

export { checarQualidade };
