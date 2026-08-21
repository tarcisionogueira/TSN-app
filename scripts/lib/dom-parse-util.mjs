/**
 * Utilidades compartilhadas dos parsers `dom` (Passo 2 do motor fetch × parse) —
 * alfa / hasta / nordeste. Fonte SPA renderizada: og tags vêm vazias (shell), então o
 * TÍTULO e cidade/UF saem do SLUG da URL ("leilao-de-fazenda-em-manhumirim-mg",
 * "128-001-imovel-rural-com-46-hectares-amargosa-bahia") e os VALORES saem do texto
 * renderizado por RÓTULO ("Valor da Avaliação", "Lance Mínimo") — nunca max/min cego
 * (lição emiliomatos), porque a página renderizada também carrega o carrossel de
 * OUTROS lotes com os próprios "LANCE MÍNIMO".
 */

export const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
export const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
export const titleCase = s => String(s || '').toLowerCase().replace(/(^|\s|'|-)([a-zà-ú])/g, (_, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Do|Da|Dos|Das|E|Em|No|Na)\b/g, m => m.toLowerCase()).replace(/^\w/, c => c.toUpperCase());

// HTML renderizado → texto corrido (sem script/style), para os matches por rótulo.
export const textoDe = html => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

// 1º R$ logo após um rótulo ("Valor da Avaliação", "Lance Mínimo", "Avaliação"…).
// A PRIMEIRA ocorrência é a do lote aberto; as seguintes são carrossel/relacionados.
export function valorPorRotulo(txt, rotuloRe) {
  const re = new RegExp(rotuloRe.source + String.raw`[^R]{0,40}R\$\s*([\d.]+,\d{2})`, rotuloRe.flags.includes('i') ? 'i' : '');
  return plaus(num((txt.match(re) || [])[1]));
}

// Título legível a partir do slug: "leilao-de-fazenda-em-manhumirim-mg" →
// "Leilão de Fazenda em Manhumirim/MG" (melhor que shell sem og).
export function tituloDeSlug(slug) {
  const limpo = String(slug || '').replace(/^[\d-]+/, '').replace(/[-_]+/g, ' ').trim();
  if (!limpo) return null;
  let t = titleCase(limpo).replace(/\bLeilao\b/gi, 'Leilão').replace(/\bImovel\b/gi, 'Imóvel');
  // UF no fim do slug: " … Manhumirim Mg" → " … Manhumirim/MG".
  t = t.replace(/\s([A-Za-z]{2})$/, (m, uf) => UFS.has(uf.toUpperCase()) ? `/${uf.toUpperCase()}` : m);
  return t.slice(0, 180);
}

// Cidade/UF do fim do slug: "…-em-manhumirim-mg", "…-campo-grande-ms". Palavras compostas
// entram na cidade até um conector; melhor esforço — quem tem rótulo no DOM sobrescreve.
export function cidadeUFDeSlug(slug) {
  // `.*` GULOSO antes do conector: pega o ÚLTIMO "em/de/no…" — senão "leilao-de-fazenda-
  // em-manhumirim-mg" capturava "fazenda-em-manhumirim" como cidade (teste de mesa 21/08).
  const m = String(slug || '').match(/^.*-(?:em|de|do|da|no|na)-([a-z0-9-]+?)-([a-z]{2})\/?$/i)
    || String(slug || '').match(/([a-z-]+?)-([a-z]{2})\/?$/i);
  if (!m) return { cidade: null, estado: null };
  const uf = m[2].toUpperCase();
  if (!UFS.has(uf)) return { cidade: null, estado: null };
  return { cidade: titleCase(m[1].replace(/-/g, ' ')).slice(0, 60) || null, estado: uf };
}

const UFS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

// Estado por extenso no slug (nordeste: "…-amargosa-bahia") → sigla.
export const UF_POR_NOME = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito-federal': 'DF', 'espirito-santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato-grosso': 'MT', 'mato-grosso-do-sul': 'MS', 'minas-gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio-de-janeiro': 'RJ',
  'rio-grande-do-norte': 'RN', 'rio-grande-do-sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa-catarina': 'SC', 'sao-paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

// Linha de imoveis_leilao — mesma forma do montarRow do leilaopro-parse (o runner upserta
// por fonte_id). `id` já vem extraído pelo idDaUrl da fonte.
export function montarRowDom(url, det, tenant, id, inferirTipo) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro} ${id}`,
    tipo: inferirTipo(det.titulo || '', url),
    modalidade: det.modalidade,
    cidade: det.cidade || null, estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao || null,
    link_edital: det.link_edital || url, url_lote: url, link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula || null, link_matricula: det.link_matricula || null,
    anexos: det.anexos || [],
    leiloeiro: tenant.leiloeiro, data_leilao: det.data_leilao || null, forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// PDFs no HTML renderizado → anexos {tipo, nome, url} (mesma taxonomia do leilaopro-parse).
export function anexosDeHtml(html, urlBase) {
  const anexos = [];
  let link_edital = null, link_matricula = null;
  for (const m of String(html || '').matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)) {
    let abs; try { abs = new URL(m[1], urlBase).href; } catch { continue; }
    const low = abs.toLowerCase();
    const tipo = /edital/.test(low) ? 'edital' : /matr[íi]cula|laudo/.test(low) ? 'matricula' : 'outro';
    if (anexos.some(a => a.url === abs)) continue;
    anexos.push({ tipo, nome: tipo === 'edital' ? 'Edital' : tipo === 'matricula' ? 'Matrícula / Laudo do bem' : 'Documento', url: abs });
    if (tipo === 'edital' && !link_edital) link_edital = abs;
    if (tipo === 'matricula' && !link_matricula) link_matricula = abs;
  }
  return { anexos, link_edital, link_matricula };
}
