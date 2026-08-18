/**
 * POST /api/inbound-juridico  (webhook do Resend — evento email.received)
 * Recebe a resposta do advogado por e-mail, casa ao caso (reply-to juridico+token@
 * + cabeçalhos In-Reply-To/References), remove o texto citado, salva anexos,
 * compila a devolutiva com a IA (parecer + divergências vs. avaliação documental),
 * atualiza o caso e publica no chat interno (analista/admin).
 *
 * Config no Resend: webhook do tipo email.received apontando para esta URL,
 * com o segredo em INBOUND_WEBHOOK_SECRET. Domínio de recebimento em INBOUND_EMAIL_DOMAIN.
 */
export const config = { runtime: 'edge' };
import { anthropicFetch } from './_claude.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const WH_SECRET    = process.env.INBOUND_WEBHOOK_SECRET; // whsec_... (Svix)

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

// ---- Verificação de assinatura Svix (Resend) ----
async function verificarAssinatura(req, raw) {
  // Fail-closed: sem segredo configurado, REJEITA (evita processar e-mails forjados
  // que sobrescreveriam o parecer jurídico). Em produção, definir INBOUND_WEBHOOK_SECRET.
  if (!WH_SECRET) { console.error('[inbound-juridico] INBOUND_WEBHOOK_SECRET não configurado — devolutivas do advogado serão rejeitadas. Configure no deploy.'); return false; }
  try {
    const id = req.headers.get('svix-id');
    const ts = req.headers.get('svix-timestamp');
    const sigHeader = req.headers.get('svix-signature') || '';
    if (!id || !ts || !sigHeader) return false;
    const secretB64 = WH_SECRET.replace(/^whsec_/, '');
    const keyBytes = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = `${id}.${ts}.${raw}`;
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return sigHeader.split(' ').some(p => p.split(',')[1] === expected);
  } catch { return false; }
}

// ---- Remove o trecho citado, mantém só a resposta nova ----
function limparResposta(texto) {
  if (!texto) return '';
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const marcadores = [
    /^\s*Em .*escreveu:\s*$/i,           // Gmail pt
    /^\s*On .*wrote:\s*$/i,              // Gmail en
    /^\s*-{2,}\s*Mensagem original\s*-{2,}/i,
    /^\s*-{2,}\s*Original Message\s*-{2,}/i,
    /^\s*De:\s.+/i,                      // Outlook pt (bloco de cabeçalho)
    /^\s*From:\s.+/i,                    // Outlook en
    /^\s*_{5,}\s*$/,                     // separador Outlook
  ];
  for (const l of linhas) {
    if (marcadores.some(m => m.test(l))) break;
    if (/^\s*>/.test(l)) continue; // linha citada
    out.push(l);
  }
  return out.join('\n').trim() || texto.trim();
}

// ─── O WEBHOOK ANUNCIA O E-MAIL; O CORPO MORA NA API (18/08) ─────────────────────
// Contrato REAL do `email.received`, conferido numa entrega de produção (não presumido —
// foi presumir que custou o primeiro e-mail da história do endpoint): o payload traz
// attachments, bcc, cc, created_at, EMAIL_ID, from, message_id, received_for, subject, to.
// text/html NÃO vêm. O corpo se busca em GET /emails/receiving/{email_id} — endpoint
// conferido no SDK OFICIAL (resend@npm, src/emails/receiving): a resposta traz text, html,
// headers e anexos. NÃO é o GET /emails/{id}: esse só serve e-mails ENVIADOS e devolve
// 404 para os recebidos — foi o que o teste de 18:53 provou, com o log dizendo por extenso.
//
// Falha aqui NUNCA derruba o webhook: sem corpo, o chamado nasce mesmo assim com o aviso
// "[mensagem sem texto…]" — visível na fila, onde alguém pergunta "cadê o texto?" — e o
// log diz o que a API respondeu. Ausência visível, nunca 200 mudo.
async function buscarCorpoNaApi(emailId) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !emailId) return null;
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error('[inbound] corpo: API respondeu', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return null;
    }
    const j = await r.json().catch(() => null);
    if (!j || (!j.text && !j.html)) {
      // 200 sem corpo = o contrato é OUTRO. As chaves no log dizem qual.
      console.error('[inbound] corpo: API 200 sem text/html — keys:', Object.keys(j || {}).join(','));
      return null;
    }
    return { text: j.text || '', html: j.html || '' };
  } catch (e) {
    console.error('[inbound] corpo: busca falhou', String(e?.message || e).slice(0, 120));
    return null;
  }
}

