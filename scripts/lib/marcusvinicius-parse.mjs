/**
 * Parser puro — MARCUS VINÍCIUS LEILÕES (marcusviniciusleiloes.com.br, Montes Claros/MG; Marcus Vinícius da Silva,
 * JUCEMG 107). Plataforma Brain at Work (PHP), server-rendered, sem anti-bot → fetch direto, grátis. Recon 04/11:
 *
 *   • Home `/`: um card por LEILÃO (`<a href="leilao/<id>/<slug>" class="lc" data-situacao="aberto|breve"
 *     data-busca="<vara> - processo: … (<o que é>)">`). Não pagina: 17 leilões em 04/11, 8 de imóvel. A maior parte é
 *     bem móvel de execução trabalhista (tear, telhas, tênis, moto, caminhão) — o filtro sai do `data-busca`.
 *   • Leilão `/leilao/<id>/<slug>`: lista os lotes (`href="item/<id>/lote-NN/<slug>"`); todos com 1 lote em 04/11.
 *   • Lote `/item/<id>/lote-NN/<slug>`: h1 = descrição completa (matrícula, CRI), `lo-leilao` = vara + título curto do
 *     leilão, "Valor inicial (1º leilão)" e "(2º leilão)", "1º leilão 19/11/2026 às 08h até 03/12/2026 às 14h", edital
 *     em `upload/files/…pdf`, status `lc-status-<x>` ("Em breve", "1º leilão aberto"). Sem valor de avaliação no site
 *     (só no edital) e sem foto nos lotes de imóvel conferidos.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://www.marcusviniciusleiloes.com.br';
export const TENANTS = {
  marcusvinicius: { fonte: 'MARCUSVINICIUS', leiloeiro: 'Marcus Vinícius Leilões', base: BASE },
};

const textoDe = (html) => decodificarEntidades(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// O que é imóvel no texto do card/lote — e o que, mesmo com "m2" ou "lote", não é ("200 m2 piso cerâmico", "lote de
// tênis"). A ordem importa: o NAO vence.
const EH_IMOVEL = /im[óo]vel|terreno|\blote\s+(?:de\s+)?terreno|[áa]rea\s+(?:urbana|rural)|fazenda|ch[áa]cara|s[íi]tio|\bcasa\b|apartamento|\bsala\b|galp[ãa]o|pr[ée]dio|hectare|\bmatr[íi]cula/i;
const NAO_IMOVEL = /\bpiso\b|telhas?\b|\btear\b|\bmesas?\b|t[êe]nis|motocicleta|caminh[ãa]o|\bve[íi]culo|gesso|drywall|elevador|m[áa]quina|equipamento/i;
export const ehImovel = (t) => EH_IMOVEL.test(String(t || '')) && !NAO_IMOVEL.test(String(t || ''));

export const idDaUrl = (url) => (String(url).match(/\/item\/(\d+)(?:[/?#]|$)/) || [])[1] || null;

/** Home → Map id do leilão → url (nível 2). Só os leilões cujo card descreve imóvel. */
export function extrairUrlsDeEvento(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/<a href="(?:https?:\/\/(?:www\.)?marcusviniciusleiloes\.com\.br\/)?leilao\/(\d+)\/([a-z0-9-]*)"[^>]*class="lc"[^>]*data-busca="([^"]*)"/gi)) {
    if (!ehImovel(`${decodificarEntidades(m[3])} ${m[2].replace(/-/g, ' ')}`)) continue;
    out.set(m[1], `${BASE}/leilao/${m[1]}/${m[2]}`);
  }
  return out;
}

