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

// Igual a `textoDe`, mas preserva QUEBRA DE LINHA por elemento de bloco — aproxima o
// `document.body.innerText` do navegador (o `dumpDetalhe` do recon usa innerText de verdade;
// o motor `dom` só entrega `page.content()`, HTML cru). Necessário quando o layout é
// TABELA ou linhas rotulo/valor empilhadas: `textoDe` colapsa tudo num espaço só e destrói a
// vizinhança entre rótulo e valor (ex.: JELEILOES/RIGOLON — o rótulo de uma coluna/linha some
// dentro do texto corrido de outra).
export function textoComLinhas(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/th)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

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
  const s = String(slug || '');
  // `.*` GULOSO antes do conector: pega o ÚLTIMO "em/no/na…" — senão "leilao-de-fazenda-
  // em-manhumirim-mg" capturava "fazenda-em-manhumirim" como cidade (teste de mesa 21/08).
  // "de/do/da" tentam DEPOIS, separado: nome de cidade composto em português frequentemente
  // TEM "da/do/de" dentro ("Nova América da Colina") — tentar esse grupo primeiro cortava a
  // cidade no ÚLTIMO conector interno e devolvia só o pedaço final ("Colina", JELEILOES
  // 07/09: "imovel-c-10-alq-em-nova-america-da-colina-pr" saía cidade "Colina"). "em/no/na"
  // quase nunca aparece DENTRO de um nome de cidade brasileiro — por isso vem primeiro.
  const m = s.match(/^.*-(?:em|no|na)-([a-z0-9-]+?)-([a-z]{2})\/?$/i)
    || s.match(/^.*-(?:de|do|da)-([a-z0-9-]+?)-([a-z]{2})\/?$/i)
    || s.match(/([a-z-]+?)-([a-z]{2})\/?$/i);
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
    leiloeiro: tenant.leiloeiro, data_leilao: det.data_leilao || null, data_leilao_2: det.data_leilao_2 || null, forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// Lê uma <table> HTML de verdade (via <tr>/<td|th>) e devolve as linhas como arrays de
// células já limpas de tag — útil quando o valor mora numa COLUNA cujo rótulo é o cabeçalho
// da tabela, não um rótulo imediatamente antes do valor (o que `valorPorRotulo` espera).
// Ex.: ALBERTOMACEDOLEILOES (tabela PRAÇA/ABERTURA/ENCERRAMENTO/INICIAL) e JELEILOES.
export function linhasDeTabela(html) {
  return [...String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
      td[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()));
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
