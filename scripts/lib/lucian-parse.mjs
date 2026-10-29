/**
 * Parser puro — LUCIAN LEILÕES (lucianleiloes.com.br, Caxias do Sul/RS). Medição da junta `medicao_2810`: 63 links de
 * lote na home, plataforma própria (Bootstrap 5 + jQuery, server-rendered, sem Cloudflare). Recon 28/10:
 *
 *   • home `/`: cards de lote `categoria/<cat>/<slug-cat>/leilao/<id>/<slug>` — categoria 6 = Imóveis (5 = bens diversos,
 *     7 = veículos). Abertos e encerrados juntos (o botão do card leva a classe `encerrado`/`cancelado`).
 *   • `/agenda/leiloes/data/<AAAA-MM-DD>/1`: a agenda de cada pregão futuro (links na home) — lista lotes que a home às
 *     vezes não mostra (04/11: 3 imóveis; 01/12: 6). Vira o nível de EVENTO do motor.
 *   • lote: `<h2>Imóveis » Casa</h2>` (categoria » tipo), `<h3>- TÍTULO</h3>`, `div.resumo` (descrição), praças em
 *     `<strong>1° Leilão:</strong> dd/mm/aaaa hh:mm:ss </div> <strong>R$ X</strong>` (idem 2°), status no botão de lance
 *     (`btn-enviar-lance … encerrado`), PDFs em `/sistema/assets/imgs/editais/(edital|matricula)_<n>.pdf`, fotos em
 *     `/sistema/assets/imgs/leiloes/` (`sem-imagem.png` = sem foto). A avaliação vem no texto ("Avaliação do bem acima
 *     descrito R$ 120.000,00"); sem ela, a 1ª praça (que no judicial é a avaliação).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { normCidade } from './inferir-uf.mjs';
import MUNICIPIOS from '../../api/_municipios.js';

export const TENANTS = {
  lucian: { fonte: 'LUCIANLEILOES', leiloeiro: 'Lucian Leilões', base: 'https://lucianleiloes.com.br' },
};

const RE_LOTE = /href=["']\/?(categoria\/6\/[a-z0-9-]+\/leilao\/(\d+)\/[a-z0-9-]+)["']/gi;
export const idDaUrl = (url) => (String(url).match(/\/leilao\/(\d+)/) || [])[1] || null;

/** Home ou agenda → Map id → url, só categoria 6 (Imóveis). */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(RE_LOTE)) out.set(m[2], `${base}/${m[1]}`);
  return out;
}

/** Home → agenda de cada pregão futuro (`/agenda/leiloes/data/<data>/<n>`). */
export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href=["']\/?(agenda\/leiloes\/data\/(\d{4}-\d{2}-\d{2})\/\d+)["']/gi)) out.set(m[2], `${base}/${m[1]}`);
  return out;
}

const limpar = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "… QUADRA 1.438 FARROUPILHA/RS", "situado na cidade de Osório/RS": a sequência MAIS LONGA de até 5 palavras antes do
 *  "/UF" que existe no IBGE (o título em caixa alta traz "SITUADO NO BALNEÁRIO NOVA TRAMANDAÍ/RS"). */
