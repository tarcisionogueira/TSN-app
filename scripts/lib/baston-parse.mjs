/**
 * Parser puro — BASTON LEILÕES (bastonleiloes.leilao.br, ASP.NET; leiloeiro Mouzar Baston Filho, TJMS/TJSP/TJDFT/TRT24).
 * Triagem 22/10 (#292). HTML pronto do servidor (grátis); o IIS responde 400 a UA de navegador e abre "pelado"
 * (o motor tenta de novo sem cabeçalho).
 *
 * ESTRUTURA (medida pelo banco em 22/10):
 *   • catálogo `/leiloes/imoveis?page=N` (20 cards por página): cada card é um LEILÃO,
 *     `<section class="leilao-card" data-url="/leilao/<vara>/<cidade>/<tribunal>/<id>">` (ou `/segundo-leilao/…`).
 *   • leilão: "Relação de Lotes" com `href=".../leilao/<id>/lote/<n>/<slug>"` (domínio www.bastonleiloes.com.br).
 *   • lote: `<h2 class="lote-title">Casa em Campo Grande/MS.</h2>`, "Lance Inicial: <b>R$ 295.192,55</b>",
 *     "Encerramento: 22/10/2026 10:00", "Encerramento 2º Leilão: …", processo em `data-processo`, anexos
 *     `a.anexos-links` ("Matrícula n° 68.871", "Avaliação atualizada"), edital `static…/edital/<uuid>.pdf` e a
 *     descrição em `.lote-descricao` (traz "VALOR DA AVALIAÇÃO … R$ …").
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, montarRowDom, cidadeUFBare, semPrefixoCidade, RE_IMG_DESCARTA } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const TENANTS = {
  baston: { fonte: 'BASTON', leiloeiro: 'Baston Leilões', base: 'https://bastonleiloes.leilao.br', catalogo: '/leiloes/imoveis' },
  // 26/10 (triagem da junta): a Baston é PLATAFORMA — o rodapé de outros leiloeiros diz "Plataforma Baston Leilões"
  // (static.bastonleiloes.com.br, mesmo /leiloes/imoveis e /leilao/<id>/lote/<n>). Medido pelo banco (pg_net) em 26/10:
  // Custódio 8 leilões de imóvel no catálogo · André Araújo 0 (catálogo responde 200 e vem vazio — entra mesmo assim).
  custodio: { fonte: 'CUSTODIO', leiloeiro: 'Custódio Leilões', base: 'https://www.custodioleiloes.com.br', catalogo: '/leiloes/imoveis' },
  andrearaujo: { fonte: 'ANDREARAUJO', leiloeiro: 'André Araújo Leilões', base: 'https://www.andrearaujoleiloes.com.br', catalogo: '/leiloes/imoveis' },
};

/** Catálogo → leilões (cada card). */
export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/data-url=["'](\/(?:segundo-)?leilao\/[^"']*?\/(\d+))["']/gi)) {
    // O catálogo mistura leilões de DEMONSTRAÇÃO ("/simulacao/simulador/", "simulador-tjdft") com os reais.
    if (/simula/i.test(m[1])) continue;
    try { out.set(m[2], new URL(m[1], base).href); } catch { /* url inválida: ignora */ }
  }
  return out;
}

/** Leilão → lotes. O link vem com o domínio .com.br; normaliza para a base (os dois servem o mesmo HTML). */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href=["'](?:https?:\/\/[^/"']+)?(\/leilao\/(\d+)\/lote\/(\d+)\/[^"']*)["']/gi)) {
    try { out.set(`${m[2]}_${m[3]}`, new URL(m[1], base).href); } catch { /* url inválida: ignora */ }
  }
  return out;
}
export const idDaUrl = (url) => { const m = String(url).match(/\/leilao\/(\d+)\/lote\/(\d+)/); return m ? `${m[1]}_${m[2]}` : null; };

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const dataBr = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function cidadeUf(...textos) {
  for (const t of textos) {
    const ms = [...String(t || '').matchAll(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .]{1,40}?)\s*\/\s*([A-Z]{2})\b/g)];
    const m = ms[0];
    if (m) return { cidade: titleCase(semPrefixoCidade(m[1].replace(/^.*\s-\s/, ''))), estado: m[2] };
  }
  return { cidade: null, estado: null };
}

export function parseDetalhe(html, url) {
  const h = String(html || '');
  const txt = decodificarEntidades(textoDe(h));
  const titulo = limpo((h.match(/<h2[^>]*class=["'][^"']*lote-title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i) || [])[1]).replace(/\.\s*$/, '').slice(0, 180) || null;
  const descricao = limpo((h.match(/class=["']lote-descricao["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]).slice(0, 4000) || null;
  // "Casa em Campo Grande/MS" — "em" antes da cidade é preposição; "Campo Grande" tem 2 palavras.
  let { cidade, estado } = cidadeUf(titulo);
  if (!cidade) ({ cidade, estado } = cidadeUf(descricao));
  if (!cidade) ({ cidade, estado } = cidadeUFBare(`${titulo || ''} ${descricao || ''}`));

  const minimo = plaus(num((txt.match(/Lance Inicial\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const avaliacao = plaus(num((String(descricao || '').match(/VALOR\s+(?:DA|DE)\s+AVALIA[ÇC][ÃA]O[^R]{0,160}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const encerra = dataBr((txt.match(/Encerramento\s*:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]);
  const encerra2 = dataBr((txt.match(/Encerramento\s+2[ºo°]\s*Leil[ãa]o\s*:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]);
  const processo = (h.match(/data-processo=["']([^"']+)["']/i) || [])[1] || null;
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;

  const anexos = [];
  const edital = (h.match(/href=["'](https?:\/\/[^"']*\/edital\/[^"']+\.pdf)["']/i) || [])[1];
  if (edital) anexos.push({ tipo: 'edital', nome: 'Edital', url: edital });
  for (const m of h.matchAll(/<a[^>]*class=["']anexos-links["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (anexos.some((a) => a.url === m[1])) continue;
    const rot = limpo(m[2]);
    const tipo = /matr[íi]cula/i.test(rot) ? 'matricula' : /edital/i.test(rot) ? 'edital' : /laudo|avalia/i.test(rot) ? 'laudo' : 'outro';
    anexos.push({ tipo, nome: rot || 'Documento', url: m[1] });
  }
  const fotos = [...new Set([...h.matchAll(/<img[^>]*(?:class=["'][^"']*foto-lote[^"']*["'][^>]*src|src)=["'](https?:\/\/static\.bastonleiloes\.com\.br\/[^"']*imagens_lote[^"']+)["']/gi)].map((m) => m[1]))]
    .filter((s) => !RE_IMG_DESCARTA.test(s));

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao || minimo, valor_minimo: minimo || avaliacao,
    modalidade: processo || /vara|tribunal|processo/i.test(txt) ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(titulo || '', descricao || ''),
    descricao, data_leilao: encerra, data_leilao_2: encerra2,
    numero_matricula: mat, numero_processo: processo, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: fotos[0] || null,
    encerrado: /Leil[ãa]o\s+(?:Encerrado|Cancelado|Suspenso)|status-encerrado|status-cancelado|status-suspenso/i.test(h),
  };
}

export const montarRow = (url, det, tenant) => ({ ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo), numero_processo: det.numero_processo || null });
export { checarQualidade };
