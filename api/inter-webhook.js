/**
 * /api/inter-webhook — aviso do Banco Inter quando uma cobrança (boleto/Pix) muda de situação.
 *
 * O corpo NÃO é prova de pagamento: qualquer um pode chamar esta URL. Daqui só sai uma lista de
 * `codigoSolicitacao`; para cada um que NÓS emitimos (inter_cobrancas), reconsultamos a API do Inter com o
 * nosso certificado e só então damos baixa (api/_inter-cobranca.js → atualizar). Código desconhecido é ignorado.
 * Responde 200 mesmo em falha parcial: o que não deu agora a varredura de 10 em 10 min refaz.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { atualizar, sb } from './_inter-cobranca.js';

const RE_COD = /^[0-9a-zA-Z-]{8,64}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const rl = await checkRateLimit(`inter-webhook:${getIP(req)}`, 60, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const itens = Array.isArray(req.body) ? req.body : [req.body || {}];
  const codigos = [...new Set(itens.map((i) => String(i?.codigoSolicitacao || i?.cobranca?.codigoSolicitacao || '')).filter((c) => RE_COD.test(c)))].slice(0, 20);
  const resultado = [];
  for (const codigo of codigos) {
    try {
      const r = await sb(`inter_cobrancas?codigo_solicitacao=eq.${encodeURIComponent(codigo)}&limit=1`);
      if (!r.ok) throw new Error(`leitura HTTP ${r.status}`);
      const [linha] = await r.json();
      if (!linha) { resultado.push({ codigo, ignorado: 'desconhecido' }); continue; }
      const { linha: atual } = await atualizar(linha);
      resultado.push({ codigo, situacao: atual?.situacao, baixa: !!atual?.baixa_aplicada_em });
    } catch (e) {
      console.error('[inter-webhook]', codigo, e?.message || e);
      resultado.push({ codigo, erro: true });
    }
  }
  return res.status(200).json({ ok: true, resultado });
}
