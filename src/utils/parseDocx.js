// Parsing de .docx pro editor de e-book (formato estruturado). Roda no BROWSER, sob
// demanda (import dinâmico, mesmo espírito do import dinâmico de pdfjs em
// src/utils/pdfjs.js) — só carrega quando o admin sobe um arquivo, não entra no bundle
// de ninguém que só lê e-book.
//
// STYLE MAP: mammoth já mapeia "Heading 1/2" -> h1/h2 por padrão, mas o Word em PT-BR
// nomeia o estilo como "Título 1/2" no w:name (mesmo com styleId=Heading1 internamente)
// — sem cobrir as duas grafias, um .docx feito no Word em português pode não detectar
// nenhum capítulo. Heading 3+ fica de fora de propósito: cai no mapeamento padrão do
// mammoth (também vira heading tag), mas como docxParaBlocos só marca h1/h2 como
// fronteira de capítulo, um H3 sempre vira texto comum dentro do capítulo corrente.
const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Título 1'] => h1:fresh",
  "p[style-name='Título 2'] => h2:fresh",
  "p[style-name='Titulo 1'] => h1:fresh",
  "p[style-name='Titulo 2'] => h2:fresh",
];

/**
 * Converte um arquivo .docx num array de blocos (um por parágrafo/heading, na ordem
 * do documento). `ehTitulo` marca headings nível 1/2 (candidatos a início de capítulo).
 * @param {File} file
 * @returns {Promise<{blocos: {id:number, ehTitulo:boolean, texto:string}[], avisos:string[]}>}
 */
export async function docxParaBlocos(file) {
  const mammoth = (await import('mammoth')).default;
  const arrayBuffer = await file.arrayBuffer();
  const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: STYLE_MAP });

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocos = Array.from(doc.body.children)
    .map((el, i) => {
      const tag = el.tagName.toLowerCase();
      const ehTitulo = tag === 'h1' || tag === 'h2';
      const texto = (tag === 'ul' || tag === 'ol')
        ? Array.from(el.querySelectorAll('li')).map((li) => `- ${li.textContent.trim()}`).join('\n')
        : el.textContent.trim();
      return { id: i, ehTitulo, texto };
    })
    .filter((b) => b.texto); // descarta parágrafos vazios (linhas em branco do Word)

  const avisos = (messages || [])
    .filter((m) => m.type === 'warning' || m.type === 'error')
    .map((m) => m.message);

  return { blocos, avisos };
}

/**
 * Agrupa blocos (com fronteiras já ajustadas pelo admin — flag `ehTitulo`) em seções
 * consecutivas, preservando os `id` de cada bloco (pra tela de ajuste poder mesclar/
 * dividir/renomear por id). Texto antes do primeiro título vira uma seção "Introdução"
 * com `tituloBlocoId: null` — nunca descarta conteúdo em silêncio.
 * @param {{id:number, ehTitulo:boolean, texto:string}[]} blocos
 * @returns {{tituloBlocoId:number|null, titulo:string, blocoIds:number[]}[]}
 */
export function agruparBlocos(blocos) {
  const grupos = [];
  let atual = null;
  for (const b of blocos) {
    if (b.ehTitulo) {
      if (atual) grupos.push(atual);
      atual = { tituloBlocoId: b.id, titulo: b.texto, blocoIds: [] };
    } else {
      if (!atual) atual = { tituloBlocoId: null, titulo: 'Introdução', blocoIds: [] };
      atual.blocoIds.push(b.id);
    }
  }
  if (atual) grupos.push(atual);
  return grupos;
}

/**
 * Agrupa blocos em capítulos finais, prontos pra `salvar_capitulos_ebook`.
 * @param {{id:number, ehTitulo:boolean, texto:string}[]} blocos
 * @returns {{ordem:number, titulo:string, conteudo_texto:string}[]}
 */
export function blocosParaCapitulos(blocos) {
  const porId = new Map(blocos.map((b) => [b.id, b]));
  return agruparBlocos(blocos).map((g, i) => ({
    ordem: i + 1,
    titulo: g.titulo,
    conteudo_texto: g.blocoIds.map((id) => porId.get(id).texto).join('\n\n'),
  }));
}
