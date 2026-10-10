/**
 * Parser puro — família "Sua Plataforma de Leilão" (Degrau Publicidade), tema MGL (10/10).
 * Sites: fernandoleiloeiro.com.br, jonasleiloeiro.com.br, lucasleiloeiro.com.br (família
 * "Antunes Moreira", MG). Atrás de Cloudflare: 403 ao runner, ao Web Unlocker e ao ISP (07-16/09).
 * Pelo Firecrawl (lib/motor/fetch-firecrawl.mjs) passam com HTTP 200 — MAS a página é montada
 * por JS (trimpath): sem `waitFor` o HTML vem com `${ValorMinimoLance...}` cru no lugar do valor.
 * Com espera de ~7 s cada campo sai numa classe própria, que é o que este parser lê:
 *   Praca{1,2,3}DataHoraEncerramento · ValorMinimoLance{Primeira,Segunda,Terceira}Praca
 *   ValorAvaliacao · BoxLanceValor (lance inicial da praça corrente)
 * Catálogo: /busca/#Engine=Start&ID_Categoria=2 — os ~25 lotes abertos numa página só (a
 * "página 2" pelo hash devolve a mesma lista, medido em 10/10). Lote: /lote/<slug>/<id>/.
 * O catálogo mistura veículos, ônibus e bens diversos: o slug descarta ANTES de abrir o lote
 * (cada abertura custa 1 crédito).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, anexosDeHtml, fotoDeHtml, montarRowDom, cidadeUFBare } from './dom-parse-util.mjs';

export const TENANTS = {
  fernando: { fonte: 'FERNANDOLEILOEIRO', leiloeiro: 'Fernando Leiloeiro', base: 'https://www.fernandoleiloeiro.com.br' },
  jonas: { fonte: 'JONASLEILOEIRO', leiloeiro: 'Jonas Leiloeiro', base: 'https://www.jonasleiloeiro.com.br' },
  lucas: { fonte: 'LUCASLEILOEIRO', leiloeiro: 'Lucas Leiloeiro', base: 'https://www.lucasleiloeiro.com.br' },
  // 10/10: mesma plataforma Degrau, achada no radar de editais (Cloudflare 400 ao runner). SP capital.
  viva: { fonte: 'VIVALEILOES', leiloeiro: 'Viva Leilões', base: 'https://www.vivaleiloes.com.br',
    // A busca por ID_Categoria=2 volta vazia aqui (o id da categoria é outro); a home lista os lotes abertos.
    catalogo: '/' },
};

// Slug de lote que NÃO é imóvel (medido nos 3 catálogos em 10/10). Prefeitura = frota/sucata.
// `comprei-`: a vitrine do leiloeiro REDIRECIONA para comprei.pgfn.gov.br (venda direta da PGFN,
// medido no Jonas em 10/10 — 5 de 5 lotes) — não é lote do leiloeiro, já entra pela GLOBOLEILOES
// (128 ativos), e abrir cada um custava 1 crédito para o parser devolver "sem detalhe".
const RE_SLUG_NAO_IMOVEL = /ve[ií]culo|onibus|caminhao|carro|moto|maquin|trator|sucata|bens-diversos|mobiliario|equipamento|prefeitura-municipal|cisaje|^comprei-/i;

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']((?:https?:\/\/[^"'/]+)?\/lote\/([^"'/]+)\/(\d+)\/?)["']/gi)) {
    if (RE_SLUG_NAO_IMOVEL.test(decodeURIComponent(m[2]))) continue;
    try { urls.set(m[3], new URL(m[1], base).href); } catch { /* href malformado: ignora o link */ }
  }
  return urls;
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/[^/]+\/(\d+)/) || [])[1] || null;

const porClasse = (html, cls) => {
  const m = String(html || '').match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*>\\s*([^<]*)<`, 'i'));
  const v = (m?.[1] || '').trim();
  return v && !v.includes('${') ? v : null;   // template não preenchido = página sem render
};
// "11/11/2026 - 10:15" → ISO com fuso de Brasília
export function dataPraca(txt) {
  const m = String(txt || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*-\s*(\d{2}):(\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-03:00` : null;
}

