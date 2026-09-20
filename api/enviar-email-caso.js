/**
 * POST /api/enviar-email-caso   (equipe: admin/analista/advogado/consultor)
 * Body: { caso_id, destino: 'juridico'|'leiloeiro', action?: 'preview'|'enviar', texto? }
 *
 * Pedido do dono (20/09): "num click incluir todos os anexos do lote, e caso seja um
 * assessorado também incluir os documentos pessoais... me permitir escolher entre enviar ao
 * jurídico ou ao leiloeiro deste lote". Mesmo padrão em DOIS PASSOS já usado em
 * `api/propor-veiculo-leiloeiro.js`/`api/pedir-documento-leiloeiro.js`: `action='preview'`
 * monta o rascunho (com a lista de anexos que SAIRIAM) sem enviar nada; `action='enviar'`
 * manda o texto que o chamador devolveu (editado, se editou).
 *
 * DIFERENTE de `api/enviar-juridico-email.js` (que é o fluxo FORMAL de "solicitar análise
 * jurídica" — muda `status_etapa` do caso, injeta o parecer documental, abre chamado): este
 * endpoint é um contato AD-HOC, mais leve — não toca no estado do caso. Reaproveita a MESMA
 * resolução de destinatário jurídico (tabela `juridico_destinatarios`) e o mesmo padrão de
 * anexo por URL (Resend busca via `path`, o servidor nunca baixa/base64-codifica o PDF — ver
 * `enviar-juridico-email.js:96-98,156`, mais barato e sem limite de payload do nosso lado).
 *
 * REMETENTE: continua `noreply@bidprobrasil.com.br` (nome de exibição = quem está enviando),
 * com `reply-to` = o e-mail de quem enviou — a resposta cai na caixa de verdade da pessoa,
 * sem precisar de mailbox corporativa nova (domínio já verificado no Resend, ver conversa).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { assinarDocumento } from './_storage.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

// Mesmo conjunto de `isStaff` da tela do caso (src/pages/Caso.jsx) — decisão de
// implementação (não pedido explícito do dono): quem já opera o caso pode contatar tanto o
// jurídico quanto o leiloeiro deste lote específico.
const ROLES_STAFF = ['admin', 'analista', 'advogado', 'consultor'];
const MAX_TEXTO_EDITADO = 4000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
}
function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function emailDoUsuario(id) {
  if (!id) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.email || null;
  } catch { return null; } // padrao-ok: helper best-effort — sem e-mail, o chamador cai no próximo fallback
}
async function auditar(row) {
  try {
    await sb('caso_emails_enviados', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  } catch { /* padrao-ok: auditoria não pode derrubar a resposta ao usuário */ }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = e => String(e || '').trim().toLowerCase();

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const casoId = String(body?.caso_id || '').trim();
  const destino = String(body?.destino || '') === 'leiloeiro' ? 'leiloeiro' : String(body?.destino || '') === 'juridico' ? 'juridico' : '';
  if (!casoId) return json({ error: 'caso_id obrigatório' }, 400);
  if (!destino) return json({ error: "destino obrigatório: 'juridico' ou 'leiloeiro'" }, 400);
  const acao = String(body?.action || 'preview') === 'enviar' ? 'enviar' : 'preview';

  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role,nome`);
  if (!rPerfil.ok) return json({ error: 'Não foi possível verificar seu acesso agora. Tente novamente.' }, 500);
  const [perfilRemetente] = await rPerfil.json();
  if (!perfilRemetente || !ROLES_STAFF.includes(perfilRemetente.role)) {
    return json({ error: 'Este recurso está disponível apenas para a equipe.' }, 403);
  }

  if (acao === 'enviar') {
    const rlUser = await checkRateLimit(`email-caso:user:${user.id}`, 30, 86_400_000);
    if (!rlUser.ok) return rateLimitedResponse(rlUser.resetAt);
    const rlCaso = await checkRateLimit(`email-caso:${destino}:${casoId}`, 3, 86_400_000);
    if (!rlCaso.ok) return rateLimitedResponse(rlCaso.resetAt);
  }

  const rCaso = await sb(`casos?id=eq.${encodeURIComponent(casoId)}&select=id,cliente_id,imovel_id,imovel_endereco,advogado_id&limit=1`);
  if (!rCaso.ok) return json({ error: 'Não foi possível ler o caso agora. Tente novamente.' }, 500);
  const [caso] = await rCaso.json();
  if (!caso) return json({ error: 'Caso não encontrado' }, 404);

  let imovel = null;
  if (caso.imovel_id) {
    const rImovel = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(caso.imovel_id)}&select=id,fonte,titulo,anexos&limit=1`);
    if (rImovel.ok) [imovel] = await rImovel.json();
  }
  const anexosLote = (Array.isArray(imovel?.anexos) ? imovel.anexos : []).filter(a => a?.url);

  // ASSESSORADO (e variante anual) → também os documentos PESSOAIS do CLIENTE dono do caso
  // (não do usuário logado — a equipe pode estar enviando em nome de outro cliente). Mesmo
  // padrão de `api/garantia-cancelar.js` para casar a variante `_anual` numa regex só.
  let perfilCliente = null;
  if (caso.cliente_id) {
    const rPerfilCliente = await sb(`perfis?id=eq.${caso.cliente_id}&select=role&limit=1`);
    if (rPerfilCliente.ok) [perfilCliente] = await rPerfilCliente.json();
  }
  const ehAssessorado = /^assessorado/.test(perfilCliente?.role || '');
  let docsPessoais = [];
  if (ehAssessorado) {
    const rDocs = await sb(`usuario_docs?user_id=eq.${encodeURIComponent(caso.cliente_id)}&select=id,nome,url&order=criado_em.desc`);
    if (rDocs.ok) docsPessoais = await rDocs.json().catch(() => []);
    if (!Array.isArray(docsPessoais)) docsPessoais = [];
  }

  const labelImovel = caso.imovel_endereco || imovel?.titulo || `Caso ${casoId.slice(0, 8)}`;
  const nomeRemetente = perfilRemetente.nome || 'Equipe BidPro Brasil';

  // ── Resolve destinatário ────────────────────────────────────────────────────────────────
  let destinatarioEmail = null;
  let ccList = [];
  if (destino === 'leiloeiro') {
    const rContato = await sb(`leiloeiro_contato?fonte=eq.${encodeURIComponent(imovel?.fonte || '')}&select=email`);
    const [contato] = rContato.ok ? await rContato.json() : [null];
    destinatarioEmail = contato?.email || null;
  } else {
    // Jurídico: mesma resolução de api/enviar-juridico-email.js (destinatários do escritório
    // do advogado do caso + os globais; copia=false → Para, copia=true → CC), SEM sortear nem
    // gravar advogado novo no caso — isto é um contato ad-hoc, não a solicitação formal.
    const advogadoId = caso.advogado_id || null;
    const filtroAdv = advogadoId ? `&or=(advogado_id.is.null,advogado_id.eq.${advogadoId})` : `&advogado_id=is.null`;
    const rDests = await sb(`juridico_destinatarios?ativo=eq.true${filtroAdv}&select=email,copia`);
    const dests = rDests.ok ? await rDests.json().catch(() => []) : [];
    const lista = Array.isArray(dests) ? dests : [];
    const toList = lista.filter(d => d.copia === false && d.email).map(d => norm(d.email));
    ccList = [...new Set(lista.filter(d => d.copia === true && d.email).map(d => norm(d.email)))];
    destinatarioEmail = toList[0] || null;
    if (!destinatarioEmail && advogadoId) destinatarioEmail = await emailDoUsuario(advogadoId);
    ccList = ccList.filter(e => e && e !== destinatarioEmail);
  }

  const corpoTextoPuro = destino === 'leiloeiro'
    ? `Prezados,\n\nEstamos em acompanhamento do lote abaixo e gostaríamos de mais informações / esclarecimentos:\n\nImóvel: ${labelImovel}\n\nSeguem em anexo os documentos do lote que já temos em mãos.\n\nAgradecemos desde já a atenção.\n\n${nomeRemetente}`
    : `Prezados,\n\nSolicitamos análise/apoio jurídico referente ao caso abaixo:\n\nImóvel: ${labelImovel}\n\nSeguem em anexo os documentos do lote${ehAssessorado ? ' e os documentos pessoais do cliente' : ''}.\n\n${nomeRemetente}`;

  // PASSO 1 — PREVIEW: mostra o rascunho e QUANTOS anexos sairiam, sem enviar nada.
  if (acao === 'preview') {
    return json({
      ok: true,
      texto: corpoTextoPuro,
      destinatarioEmail,
      contatoDisponivel: !!destinatarioEmail,
      anexosLote: anexosLote.map(a => a.nome || 'documento'),
      anexosPessoais: ehAssessorado ? docsPessoais.map(d => d.nome || 'documento') : null,
      ehAssessorado,
    });
  }

  // PASSO 2 — ENVIAR.
  const textoFinal = String(body?.texto || '').trim().slice(0, MAX_TEXTO_EDITADO) || corpoTextoPuro;

  if (!destinatarioEmail) {
    await auditar({ caso_id: casoId, destino, destinatario_email: null, enviado_por: user.id,
      anexos_lote: anexosLote.length, anexos_pessoais: docsPessoais.length, texto_enviado: null, status: 'sem_contato' });
    return json({ ok: false, semContato: true, texto: textoFinal });
  }

  // Anexos do LOTE: URL externa (S3/CDN do leiloeiro) — Resend busca direto, sem passar pelo
  // nosso servidor. Anexos PESSOAIS: bucket privado nosso — cada um assinado agora (curta
  // duração), o suficiente para o Resend buscar no ato do envio.
  const attachments = [
    ...anexosLote.map(a => ({ filename: a.nome || 'documento', path: a.url })),
  ];
  for (const d of docsPessoais) {
    const link = /^https?:\/\//i.test(d.url || '') ? d.url : await assinarDocumento(d.url);
    if (link) attachments.push({ filename: d.nome || 'documento', path: link });
  }

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;white-space:pre-wrap;line-height:1.6">${esc(textoFinal)}
    <p style="color:#94a3b8;font-size:11px;margin-top:24px;white-space:normal">Enviado via BidPro Brasil.</p>
  </div>`;

  const r = await enviarEmail({
    from: `${nomeRemetente} (BidPro Brasil) <noreply@bidprobrasil.com.br>`,
    to: destinatarioEmail,
    cc: ccList,
    replyTo: user.email,
    subject: `${destino === 'leiloeiro' ? 'Contato' : 'Apoio jurídico'} — ${labelImovel}`,
    html,
    text: textoFinal,
    attachments,
    meta: { tipo: `email_caso_${destino}`, userId: user.id },
  });

  await auditar({
    caso_id: casoId, destino, destinatario_email: destinatarioEmail, enviado_por: user.id,
    anexos_lote: anexosLote.length, anexos_pessoais: docsPessoais.length, texto_enviado: textoFinal,
    resend_id: r.ok ? (r.id || null) : null, status: r.ok ? 'enviado' : 'falha',
  });

  if (!r.ok) return json({ error: 'Não foi possível enviar o e-mail agora: ' + (r.error || 'falha desconhecida'), texto: textoFinal }, 502);

  return json({ ok: true, destinatario: destinatarioEmail, anexos: attachments.length });
}