/** Página do leilão → Map id do lote → url. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/(?:www\.)?marcusviniciusleiloes\.com\.br\/)?item\/(\d+)\/(lote-[a-z0-9-]+\/[a-z0-9-]*)"/gi)) out.set(m[1], `${BASE}/item/${m[1]}/${m[2]}`);
  return out;
}

const num = (s) => { const v = Number(String(s || '').replace(/[^\d,]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };
/** "03/12/2026 às 14h" (ou "14h30") → ISO em -03:00. */
const iso = (txt) => {
  const m = String(txt || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:às)?\s*(\d{1,2})h(\d{2})?)?/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:00-03:00`;
};
const FORA = /encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad|finalizad/i;

/** `<dt>1º leilão</dt><dd>19/11/2026 às 08h<br><small>até 03/12/2026 às 14h</small></dd>` → { inicio, fim }. */
function fase(h, n) {
  const m = h.match(new RegExp(`<dt>\\s*${n}º leil[ãa]o\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i'));
  if (!m) return null;
  const [ini, fim] = [m[1].split(/<small/i)[0], (m[1].match(/at[ée]\s*([^<]+)/i) || [])[1]];
  return { inicio: iso(ini), fim: iso(fim) || iso(ini) };
}

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  if (!idDaUrl(url) || !/<article class="lo"/.test(h)) return null;
  const descricaoLonga = textoDe((h.match(/<h1>([\s\S]*?)<\/h1>/i) || [])[1]);
  if (!descricaoLonga) return null;
  const blocoLeilao = (h.match(/<p class="lo-leilao">([\s\S]*?)<\/p>/i) || [])[1] || '';
  const tituloLeilao = textoDe((blocoLeilao.match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1]).replace(/[\s).]+$/, '');
  const orgao = textoDe(blocoLeilao.replace(/<a[\s\S]*$/i, '')).replace(/\s*·\s*$/, '');
  const corpo = textoDe((h.match(/<section class="lo-descricao">([\s\S]*?)(?:<div class="lo-arquivos|<\/section>)/i) || [])[1]).replace(/^Descri[çc][ãa]o\s*/i, '');
  const status = textoDe((h.match(/<span class="lc-status[^"]*">([\s\S]*?)<\/span>/i) || [])[1]);
  const v1 = num((h.match(/inicial \(1º leil[ãa]o\)<\/span><\/span>\s*<strong>R\$\s*<span class="currentBidAmount">([\d.,]+)/i) || [])[1]);
  const v2 = num((h.match(/<dt>Valor inicial \(2º leil[ãa]o\)<\/dt>\s*<dd>R\$\s*([\d.,]+)/i) || [])[1]);
  const f1 = fase(h, 1), f2 = fase(h, 2);
  const edital = (h.match(/href="(https?:\/\/[^"]+\/upload\/files\/[^"]+\.pdf)"[^>]*>[\s\S]{0,120}?Edital/i) || [])[1] || null;
  const fotos = [...new Set([...h.matchAll(/(?:src|href|data-src)="((?:https?:\/\/[^"]+\/)?upload\/img\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1]))]
    .filter((u) => !/banner|martel/i.test(u))
    .map((u) => (/^https?:/i.test(u) ? u : `${BASE}/${u}`));

  const texto = `${tituloLeilao} ${descricaoLonga}`;
  // "Ibituruna - Montes Claros - MG" / "Ubaí - MG": o cidadeDoTexto lê a forma "Cidade/UF".
  const comBarra = (t) => String(t || '').replace(/\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]{1,40}?)\s*[–-]\s*(MG|[A-Z]{2})\b/g, '$1/$2');
  const local = [cidadeDoTexto(comBarra(tituloLeilao)), cidadeDoTexto(comBarra(descricaoLonga))].find((c) => c.cidade)
    || { cidade: null, estado: null };
  const ultimaData = f2?.fim || f1?.fim || null;
  const judicial = /\bvara\b|comarca|ju[íi]zo|tribunal/i.test(orgao) || /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(corpo);
  const descricao = [descricaoLonga, corpo && corpo !== descricaoLonga && corpo, orgao && `Órgão: ${orgao}.`]
    .filter(Boolean).join('\n');
  return {
    titulo: (tituloLeilao || descricaoLonga).slice(0, 200),
    cidade: local.cidade, estado: local.estado || 'MG',
    valor_avaliacao: 0,          // não publicado no site (só no edital)
    valor_minimo: v1 || v2 || 0,
    valor_minimo_2: v2 || null,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(texto) || 0,
    descricao: descricao.slice(0, 8000) || null,
    data_leilao: f1?.fim || null,
    data_leilao_2: f2?.fim || null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: null,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : [],
    numero_matricula: numeroMatriculaDoTexto(descricaoLonga) || null,
    situacao: status || null,
    naoImovel: !ehImovel(texto),
    encerrado: FORA.test(status) || (ultimaData ? Date.parse(ultimaData) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
