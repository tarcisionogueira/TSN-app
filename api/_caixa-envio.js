/**
 * ENVIO DA CAIXA DE E-MAIL — a parte comum ao botão Enviar (api/email-caixa.js) e ao envio AGENDADO
 * (api/email-agendados-cron.js). Extraído em 23/11 quando o agendamento nasceu: o e-mail agendado tem
 * de passar EXATAMENTE pelo mesmo caminho do envio na hora — orçamento diário e supressão
 * (`enviarEmail`), encadeamento no fio e no chamado, registro em Enviados. Duas cópias da regra
 * divergiriam na primeira mudança.
 *
 * `enviarDaCaixa` devolve { status, obj } (quem chama transforma em resposta HTTP ou em status do
 * agendamento). Nunca lança por erro de envio: o motivo vem em `obj.error`.
 */
import { enviarEmail } from './_email.js';
import { referenciasNormalizadas } from './_email-referencias.js';

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
export const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
export const DOMINIO      = 'bidprobrasil.com.br';
// Espelha public.pode_caixa_email(): admin + analista + consultor (role OU funcao_equipe).
export const PAPEIS_CAIXA = ['admin', 'analista', 'consultor'];
export const CAIXAS_ENVIO = ['suporte', 'contato', 'privacidade'];
const RE_EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
const MAX_TEXTO = 20000;
const resp = (obj, status = 200) => ({ status, obj });

// Quem pode usar a caixa e como. Advogado (23/09): só a PRÓPRIA caixa pessoal, nunca a comunicação.
export function acessoCaixa(perfil) {
  const soPessoal = [perfil?.role, perfil?.funcao_equipe].includes('advogado')
    && !(PAPEIS_CAIXA.includes(perfil?.role) || PAPEIS_CAIXA.includes(perfil?.funcao_equipe));
  const permitido = !!perfil && (soPessoal || PAPEIS_CAIXA.includes(perfil.role) || PAPEIS_CAIXA.includes(perfil.funcao_equipe));
  return { permitido, soPessoal };
}

export function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
export async function ler1(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  const [linha] = await r.json();
  return linha || null;
}
export const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const listaEmails = (v) => [...new Set([].concat(v || []).flatMap(x => String(x || '').split(/[,;\s]+/))
  .map(x => x.trim().toLowerCase()).filter(Boolean))];

