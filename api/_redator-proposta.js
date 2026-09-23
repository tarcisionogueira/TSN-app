/**
 * api/_redator-proposta.js — REDATOR DE PROPOSTA AO LEILOEIRO que aprende com os e-mails que o
 * próprio remetente já mandou (pedido do dono, 23/09: "veja um agente mais adequado para aprender
 * com os emails enviados para já trazer um texto mais pronto. se não houver, crie").
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Não havia agente para isso: `_mensagens-grupo-estilo.js` aprende TOM de mensagem de WhatsApp a
 * partir de edições; este segue o MESMO desenho (exemplos reais → rascunho → trava na saída),
 * aplicado ao e-mail ao leiloeiro. Os exemplos são os envios reais da pessoa (`email_caixa`,
 * pasta enviados), então o redator aprende sozinho a cada e-mail novo: estrutura, tom, o que ela
 * costuma propor (ex.: imóvel negativo com financiamento → 70% do lance mínimo; veículo sem
 * licitantes → 50% à vista) e como assina.
 *
 * TRAVAS (a garantia não é o prompt, é validar a SAÍDA — mesmo princípio do estilo de grupo):
 *  - nenhum valor em R$ que não esteja nos DADOS do lote (proposta vai em %, como o dono escreve);
 *  - o link do lote, quando existe, tem de estar no texto;
 *  - a assinatura tem de ser o nome real de quem envia;
 *  - reprovou, falhou ou faltou exemplo → `null` + motivo, e quem chama usa o texto padrão.
 * O texto SEMPRE passa pela caixa editável antes de sair: é rascunho, não envio automático.
 */
import { iaGeminiPrimary } from './_claude.js';

const CLAUDE_KEY = process.env.CLAUDE_KEY;
const MAX_EXEMPLOS = 6;   // mais recentes primeiro — o jeito de escrever de hoje pesa mais

const brl = (v) => (Number(v) > 0 ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null);

/**
 * @param {{ nome: string, exemplos: {assunto?:string, texto:string}[], lote: {
 *   tipo:'Imóvel'|'Veículo', rotulo:string, leiloeiro?:string, link?:string, cidade?:string,
 *   estado?:string, valorMinimo?:number, valorAvaliacao?:number, resultado?:string|null,
 *   modalidade?:string, dataLeilao?:string, temDocumentos?:boolean } }} p
 * @returns {Promise<{ texto: string|null, motivo: string|null, exemplos: number }>}
 */
