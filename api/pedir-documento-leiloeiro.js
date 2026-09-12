/**
 * POST /api/pedir-documento-leiloeiro   (usuário logado)
 * Body: { imovel_id, action?: 'preview'|'enviar', texto? }
 *
 * Pedido do dono (11/09): na tela de Análise, o cliente dispara um e-mail ao leiloeiro pedindo
 * só o que está faltando/em aberto no checklist documental — não uma lista "de advogado", só o
 * que é relevante e o leiloeiro consegue responder fácil. Os itens vêm de
 * `analises_documental.result` (`faltando` = documento central ausente; `lacunas` = pontos que a
 * IA já sinalizou como diligência, em linguagem para leigo — a mesma lista que a tela de Análise
 * já mostra, não um pedido novo inventado aqui).
 *
 * DOIS PASSOS (12/09, pedido do dono): o texto pronto pelo servidor é só um RASCUNHO — quem tem
 * acesso à função pode complementar antes de mandar (ex.: pedir também o auto de arrematação
 * anterior, apontar um vício específico achado na leitura). `action='preview'` monta o texto e
 * devolve SEM enviar nem gastar rate limit; `action='enviar'` manda o texto que o CHAMADOR
 * devolveu (o editado, se houve edição) — o servidor só garante o CABEÇALHO (lote/processo/link),
 * nunca o corpo livre, que é sempre do punho de quem está pedindo.
 *
 * ACESSO (12/09, pedido do dono): só para quem PRECISA negociar com o leiloeiro em nome do
 * cliente — equipe (admin/analista/advogado/suporte) e Assessorados (o plano com acompanhamento
 * dedicado). Explorador/Investidor Pro/Leilão Club NÃO veem esta ação, mesmo tendo acesso à
 * Análise Documental — é uma restrição adicional, verificada aqui no servidor (não só escondendo
 * o botão na tela, que um clique de DevTools contornaria).
 *
 * NENHUMA fonte tem e-mail de leiloeiro cadastrado hoje (levantado antes de escrever isto) —
 * `leiloeiro_contato` é o cadastro manual, alimentado aos poucos pelo admin/analista. Sem
 * contato cadastrado, devolve `semContato:true` + o texto, para o front oferecer "copiar e
 * mandar manualmente" em vez de fingir que enviou.
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

// Quem pode negociar documentação com o leiloeiro EM NOME do cliente. Mais estreito que o
// acesso à Análise Documental (que também vale para top2/clube) — decisão do dono, 12/09.
const ROLES_PEDIDO_LEILOEIRO = ['admin', 'analista', 'advogado', 'suporte', 'assessorado', 'assessorado_anual'];

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
// Teto do texto EDITADO (passo 2): folga generosa para complementar sem virar um anexo.
const MAX_TEXTO_EDITADO = 6000;

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
  const acao = String(body?.action || 'preview') === 'enviar' ? 'enviar' : 'preview';

  // ACESSO: papel do usuário AUTENTICADO, nunca o que o body diz (o body não manda role).
  // Falha de leitura NÃO pode virar "sem permissão" silencioso nem "libera geral" — fecha e
  // diz o que houve, para não confundir "não pode" com "não consegui checar" (forma #2/#5).
  const resPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!resPerfil.ok) return json({ error: 'Não foi possível verificar seu acesso agora. Tente novamente.' }, 500);
  const [perfil] = await resPerfil.json();
  if (!ROLES_PEDIDO_LEILOEIRO.includes(perfil?.role)) {
    return json({ error: 'Este recurso está disponível para a equipe e para o plano Assessorado.' }, 403);
  }

  // Rate limit SÓ no envio de verdade — o preview (montar/reler o texto) não gasta cota.
  // Duas chaves: por usuário (evita bombardear vários leiloeiros) e por imóvel (evita
  // reenviar o mesmo pedido repetidas vezes — o leiloeiro só precisa ver um).
  if (acao === 'enviar') {
    const rlUser = await checkRateLimit(`pedido-leiloeiro:user:${user.id}`, 5, 86_400_000);
    if (!rlUser.ok) return rateLimitedResponse(rlUser.resetAt);
    const rlImovel = await checkRateLimit(`pedido-leiloeiro:imovel:${imovelId}`, 1, 48 * 3_600_000);
    if (!rlImovel.ok) {
      return json({ error: 'Já foi enviado um pedido para este imóvel recentemente. Aguarde a resposta do leiloeiro antes de pedir de novo.', jaEnviado: true }, 429);
    }
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

  const [contato] = await (await sb(`leiloeiro_contato?fonte=eq.${encodeURIComponent(imovel.fonte || '')}&select=email`)).json();

  // PASSO 1 — PREVIEW: devolve o rascunho pronto, sem mandar nada e sem gastar rate limit. O
  // front mostra num campo editável; quem usa complementa (ou não) antes de confirmar o envio.
  if (acao === 'preview') {
    return json({ ok: true, texto: corpoTextoPuro, linkLote: linkLote || null, contatoDisponivel: !!contato?.email });
  }

  // PASSO 2 — ENVIAR: o corpo é o que o CHAMADOR mandou (o editado, se editou) — nunca
  // reconstruído aqui, senão a edição do passo 1 seria ignorada. Só o essencial (destinatário,
  // assunto, reply-to) continua vindo do servidor, para não virar um relay de e-mail livre.
  const textoFinal = String(body?.texto || '').trim().slice(0, MAX_TEXTO_EDITADO) || corpoTextoPuro;

  if (!contato?.email) {
    await auditar({ imovel_id: imovelId, user_id: user.id, fonte: imovel.fonte || null, destinatario_email: null, itens_pedidos: itensTexto, texto_enviado: null, status: 'sem_contato' });
    return json({ ok: false, semContato: true, texto: textoFinal, linkLote: linkLote || null });
  }

  // HTML a partir do texto LIVRE (editado): sem a tabela estruturada do rascunho original,
  // porque o texto pode ter mudado de forma — escapa e preserva as quebras de linha.
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;white-space:pre-wrap;line-height:1.6">${esc(textoFinal)}
    <p style="color:#94a3b8;font-size:11px;margin-top:24px;white-space:normal">Enviado via BidPro Brasil, a pedido do interessado no lote.</p>
  </div>`;

  const r = await enviarEmail({
    to: contato.email,
    replyTo: user.email,
    subject: assunto,
    html,
    text: textoFinal,
    meta: { tipo: 'pedido_documento_leiloeiro', userId: user.id },
  });

  await auditar({
    imovel_id: imovelId, user_id: user.id, fonte: imovel.fonte || null,
    destinatario_email: contato.email, itens_pedidos: itensTexto, texto_enviado: textoFinal,
    resend_id: r.ok ? (r.id || null) : null, status: r.ok ? 'enviado' : 'falha',
  });

  if (!r.ok) return json({ error: 'Não foi possível enviar o e-mail agora: ' + (r.error || 'falha desconhecida'), texto: textoFinal, linkLote: linkLote || null }, 502);

  return json({ ok: true, destinatario: contato.email });
}
