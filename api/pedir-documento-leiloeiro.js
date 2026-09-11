/**
 * POST /api/pedir-documento-leiloeiro   (usuário logado)
 * Body: { imovel_id }
 *
 * Pedido do dono (11/09): na tela de Análise, o cliente dispara um e-mail ao leiloeiro pedindo
 * só o que está faltando/em aberto no checklist documental — não uma lista "de advogado", só o
 * que é relevante e o leiloeiro consegue responder fácil. Os itens vêm de
 * `analises_documental.result` (`faltando` = documento central ausente; `lacunas` = pontos que a
 * IA já sinalizou como diligência, em linguagem para leigo — a mesma lista que a tela de Análise
 * já mostra, não um pedido novo inventado aqui).
 *
 * NENHUMA fonte tem e-mail de leiloeiro cadastrado hoje (levantado antes de escrever isto) —
 * `leiloeiro_contato` é o cadastro manual, alimentado aos poucos pelo admin/analista. Sem
 * contato cadastrado, devolve `semContato:true` + o texto pronto, para o front oferecer
 * "copiar e mandar manualmente" em vez de fingir que enviou.
 *
 * Reply-to = o PRÓPRIO e-mail do cliente: o leiloeiro responde direto para ele, sem exigir
 * infraestrutura de ingestão de resposta (diferente do jurídico, que precisa registrar a
 * devolutiva no caso).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
}
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
  });
}
async function auditar(row) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/documental_pedidos_leiloeiro`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch { /* padrao-ok: auditoria não pode derrubar a resposta ao cliente */ }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DOC_FALTA_LABEL = { matricula: 'Matrícula do imóvel', edital: 'Edital do leilão', regras_venda: 'Regras de venda' };
// Sem lista curada de "o que é fácil o leiloeiro responder", o pedido inteiro (`lacunas`) já
// nasce curto e em linguagem simples — é o mesmo texto que a IA já escreve para o CLIENTE ler,
// não uma lista jurídica nova. O teto aqui é só para não mandar um e-mail gigante se a IA
// registrou muitas lacunas num imóvel complexo.
const MAX_LACUNAS = 8;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const imovelId = String(body?.imovel_id || '').trim();
  if (!imovelId) return json({ error: 'imovel_id obrigatório' }, 400);

  // Rate limit em DUAS chaves: por usuário (evita bombardear vários leiloeiros) e por imóvel
  // (evita reenviar o mesmo pedido repetidas vezes — o leiloeiro só precisa ver um).
  const rlUser = await checkRateLimit(`pedido-leiloeiro:user:${user.id}`, 5, 86_400_000);
  if (!rlUser.ok) return rateLimitedResponse(rlUser.resetAt);
  const rlImovel = await checkRateLimit(`pedido-leiloeiro:imovel:${imovelId}`, 1, 48 * 3_600_000);
  if (!rlImovel.ok) {
    return json({ error: 'Já foi enviado um pedido para este imóvel recentemente. Aguarde a resposta do leiloeiro antes de pedir de novo.', jaEnviado: true }, 429);
  }

  const [imovel] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=id,fonte,leiloeiro,titulo,endereco,cidade,estado,url_lote,link_edital,numero_processo`)).json();
  if (!imovel) return json({ error: 'Imóvel não encontrado' }, 404);

  // O parecer documental é lido do BANCO (resultado já gerado), nunca do que o client mandar —
  // um payload forjado no body não pode virar conteúdo de e-mail em nome do sistema.
  const [analise] = await (await sb(`analises_documental?user_id=eq.${user.id}&imovel_id=eq.${encodeURIComponent(imovelId)}&select=result&order=updated_at.desc&limit=1`)).json();
  const result = analise?.result || {};
  const faltando = [...new Set(Array.isArray(result.faltando) ? result.faltando : [])].filter(t => DOC_FALTA_LABEL[t]);
  const lacunas = (Array.isArray(result.lacunas) ? result.lacunas : []).filter(Boolean).slice(0, MAX_LACUNAS);
  if (!faltando.length && !lacunas.length) {
    return json({ error: 'Não há pendência documental registrada para este imóvel — gere a análise documental primeiro.' }, 400);
  }

  const enderecoLabel = imovel.titulo || [imovel.endereco, imovel.cidade, imovel.estado].filter(Boolean).join(', ') || `Imóvel ${imovelId}`;
  const linkLote = imovel.url_lote || imovel.link_edital || '';

  const itensTexto = [
    ...faltando.map(t => DOC_FALTA_LABEL[t]),
    ...lacunas,
  ];

  const nomeCliente = user.user_metadata?.nome || user.user_metadata?.full_name || 'Interessado(a)';
  const assunto = `Documentação do lote — ${enderecoLabel}${imovel.numero_processo ? ` (proc. ${imovel.numero_processo})` : ''}`;
  const corpoTextoPuro = `Prezados,\n\nSou interessado(a) no lote abaixo e, para concluir minha análise antes do leilão, peço a gentileza de confirmar os pontos a seguir:\n\nLote: ${enderecoLabel}${linkLote ? `\nPágina do lote: ${linkLote}` : ''}${imovel.numero_processo ? `\nProcesso: ${imovel.numero_processo}` : ''}\n\n${itensTexto.map(t => `• ${t}`).join('\n')}\n\nAgradeço desde já a atenção.\n\n${nomeCliente}`;

  // Sem e-mail cadastrado para a fonte: o front cai para "copiar texto + abrir a página do
  // lote" — não existe endereço genérico confiável para tentar (mandar para o site errado é
  // pior do que não mandar). Fica registrado como pendência de cadastro.
  const [contato] = await (await sb(`leiloeiro_contato?fonte=eq.${encodeURIComponent(imovel.fonte || '')}&select=email`)).json();
  if (!contato?.email) {
    await auditar({ imovel_id: imovelId, user_id: user.id, fonte: imovel.fonte || null, destinatario_email: null, itens_pedidos: itensTexto, status: 'sem_contato' });
    return json({ ok: false, semContato: true, texto: corpoTextoPuro, linkLote: linkLote || null });
  }

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
    <p>Prezados,</p>
    <p>Sou interessado(a) no lote abaixo e, para concluir minha análise antes do leilão, peço a gentileza de confirmar os pontos a seguir:</p>
    <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
      <tr><td style="padding:3px 10px 3px 0;color:#64748b">Lote</td><td style="padding:3px 0"><strong>${esc(enderecoLabel)}</strong></td></tr>
      ${linkLote ? `<tr><td style="padding:3px 10px 3px 0;color:#64748b">Página do lote</td><td style="padding:3px 0"><a href="${esc(linkLote)}">${esc(linkLote)}</a></td></tr>` : ''}
      ${imovel.numero_processo ? `<tr><td style="padding:3px 10px 3px 0;color:#64748b">Processo</td><td style="padding:3px 0">${esc(imovel.numero_processo)}</td></tr>` : ''}
    </table>
    <ul style="font-size:14px;line-height:1.6">${itensTexto.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <p>Agradeço desde já a atenção.</p>
    <p style="margin-top:18px">${esc(nomeCliente)}</p>
    <p style="color:#94a3b8;font-size:11px;margin-top:24px">Enviado via BidPro Brasil, a pedido do interessado no lote.</p>
  </div>`;

  const r = await enviarEmail({
    to: contato.email,
    replyTo: user.email,
    subject: assunto,
    html,
    text: corpoTextoPuro,
    meta: { tipo: 'pedido_documento_leiloeiro', userId: user.id },
  });

  await auditar({
    imovel_id: imovelId, user_id: user.id, fonte: imovel.fonte || null,
    destinatario_email: contato.email, itens_pedidos: itensTexto,
    resend_id: r.ok ? (r.id || null) : null, status: r.ok ? 'enviado' : 'falha',
  });

  if (!r.ok) return json({ error: 'Não foi possível enviar o e-mail agora: ' + (r.error || 'falha desconhecida'), texto: corpoTextoPuro, linkLote: linkLote || null }, 502);

  return json({ ok: true, destinatario: contato.email });
}
