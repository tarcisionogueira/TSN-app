/**
 * /api/chamado-documentos   (admin/analista)
 *
 * Painel do CHAMADO DE DOCUMENTOS DO LEILOEIRO no Atendimento (04/11, pedido do dono). O chamado
 * nasce em api/_chamado-documentos.js quando o pedido automático não consegue sair; aqui a equipe
 * resolve sem sair do chamado:
 *
 *  GET  ?chamado_id=…              → lote, o que falta, pedidos já feitos, contato resolvido agora
 *  POST { acao:'enviar',  chamado_id } → manda o pedido por e-mail ao leiloeiro (depois de cadastrar
 *                                        o contato em /api/leiloeiro-contato), com o reply-to que faz
 *                                        a resposta entrar sozinha no lote
 *  POST { acao:'whatsapp', chamado_id, mensagem } → a equipe abriu o pedido no WhatsApp do leiloeiro (o envio
 *                                        é no aparelho dela, wa.me com o texto pronto — sem API paga): fica
 *                                        registrado no chamado o quê e para quem foi pedido (05/11)
 *  POST { acao:'regerar', chamado_id } → depois de a equipe anexar o documento (/api/upload-anexo):
 *                                        as análises documentais paradas em "faltam documentos"
 *                                        voltam para a fila do regenerar-relatorios-cron
 *
 * Encerrar o chamado quando o documento chega é do banco (gatilho `zz_anexo_chamado_documentos`).
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { pedidoRepetido, respostaRepetido } from './_pedido-unico.js';
import { pedirDocumentosAoLeiloeiro } from './_pedido-leiloeiro-auto.js';
import { registrarNoChamado, TIPO_CHAMADO_DOCUMENTOS } from './_chamado-documentos.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN   = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const ROLES = ['admin', 'analista'];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
}
function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
// Leitura que precisa dar certo: falha vira erro com o motivo, nunca lista vazia (forma #2).
async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

const SEL_IMOVEL = 'id,titulo,cidade,estado,fonte,leiloeiro,url_lote,numero_processo,tem_matricula_doc,tem_edital_doc,ativo';

function faltandoDo(imovel) {
  return [!imovel.tem_matricula_doc ? 'matricula' : null, !imovel.tem_edital_doc ? 'edital' : null].filter(Boolean);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-pedido-id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
  }
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);
  if (req.method === 'POST' && await pedidoRepetido(req, 'chamado-documentos')) return respostaRepetido();

  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role,nome`);
  if (!rPerfil.ok) return json({ error: 'Não foi possível verificar seu acesso agora. Tente novamente.' }, 500);
  const [perfil] = await rPerfil.json();
  if (!ROLES.includes(perfil?.role)) return json({ error: 'Apenas admin/analista' }, 403);

  let body = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); } }
  const chamadoId = String(req.method === 'GET' ? new URL(req.url).searchParams.get('chamado_id') || '' : body?.chamado_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(chamadoId)) return json({ error: 'chamado_id inválido' }, 400);

  try {
    const [chamado] = await ler(`chamados?id=eq.${chamadoId}&select=id,tipo,status,imovel_id&limit=1`);
    if (!chamado || chamado.tipo !== TIPO_CHAMADO_DOCUMENTOS || !chamado.imovel_id) return json({ error: 'Este chamado não é de documentos do leiloeiro' }, 404);
    const [imovel] = await ler(`imoveis_leilao?id=eq.${chamado.imovel_id}&select=${SEL_IMOVEL}&limit=1`);
    if (!imovel) return json({ error: 'Lote não encontrado' }, 404);

    if (req.method === 'GET') {
      const argsContato = JSON.stringify({ p_fonte: imovel.fonte || '', p_leiloeiro: imovel.leiloeiro || null });
      const [pedidos, anexos, rContato, rTel] = await Promise.all([
        ler(`documental_pedidos_leiloeiro?imovel_id=eq.${chamado.imovel_id}&select=id,status,destinatario_email,itens_pedidos,automatico,criado_em,respondido_em,anexos_recebidos&order=criado_em.desc&limit=20`),
        ler(`imovel_anexos?imovel_id=eq.${chamado.imovel_id}&tipo=in.(matricula,edital,regras_venda,regras,laudo)&select=tipo,nome,criado_em&order=criado_em.desc&limit=30`),
        sb('rpc/contato_leiloeiro_resolver', { method: 'POST', body: argsContato }),
        sb('rpc/telefone_leiloeiro_resolver', { method: 'POST', body: argsContato }),
      ]);
      // Contato ilegível ≠ "sem contato": a tela mostra o erro em vez de mandar cadastrar de novo.
      const contato = rContato.ok ? ((await rContato.json().catch(() => []))[0] || null) : undefined;
      const telefone = rTel.ok ? ((await rTel.json().catch(() => []))[0] || null) : undefined;
      return json({
        ok: true,
        imovel: { id: imovel.id, titulo: imovel.titulo, cidade: imovel.cidade, estado: imovel.estado, fonte: imovel.fonte, leiloeiro: imovel.leiloeiro, url_lote: imovel.url_lote, numero_processo: imovel.numero_processo, ativo: imovel.ativo },
        faltando: faltandoDo(imovel),
        pedidos, anexos,
        contato: contato === undefined ? { erro: `HTTP ${rContato.status}` } : contato ? { email: contato.email || null, escopo: contato.escopo || null } : null,
        telefone: telefone === undefined ? { erro: `HTTP ${rTel.status}` } : telefone ? { numero: telefone.telefone, whatsapp: !!telefone.whatsapp } : null,
      });
    }

    const acao = String(body?.acao || '');
    const autor = { autorTipo: 'atendente', autorNome: perfil.nome || user.email?.split('@')[0] || 'Equipe', autorId: user.id };

    if (acao === 'enviar') {
      const rl = await checkRateLimit(`chamado-documentos:enviar:${chamadoId}`, 3, 86_400_000);
      if (!rl.ok) return rateLimitedResponse(rl.resetAt);
      const faltando = faltandoDo(imovel);
      if (!faltando.length) return json({ error: 'Matrícula e edital já estão no lote — não há o que pedir.' }, 400);
      const p = await pedirDocumentosAoLeiloeiro({ imovelId: chamado.imovel_id, userId: user.id, faltando, forcar: true });
      if (p.pedidoId) {
        const rv = await sb(`documental_pedidos_leiloeiro?id=eq.${p.pedidoId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ chamado_id: chamadoId }) });
        if (!rv.ok) console.error('[chamado-documentos] vincular pedido HTTP', rv.status);
      }
      const texto = {
        enviado: `✉️ Pedido enviado ao leiloeiro (${p.destinatario}). A resposta com anexo entra sozinha no lote e encerra este chamado.`,
        represado: `✉️ Pedido aceito e na fila de envio para ${p.destinatario}. A resposta com anexo entra sozinha no lote.`,
        sem_contato: '⚠️ Ainda não há e-mail para este leiloeiro. Cadastre o contato e tente de novo.',
        falha: `⚠️ O e-mail para ${p.destinatario || 'o leiloeiro'} não saiu: ${p.erro || 'falha no envio'}. Confira o endereço.`,
        nada_a_pedir: 'ℹ️ Nada a pedir: o leilão já passou ou o lote é da Caixa.',
      }[p.status] || `⚠️ Não consegui pedir agora (${p.status}${p.erro ? `: ${p.erro}` : ''}).`;
      await registrarNoChamado(chamadoId, texto, autor);
      const ok = p.status === 'enviado' || p.status === 'represado';
      return json({ ok, status: p.status, destinatario: p.destinatario || null, mensagem: texto }, ok ? 200 : 422);
    }

    if (acao === 'whatsapp') {
      const rl = await checkRateLimit(`chamado-documentos:whatsapp:${chamadoId}`, 10, 86_400_000);
      if (!rl.ok) return rateLimitedResponse(rl.resetAt);
      const rTel = await sb('rpc/telefone_leiloeiro_resolver', { method: 'POST', body: JSON.stringify({ p_fonte: imovel.fonte || '', p_leiloeiro: imovel.leiloeiro || null }) });
      if (!rTel.ok) return json({ error: `Não consegui ler o telefone do leiloeiro (HTTP ${rTel.status}).` }, 502);
      const tel = (await rTel.json().catch(() => []))[0];
      if (!tel?.telefone) return json({ error: 'Este leiloeiro não tem telefone cadastrado.' }, 400);
      const mensagem = String(body?.mensagem || '').trim().slice(0, 1500);
      const texto = `💬 Pedido aberto no WhatsApp do leiloeiro (+${tel.telefone}) por ${autor.autorNome}. O que ele mandar, anexe aqui: o lote recebe o documento e as análises são geradas de novo.${mensagem ? `\n\nMensagem:\n${mensagem}` : ''}`;
      await registrarNoChamado(chamadoId, texto, autor);
      return json({ ok: true, mensagem: '💬 Registrado no chamado. Quando o leiloeiro mandar, anexe o arquivo aqui.' });
    }

    if (acao === 'regerar') {
      const rr = await sb(`analises_documental?imovel_id=eq.${chamado.imovel_id}&result->>precisaDocumentos=eq.true`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ regen_motivo: 'matricula_nao_lida', regen_tentativas: 0, updated_at: new Date().toISOString() }),
      });
      if (!rr.ok) return json({ error: `Não consegui marcar as análises para gerar de novo (HTTP ${rr.status}).` }, 502);
      const n = (await rr.json().catch(() => [])).length;
      await registrarNoChamado(chamadoId, n
        ? `🔄 ${n} análise(s) documental(is) deste lote voltaram para a fila e são geradas de novo com o documento anexado.`
        : 'ℹ️ Nenhuma análise documental deste lote estava esperando documento.', autor);
      return json({ ok: true, analises: n });
    }

    return json({ error: 'acao inválida (use enviar, whatsapp ou regerar)' }, 400);
  } catch (e) {
    console.error('[chamado-documentos] falhou:', String(e?.message || e).slice(0, 160));
    return json({ error: 'Não consegui ler o chamado agora: ' + String(e?.message || e).slice(0, 120) }, 502);
  }
}
