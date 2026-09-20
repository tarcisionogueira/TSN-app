// TEMPORÁRIO — mede tempo real e tamanho de saída ao gerar um contrato COMPLEXO com
// max_tokens 24000 (subiu de 8000, pedido do dono: "cobrir contratos complexos, ~100 mil
// caracteres"). maxDuration é 300s (teto real deste projeto, nenhuma rota passa disso) — este
// teste confirma se o novo max_tokens completa dentro do orçamento ou se precisa recuar.
// Remove depois do teste.
export const config = { runtime: 'nodejs', maxDuration: 300 };
import { isCronAuthorized } from './_auth.js';
import { anthropicFetch } from './_claude.js';

const CLAUDE_KEY = process.env.CLAUDE_KEY;
const MODEL = process.env.CONTRATO_IA_MODEL || 'claude-haiku-4-5-20251001';

const PROMPT_COMPLEXO = `Gere um contrato de prestação de serviços de TI extremamente detalhado e complexo, cobrindo:
1. Objeto: desenvolvimento, implantação, hospedagem e suporte de uma plataforma de e-commerce multi-tenant com 15 módulos distintos (catálogo, pedidos, pagamentos, logística, CRM, BI, marketplace, assinaturas, fidelidade, marketing, atendimento, financeiro, fiscal, integrações e mobile).
2. Obrigações da CONTRATADA: liste no mínimo 25 obrigações específicas e detalhadas, uma por parágrafo.
3. Obrigações da CONTRATANTE: liste no mínimo 15 obrigações específicas.
4. SLA: tabela detalhada com 10 níveis de severidade de incidente, tempo de resposta e resolução para cada um, e multas por descumprimento.
5. Cronograma: 12 fases de implantação, cada uma com entregáveis, prazo e critério de aceite.
6. Matriz de responsabilidades (RACI) para 20 atividades.
7. Cláusulas de propriedade intelectual, confidencialidade (LGPD completa), garantia, rescisão (8 hipóteses diferentes), penalidades, foro, e um glossário técnico com 30 termos definidos.
8. Valores: tabela de 15 itens de escopo com valor individual, forma de pagamento e reajuste.
Escreva TUDO por extenso, com numeração de cláusulas e subcláusulas, sem resumir ou usar reticências — o objetivo é medir o tamanho REAL do texto gerado.`;

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }

  const t0 = Date.now();
  try {
    const r = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 24000,
        system: 'Você é um advogado especialista em contratos empresariais brasileiros. Gere contratos completos, formais e juridicamente sólidos, com base legal citada.',
        messages: [{ role: 'user', content: PROMPT_COMPLEXO }],
      }),
    }, { retries: 0, timeoutMs: 270000 });
    const elapsedMs = Date.now() - t0;
    const bruto = await r.text();
    let data; try { data = JSON.parse(bruto); } catch { data = null; }
    if (!data) { res.status(200).json({ ok: false, elapsedMs, erro: `resposta não-JSON: ${bruto.slice(0, 300)}` }); return; }
    const texto = data.content?.[0]?.text || '';
    res.status(200).json({
      ok: true, elapsedMs, elapsedS: Math.round(elapsedMs / 1000),
      stop_reason: data.stop_reason,
      output_tokens: data.usage?.output_tokens,
      texto_len: texto.length,
      amostra_final: texto.slice(-300),
    });
  } catch (e) {
    res.status(200).json({ ok: false, elapsedMs: Date.now() - t0, erro: String(e?.message || e).slice(0, 300) });
  }
}
