/**
 * POST /api/email-caixa  (equipe) — a parte SERVIDOR da caixa de e-mail de /atendimento.
 * Ler, mover de pasta, marcar lido e bloquear remetente a tela faz direto no banco (RLS de
 * `email_caixa`/`email_bloqueados`, só equipe). Aqui fica o que precisa de segredo:
 *
 *   { acao: 'enviar', de: 'suporte'|'contato'|'privacidade', para: [..], cc?: [..],
 *     assunto, texto, responder_a?: <id em email_caixa> }
 *   { acao: 'anexo', id: <id em email_caixa>, anexo_id } → { url } (link temporário do Resend)
 *   enviar aceita `anexos: [{ arquivo, nome, inline? }]` — arquivos que a TELA subiu para
 *   documentos/email/saida/<user>/ (09/10). `inline` = imagem colada no corpo: o marcador
 *   "[imagem: nome]" no texto vira a imagem no HTML (cid); sem marcador, vai como anexo comum.
 *
 * Resposta a e-mail que virou CHAMADO: o reply-to leva o token do chamado
 * (suporte+<token>@) e a mensagem entra no histórico do chamado como do atendente — a
 * resposta do cliente volta para o MESMO chamado e a fila conta a resposta humana.
 * Envio passa por `enviarEmail` (orçamento diário + lista de supressão, como todo o resto).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { pedidoRepetido, CORPO_REPETIDO } from './_pedido-unico.js';
import { SUPABASE_URL, SERVICE_KEY, acessoCaixa, sb, ler1, resolverAnexo, enviarDaCaixa } from './_caixa-envio.js';

const APP_ORIGIN   = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

// TIPO PELO NOME DO ARQUIVO (26/09, dono: anexo abria página em branco no iPhone). O Resend
// devolve todo anexo como application/octet-stream + "attachment" — o navegador do app não sabe
// mostrar e fica em branco. Com `proxy: true` o arquivo passa por aqui, com o tipo certo e inline.
const TIPOS = { pdf: 'application/pdf', html: 'text/plain; charset=utf-8', htm: 'text/plain; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', amr: 'audio/amr', mp4: 'video/mp4', mov: 'video/quicktime', zip: 'application/zip' };
// 18/10 (bug bounty): .html de quem manda e-mail para suporte@ abria como PÁGINA com a origem do app (blob
// via createObjectURL) — dava para montar um "sua sessão expirou" no nosso domínio. Vai como texto.
const tipoPeloNome = (nome) => TIPOS[String(nome || '').toLowerCase().split('.').pop()] || 'application/octet-stream';
async function entregarArquivo(url, nome) {
  const up = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!up.ok || !up.body) return json({ error: `O provedor não entregou o arquivo (HTTP ${up.status}).` }, 502);
  return new Response(up.body, { headers: {
    'Content-Type': tipoPeloNome(nome),
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nome || 'anexo')}`,
    'Cache-Control': 'private, no-store',
    'Access-Control-Allow-Origin': APP_ORIGIN,
  } });
}

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

  let perfil;
  try { perfil = await ler1(`perfis?id=eq.${user.id}&select=role,funcao_equipe,nome`); }
  catch (e) { console.error('[email-caixa] perfil:', e.message); return json({ error: 'Não foi possível verificar seu acesso agora.' }, 500); }
  // Advogado (23/09): usa só a PRÓPRIA caixa pessoal — envia por ela, nunca pela comunicação.
  const { permitido, soPessoal } = acessoCaixa(perfil);
  if (!permitido) return json({ error: 'A caixa de e-mail é só da equipe.' }, 403);

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // ─── ANEXO sob demanda: o binário fica no Resend; pedimos um link temporário na hora ───
  if (body?.acao === 'anexo') {
    const id = String(body?.id || ''), anexoId = String(body?.anexo_id || '');
    let msg;
    try { msg = await ler1(`email_caixa?id=eq.${encodeURIComponent(id)}&select=direcao,resend_email_id,anexos,dono`); }
    catch (e) { console.error('[email-caixa] anexo:', e.message); return json({ error: 'Não foi possível ler a mensagem.' }, 500); }
    // Mesma cerca da RLS (a chave aqui é de serviço): caixa pessoal só o dono; comunicação só
    // quem tem acesso a ela (advogado não).
    if (msg && (msg.dono ? msg.dono !== user.id : soPessoal)) return json({ error: 'Anexo não encontrado' }, 404);
    const res = await resolverAnexo(msg, { anexoId, idx: Number(body?.anexo_idx) });
    if (res.erro) return json({ error: res.erro }, res.status);
    // Cópia NOSSA (09/10, dono: vídeo anexado abria preto em 0:00): o Storage já serve com o tipo
    // certo e aceita leitura por pedaços (Range), que é o que o player de vídeo/áudio precisa. Passar
    // pela função quebrava mídia — teto de resposta da Vercel (~4,5 MB) e blob sem Range. Vai o link.
    if (body?.proxy === true && res.nosso) return json({ ok: true, url: res.url, direto: true });
    if (body?.proxy === true) return entregarArquivo(res.url, res.nome);
    return json({ ok: true, url: res.url });
  }

  // ─── CLIENTE DO CASO (10/10, dono): o advogado responde com a guia da parcela e a equipe manda
  // SÓ o anexo ao cliente — sem o texto do advogado. A tela pede aqui o destinatário do caso.
  // Só a equipe da caixa (advogado não fala com o cliente por aqui).
  if (body?.acao === 'cliente_do_caso') {
    if (soPessoal) return json({ error: 'Só a equipe envia ao cliente.' }, 403);
    const casoId = String(body?.caso_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(casoId)) return json({ error: 'caso_id inválido' }, 400);
    let caso;
    try { caso = await ler1(`casos?id=eq.${casoId}&select=id,cliente_id,imovel_endereco,posse_em,copiar_cliente`); }
    catch (e) { console.error('[email-caixa] caso:', e.message); return json({ error: 'Não foi possível ler o caso.' }, 500); }
    if (!caso?.cliente_id) return json({ error: 'Caso sem cliente.' }, 404);
    let cli = null, email = null;
    try {
      cli = await ler1(`perfis?id=eq.${caso.cliente_id}&select=nome`);
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${caso.cliente_id}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      if (!r.ok) throw new Error(`auth HTTP ${r.status}`);
      email = (await r.json())?.email || null;
    } catch (e) { console.error('[email-caixa] cliente do caso:', e.message); return json({ error: 'Não foi possível ler o e-mail do cliente.' }, 500); }
    if (!email) return json({ error: 'O cliente deste caso não tem e-mail cadastrado.' }, 404);
    return json({ ok: true, email, nome: cli?.nome || null, endereco: caso.imovel_endereco || null, posse_em: caso.posse_em, copiar_cliente: caso.copiar_cliente === true });
  }

  if (body?.acao !== 'enviar') return json({ error: 'acao inválida' }, 400);
  if (await pedidoRepetido(req, 'email-caixa:enviar')) return json(CORPO_REPETIDO, 409); // comando repetido pela rede/navegador (30/10)

  const rl = await checkRateLimit(`email-caixa:user:${user.id}`, 80, 86_400_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  // O envio em si mora em _caixa-envio.js (23/11) — o envio AGENDADO usa a mesma função.
  const r = await enviarDaCaixa({ user, perfil, soPessoal, body });
  return json(r.obj, r.status);
}
