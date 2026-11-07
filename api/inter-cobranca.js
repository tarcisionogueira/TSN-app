/**
 * /api/inter-cobranca — Pix e boleto pelo Banco Inter na página pública da cobrança avulsa (/cobranca/:id).
 *  POST { acao:'emitir', cobranca_id, email, pagador:{ doc, nome, endereco:{cep,logradouro,numero,complemento,bairro,cidade,uf} } }
 *  POST { acao:'consultar', cobranca_id }          → reconsulta o Inter (e dá baixa se pago)
 *  GET  ?cobranca_id=…&pdf=1                        → PDF do boleto
 * Público como o resto da página (o link vai a quem não tem conta). O valor vem SEMPRE do banco; a resposta nunca
 * traz o CPF de volta. Ver api/_inter-cobranca.js.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { emitir, atualizar, pdf, visao, sb } from './_inter-cobranca.js';

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ultimaDaCobranca(cobrancaId) {
  const r = await sb(`inter_cobrancas?cobranca_avulsa_id=eq.${cobrancaId}&codigo_solicitacao=not.is.null&order=criado_em.desc&limit=1`);
  if (!r.ok) throw new Error(`leitura HTTP ${r.status}`);
  return (await r.json())[0] || null;
}

export default async function handler(req, res) {
  const ip = getIP(req);
  const rl = await checkRateLimit(`inter-cobranca:${ip}`, 30, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  try {
    if (req.method === 'GET') {
      const id = String(req.query?.cobranca_id || '');
      if (!RE_UUID.test(id) || !req.query?.pdf) return res.status(400).json({ error: 'parâmetros inválidos' });
      const linha = await ultimaDaCobranca(id);
      const b64 = linha ? await pdf(linha) : null;
      if (!b64) return res.status(404).json({ error: 'Boleto ainda não disponível. Tente de novo em instantes.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="boleto-bidpro-${linha.seu_numero}.pdf"`);
      return res.status(200).send(Buffer.from(b64, 'base64'));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

    const b = req.body || {};
    const id = String(b.cobranca_id || '');
    if (!RE_UUID.test(id)) return res.status(400).json({ error: 'cobranca_id inválido' });

    if (b.acao === 'emitir') {
      const email = String(b.email || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
      const out = await emitir({ cobrancaId: id, pagador: b.pagador || {}, email });
      if (out.erro) return res.status(out.http || 400).json({ error: out.erro, semInter: !!out.semInter, falhaInter: !!out.falhaInter });
      return res.status(200).json({ ok: true, cobranca: visao(out.linha) });
    }

    if (b.acao === 'consultar') {
      const linha = await ultimaDaCobranca(id);
      if (!linha) return res.status(404).json({ error: 'Nenhum Pix/boleto emitido para esta cobrança.' });
      const { linha: atual } = await atualizar(linha);
      return res.status(200).json({ ok: true, cobranca: visao(atual) });
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[inter-cobranca]', e?.message || e);
    return res.status(502).json({ error: 'Não consegui falar com o banco agora. Tente em instantes.' });
  }
}
