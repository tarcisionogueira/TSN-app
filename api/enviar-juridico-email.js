/**
 * POST /api/enviar-juridico-email  (analista/admin)
 * Um clique: envia ao advogado do caso a documentação do imóvel (todos os anexos)
 * + o relatório de AVALIAÇÃO DOCUMENTAL (juridica_preliminar) — sem mercadológico
 * nem financeiro — solicitando análise com brevidade para confirmação de viabilidade.
 * A resposta volta por e-mail (reply-to único por caso) e é ingerida em /api/inbound-juridico.
 * Body: { caso_id }
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { enviarEmail } from './_email.js';
import { addDiasUteis } from './_dias-uteis.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const INBOUND_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || 'bidprobrasil.com.br';
const APP_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
async function emailDoUsuario(id) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const d = await r.json();
    return d?.email || null;
  } catch { return null; }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Markdown bem simples → HTML (negrito, títulos, quebras)
function mdToHtml(md) {
  if (!md) return '<p style="color:#64748b">— relatório documental ainda não gerado —</p>';
  return esc(md)
    .replace(/^### (.*)$/gm, '<h4 style="margin:14px 0 4px">$1</h4>')
    .replace(/^## (.*)$/gm, '<h3 style="margin:16px 0 6px">$1</h3>')
    .replace(/^# (.*)$/gm, '<h2 style="margin:18px 0 8px">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role,nome`)).json();
  if (!perfil || !['analista', 'admin'].includes(perfil.role)) return json({ error: 'Apenas analista/admin' }, 403);

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const { caso_id } = body || {};
  if (!caso_id) return json({ error: 'caso_id obrigatório' }, 400);

  const [caso] = await (await sb(`casos?id=eq.${encodeURIComponent(caso_id)}&select=*`)).json();
  if (!caso) return json({ error: 'Caso não encontrado' }, 404);

  // Advogado responsável (para registro no caso); usado como fallback de destino.
  let advogadoId = caso.advogado_id;
  if (!advogadoId) {
    // Só advogados ATIVOS podem receber casos (evita atribuir a um ex-advogado).
    const [adv] = await (await sb(`perfis?role=eq.advogado&ativo=eq.true&select=id,nome&order=criado_em.asc&limit=1`)).json();
    advogadoId = adv?.id;
  }
  const [advPerfil] = advogadoId ? await (await sb(`perfis?id=eq.${advogadoId}&select=nome`)).json() : [null];

  // Destinatários configurados (do escritório do advogado do caso + os globais).
  // copia=false → "Para" (To); copia=true → "Cópia" (CC).
  const filtroAdv = advogadoId ? `&or=(advogado_id.is.null,advogado_id.eq.${advogadoId})` : `&advogado_id=is.null`;
  const dests = await (await sb(`juridico_destinatarios?ativo=eq.true${filtroAdv}&select=nome,email,copia`)).json();
  const norm = e => String(e || '').trim().toLowerCase();
  let toList = (Array.isArray(dests) ? dests : []).filter(d => d.copia === false && d.email).map(d => norm(d.email));
  let ccList = (Array.isArray(dests) ? dests : []).filter(d => d.copia === true && d.email).map(d => norm(d.email));
  // CC extra passado na requisição (ad-hoc)
  if (body.cc) ccList = ccList.concat((Array.isArray(body.cc) ? body.cc : String(body.cc).split(/[,;]/)).map(norm));

  // Fallback: sem lista de "Para" configurada → usa o e-mail do advogado do caso.
  if (!toList.length) {
    const advEmail = await emailDoUsuario(advogadoId);
    if (!advEmail) return json({ error: 'Configure os destinatários do jurídico (ou um advogado com e-mail no caso).' }, 400);
    toList = [norm(advEmail)];
  }
  // Dedup: remove de CC quem já está no Para
  ccList = [...new Set(ccList)].filter(e => e && !toList.includes(e));
  const nomePrincipal = (Array.isArray(dests) && dests.find(d => d.copia === false)?.nome) || advPerfil?.nome || 'Doutor(a)';

  // Anexos do imóvel
  const anexos = await (await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(caso.imovel_id)}&select=nome,url,tipo`)).json();
  // Triagem jurídica completa do sistema (documental + judicial/CNJ + sanções).
  // NÃO inclui mercadológico nem viabilidade financeira.
  const [doc] = await (await sb(`analise_relatorios?caso_id=eq.${encodeURIComponent(caso_id)}&tipo=eq.juridica_preliminar&select=conteudo_md,conteudo_json,versao&order=versao.desc&limit=1`)).json();
  const dj = doc?.conteudo_json || {};
  const linhaTri = (rotulo, valor) => valor ? `<tr><td style="padding:3px 10px 3px 0;color:#64748b;white-space:nowrap">${esc(rotulo)}</td><td style="padding:3px 0">${valor}</td></tr>` : '';
  const triagemHtml = (dj.executado?.nome || dj.numero_processo || dj.score_juridico != null || (dj.sancoes||[]).length || (dj.riscos||[]).length) ? `
    <table style="border-collapse:collapse;margin:6px 0;font-size:14px">
      ${linhaTri('Executado', dj.executado?.nome ? `${esc(dj.executado.nome)}${dj.executado.cpf_cnpj ? ` <span style="color:#94a3b8">(${esc(dj.executado.cpf_cnpj)})</span>` : ''}` : '')}
      ${linhaTri('Processo (CNJ)', dj.numero_processo ? esc(dj.numero_processo) : '')}
      ${linhaTri('Score jurídico', dj.score_juridico != null ? `${esc(dj.score_juridico)}/100` : '')}
      ${linhaTri('Sanções CEIS/CNEP', (dj.sancoes||[]).length ? `<strong>${(dj.sancoes).length}</strong> encontrada(s)` : '0 (nada encontrado)')}
    </table>
    ${(dj.riscos||[]).length ? `<p style="margin:8px 0 2px;font-weight:700">Gravames/ônus identificados:</p><ul style="margin:0;padding-left:18px">${dj.riscos.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  ` : '';
  // Situação do devedor / risco de suspensão (foco no extrajudicial)
  const procs = dj.processos_cnj || [];
  const suspensivoHtml = (procs.length || dj.modalidade === 'extrajudicial') ? `
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-weight:700;margin:0 0 4px">Situação do devedor e risco de suspensão/atraso do leilão${dj.modalidade ? ` (${esc(dj.modalidade)})` : ''}:</p>
    ${dj.risco_suspensao ? '<p style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;color:#991b1b;margin:6px 0"><strong>⚠️ Atenção:</strong> foram localizadas ações em nome do devedor que podem <strong>suspender, anular ou atrasar</strong> o leilão. Confirmar urgência.</p>' : ''}
    ${procs.length
      ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${procs.map(p => `<li><strong>${esc(p.numero || 's/nº')}</strong> · ${esc(p.tribunal||'')} · ${esc(p.classe||'')}${(p.categorias_risco||[]).length ? ` <span style="color:#b91c1c">[${esc((p.categorias_risco||[]).join(', '))}]</span>` : ''}${p.data_ajuizamento ? ` · ajuiz. ${esc(p.data_ajuizamento)}` : ''}</li>`).join('')}</ul>`
      : '<p style="color:#64748b;font-size:13px">Não foram localizadas ações suspensivas nos tribunais consultados — <strong>favor confirmar</strong> a situação do devedor fiduciante e eventual ação tentando obstar o leilão.</p>'}
  ` : '';

  const token = caso.juridico_token || (crypto.randomUUID().split('-')[0] + crypto.randomUUID().split('-')[0]);
  const replyTo = `juridico+${token}@${INBOUND_DOMAIN}`;
  const refCurto = String(caso_id).split('-')[0].toUpperCase();
  const advNome = nomePrincipal;

  const listaAnexos = (anexos || []).length
    ? `<ul style="margin:6px 0 0;padding-left:18px">${anexos.map(a => `<li>${esc(a.nome)} <span style="color:#94a3b8">(${esc(a.tipo)})</span></li>`).join('')}</ul>`
    : '<p style="color:#b45309">⚠️ Nenhum documento anexado a este imóvel ainda.</p>';

  const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#111">
    <p>Prezado(a) ${esc(advNome)},</p>
    <p>Solicitamos a <strong>análise da documentação com brevidade, para confirmação de viabilidade</strong> da seguinte arrematação em leilão:</p>
    <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
      <tr><td style="padding:3px 10px 3px 0;color:#64748b">Imóvel</td><td style="padding:3px 0"><strong>${esc(caso.imovel_endereco || caso.imovel_id)}</strong></td></tr>
      <tr><td style="padding:3px 10px 3px 0;color:#64748b">Tipo de leilão</td><td style="padding:3px 0">${esc(caso.tipo_leilao || '—')}</td></tr>
      <tr><td style="padding:3px 10px 3px 0;color:#64748b">Ref. do caso</td><td style="padding:3px 0">${esc(refCurto)}</td></tr>
    </table>
    <p style="font-weight:700;margin:18px 0 4px">Documentos anexos a este e-mail:</p>
    ${listaAnexos}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-weight:700;margin:0 0 4px">Triagem jurídica do sistema — levantamento de dados (CNJ/processo, sanções CEIS/CNEP e gravames):</p>
    ${triagemHtml || '<p style="color:#64748b">— triagem estruturada ainda não disponível —</p>'}
    ${suspensivoHtml}
    <p style="font-weight:700;margin:16px 0 4px">Parecer documental + judicial preliminar (para sua conferência):</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.55">${mdToHtml(doc?.conteudo_md)}</div>
    <p style="margin:18px 0 0">Caso identifique <strong>divergências</strong> em relação a esta avaliação, por favor aponte na resposta — usamos seus apontamentos para aprimorar a análise.</p>
    <p style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 14px;margin:16px 0;font-size:14px">
      👉 <strong>Basta responder a este próprio e-mail</strong> com seu parecer (recomenda / recomenda com ressalvas / não recomenda) e as observações. A resposta é registrada automaticamente no caso.
    </p>
    <p style="color:#64748b;font-size:12px;margin-top:18px">BidPro Brasil · Jurídico · Ref. ${esc(refCurto)}</p>
  </div>`;

  const attachments = (anexos || []).filter(a => a.url).map(a => ({ filename: a.nome || 'documento', path: a.url }));

  const r = await enviarEmail({
    from: 'BidPro Brasil Jurídico <noreply@bidprobrasil.com.br>',
    to: toList,
    cc: ccList,
    replyTo,
    subject: `Análise documental para confirmação de viabilidade — Caso ${refCurto}`,
    html,
    attachments,
  });
  if (!r.ok) return json({ error: 'Falha no envio do e-mail: ' + r.error }, 502);

  // Atualiza o caso
  await sb(`casos?id=eq.${encodeURIComponent(caso_id)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      status_etapa: 'juridico_solicitado', juridico_status: 'em_revisao',
      juridico_enviado_em: new Date().toISOString(), advogado_id: advogadoId,
      juridico_token: token, juridico_email_id: r.id,
      // Prazo de devolutiva: 7 dias úteis. Os lembretes (cron) e a reatribuição
      // por perda de prazo se baseiam neste campo. Zera contadores de lembrete.
      prazo_juridico: addDiasUteis(new Date(), 7).toISOString(),
      juridico_lembretes: 0, juridico_ultimo_lembrete: null,
    },
  });
  // Auditoria
  await sb('juridico_emails', { method: 'POST', prefer: 'return=minimal',
    body: { caso_id, direcao: 'saida', message_id: r.id, de: 'noreply@bidprobrasil.com.br', para: [...toList, ...ccList.map(c => `cc:${c}`)].join(', '), assunto: `Análise documental — Caso ${refCurto}`, anexos: attachments.map(a => ({ filename: a.filename })) } });

  // Chat interno (visível a analista/admin) amarrado ao caso
  let [chamado] = await (await sb(`chamados?caso_id=eq.${encodeURIComponent(caso_id)}&segmento=eq.interno&select=id&limit=1`)).json();
  if (!chamado) {
    [chamado] = await (await sb('chamados', { method: 'POST', prefer: 'return=representation',
      body: { user_id: null, user_email: null, user_nome: 'Jurídico', titulo: `Jurídico — ${caso.imovel_endereco || refCurto}`, status: 'em_atendimento', segmento: 'interno', caso_id } })).json();
  }
  if (chamado?.id) {
    await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal',
      body: { chamado_id: chamado.id, autor_id: user.id, autor_nome: perfil.nome || 'Analista', autor_tipo: 'sistema',
        conteudo: `📨 Documentação enviada ao advogado (${advNome}) por e-mail, solicitando análise da documentação com brevidade. Aguardando devolutiva jurídica.`, anexos: [] } });
  }

  return json({ ok: true, advogado: advNome, anexos: attachments.length });
}