function headerMap(data) {
  const h = {};
  const arr = data?.headers || [];
  if (Array.isArray(arr)) arr.forEach(x => { if (x?.name) h[x.name.toLowerCase()] = x.value; });
  else if (arr && typeof arr === 'object') Object.entries(arr).forEach(([k, v]) => { h[k.toLowerCase()] = v; });
  return h;
}
function destinatarios(data, headers) {
  return []
    .concat(data?.to || [], data?.cc || [], headers['delivered-to'] || [], headers['to'] || [])
    .flatMap(x => typeof x === 'string' ? [x] : (x?.address ? [x.address] : []));
}
function extrairToken(data, headers) {
  for (const d of destinatarios(data, headers)) {
    const m = String(d).match(/juridico\+([a-z0-9]+)@/i);
    if (m) return m[1];
  }
  return null;
}
// Token do fio de ATENDIMENTO: `suporte+<token>@` no To/Cc.
function extrairTokenSuporte(data, headers) {
  for (const d of destinatarios(data, headers)) {
    const m = String(d).match(/(?:suporte|contato|privacidade)\+([a-z0-9]+)@/i);
    if (m) return m[1];
  }
  return null;
}
function remetente(data) {
  const f = data?.from;
  const endereco = (typeof f === 'string' ? f : f?.address) || '';
  const nome = (typeof f === 'string' ? '' : f?.name) || '';
  const m = String(endereco).match(/<([^>]+)>/);
  return { endereco: (m ? m[1] : endereco).trim().toLowerCase(), nome: nome.trim() };
}

async function uploadAnexo(imovelId, att) {
  try {
    const bytes = Uint8Array.from(atob(att.content), c => c.charCodeAt(0));
    const nome = (att.filename || 'parecer').replace(/[^\w.\-]+/g, '_');
    const path = `casos/${imovelId}/parecer_${Date.now()}_${nome}`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': att.content_type || 'application/octet-stream' },
      body: bytes,
    });
    if (!up.ok) return null;
    const signed = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 }),
    }).then(r => r.json()).catch(() => null);
    const url = signed?.signedURL ? `${SUPABASE_URL}/storage/v1${signed.signedURL}` : null;
    return { nome, url, tipo: 'parecer_juridico', tamanho_kb: Math.round(bytes.length / 1024) };
  } catch { return null; }
}