export async function redigirProposta({ nome, exemplos, lote }) {
  const vistos = new Set();
  const exs = (Array.isArray(exemplos) ? exemplos : [])
    .map((e) => ({ assunto: String(e?.assunto || ''), texto: String(e?.texto || '').trim() }))
    .filter((e) => e.texto.length > 40 && !vistos.has(e.texto) && vistos.add(e.texto))   // reenvio idêntico não é exemplo novo
    .slice(0, MAX_EXEMPLOS);
  if (!exs.length) return { texto: null, motivo: 'sem e-mails anteriores seus para aprender o estilo', exemplos: 0 };
  if (!CLAUDE_KEY) return { texto: null, motivo: 'IA não configurada', exemplos: exs.length };

  const negativo = ['sem_lance', 'indeterminado'].includes(lote.resultado || '');
  const dados = [
    `Tipo: ${lote.tipo}`,
    `Lote: ${lote.rotulo}`,
    lote.leiloeiro ? `Leiloeiro: ${lote.leiloeiro}` : null,
    lote.cidade ? `Local: ${[lote.cidade, lote.estado].filter(Boolean).join('/')}` : null,
    brl(lote.valorMinimo) ? `Lance mínimo: ${brl(lote.valorMinimo)}` : null,
    brl(lote.valorAvaliacao) ? `Avaliação: ${brl(lote.valorAvaliacao)}` : null,
    lote.modalidade ? `Modalidade: ${lote.modalidade}` : null,
    lote.dataLeilao ? `Data do leilão: ${lote.dataLeilao}` : null,
    `Resultado do leilão: ${negativo ? 'encerrado SEM lance (leilão negativo)' : 'não apurado / em andamento'}`,
    lote.link ? `Link do lote: ${lote.link}` : null,
    lote.temDocumentos ? 'Documentos do lote vão em anexo.' : 'Não há documentos em anexo.',
  ].filter(Boolean).join('\n');

  const blocoEx = exs.map((e, i) => `--- E-mail ${i + 1}${e.assunto ? ` (assunto: ${e.assunto})` : ''} ---\n${e.texto}`).join('\n\n');
  const prompt = `Você redige e-mails de ${nome} para leiloeiros, no jeito DELE de escrever. Abaixo estão e-mails reais que ele já mandou — aprenda a estrutura, o tom, como ele formula a proposta (percentual, forma de pagamento, menção a financiamento, comissão do leiloeiro) e como ele assina:

${blocoEx}

Escreva agora o e-mail para ESTE lote, usando SOMENTE estes dados:
${dados}

Como decidir o conteúdo:
- ${negativo
    ? `O leilão foi NEGATIVO: escreva uma proposta de compra direta seguindo o padrão que ${nome} usa para ${lote.tipo === 'Veículo' ? 'veículos' : 'imóveis'} nos exemplos (mesmo percentual e condição). Se nos exemplos não houver proposta desse tipo de bem, escreva "[__]%" no lugar do percentual para ele completar.`
    : 'O leilão NÃO consta como negativo: não faça proposta de valor; peça informações/esclarecimentos sobre o lote, como nos exemplos.'}
- Se houver link do lote, inclua-o como ele faz.
- Mencione os documentos em anexo só se os dados disserem que há documentos.

REGRAS ABSOLUTAS:
- Não escreva nenhum valor em R$ que não esteja nos dados acima; proposta em percentual.
- Não invente fato sobre o lote (ocupação, dívidas, estado, prazos) que não esteja nos dados.
- Assine exatamente: ${nome}
- Responda APENAS com o corpo do e-mail, pronto para enviar — sem assunto, sem aspas, sem comentário.`;

  let saida = null;
  try {
    const r = await iaGeminiPrimary({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r?.ok) return { texto: null, motivo: `IA indisponível (HTTP ${r?.status ?? 'sem resposta'})`, exemplos: exs.length };
    const j = await r.json().catch(() => null);
    if (j?.error) return { texto: null, motivo: `IA recusou: ${String(j.error?.message || j.error).slice(0, 80)}`, exemplos: exs.length };
    saida = j?.content?.[0]?.text?.trim() || null;
  } catch (e) {
    return { texto: null, motivo: `IA falhou: ${String(e?.message || e).slice(0, 80)}`, exemplos: exs.length };
  }
  if (!saida || saida.length < 60) return { texto: null, motivo: 'IA devolveu texto vazio', exemplos: exs.length };

  // ── Trava de saída ─────────────────────────────────────────────────────────────────────
  const permitidos = [brl(lote.valorMinimo), brl(lote.valorAvaliacao)].filter(Boolean).map((v) => v.replace(/\s/g, ''));
  const valoresSaida = (saida.match(/R\$\s?[\d.,]+/g) || []).map((v) => v.replace(/\s/g, '').replace(/[.,]$/, ''));
  const inventado = valoresSaida.find((v) => !permitidos.some((p) => p.startsWith(v) || v.startsWith(p)));
  if (inventado) return { texto: null, motivo: `rascunho descartado: citou ${inventado}, que não está nos dados do lote`, exemplos: exs.length };
  if (lote.link && !saida.includes(lote.link)) return { texto: null, motivo: 'rascunho descartado: faltou o link do lote', exemplos: exs.length };
  if (!saida.includes(nome)) return { texto: null, motivo: 'rascunho descartado: assinatura diferente do remetente', exemplos: exs.length };
  return { texto: saida, motivo: null, exemplos: exs.length };
}
