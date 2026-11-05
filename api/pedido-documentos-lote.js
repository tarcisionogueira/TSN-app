/**
 * POST /api/pedido-documentos-lote   (usuário logado)
 * Body: { imovel_id, faltando? }
 *
 * POR QUE EXISTE (04/11): o pedido automático ao leiloeiro (api/_pedido-leiloeiro-auto.js) só
 * rodava dentro do api/gerar-documental.js — mas a tela de Análise faz uma PRÉ-CHECAGEM e, quando
 * falta a matrícula num leiloeiro que não é a Caixa (o caso mais comum), mostra "anexe" SEM chamar
 * o servidor, para não gastar a análise. Resultado: o pedido automático quase nunca rodava (havia
 * 1 pedido no banco inteiro) e o chamado de documentos, que nasce dele, também não.
 *
 * Aqui a tela avisa o servidor que parou por falta de documento, sem gerar análise e sem IA. Valem
 * as MESMAS travas do automático: 1 pedido por lote a cada 7 dias (qualquer cliente), 3 e-mails por
 * semana por endereço do leiloeiro, quem não responde vai para a equipe, leilão em < 48 h não pede,
 * Caixa e leilão encerrado ficam de fora. Sem contato / e-mail que falhou → chamado no Atendimento.
 *
 * O que falta é decidido AQUI, pelos selos do lote (`tem_matricula_doc`/`tem_edital_doc`), não pela
 * lista que o navegador mandou — senão um clique de DevTools pediria ao leiloeiro o que já temos.
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { pedirDocumentosAoLeiloeiro, fraseDoPedido } from './_pedido-leiloeiro-auto.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN   = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const imovelId = String(body?.imovel_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(imovelId)) return json({ error: 'imovel_id inválido' }, 400);

  // Teto por PESSOA (o teto por lote e por leiloeiro é do helper): abrir 30 lotes sem matrícula
  // num dia é uso normal de quem pesquisa; mais que isso é varredura.
  const rl = await checkRateLimit(`pedido-documentos-lote:${user.id}`, 30, 86_400_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const r = await fetch(`${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${imovelId}&select=id,fonte,tem_matricula_doc,tem_edital_doc,modalidade&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) return json({ error: `Não consegui ler o lote (HTTP ${r.status}).` }, 502);
  const [imovel] = await r.json();
  if (!imovel) return json({ error: 'Lote não encontrado' }, 404);
  // MATRÍCULA PARA O MERCADOLÓGICO (dono, 04/11: "bloquear sem matrícula"): a tela de Análise pergunta
  // aqui antes de gerar o 1º relatório. `matriculaOk` segue a mesma régua do servidor de geração
  // (api/gerar-analise.js · matriculaDisponivel): selo do lote ou Caixa (matrícula baixada sozinha).
  const matriculaOk = !!imovel.tem_matricula_doc || /caixa|cef/i.test(String(imovel.fonte || ''));

  // Pede só o que o SERVIDOR e a TELA concordam que falta. O servidor impede pedir o que já temos;
  // a tela evita pedir o edital quando o lote tem um regulamento anexado (ela aceita `regras` no
  // lugar do edital, e o selo `tem_edital_doc` não).
  const daTela = new Set(Array.isArray(body?.faltando) ? body.faltando.map(String) : ['matricula', 'edital', 'regras_venda']);
  const vendaDireta = /venda_(direta|online)/i.test(String(imovel.modalidade || ''));
  const faltando = [
    !imovel.tem_matricula_doc ? 'matricula' : null,
    !imovel.tem_edital_doc ? (vendaDireta ? 'regras_venda' : 'edital') : null,
  ].filter(t => t && (daTela.has(t) || (t !== 'matricula' && (daTela.has('edital') || daTela.has('regras_venda')))));
  if (!faltando.length || (matriculaOk && faltando.every(t => t === 'matricula'))) {
    return json({ ok: true, status: 'nada_a_pedir', frase: '', matriculaOk });
  }

  const p = await pedirDocumentosAoLeiloeiro({ imovelId, userId: user.id, faltando });
  if (p.status === 'erro' || p.status === 'falha') console.error('[pedido-documentos-lote]', p.status, p.erro);
  // Sem análise documental gravada não há o que regenerar sozinho: a frase não promete isso.
  // Pedido que falhou NÃO muda a resposta sobre a matrícula: ela continua faltando.
  return json({ ok: p.status !== 'erro', status: p.status, frase: fraseDoPedido(p, { semAnalise: true }), matriculaOk }, p.status === 'erro' ? 502 : 200);
}