async function compilarComIA(devolutiva, docMd) {
  if (!CLAUDE_KEY) return null;
  const sys = `Você compila pareceres jurídicos de imóveis em leilão. Recebe a AVALIAÇÃO DOCUMENTAL PRELIMINAR do sistema e a DEVOLUTIVA do advogado (texto de e-mail). Sua tarefa: extrair a posição do advogado, compilar um parecer jurídico final (documental + jurídico) e listar divergências em relação à avaliação do sistema.
Responda SOMENTE com um JSON válido, sem texto fora dele:
{"resultado":"recomendo|recomendo_ressalvas|nao_recomendo|null","nivel_risco":"baixo|medio|alto|null","ressalvas":"string","relatorio_md":"parecer final compilado em markdown","red_flags":["..."],"divergencias":[{"campo":"...","valor_ia":"...","valor_advogado":"...","observacao":"..."}]}
Regras: nunca invente fatos; se o advogado não deu posição clara, use null em resultado/nivel_risco e explique no relatório. Seja fiel ao que o advogado escreveu.`;
  const userMsg = `## Avaliação documental preliminar do sistema:\n${docMd || '(não disponível)'}\n\n## Devolutiva do advogado (e-mail):\n${devolutiva}`;
  try {
    const res = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: sys, messages: [{ role: 'user', content: userMsg }] }),
    });
    // FALHA-ALTO: `anthropicFetch` DEVOLVE o Response não-ok depois de esgotar os retries
    // (não lança), então sem checar `.ok` um 429/529 da Anthropic virava `txt = ''` e a
    // compilação retornava null EM SILÊNCIO. O caso seguia para `juridico_status='publicado'`
    // com resultado/nivel_risco/red_flags nulos e zero linhas em `juridico_aprendizado` — e,
    // publicado, saía do alcance do juridico-lembretes-cron (que só varre `em_revisao`).
    // Ou seja: a devolutiva do advogado era perdida como aprendizado e ninguém era avisado.
    // Distinguir null (sem IA) de erro permite ao chamador NÃO publicar.
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      console.error('[inbound-juridico] compilação IA falhou', res.status, String(corpo).slice(0, 300));
      return { __falhouIA: true };
    }
    const data = await res.json();
    const txt = data?.content?.[0]?.text || '';
    const ini = txt.indexOf('{'), fim = txt.lastIndexOf('}');
    if (ini < 0 || fim < 0) return null;
    return JSON.parse(txt.slice(ini, fim + 1));
  } catch { return null; }
}

const ENUM_RESULT = ['recomendo', 'recomendo_ressalvas', 'nao_recomendo'];
const ENUM_RISCO = ['baixo', 'medio', 'alto'];

// ─── E-mail que NÃO é devolutiva de advogado → vira CHAMADO no Atendimento ────
//
// Três formas de casar com uma conversa que já existe, da mais forte para a mais
// fraca, antes de abrir um chamado novo:
//   1. token do reply-to (`suporte+<token>@`) — é o que nós mesmos enviamos;
//   2. In-Reply-To/References contra o Message-ID de uma mensagem já gravada —
//      cobre o cliente que responde um e-mail nosso anterior ao token existir;
//   3. remetente com chamado ABERTO no canal e-mail — cobre quem escreve de novo
//      em vez de responder o fio. Sem isto, cada mensagem viraria um chamado solto.
//
// ANEXOS: o remetente aqui é QUALQUER UM da internet. Guardar o conteúdo criaria
// um caminho de upload não autenticado para o nosso storage (abuso de espaço e,
// pior, hospedagem de arquivo com URL assinada nossa). Registramos só os NOMES,
// e o atendente pede reenvio pelo chat se precisar do arquivo.
// Assinatura do payload SEM o conteúdo: quais chaves vieram e o tamanho de cada corpo.
// Existe porque em 18/08 o primeiro e-mail REAL da história do endpoint entrou, saiu 200
// e não deixou rastro — nem chamado, nem log. Descarte silencioso é o defeito da casa.
function formatoDoPayload(data) {
  return `keys=[${Object.keys(data || {}).join(',')}] text=${(data?.text || '').length} html=${(data?.html || '').length} anexos=${(data?.attachments || []).length}`;
}