// LINK DO ANEXO de uma mensagem da caixa — usado ao ABRIR o anexo e ao ENCAMINHAR (09/10: o
// "Encaminhar a conversa" mandava só o texto, nenhum anexo). Ordem: cópia nossa no bucket (o
// Resend apaga em 30 dias) → anexo do envio (saída) → anexo recebido (entrada). Devolve
// { url, nome } ou { erro, status } — nunca "sem anexo" calado.
export async function resolverAnexo(msg, { anexoId = '', idx = NaN } = {}) {
  const lista = msg?.anexos || [];
  const item = msg?.direcao === 'saida' ? lista[idx] : lista.find(a => a?.id && a.id === anexoId);
  if (item?.arquivo && String(item.arquivo).startsWith('email/')) {
    const rs = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${item.arquivo}`, {
      method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 }), signal: AbortSignal.timeout(10000),
    });
    const js = rs.ok ? await rs.json().catch(() => null) : null;
    if (js?.signedURL) return { url: `${SUPABASE_URL}/storage/v1${js.signedURL}`, nome: item.nome, nosso: true, arquivo: item.arquivo };
    // Cópia registrada mas não assinável: diz, e segue para o Resend enquanto ele ainda tiver.
    console.error('[email-caixa] anexo arquivado não assinou:', rs.status, item.arquivo);
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return { erro: 'Envio de e-mail não configurado', status: 503 };

  // ENVIADO (23/09): o arquivo é o que o Resend de fato ANEXOU no envio — GET
  // /emails/{id}/attachments. Mostra exatamente o que o destinatário recebeu, não uma
  // releitura da origem (que pode ter mudado, ou exigir login — caso da matrícula LEILOFY).
  if (msg?.direcao === 'saida') {
    const esperado = lista[idx];
    if (!msg.resend_email_id || !esperado) return { erro: 'Anexo não encontrado', status: 404 };
    const rl = await fetch(`https://api.resend.com/emails/${encodeURIComponent(msg.resend_email_id)}/attachments`,
      { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    const jl = rl.ok ? await rl.json().catch(() => null) : null;
    const itens = Array.isArray(jl?.data) ? jl.data : (Array.isArray(jl) ? jl : null);
    if (!itens) {
      console.error('[email-caixa] anexos enviados: Resend', rl.status, jl ? Object.keys(jl).join(',') : '(sem corpo)');
      return { erro: `O provedor não listou os anexos deste envio (HTTP ${rl.status}).`, status: 502 };
    }
    // 19/10: sem casamento por POSIÇÃO (o arquivador já tirou em 16/10) — anexo que não foi entregue
    // desloca os índices e a tela mostrava/encaminhava OUTRO arquivo com o nome deste.
    if (esperado.enviado === false) return { erro: 'Este anexo não foi entregue no envio original.', status: 404 };
    const alvo = itens.find(a => a?.filename === esperado.nome);
    if (!alvo) return { erro: 'Anexo não encontrado neste envio.', status: 404 };
    let url = alvo?.download_url || null;
    if (!url && alvo?.id) {
      const ra = await fetch(`https://api.resend.com/emails/${encodeURIComponent(msg.resend_email_id)}/attachments/${encodeURIComponent(alvo.id)}`,
        { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
      const ja = ra.ok ? await ra.json().catch(() => null) : null;
      url = ja?.download_url || null;
      if (!url) console.error('[email-caixa] anexo enviado: Resend', ra.status, ja ? Object.keys(ja).join(',') : '(sem corpo)');
    }
    if (!url) return { erro: 'O provedor não entregou o anexo agora. Tente de novo em instantes.', status: 502 };
    return { url, nome: alvo?.filename || esperado.nome };
  }

  // Só anexo que É desta mensagem — o id vem do cliente e não pode virar proxy do Resend.
  if (!msg?.resend_email_id || !lista.some(a => a?.id && a.id === anexoId)) return { erro: 'Anexo não encontrado', status: 404 };
  const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(msg.resend_email_id)}/attachments/${encodeURIComponent(anexoId)}`,
    { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
  const j = r.ok ? await r.json().catch(() => null) : null;
  if (!j?.download_url) {
    console.error('[email-caixa] anexo: Resend', r.status, j ? Object.keys(j).join(',') : '(sem corpo)');
    return { erro: 'O provedor não entregou o anexo agora. Tente de novo em instantes.', status: 502 };
  }
  return { url: j.download_url, nome: j.filename || lista.find(a => a?.id === anexoId)?.nome };
}

export async function enviarDaCaixa({ user, perfil, soPessoal, body }) {
  // 'pessoal' = o endereço da própria pessoa (equipe_email). Os demais são de COMUNICAÇÃO.
  let pessoal = null;
  if (soPessoal && body?.acao === 'enviar') body.de = 'pessoal';
  if (body?.de === 'pessoal') {
    try { pessoal = await ler1(`equipe_email?user_id=eq.${user.id}&select=endereco`); }
    catch (e) { console.error('[email-caixa] equipe_email:', e.message); return resp({ error: 'Não foi possível ler seu endereço da equipe.' }, 500); }
    if (!pessoal) return resp({ error: 'Você ainda não tem endereço pessoal @bidprobrasil.com.br — peça ao admin.' }, 400);
  }
  const de = pessoal ? null : (CAIXAS_ENVIO.includes(body?.de) ? body.de : 'suporte');
  const enderecoDe = pessoal ? pessoal.endereco : `${de}@${DOMINIO}`;
  const para = listaEmails(body?.para);
  const cc = listaEmails(body?.cc).filter(e => !para.includes(e));
  // Cco (23/11): cópia oculta — quem está em Para/Cc não vê. Repetido em Para/Cc sai daqui.
  const cco = listaEmails(body?.cco).filter(e => !para.includes(e) && !cc.includes(e));
  const assunto = String(body?.assunto || '').trim().slice(0, 300);
  const texto = String(body?.texto || '').trim().slice(0, MAX_TEXTO);
  if (!para.length || [...para, ...cc, ...cco].some(e => !RE_EMAIL.test(e))) return resp({ error: 'Confira os destinatários (e-mail inválido).' }, 400);
  if (para.length + cc.length + cco.length > 10) return resp({ error: 'No máximo 10 destinatários por mensagem (somando Para, Cc e Cco).' }, 400);
  if (!assunto || !texto) return resp({ error: 'Assunto e mensagem são obrigatórios.' }, 400);

  // ANEXOS ENCAMINHADOS (09/10, dono: "Encaminhar a conversa" chegou sem nenhum anexo). A tela manda
  // a referência de cada anexo das mensagens encaminhadas; aqui cada um vira link (cópia nossa ou
  // provedor) e o Resend busca o arquivo. Faltou UM, nada sai: e-mail encaminhado sem o anexo que
  // o destinatário espera é pior que um erro na tela, que dá para repetir.
  const pedidos = Array.isArray(body?.encaminhar_anexos) ? body.encaminhar_anexos.slice(0, 21) : [];
  if (pedidos.length > 20) return resp({ error: 'No máximo 20 anexos por encaminhamento.' }, 400);
  const anexosEnvio = [];
  for (const p of pedidos) {
    const idMsg = String(p?.id || '');
    let m = null;
    try { m = idMsg ? await ler1(`email_caixa?id=eq.${encodeURIComponent(idMsg)}&select=direcao,resend_email_id,anexos,dono`) : null; }
    catch (e) { console.error('[email-caixa] encaminhar anexo:', e.message); return resp({ error: 'Não foi possível ler os anexos a encaminhar.' }, 500); }
    if (!m || (m.dono ? m.dono !== user.id : soPessoal)) return resp({ error: 'Um dos anexos a encaminhar não foi encontrado. Nada foi enviado.' }, 404);
    const res = await resolverAnexo(m, { anexoId: String(p?.anexo_id || ''), idx: Number(p?.anexo_idx) });
    if (res.erro) return resp({ error: `Anexo "${p?.nome || 'sem nome'}": ${res.erro} Nada foi enviado.` }, res.status);
    // `arquivo`: o anexo encaminhado JÁ tem cópia nossa (a da mensagem de origem) — registrar o
    // caminho dela evita que o arquivador tente baixá-lo de novo do provedor (12/10: 5 anexos de um
    // encaminhamento acusavam `anexo_email_nao_arquivado` sem nunca ter corrido risco).
    anexosEnvio.push({ filename: String(res.nome || p?.nome || 'anexo').slice(0, 150), path: res.url, ...(res.arquivo ? { arquivo: res.arquivo } : {}) });
  }

  // ANEXOS DA TELA (09/10, dono: "permitir anexar documentos/fotos e colar imagem no corpo"). A tela
  // sobe o arquivo direto para o bucket (só no prefixo do PRÓPRIO usuário) e manda o caminho; aqui
  // conferimos o prefixo, assinamos e o Resend busca. Validade longa: se o Resend demorar a buscar,
  // o link não pode ter vencido. Não assinou UM → nada sai (mesma regra do encaminhar).
  const anexosTela = Array.isArray(body?.anexos) ? body.anexos.slice(0, 21) : [];
  if (pedidos.length + anexosTela.length > 20) return resp({ error: 'No máximo 20 anexos por mensagem.' }, 400);
  const prefixo = `email/saida/${user.id}/`;
  const inlines = [];
  const anexosRegistro = anexosEnvio.map((a) => ({ nome: a.filename, ...(a.arquivo ? { arquivo: a.arquivo, arquivado_em: new Date().toISOString() } : {}) }));
  for (const [i, a] of anexosTela.entries()) {
    const arquivo = String(a?.arquivo || '');
    const nome = String(a?.nome || 'anexo').replace(/[\r\n\]]/g, ' ').slice(0, 150);
    if (!arquivo.startsWith(prefixo) || !/^[A-Za-z0-9._-]+$/.test(arquivo.slice(prefixo.length))) {
      return resp({ error: `Anexo "${nome}" inválido. Nada foi enviado.` }, 400);
    }
    let url = null;
    try {
      const rs = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${arquivo}`, {
        method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 7 * 86400 }), signal: AbortSignal.timeout(10000),
      });
      const js = rs.ok ? await rs.json().catch(() => null) : null;
      if (js?.signedURL) url = `${SUPABASE_URL}/storage/v1${js.signedURL}`;
      else console.error('[email-caixa] anexo da tela não assinou:', rs.status, arquivo);
    } catch (e) { console.error('[email-caixa] anexo da tela:', String(e?.message || e).slice(0, 120)); }
    if (!url) return resp({ error: `Anexo "${nome}" não foi encontrado no armazenamento (o envio do arquivo terminou?). Nada foi enviado.` }, 400);
    const marcador = `[imagem: ${nome}]`;
    const cid = a?.inline === true && texto.includes(marcador) ? `img${i}-${crypto.randomUUID().slice(0, 8)}@bidprobrasil` : null;
    if (cid) inlines.push({ marcador, cid });
    anexosEnvio.push({ filename: nome, path: url, ...(cid ? { content_id: cid } : {}) });
    anexosRegistro.push({ nome, arquivo });
  }

  // Resposta: encadeia no fio do remetente e, se virou chamado, no chamado.
  let original = null, chamado = null;
  if (body?.responder_a) {
    try {
      original = await ler1(`email_caixa?id=eq.${encodeURIComponent(body.responder_a)}&select=id,de_email,de_nome,assunto,texto,message_id,referencias,chamado_id,criado_em,dono`);
      if (original && (original.dono ? original.dono !== user.id : soPessoal)) original = null; // mesma cerca da RLS
      if (original?.chamado_id) chamado = await ler1(`chamados?id=eq.${original.chamado_id}&select=id,email_token,canal`);
    } catch (e) { console.error('[email-caixa] original:', e.message); return resp({ error: 'Não foi possível ler a mensagem original.' }, 500); }
    if (!original) return resp({ error: 'Mensagem original não encontrada' }, 404);
  }

  // Para onde volta a resposta (23/09, decisão do dono):
  //   · chamado        → suporte+<token do chamado>@ (volta ao MESMO chamado)
  //   · endereço pessoal → pessoa+<token do envio>@ (volta à caixa dela, encadeada)
  //   · comunicação    → o próprio endereço (contato@/suporte@…) → cai na fila de atendimento
  // Toque duplo no celular (25/09): o mesmo e-mail saiu 2× ao leiloeiro, 1,1 s de diferença, com
  // dois ids do Resend. A tela gera uma chave por mensagem composta; com ela o Resend devolve o
  // envio original em vez de mandar de novo, e o registro abaixo não duplica em Enviados.
  const chaveEnvio = /^[A-Za-z0-9-]{8,64}$/.test(String(body?.chave_envio || '')) ? String(body.chave_envio) : null;
  // O token de resposta SAI DA CHAVE, não do acaso (30/10). Sorteado a cada pedido, ele mudava o
  // Reply-To — e uma repetição do MESMO envio (um clique, dois pedidos, 16 s depois) chegava ao
  // Resend com corpo diferente: "idempotency key ... body was modified". O e-mail já tinha saído,
  // e a tela mostrava erro. Mesma chave → mesmo token → mesmo corpo → o Resend devolve o original.
  let respostaToken = null;
  if (!chamado && pessoal) {
    if (chaveEnvio) {
      const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user.id}:${chaveEnvio}`));
      respostaToken = [...new Uint8Array(dig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    } else {
      respostaToken = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    }
  }
  let replyTo = respostaToken ? enderecoDe.replace('@', `+${respostaToken}@`) : enderecoDe;
  if (chamado) {
    let token = chamado.email_token;
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const up = await sb(`chamados?id=eq.${chamado.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { email_token: token } });
      if (!up.ok) { console.error('[email-caixa] token do chamado não gravado', up.status); token = null; }
    }
    if (token) replyTo = `suporte+${token}@${DOMINIO}`;
  }

  const headers = {};
  if (original?.message_id) {
    headers['In-Reply-To'] = original.message_id;
    // Normaliza: linha antiga guarda o JSON do array (02/10) — colado cru, aninhava o fio.
    headers['References'] = referenciasNormalizadas(original.referencias, original.message_id) || original.message_id;
  }
  // 25/09 (dono): a resposta leva SÓ o que foi digitado + assinatura. A conversa inteira fica na
  // tela para dar contexto a quem responde; citar o e-mail anterior virou opção (`citar: true`).
  // Antes citava sempre — e como o e-mail do outro lado já traz o histórico dentro, ia quase a
  // conversa toda junto. In-Reply-To/References continuam: o fio segue encadeado lá do outro lado.
  const citacao = body?.citar === true && original?.texto
    ? `\n\nEm ${new Date(original.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, ${original.de_nome || original.de_email} escreveu:\n`
      + String(original.texto).slice(0, 4000).split('\n').map(l => `> ${l}`).join('\n')
    : '';
  const nomeRemetente = perfil.nome || 'Equipe BidPro Brasil';
  const textoFinal = `${texto}\n\n—\n${nomeRemetente}\nBidPro Brasil${citacao}`;
  // Imagem colada: o marcador no texto vira <img> apontando para o anexo inline (cid).
  let corpoHtml = esc(texto);
  for (const { marcador, cid } of inlines) {
    corpoHtml = corpoHtml.split(esc(marcador)).join(`<img src="cid:${cid}" alt="${esc(marcador.slice(9, -1))}" style="max-width:100%;height:auto;display:block;margin:8px 0">`);
  }
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1e293b;line-height:1.6;white-space:pre-wrap">${corpoHtml}</div>`
    + `<p style="font-family:Arial,Helvetica,sans-serif;color:#475569;font-size:13px;margin-top:18px">—<br>${esc(nomeRemetente)}<br>BidPro Brasil</p>`
    + (citacao ? `<blockquote style="border-left:3px solid #cbd5e1;margin:16px 0 0;padding:4px 12px;color:#64748b;white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:13px">${esc(citacao.trim())}</blockquote>` : '');

  const r = await enviarEmail({
    from: `${nomeRemetente} (BidPro Brasil) <${enderecoDe}>`,
    to: para, cc, ...(cco.length ? { bcc: cco } : {}), replyTo, subject: assunto, html, text: textoFinal,
    ...(anexosEnvio.length ? { attachments: anexosEnvio.map(({ arquivo, ...resto }) => resto), semFila: true } : {}), // eslint-disable-line no-unused-vars
    headers: Object.keys(headers).length ? headers : undefined,
    meta: { tipo: 'caixa_equipe', userId: user.id },
    idempotencyKey: chaveEnvio ? `caixa:${user.id}:${chaveEnvio}` : undefined,
  });
  if (!r.ok && /idempotenc/i.test(String(r.error || ''))) {
    // Chave já usada com OUTRO conteúdo (ex.: o envio saiu, a tela não soube, e o texto foi mexido
    // antes de clicar de novo). Se este envio já está em Enviados, ele SAIU — dizer "não foi
    // possível enviar" levaria a mandar de novo. Senão, explica o que fazer, sem jargão do Resend.
    const ja = await sb(`email_caixa?enviado_por=eq.${user.id}&direcao=eq.saida&assunto=eq.${encodeURIComponent(assunto)}&criado_em=gte.${new Date(Date.now() - 24 * 3600e3).toISOString()}&select=id,criado_em&order=criado_em.desc&limit=1`);
    const linhas = ja.ok ? await ja.json().catch(() => null) : null;
    if (!ja.ok || !Array.isArray(linhas)) console.error('[email-caixa] checagem do envio repetido falhou HTTP', ja.status);
    if (Array.isArray(linhas) && linhas.length) {
      const h = new Date(linhas[0].criado_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      return resp({ ok: true, repetido: true, avisos: [`este e-mail já tinha saído às ${h} (está em Enviados) — não foi mandado de novo`] });
    }
    return resp({ error: 'Este envio já foi tentado com um conteúdo diferente. Confira em Enviados; se não estiver lá, descarte e escreva de novo.' }, 409);
  }
  if (!r.ok) {
    const msg = r.error === 'orcamento_diario_excedido'
      ? (r.enfileirado
        ? 'Limite diário de envio atingido — a mensagem foi colocada na fila e sai amanhã.'
        : anexosEnvio.length || cco.length
          ? `Limite diário de envio atingido. E-mail com ${anexosEnvio.length ? 'anexo' : 'Cco'} não vai para a fila (sairia sem ${anexosEnvio.length ? 'o arquivo' : 'as cópias ocultas'}) — o rascunho ficou salvo, envie amanhã.`
          : 'Limite diário de envio atingido e a fila de espera falhou — NADA foi enviado. Tente de novo mais tarde.')
      : r.error === 'suprimido' ? 'O destinatário está na lista de supressão (endereço com bounce/reclamação). Nada foi enviado.'
      : `Não foi possível enviar agora: ${r.error || 'falha desconhecida'}`;
    return resp({ error: msg, enfileirado: !!r.enfileirado }, r.error === 'suprimido' ? 409 : 502);
  }

  // Registro na caixa (Enviados). O e-mail JÁ SAIU — falha aqui é só histórico: avisa, não esconde.
  const avisos = [];
  // 16/10: anexo que o servidor não conseguiu baixar NÃO foi junto — registro e tela dizem isso.
  // `anexos_status` tem a mesma ordem de `anexosEnvio`, que é a mesma de `anexosRegistro`.
  (r.anexos_status || []).forEach((st, i) => {
    if (st?.enviado === false && anexosRegistro[i]) {
      anexosRegistro[i] = { ...anexosRegistro[i], enviado: false, motivo: st.motivo };
      avisos.push(`"${st.nome}" NÃO foi anexado: ${st.motivo}`);
    }
  });
  if (r.id) {
    const ja = await sb(`email_caixa?resend_email_id=eq.${encodeURIComponent(r.id)}&select=id&limit=1`);
    const linhas = ja.ok ? await ja.json().catch(() => null) : null;
    if (!ja.ok || !Array.isArray(linhas)) console.error('[email-caixa] checagem de repetido falhou HTTP', ja.status, '— registrando assim mesmo');
    else if (linhas.length) return resp({ ok: true, id: r.id, repetido: true, avisos: ['este envio já tinha saído — não foi mandado de novo'] });
  }
  const ins = await sb('email_caixa', { method: 'POST', prefer: 'return=minimal', body: {
    direcao: 'saida', pasta: 'enviados', caixa: enderecoDe, de_email: enderecoDe, de_nome: nomeRemetente, dono: pessoal ? user.id : null,
    // Imagem inline (cid) não abre na nossa tela: em Enviados fica o marcador; a imagem segue nos anexos.
    para, cc, ...(cco.length ? { cco } : {}), assunto, texto: textoFinal, html: inlines.length ? html.split(corpoHtml).join(esc(texto)) : html, in_reply_to: original?.message_id || null,
    referencias: headers['References'] || null, resend_email_id: r.id || null, lido: true,
    ...(anexosRegistro.length ? { anexos: anexosRegistro } : {}),
    chamado_id: chamado?.id || null, enviado_por: user.id, resposta_token: respostaToken,
    // Envio ligado a um caso (guia da parcela ao cliente): fica na pasta do caso.
    ...(!soPessoal && /^[0-9a-f-]{36}$/i.test(String(body?.caso_id || '')) ? { caso_id: body.caso_id } : {}),
  } });
  if (!ins.ok) { console.error('[email-caixa] registrar enviado HTTP', ins.status); avisos.push('enviado, mas não ficou registrado em Enviados'); }

  if (original) {
    const lido = await sb(`email_caixa?id=eq.${original.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { lido: true } });
    if (!lido.ok) console.error('[email-caixa] marcar lido HTTP', lido.status);
  }
  if (chamado) {
    const m = await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal', body: {
      chamado_id: chamado.id, autor_id: user.id, autor_nome: nomeRemetente, autor_tipo: 'atendente',
      conteudo: texto, canal: 'email',
    } });
    if (!m.ok) { console.error('[email-caixa] histórico do chamado HTTP', m.status); avisos.push('enviado, mas não entrou no histórico do chamado'); }
    else await sb(`chamados?id=eq.${chamado.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { atualizado_em: new Date().toISOString() } });
  }

  return resp({ ok: true, id: r.id || null, avisos });
}
