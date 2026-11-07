/**
 * /api/atendimento-canal  (cliente logado)
 *  GET  -> { advogados: [{ caso_id, imovel, nome }] }  o que este cliente pode escolher
 *  POST { acao:'abrir', destino:'equipe'|'advogado', mensagem, anexos?, caso_id? }  abre o chamado já com a pessoa
 *  POST { acao:'transferir', chamado_id, destino, caso_id? }  sai da IA para a pessoa
 *  POST { acao:'encaminhar', chamado_id, mensagem_id }  leva ao advogado a mensagem nova do cliente
 * Ver api/_atendimento-canal.js. A posse do chamado e do caso é sempre conferida aqui (service key).
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { sb, lerLista, advogadosDoCliente, casoDoCliente, canalAdvogadoLigado, emailAoAdvogado, TIPO_JURIDICO_CLIENTE,
  mensagemSistema, atualizarChamado, paraEquipe } from './_atendimento-canal.js';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const SEGMENTO = { explorador: 'explorador', top2: 'investidor', assessorado: 'assessorado', clube: 'clube' };

async function paraAdvogado(chamado, caso, nome, texto) {
  const token = chamado.email_token || crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const linha = await atualizarChamado(chamado.id, { status: 'em_atendimento', tipo: TIPO_JURIDICO_CLIENTE, caso_id: caso.id, email_token: token, atendente_nome: 'Advogado do caso' });
  const r = await emailAoAdvogado({ chamado: linha, caso, clienteNome: nome, texto, chaveEnvio: `chamado-adv-${chamado.id}` });
  // Orçamento diário do e-mail: represado sai depois. Não é falha, e cair para a equipe duplicaria o atendimento.
  if (!r.ok && r.enfileirado) {
    await mensagemSistema(chamado.id, 'Sua mensagem foi registrada e segue ao advogado assim que o envio for liberado. A resposta aparece aqui.');
    return { chamado: linha };
  }
  if (!r.ok) {
    console.error('[atendimento-canal] e-mail ao advogado não saiu', r.error);
    const fallback = await paraEquipe(linha, nome, texto, {
      avisoCliente: 'Não consegui entregar sua mensagem ao advogado agora. Nossa equipe assumiu e responde por aqui em até 24 h em dia útil (48 h em fim de semana e feriado).',
      motivoInterno: 'O envio ao advogado falhou.',
    });
    return { chamado: fallback, aviso: 'Não consegui falar com o advogado agora. Sua mensagem foi para a equipe.' };
  }
  await mensagemSistema(chamado.id, '✅ Sua mensagem foi enviada ao advogado do seu caso. A resposta aparece aqui, e o prazo é de até 3 dias úteis.');
  return { chamado: linha };
}

export default async function handler(req) {
  const user = await getAuthUser(req);
  if (!user?.id) return json({ error: 'Faça login.' }, 401);
  const rl = await checkRateLimit(`atendimento-canal:${user.id}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  try {
    if (req.method === 'GET') return json({ advogados: await advogadosDoCliente(user.id) });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    if (b.destino === 'advogado' && !(await canalAdvogadoLigado())) return json({ error: 'A conversa direta com o advogado ainda não está disponível. Fale com a equipe de atendimento.' }, 409);
    const [perfil] = await lerLista(`perfis?id=eq.${user.id}&select=nome,role&limit=1`);
    const nome = perfil?.nome || user.email;

    if (b.acao === 'abrir') {
      const mensagem = String(b.mensagem || '').trim().slice(0, 20000);
      if (!mensagem) return json({ error: 'Escreva a sua mensagem.' }, 400);
      if (!['equipe', 'advogado'].includes(b.destino)) return json({ error: 'Destino inválido.' }, 400);
      const caso = b.destino === 'advogado' ? await casoDoCliente(b.caso_id, user.id) : null;
      if (b.destino === 'advogado' && !caso) return json({ error: 'Caso não encontrado.' }, 404);
      const rc = await sb('chamados', { method: 'POST', prefer: 'return=representation', body: {
        user_id: user.id, user_email: user.email, user_nome: nome, titulo: mensagem.slice(0, 80), segmento: SEGMENTO[perfil?.role] || 'outro',
      } });
      if (!rc.ok) throw new Error(`chamado não criado (HTTP ${rc.status})`);
      const [chamado] = await rc.json();
      const rm = await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal', body: {
        chamado_id: chamado.id, autor_id: user.id, autor_nome: nome, autor_tipo: 'cliente', conteudo: mensagem,
        anexos: Array.isArray(b.anexos) ? b.anexos.slice(0, 5) : [],
      } });
      if (!rm.ok) throw new Error(`mensagem não gravada (HTTP ${rm.status})`);
      if (b.destino === 'equipe') return json({ chamado: await paraEquipe(chamado, nome, mensagem) });
      return json(await paraAdvogado(chamado, caso, nome, mensagem));
    }

    const [chamado] = await lerLista(`chamados?id=eq.${encodeURIComponent(b.chamado_id)}&user_id=eq.${user.id}&select=*&limit=1`);
    if (!chamado) return json({ error: 'Chamado não encontrado.' }, 404);
    if (chamado.status === 'finalizado') return json({ error: 'Este atendimento já foi encerrado.' }, 409);

    if (b.acao === 'transferir') {
      if (!['equipe', 'advogado'].includes(b.destino)) return json({ error: 'Destino inválido.' }, 400);
      // Já está com a equipe (a IA escalou no servidor): não repete aviso nem e-mail.
      if (b.destino === 'equipe' && chamado.status === 'aguardando_atendente') return json({ chamado });
      const falas = await lerLista(`chamados_mensagens?chamado_id=eq.${chamado.id}&autor_tipo=eq.cliente&select=conteudo&order=criado_em.desc&limit=5`);
      const texto = falas.reverse().map((m) => m.conteudo).join('\n\n') || chamado.titulo || '(sem texto)';
      if (b.destino === 'equipe') return json({ chamado: await paraEquipe(chamado, nome, texto) });
      const caso = await casoDoCliente(b.caso_id, user.id);
      if (!caso) return json({ error: 'Caso não encontrado.' }, 404);
      return json(await paraAdvogado(chamado, caso, nome, texto));
    }

    if (b.acao === 'encaminhar') {
      if (chamado.tipo !== TIPO_JURIDICO_CLIENTE || !chamado.caso_id) return json({ error: 'Este chamado não está com o advogado.' }, 409);
      const [m] = await lerLista(`chamados_mensagens?id=eq.${encodeURIComponent(b.mensagem_id)}&chamado_id=eq.${chamado.id}&autor_tipo=eq.cliente&select=id,conteudo&limit=1`);
      if (!m) return json({ error: 'Mensagem não encontrada.' }, 404);
      const caso = await casoDoCliente(chamado.caso_id, user.id);
      if (!caso) return json({ error: 'Caso não encontrado.' }, 404);
      const r = await emailAoAdvogado({ chamado, caso, clienteNome: nome, texto: m.conteudo, chaveEnvio: `chamado-msg-${m.id}` });
      if (!r.ok && !r.enfileirado) return json({ error: 'A mensagem ficou registrada, mas o e-mail ao advogado não saiu. Peça ajuda à equipe.' }, 502);
      return json({ ok: true });
    }
    return json({ error: 'Ação inválida.' }, 400);
  } catch (e) {
    console.error('[atendimento-canal]', String(e?.message || e));
    return json({ error: 'Não consegui concluir agora. Tente de novo em instantes.' }, 502);
  }
}
