/**
 * MONTENEGRO LEILÕES (Fortaleza/CE) pela API própria do leiloeiro — 1ª integração DIRETA da BidPro (11/11).
 *
 * O site fica atrás do Cloudflare; o TI deles (Paulo Dantas) passou o endpoint em 10/11:
 *   GET https://montenegroleiloes.com.br/api/leiloes/imoveis
 *   → { status:'ok', qtd, leiloes: { '0': { id, titulo, data_hora_inicio, data_hora_inicio_segundo_leilao, url,
 *        tipo_leilao, edital, arquivos_do_leilao[{descricao,url}], lotes[{ id, url, titulo, descricao(html),
 *        lance_minimo, lance_minimo_segundo_leilao, avaliacao_comitente, status_lote{identificador},
 *        imagens_lote[{url_imagem}], vistoria_imobiliaria{tamanho, latitude, longitude, subcategoria_imobiliaria{nome}} }] } } }
 * Medido em 11/11: 7 leilões, 32 lotes, todos imóveis; 29 ABERTO (os outros: CANCELADO/RETIRADO/SUSPENSO).
 *
 * A descrição de quase todo lote traz o MAPA do Google (iframe) com a coordenada do imóvel: o pino sai daqui, conferido
 * contra a UF/cidade (coordValida), sem gastar geolocalização.
 *
 * Parser PURO: recebe o JSON, devolve linhas de imoveis_leilao. Transporte e gravação em scripts/scraper-montenegro.mjs.
 */
import { cidadeUFBare, titleCase } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import { coordValida } from '../../api/_geo.js';

export const FONTE = 'MONTENEGRO';
export const LEILOEIRO = 'Montenegro Leilões';
export const API = 'https://montenegroleiloes.com.br/api/leiloes/imoveis';

const TIPO = { apartamentos: 'apartamento', casas: 'casa', terrenos: 'terreno', comerciais: 'comercial', rurais: 'rural' };
const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// "Judicial", "TJCE", "TRT7" → judicial · "Extra-Judicial" → extrajudicial · "Particular" → venda direta.
export function modalidadeDe(tipoLeilao) {
  const t = norm(tipoLeilao);
  if (/extra/.test(t)) return 'extrajudicial';
  if (/particular|venda/.test(t)) return 'venda_direta';
  return 'judicial';
}

// "2026-11-27 10:00:00" (horário de Fortaleza, sem fuso) → ISO com -03:00.
export function dataIso(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/);
  return m ? `${m[1]}T${m[2]}:00-03:00` : null;
}

// HTML da descrição → texto. O iframe do mapa vem ESCAPADO (&lt;iframe…) e decodificar antes de tirar as tags
// deixaria o "<iframe src=…>" como texto: tira o iframe nas duas formas.
export function textoDescricao(html) {
  const s = decodificarEntidades(String(html || ''))
    .replace(/<iframe[\s\S]*?(<\/iframe>|>)/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<hr\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodificarEntidades(s).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// Coordenada do mapa embutido. Street View: "!1d<lat>!2d<lng>"; mapa: "!2d<lng>!3d<lat>".
export function coordDoMapa(html) {
  const s = decodificarEntidades(String(html || ''));
  let m = s.match(/!1d(-?\d{1,2}\.\d{4,})!2d(-?\d{1,3}\.\d{4,})/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  m = s.match(/!2d(-?\d{1,3}\.\d{4,})!3d(-?\d{1,2}\.\d{4,})/);
  if (m) return { lat: Number(m[2]), lng: Number(m[1]) };
  return null;
}

export function lotesDaApi(json) {
  if (!json || json.status !== 'ok' || typeof json.leiloes !== 'object') throw new Error(`API sem lista (status ${json?.status ?? '?'})`);
  const leiloes = Object.values(json.leiloes || {});
  const rows = [];
  const resumo = { leiloes: leiloes.length, lotes: 0, abertos: 0, semLocal: 0, semValor: 0, comPino: 0 };
  for (const lei of leiloes) {
    const anexos = (lei.arquivos_do_leilao || []).filter((a) => a?.url).map((a) => ({
      tipo: /edital/i.test(a.descricao || '') ? 'edital' : 'outro', nome: String(a.descricao || 'Documento do leilão').slice(0, 120), url: a.url,
    }));
    const edital = (typeof lei.edital === 'string' && lei.edital) || lei.edital?.url || anexos.find((a) => a.tipo === 'edital')?.url || null;
    for (const lot of lei.lotes || []) {
      resumo.lotes++;
      if (String(lot?.status_lote?.identificador || '').toUpperCase() !== 'ABERTO') continue;
      resumo.abertos++;
      const titulo = String(lot.titulo || '').trim().replace(/\.$/, '');
      const descricao = textoDescricao(lot.descricao);
      let { cidade, estado } = cidadeUFBare(titulo);
      if (!cidade) ({ cidade, estado } = cidadeUFBare(descricao));
      if (!cidade || !estado) { resumo.semLocal++; continue; }
      const vm = n(lot.lance_minimo);
      if (!vm) { resumo.semValor++; continue; }
      const va = n(lot.avaliacao_comitente);
      const vist = lot.vistoria_imobiliaria || {};
      const sub = norm(vist.subcategoria_imobiliaria?.nome);
      const fotos = (lot.imagens_lote || []).map((i) => i?.url_imagem).filter(Boolean);
      const proc = (descricao.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/) || [])[0] || null;
      const mat = (descricao.match(/matr[íi]cula\s*(?:imobili[áa]ria\s*)?(?:n[º°o.]*\s*)?([\d.]{3,10})/i) || [])[1] || null;
      // Pino do mapa do leiloeiro só vale dentro do município (coordValida, 40 km): mapa de outro lote não entra.
      const c = coordDoMapa(lot.descricao) || (n(vist.latitude) || Number(vist.latitude) < 0 ? { lat: Number(vist.latitude), lng: Number(vist.longitude) } : null);
      const pino = c && coordValida(c.lat, c.lng, estado, cidade, 40) ? c : null;
      if (pino) resumo.comPino++;
      rows.push({
        fonte: FONTE, fonte_id: `montenegro_${lot.id}`,
        titulo, tipo: TIPO[sub] || 'imovel', modalidade: modalidadeDe(lei.tipo_leilao),
        cidade: titleCase(cidade), estado: String(estado).toUpperCase(),
        valor_minimo: vm, valor_avaliacao: va, valor_minimo_2: n(lot.lance_minimo_segundo_leilao) || null,
        area_m2: n(vist.tamanho),
        descricao: descricao.slice(0, 9000),
        url_lote: lot.url, link_edital: edital || lot.url,
        link_foto: fotos[0] || null, ...(fotos.length > 1 ? { fotos } : {}),
        anexos, numero_processo: proc, numero_matricula: mat ? mat.replace(/\./g, '') : null,
        leiloeiro: LEILOEIRO,
        data_leilao: dataIso(lei.data_hora_inicio), data_leilao_2: dataIso(lei.data_hora_inicio_segundo_leilao),
        ...(pino ? { latitude: pino.lat, longitude: pino.lng, geocod_nivel: 'endereco' } : {}),
        ativo: true,
        desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
        atualizado_em: new Date().toISOString(),
      });
    }
  }
  return { rows, resumo };
}