export function cidadeDoTexto(texto) {
  for (const m of String(texto || '').matchAll(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .-]{1,60}?)\s*\/\s*([A-Z]{2})\b/g)) {
    const uf = m[2]; const palavras = m[1].trim().split(/\s+/);
    for (let k = Math.min(5, palavras.length); k >= 1; k--) {
      const cand = palavras.slice(-k).join(' ').replace(/^[-.\s]+/, '');
      if (Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(cand)}`)) return { cidade: titleCase(cand.toLowerCase()), estado: uf };
    }
  }
  return { cidade: null, estado: null };
}

const dataISO = (d, h = '00:00:00') => {
  const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${(h.match(/\d{2}:\d{2}(?::\d{2})?/) || ['00:00'])[0].padEnd(8, ':00').slice(0, 8)}-03:00`;
};
function praca(h, n) {
  const m = h.match(new RegExp(`${n}\\s*°\\s*Leil[ãa]o:\\s*</strong>\\s*(\\d{2}/\\d{2}/\\d{4})\\s*(\\d{2}:\\d{2}(?::\\d{2})?)?[\\s\\S]{0,120}?<strong>\\s*R\\$\\s*([\\d.,]+)`, 'i'));
  return m ? { data: dataISO(m[1], m[2] || ''), valor: num(m[3]) } : null;
}

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const titulo = limpar((h.match(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<!--\s*T[íi]tulo/i) || h.match(/<\/h2>\s*(?:<!--[^>]*-->\s*)?<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]).replace(/^[-–\s]+/, '');
  if (!titulo) return null;
  const cat = limpar((h.match(/<h2[^>]*class="pb-4"[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
  const resumo = limpar((h.match(/<div class="resumo">([\s\S]*?)<\/div>\s*(?:<div|<\/div>|<h)/i) || [])[1]);
  const obs = limpar((h.match(/Observa[çc][õo]es\s*<\/[^>]+>([\s\S]{0,3000}?)(?:Entre em contato|<form)/i) || [])[1]);
  const descricao = [resumo, obs && `Observações: ${obs}`].filter(Boolean).join(' ');
  const textoTodo = `${titulo} ${descricao}`;
  let p1 = praca(h, 1), p2 = praca(h, 2);
  // 2º TEMPLATE (pregão com "Lote 01…16", 28/10: ids 820–840): sem o bloco de praças — as datas só nos inputs ocultos
  // `data_primeiro_leilao`/`data_segundo_leilao` ("2026-11-11 10:30:00"; iguais = praça única) e os valores escritos nas
  // Observações ("VALOR DE AVALIAÇÃO: R$ …", "LANCE MÍNIMO: R$ …").
  if (!p1) {
    const oculto = (n) => (h.match(new RegExp(`name="data_${n}_leilao"\\s+value="(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}(?::\\d{2})?)"`, 'i')) || h.match(new RegExp(`id="data-${n}-leilao-\\d+"\\s+name="data_${n}_leilao"\\s+value="(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}:\\d{2}(?::\\d{2})?)"`, 'i')));
    const iso = (m) => (m ? `${m[1]}T${m[2].padEnd(8, ':00').slice(0, 8)}-03:00` : null);
    const o1 = iso(oculto('primeiro')), o2 = iso(oculto('segundo'));
    const minimo = num((textoTodo.match(/LANCE\s+M[ÍI]NIMO[^R$]{0,40}R\$\s*([\d.]+,\d{2})/i) || [])[1]);
    const minimo2 = num((textoTodo.match(/(?:2[ºo°]|SEGUNDO)\s+LEIL[ÃA]O[^R$]{0,80}R\$\s*([\d.]+,\d{2})/i) || [])[1]);
    if (o1) p1 = { data: o1, valor: minimo };
    if (o2 && o2 !== o1) p2 = { data: o2, valor: minimo2 || 0 };
  }
  const aval = num((textoTodo.match(/Avalia[çc][ãa]o[^R$]{0,80}R\$\s*([\d.]+,\d{2})/i) || [])[1]) || p1?.valor || 0;
  if (p1 && !p1.valor) p1.valor = aval;
  let d1 = p1?.data || null, v1 = p1?.valor || 0, d2 = p2?.data || null, v2 = p2?.valor || 0;
  // Entre as praças: vale a 2ª (lance de agora).
  if (d1 && d2 && Date.parse(d1) < agora && Date.parse(d2) >= agora) { d1 = d2; v1 = v2 || v1; d2 = null; v2 = 0; }
  const botao = (h.match(/class="btn btn-enviar-lance[^"]*"[^>]*>([^<]*)</i) || h.match(/btn-enviar-lance-\d+[^"]*"/i) || [''])[0];
  const fechado = /encerrad|cancelad|suspens|arrematad|vendid|retirad/i.test(botao);
  const fim = d2 || d1;
  const pdf = (re) => { const m = h.match(re); return m ? new URL(m[1], url).href : null; };
  const edital = pdf(/href="([^"]*\/editais\/edital_[^"]+\.pdf)"/i);
  const matricula = pdf(/href="([^"]*\/editais\/matricula_[^"]+\.pdf)"/i);
  const foto = [...h.matchAll(/(?:src|href|data-src)="([^"]*\/sistema\/assets\/imgs\/leiloes\/[^"]+\.(?:jpe?g|png|webp|jfif))"/gi)]
    .map((m) => m[1]).find((u) => !/sem-imagem/i.test(u));
  const { cidade, estado } = cidadeDoTexto(titulo).cidade ? cidadeDoTexto(titulo) : cidadeDoTexto(descricao);
  const judicial = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|art\.?\s*889\s+do\s+CPC|hasta|ju[ií]z[oa]?\b/i.test(`${h.match(/Regulamento do Leil[ãa]o[\s\S]{0,4000}/i)?.[0] || ''} ${edital || ''} ${descricao}`);
  return {
    // `<h2>Imóveis <i class="fa-angles-right"></i> Casa</h2>`: o "»" é ícone — sobra "Imóveis Casa", e o tipo é o resto.
    titulo: `${cat.replace(/^Im[óo]veis\s*/i, '').trim() || 'Imóvel'} - ${titleCase(titulo.toLowerCase()).replace(/\/([a-z]{2})\b/i, (_, uf) => `/${uf.toUpperCase()}`)}`.slice(0, 200),
    cidade, estado,
    valor_avaliacao: aval, valor_minimo: v1, valor_minimo_2: v2 && v2 !== v1 ? v2 : null,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(textoTodo) || 0,
    descricao: descricao ? descricao.slice(0, 8000) : null,
    data_leilao: d1, data_leilao_2: d2,
    link_foto: foto ? new URL(foto, url).href : null,
    link_edital: edital || url,
    link_matricula: matricula,
    anexos: [edital && { tipo: 'edital', nome: 'Edital', url: edital }, matricula && { tipo: 'matricula', nome: 'Matrícula', url: matricula }].filter(Boolean),
    // "imóvel este matriculado no CRI de Farroupilha sob nº 25.560" — forma deste leiloeiro, fora do helper comum.
    numero_matricula: numeroMatriculaDoTexto(descricao)
      || (descricao.match(/matriculad[oa][^.;]{0,80}?sob\s+(?:o\s+)?n[º°o.]*\s*(\d{1,3}(?:\.\d{3})+|\d{3,7})/i)?.[1] || '').replace(/\./g, '') || null,
    naoImovel: !!cat && !/im[óo]ve/i.test(cat),
    encerrado: fechado || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  valor_minimo_2: det.valor_minimo_2 || null,
});
export { checarQualidade };
