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
  if (!WH_SECRET) return false;
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

function headerMap(data) {
  const h = {};
  const arr = data?.headers || [];
  if (Array.isArray(arr)) arr.forEach(x => { if (x?.name) h[x.name.toLowerCase()] = x.value; });
  else if (arr && typeof arr === 'object') Object.entries(arr).forEach(([k, v]) => { h[k.toLowerCase()] = v; });
  return h;
}
function extrairToken(data, headers) {
  const dests = []
    .concat(data?.to || [], data?.cc || [], headers['delivered-to'] || [], headers['to'] || [])
    .flatMap(x => typeof x === 'string' ? [x] : (x?.address ? [x.address] : []));
  for (const d of dests) {
    const m = String(d).match(/juridico\+([a-z0-9]+)@/i);
    if (m) return m[1];
  }
  return null;
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
    const data = await res.json();
    const txt = data?.content?.[0]?.text || '';
    const ini = txt.indexOf('{'), fim = txt.lastIndexOf('}');
    if (ini < 0 || fim < 0) return null;
    return JSON.parse(txt.slice(ini, fim + 1));
  } catch { return null; }
}

const ENUM_RESULT = ['recomendo', 'recomendo_ressalvas', 'nao_recomendo'];
const ENUM_RISCO = ['baixo', 'medio', 'alto'];

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const raw = await req.text();
  if (!(await verificarAssinatura(req, raw))) return json({ error: 'assinatura inválida' }, 401);

  let evt; try { evt = JSON.parse(raw); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (evt?.type && evt.type !== 'email.received') return json({ ok: true, ignored: evt.type });
  const data = evt?.data || evt;
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
  if (!caso) return json({ ok: true, unmatched: true }); // 200 p/ não gerar retry infinito

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

  // Atualiza o caso
  await sb(`casos?id=eq.${caso.id}`, { method: 'PATCH', prefer: 'return=minimal',
    body: { status_etapa: 'juridico_concluido', juridico_status: 'publicado' } });

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