async function encaminharParaAtendimento(data, headers, messageId) {
  const { endereco, nome } = remetente(data);
  if (!endereco) {
    console.error('[inbound-atendimento] IGNORADO sem_remetente —', formatoDoPayload(data));
    return json({ ok: true, ignorado: 'sem_remetente' });
  }

  const assunto = String(data?.subject || '').trim().slice(0, 200) || 'Mensagem por e-mail';
  const corpo = limparResposta(data?.text || data?.html?.replace(/<[^>]+>/g, ' ') || '').slice(0, 20000);
  const anexos = (data?.attachments || [])
    .map(a => ({ nome: String(a?.filename || 'anexo').slice(0, 120), tipo: 'email_nao_armazenado' }));
  // Só descarta quando NÃO HÁ NADA: nem corpo, nem anexo, nem assunto. E-mail com assunto e
  // corpo vazio ainda é um cliente falando (ou o payload do webhook veio sem o corpo — caso
  // em que descartar esconderia o problema; gravar com '[mensagem sem texto]' o torna visível
  // na fila, onde alguém pergunta "cadê o texto?" e o defeito aparece).
  if (!corpo && !anexos.length && !String(data?.subject || '').trim()) {
    console.error('[inbound-atendimento] IGNORADO vazio —', formatoDoPayload(data));
    return json({ ok: true, ignorado: 'vazio' });
  }

  // Leitura que LANÇA em não-2xx. Aqui um `{}` silencioso não é inofensivo: falhar em
  // achar o fio existente faz a resposta do cliente virar um chamado NOVO, fragmentando a
  // conversa sem nenhum erro à vista. Melhor devolver 500 e deixar o Resend reentregar.
  const buscar1 = async (path) => {
    const r = await sb(path);
    if (!r.ok) throw new Error(`consulta ${r.status}: ${path.split('?')[0]}`);
    const linhas = await r.json();
    return Array.isArray(linhas) ? (linhas[0] || null) : null;
  };

  let chamado = null;
  try {
    const tok = extrairTokenSuporte(data, headers);
    if (tok) chamado = await buscar1(`chamados?email_token=eq.${encodeURIComponent(tok)}&select=id,status&limit=1`);
    if (!chamado) {
      const refs = `${headers['in-reply-to'] || ''} ${headers['references'] || ''}`.match(/[^\s<>]+/g) || [];
      for (const ref of refs) {
        const m = await buscar1(`chamados_mensagens?email_message_id=eq.${encodeURIComponent(ref)}&select=chamado_id&limit=1`);
        if (!m?.chamado_id) continue;
        chamado = await buscar1(`chamados?id=eq.${encodeURIComponent(m.chamado_id)}&select=id,status&limit=1`);
        if (chamado) break;
      }
    }
    if (!chamado) {
      chamado = await buscar1(`chamados?canal=eq.email&user_email=eq.${encodeURIComponent(endereco)}&status=eq.aberto&select=id,status&order=criado_em.desc&limit=1`);
    }
  } catch (e) {
    console.error('[inbound-atendimento] busca do fio', e?.message || e);
    return json({ error: 'consulta_falhou' }, 500);
  }

  let novo = false;
  if (!chamado) {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const r = await sb('chamados', {
      method: 'POST', prefer: 'return=representation',
      body: {
        user_id: null, user_email: endereco, user_nome: nome || endereco,
        titulo: assunto, status: 'aberto', segmento: 'curioso', tipo: 'duvida',
        origem: 'email', canal: 'email', email_token: token,
      },
    });
    if (!r.ok) {
      // Falhar aqui é PERDER a mensagem do cliente. 500 faz o Resend re-entregar.
      console.error('[inbound-atendimento] criar chamado', r.status, await r.text().catch(() => ''));
      return json({ error: 'nao_foi_possivel_abrir_chamado' }, 500);
    }
    [chamado] = await r.json();
    novo = true;
  } else if (chamado.status !== 'aberto') {
    await sb(`chamados?id=eq.${chamado.id}`, { method: 'PATCH', body: { status: 'aberto' } });
  }

  const rm = await sb('chamados_mensagens', {
    method: 'POST', prefer: 'return=representation',
    body: {
      chamado_id: chamado.id, autor_id: null, autor_nome: nome || endereco,
      autor_tipo: 'cliente', conteudo: corpo || `[mensagem sem texto — ler no painel do Resend, id ${data?.email_id || '?'}]`,
      anexos, canal: 'email', email_message_id: messageId || null,
    },
  });
  if (!rm.ok) {
    const txt = await rm.text().catch(() => '');
    // 23505 = índice único de email_message_id: o webhook reentregou a MESMA
    // mensagem. Isso é sucesso, não erro — devolver 500 pediria mais reentregas.
    if (/23505|duplicate key/i.test(txt)) return json({ ok: true, duplicate: true });
    console.error('[inbound-atendimento] gravar mensagem', rm.status, txt);
    return json({ error: 'nao_foi_possivel_gravar_mensagem' }, 500);
  }

  await sb(`chamados?id=eq.${chamado.id}`, { method: 'PATCH', body: { atualizado_em: new Date().toISOString() } });
  return json({ ok: true, atendimento: true, chamado_id: chamado.id, novo });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const raw = await req.text();
  if (!(await verificarAssinatura(req, raw))) return json({ error: 'assinatura inválida' }, 401);

  let evt; try { evt = JSON.parse(raw); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (evt?.type && evt.type !== 'email.received') {
    console.error('[inbound-juridico] IGNORADO tipo de evento:', evt.type);
    return json({ ok: true, ignored: evt.type });
  }
  const data = evt?.data || evt;
  // Hidrata o corpo ANTES de rotear: tanto a devolutiva do advogado quanto o chamado de
  // atendimento leem data.text/data.html, e o payload não os traz.
  if (!data?.text && !data?.html && data?.email_id) {
    const corpo = await buscarCorpoNaApi(data.email_id);
    if (corpo) { data.text = corpo.text; data.html = corpo.html; }
  }
  const headers = headerMap(data);
  const messageId = headers['message-id'] || data?.message_id || data?.id || null;

  // Idempotência
  if (messageId) {
    const [dup] = await (await sb(`juridico_emails?message_id=eq.${encodeURIComponent(messageId)}&direcao=eq.entrada&select=id&limit=1`)).json();
    if (dup) return json({ ok: true, duplicate: true });
  }

  // Casa ao caso: token do reply-to → fallback In-Reply-To/References
  let caso = null;
  const token = extrairToken(data, headers);
  if (token) {
    [caso] = await (await sb(`casos?juridico_token=eq.${encodeURIComponent(token)}&select=*`)).json();
  }
  if (!caso) {
    const refs = `${headers['in-reply-to'] || ''} ${headers['references'] || ''}`.match(/[^\s<>]+/g) || [];
    for (const ref of refs) {
      [caso] = await (await sb(`casos?juridico_email_id=eq.${encodeURIComponent(ref)}&select=*`)).json();
      if (caso) break;
    }
  }
  // NÃO É UM CASO JURÍDICO → é e-mail para o atendimento (suporte@, privacidade@,
  // contato@ …). Antes esta linha era `return { ok:true, unmatched:true }`: o e-mail
  // sumia com HTTP 200, sem log e sem alerta — inclusive a resposta do cliente ao
  // "é só responder este e-mail" que nós mesmos mandamos, e pedido de titular de
  // dados endereçado ao privacidade@, que a LGPD obriga a atender.
  if (!caso) return await encaminharParaAtendimento(data, headers, messageId);

  const corpoBruto = data?.text || data?.html?.replace(/<[^>]+>/g, ' ') || '';
  const devolutiva = limparResposta(corpoBruto);

  // Anexos do advogado → storage + imovel_anexos
  const anexosSalvos = [];
  for (const att of (data?.attachments || [])) {
    if (!att?.content) continue;
    const salvo = await uploadAnexo(caso.imovel_id, att);
    if (salvo) {
      anexosSalvos.push(salvo);
      await sb('imovel_anexos', { method: 'POST', prefer: 'return=minimal',
        body: { imovel_id: caso.imovel_id, tipo: 'parecer_juridico', nome: salvo.nome, url: salvo.url, tamanho_kb: salvo.tamanho_kb, criado_por: caso.advogado_id, role_criador: 'advogado' } });
    }
  }

  // Relatório documental para comparar
  const [doc] = await (await sb(`analise_relatorios?caso_id=eq.${encodeURIComponent(caso.id)}&tipo=eq.juridica_preliminar&select=conteudo_md&order=versao.desc&limit=1`)).json();
  const compilado = await compilarComIA(devolutiva, doc?.conteudo_md);

  // Persiste parecer em analise_juridica (upsert por caso)
  const resultado = ENUM_RESULT.includes(compilado?.resultado) ? compilado.resultado : null;
  const nivel = ENUM_RISCO.includes(compilado?.nivel_risco) ? compilado.nivel_risco : null;
  const ajPayload = {
    caso_id: caso.id, advogado_id: caso.advogado_id, entregue_em: new Date().toISOString(),
    resultado, nivel_risco: nivel,
    ressalvas: compilado?.ressalvas || null,
    relatorio_md: compilado?.relatorio_md || devolutiva,
    red_flags: Array.isArray(compilado?.red_flags) ? compilado.red_flags : null,
  };
  const [ajExist] = await (await sb(`analise_juridica?caso_id=eq.${encodeURIComponent(caso.id)}&select=id&limit=1`)).json();
  if (ajExist) await sb(`analise_juridica?id=eq.${ajExist.id}`, { method: 'PATCH', prefer: 'return=minimal', body: ajPayload });
  else await sb('analise_juridica', { method: 'POST', prefer: 'return=minimal', body: ajPayload });

  // Aprendizado: divergências
  for (const d of (compilado?.divergencias || [])) {
    await sb('juridico_aprendizado', { method: 'POST', prefer: 'return=minimal',
      body: { caso_id: caso.id, imovel_id: caso.imovel_id, campo: d.campo || null, valor_ia: d.valor_ia || null, valor_advogado: d.valor_advogado || null, observacao: d.observacao || null } });
  }

  // Atualiza o caso. Se a IA FALHOU (indisponibilidade da Anthropic), o caso NÃO é publicado:
  // fica em revisão para a próxima passada compilar de verdade. Publicar aqui apagaria o
  // veredito estruturado e ainda tiraria o caso do juridico-lembretes-cron, que só varre
  // `em_revisao` — o parecer do advogado ficaria órfão sem ninguém perceber. O texto dele já
  // está preservado em `relatorio_md` acima, então nada se perde ao adiar.
  if (compilado?.__falhouIA) {
    console.warn('[inbound-juridico] IA indisponível — caso mantido em revisão para recompilar', caso.id);
  } else {
    await sb(`casos?id=eq.${caso.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: { status_etapa: 'juridico_concluido', juridico_status: 'publicado' } });
  }

  // Auditoria do e-mail recebido
  await sb('juridico_emails', { method: 'POST', prefer: 'return=minimal',
    body: { caso_id: caso.id, direcao: 'entrada', message_id: messageId, in_reply_to: headers['in-reply-to'] || null, de: data?.from?.address || data?.from || null, para: `juridico+${token || ''}`, assunto: data?.subject || null, corpo: devolutiva, anexos: anexosSalvos.map(a => ({ nome: a.nome })) } });

  // Publica no chat interno (analista/admin)
  let [chamado] = await (await sb(`chamados?caso_id=eq.${encodeURIComponent(caso.id)}&segmento=eq.interno&select=id&limit=1`)).json();
  if (!chamado) {
    const refCurto = String(caso.id).split('-')[0].toUpperCase();
    [chamado] = await (await sb('chamados', { method: 'POST', prefer: 'return=representation',
      body: { user_id: null, user_email: null, user_nome: 'Jurídico', titulo: `Jurídico — ${caso.imovel_endereco || refCurto}`, status: 'em_atendimento', segmento: 'interno', caso_id: caso.id } })).json();
  }
  if (chamado?.id) {
    const anexosMsg = anexosSalvos.map(a => ({ tipo: 'arquivo', url: a.url, nome: a.nome }));
    await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal',
      body: { chamado_id: chamado.id, autor_id: caso.advogado_id, autor_nome: 'Advogado', autor_tipo: 'advogado', conteudo: devolutiva, anexos: anexosMsg } });
    const resumo = resultado ? `Resultado: ${resultado.replace('_', ' ')}${nivel ? ` · risco ${nivel}` : ''}` : 'parecer registrado';
    await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal',
      body: { chamado_id: chamado.id, autor_tipo: 'sistema', autor_nome: 'Sistema', conteudo: `✅ Parecer jurídico recebido e compilado (${resumo}). Caso movido para "jurídico concluído".`, anexos: [] } });
  }

  return json({ ok: true, caso_id: caso.id, resultado, divergencias: (compilado?.divergencias || []).length });
}
