/**
 * Peças comuns da captura de documentos de leiloeiro (21/11): usadas por
 * `captura-documentos.mjs` (fila genérica, com navegador) e `arquivar-docs-conhecidos.mjs`
 * (arquivamento direto de todos os links conhecidos). Antes viviam só no primeiro script, que
 * roda `main()` ao ser importado — por isso a extração.
 */
import { carregarPDFParse } from '../../api/_pdf-safe.js';
import { extrairMatriculaTexto, extrairPagamentoTexto, extrairCustosTexto, extrairIdentidadeTexto } from '../../api/_doc-extracao.js';
import { isolarBlocoDoLote, ehDocMultiLote } from '../../api/_edital-extrato.js';

// Limpa o "nome" do doc: tira URLs/paths e ruído, deixa só texto humano curto
// (senão o nome no banco virava a URL crua repetida — feio na tela).
export function limparNome(n) {
  const s = (n || '')
    .replace(/https?:\/\/\S+/gi, ' ')          // URLs absolutas
    .replace(/[\w.-]+\/[\w./-]+\.pdf/gi, ' ')  // paths tipo imovel.ai/.../x.pdf
    .replace(/\s+/g, ' ').trim();
  // Deduplica palavras repetidas em sequência (o ctx às vezes repete o rótulo).
  const uniq = [...new Set(s.split(' '))].join(' ');
  return uniq.slice(0, 60);
}

// Classifica o documento pelo nome/URL para gravar o tipo certo.
export function classificar(url, nome = '', fonte = '') {
  const s = `${url} ${nome}`.toLowerCase();
  if (/matric/.test(s)) return 'matricula';
  if (/edital/.test(s)) return 'edital';
  if (/laudo|avalia/.test(s)) return 'laudo';
  if (/regras|condi|como.?comprar/.test(s)) return 'regras_venda';
  // REGRA APRENDIDA (auditoria de docs 15/07/2026): BIASI publica 1 doc por-lote em
  // /file/loteanexo/ e ESSE doc É a matrícula — mas vem com nome numérico, que não bate
  // em /matric/ e caía como 'outro' (só 42% tinham matrícula). Rotula como matrícula p/
  // não regredir os 96,5% do backfill. (Extras de lotes multi-doc voltam a 'outro' no
  // chamador, então nenhum documento é descartado.)
  if (fonte === 'BIASI' && /loteanexo/i.test(url)) return 'matricula';
  return 'outro';
}

/**
 * ENRIQUECE A FICHA NO MOMENTO DA CAPTURA (pedido do dono, 06/08: "ao extrair a
 * documentação, poder informar esses detalhes na tela do imóvel").
 *
 * O PDF já está em memória aqui — ler o texto e aplicar os mesmos extratores do
 * relatório custa milissegundos e ZERO em API. Sem isto, os fatos do documento só
 * apareceriam no lote de quem gerou relatório; com isto, todo lote que passa pela
 * captura ganha a ficha enriquecida sozinho. PDF escaneado (sem camada de texto)
 * não rende nada e fica para a leitura por visão do documental — como antes.
 * Best-effort absoluto: qualquer falha aqui não pode derrubar a captura.
 *
 * `valores` = { valorMinimo, valorAvaliacao } DESTE imóvel (14/09→17/09, causa raiz do item
 * 24/31 do HANDOFF): PDF de edital judicial pode reunir DEZENAS de lotes num documento só —
 * sem isolar, `extrairIdentidadeTexto`/`extrairMatriculaTexto` liam o documento INTEIRO e
 * publicavam o bloco de OUTRO lote na ficha deste imóvel (achado real, TORRES3: endereço e
 * área de Arapiraca/AL gravados num imóvel de São Joaquim de Bicas/MG). `api/_edital-
 * extrato.js` já resolve exatamente isso para o mercadológico via `isolarBlocoDoLote` — reusa
 * aqui em vez de duplicar a lógica. Sem `valores` (chamador não os tem) ou documento de lote
 * único, `isolarBlocoDoLote` devolve `null` e o comportamento é idêntico ao de antes.
 */
export async function publicarFatosDoPdf(supabase, imovelId, buffer, tipo, valores = {}) {
  try {
    const PDFParse = await carregarPDFParse();
    const parser = new PDFParse({ data: buffer });
    let txt = '';
    try { txt = String((await parser.getText())?.text || '').slice(0, 120000); }
    finally { await parser.destroy().catch(() => {}); }
    if (txt.length < 200) return;
    const blocoLote = isolarBlocoDoLote(txt, { valorMinimo: valores.valorMinimo, valorAvaliacao: valores.valorAvaliacao });
    const txtLote = blocoLote || txt;
    // Edital de VÁRIOS lotes sem o bloco deste isolado: identidade e matrícula seriam do 1º lote do
    // documento, gravadas em todos (28/09: 27 lotes com "matrícula" de outro — ver ehDocMultiLote).
    // A matrícula PRÓPRIA do lote (tipo 'matricula') continua lida inteira.
    const confiavel = tipo === 'matricula' || !!blocoLote || !ehDocMultiLote(txt);
    const fatos = { identidade: confiavel ? extrairIdentidadeTexto(txtLote) : null };
    if (tipo === 'matricula') fatos.matricula = extrairMatriculaTexto(txtLote);
    else { fatos.custos = extrairCustosTexto(txtLote); fatos.pagamento = extrairPagamentoTexto(txtLote); fatos.matricula = confiavel ? extrairMatriculaTexto(txtLote) : null; }
    if (!Object.values(fatos).some(Boolean)) return;
    await supabase.rpc('registrar_doc_fatos', { p_imovel_id: imovelId, p_fatos: { ...fatos, em: new Date().toISOString() } });
  } catch { /* enriquecer a ficha nunca bloqueia a captura */ }
}