export function parseDetalhe(html, url, agora = new Date()) {
  const txt = textoDe(html);
  const ORD = ['Primeira', 'Segunda', 'Terceira'];
  const pracas = [1, 2, 3].map((n) => ({
    fim: dataPraca(porClasse(html, `Praca${n}DataHoraEncerramento`)),
    valor: plaus(num(porClasse(html, `ValorMinimoLance${ORD[n - 1]}Praca`))),
  })).filter((p) => p.fim || p.valor);
  const avaliacao = plaus(num(porClasse(html, 'ValorAvaliacao')));
  // Página sem render: a AVALIAÇÃO vem do servidor, mas praças e lance só depois do JS. Sem os
  // valores das praças devolve null — senão a avaliação viraria o "lance" (medido em 10/10: lance
  // real R$ 56.473 na 3ª praça, e o fallback gravaria R$ 94.122). Plausível e errado = forma nº 10.
  if (!pracas.some((p) => p.valor)) return null;

  // Praça corrente = a 1ª que ainda não fechou; o lance inicial publicado é o dela.
  const abertas = pracas.filter((p) => p.fim && new Date(p.fim) > agora);
  const corrente = abertas[0] || pracas[pracas.length - 1] || {};
  const lanceInicial = plaus(num(porClasse(html, 'BoxLanceValor')));
  const minimo = lanceInicial || corrente.valor || avaliacao;
  const ultima = pracas[pracas.length - 1] || {};

  const tituloBruto = (String(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
  // "… . Casas em Leilão" (MG) e "… Apartamentos em Leilão" (Viva, sem ponto): sufixo de SEO, não é título.
  const titulo = tituloBruto.split(/\s*\|\s*/)[0].replace(/\.?\s*[A-ZÀ-Úa-zà-ú]+ em leil[ãa]o\s*$/i, '').trim() || null;
  const tUF = (titulo || '').match(/^([A-ZÀ-Ú][A-ZÀ-Ú .'-]+)\/([A-Z]{2})\b/);
  // Viva (10/10): o título não traz UF e o texto solto dava "Piqueri São Paulo" (bairro + cidade do
  // breadcrumb). A linha "Endereço: …, Jardim Íris, São Paulo/SP, CEP …" é a fonte certa; Comarca, a reserva.
  const cuDe = (re) => { const m = txt.match(re); return m ? { cidade: titleCase(m[1].trim()), estado: m[2] } : null; };
  const { cidade, estado } = (tUF ? { cidade: titleCase(tUF[1].trim()), estado: tUF[2] } : null)
    || cuDe(/Endere[çc]o\s*:[^.]{0,250}?,\s*([A-ZÀ-Úa-zà-ú][A-Za-zÀ-ú' ]{2,40}?)\s*\/\s*([A-Z]{2})\b/)
    || cuDe(/Comarca\s*:\s*([A-ZÀ-Úa-zà-ú][A-Za-zÀ-ú' ]{2,40}?)\s*\/\s*([A-Z]{2})\b/)
    || cidadeUFBare(txt);

  const desc = (txt.match(/Informa[çc][õo]es\s+(.{40,2500}?)\s+[ÔO]nus\b/i) || [])[1] || null;
  const mat = ((desc || txt).match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);
  // "Edital do Leilão" / "Matrícula" são os rótulos dos links da seção Documentos; o link de
  // matrícula sem arquivo ("/preview/") é vazio no site e não entra.
  const linkPorRotulo = (re) => {
    for (const m of String(html).matchAll(/<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
      if (re.test(textoDe(m[2]))) { try { return new URL(m[1], url).href; } catch { return null; } }
    }
    return null;
  };
  const linkEdital = linkPorRotulo(/edital/i);
  const linkMatricula = linkPorRotulo(/matr[íi]cula/i);
  const comissao = (txt.match(/Comiss[ãa]o do Leiloeiro:\s*([\d.,]+)\s*%/i) || [])[1];

  return {
    titulo: titulo ? titleCase(titulo.toLowerCase()).replace(/\/([a-z]{2})\b/i, (_, uf) => `/${uf.toUpperCase()}`) : null,
    cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    // O rodapé diz "leilões judiciais e extrajudiciais" em toda página — o sinal é o PROCESSO/VARA.
    modalidade: /N[úu]mero do Processo|\bVara\s*:/i.test(txt) ? 'judicial' : 'extrajudicial',
    area_m2: 0,
    descricao: desc ? desc.slice(0, 4000) : null,
    data_leilao: corrente.fim || null,
    data_leilao_2: ultima.fim && ultima.fim !== corrente.fim ? ultima.fim : null,
    numero_matricula: mat,
    link_foto: fotoDeHtml(html, url),
    comissao_pct: comissao ? Number(comissao.replace(',', '.')) : null,
    ...docs,
    anexos: (docs.anexos || []).map((a) => (a.url === linkEdital ? { ...a, tipo: 'edital', nome: 'Edital' }
      : a.url === linkMatricula ? { ...a, tipo: 'matricula', nome: 'Matrícula' } : a)),
    link_edital: linkEdital || docs.link_edital || null,
    link_matricula: linkMatricula || docs.link_matricula || null,
    encerrado: !abertas.length && pracas.length > 0,
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
