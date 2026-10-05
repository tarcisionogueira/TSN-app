/**
 * PEDIDO AUTOMÁTICO DE DOCUMENTO AO LEILOEIRO (05/10, regra do dono)
 *
 * "Um caso sem edital nem matrícula deveria solicitar via e-mail ao leiloeiro os documentos para
 * então poder gerar. Gerar relatório sem os documentos pode causar falhas."
 *
 * O documental já se recusa a sair sem matrícula + edital lidos (`precisaDocumentos`). Faltava o
 * passo seguinte quando a captura automática não resolve: pedir ao leiloeiro. Aqui o pedido sai
 * EM NOME DA EQUIPE (não do cliente), com reply-to `documentos+<token>@` — a resposta com o
 * arquivo entra sozinha no lote (api/inbound-juridico.js) e marca as análises que esperavam por
 * ela para regerar.
 *
 * Um pedido por LOTE a cada 7 dias, qualquer que seja o cliente que gerou: o leiloeiro não pode
 * receber o mesmo e-mail a cada clique em "Gerar". `sem_contato` também conta — sem isso, cada
 * geração gravaria uma linha nova dizendo a mesma coisa.
 *
 * Nunca lança: o chamador é a geração do relatório, e o pedido é acessório a ela. O retorno diz
 * O QUE aconteceu (`status`), inclusive a falha — não um null que se confunde com "não precisou".
 */
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const INBOUND_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || 'bidprobrasil.com.br';
const JANELA_DIAS = 7;
const ROTULO = { matricula: 'Matrícula atualizada do imóvel', edital: 'Edital do leilão', regras_venda: 'Regras de venda' };

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export async function pedirDocumentosAoLeiloeiro({ imovelId, userId, faltando }) {
  const itens = [...new Set(faltando || [])].filter(t => ROTULO[t]);
  if (!itens.length || !imovelId || !userId) return { status: 'nada_a_pedir' };
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: 'erro', erro: 'configuracao_ausente' };
  try {
    const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString();
    const rj = await sb(`documental_pedidos_leiloeiro?imovel_id=eq.${encodeURIComponent(imovelId)}&criado_em=gt.${encodeURIComponent(desde)}&status=in.(enviado,represado,sem_contato)&select=criado_em,status,destinatario_email,respondido_em&order=criado_em.desc&limit=1`);
    if (!rj.ok) return { status: 'erro', erro: `pedidos HTTP ${rj.status}` };
    const [ja] = await rj.json();
    if (ja) return { status: ja.status === 'sem_contato' ? 'sem_contato' : 'ja_pedido', em: ja.criado_em, destinatario: ja.destinatario_email || null, respondidoEm: ja.respondido_em || null };

    const ri = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=fonte,leiloeiro,titulo,endereco,cidade,estado,url_lote,link_edital,numero_processo&limit=1`);
    if (!ri.ok) return { status: 'erro', erro: `imovel HTTP ${ri.status}` };
    const [imovel] = await ri.json();
    if (!imovel) return { status: 'erro', erro: 'imovel_nao_encontrado' };
    // Caixa tem pipeline próprio (matrícula estática + fila de captura) e não responde e-mail de lote.
    if (/caixa|cef/i.test(imovel.fonte || '')) return { status: 'nada_a_pedir' };

    const rc = await sb('rpc/contato_leiloeiro_resolver', { method: 'POST', body: JSON.stringify({ p_fonte: imovel.fonte || '', p_leiloeiro: imovel.leiloeiro || null }) });
    if (!rc.ok) return { status: 'erro', erro: `contato HTTP ${rc.status}` };
    const [contato] = await rc.json();
    const itensTexto = itens.map(t => ROTULO[t]);
    const base = { imovel_id: String(imovelId), user_id: userId, fonte: imovel.fonte || null, itens_pedidos: itensTexto, automatico: true };

    if (!contato?.email) {
      const ra = await sb('documental_pedidos_leiloeiro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...base, status: 'sem_contato' }) });
      if (!ra.ok) console.error('[pedido-leiloeiro-auto] auditoria sem_contato HTTP', ra.status);
      return { status: 'sem_contato' };
    }

    const lote = imovel.titulo || [imovel.endereco, imovel.cidade, imovel.estado].filter(Boolean).join(', ') || 'Lote';
    const link = imovel.url_lote || imovel.link_edital || '';
    const texto = `Prezados,\n\nA equipe da BidPro Brasil está analisando o lote abaixo para um cliente interessado e não localizou na página do leilão o(s) documento(s) a seguir:\n\n${itensTexto.map(t => `• ${t}`).join('\n')}\n\nLote: ${lote}${link ? `\nPágina do lote: ${link}` : ''}${imovel.numero_processo ? `\nProcesso: ${imovel.numero_processo}` : ''}\n\nPoderiam, por gentileza, responder a este e-mail com o(s) arquivo(s) em anexo (PDF)?\n\nAgradecemos a atenção.\n\nEquipe BidPro Brasil`;
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const token = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
    const r = await enviarEmail({
      to: contato.email,
      replyTo: `documentos+${token}@${INBOUND_DOMAIN}`,
      subject: `Documentação do lote — ${lote}${imovel.numero_processo ? ` (proc. ${imovel.numero_processo})` : ''}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;white-space:pre-wrap;line-height:1.6">${esc(texto)}</div>`,
      text: texto,
      meta: { tipo: 'pedido_documento_leiloeiro_auto', userId },
    });
    const status = r.ok ? 'enviado' : r.enfileirado ? 'represado' : 'falha';
    const ra = await sb('documental_pedidos_leiloeiro', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      ...base, destinatario_email: contato.email, texto_enviado: texto, resend_id: r.ok ? (r.id || null) : null, status,
      resposta_token: status === 'falha' ? null : token,
    }) });
    // Sem a linha, a resposta do leiloeiro não casa com o lote — e o dedup não segura o próximo envio.
    if (!ra.ok) console.error('[pedido-leiloeiro-auto] auditoria HTTP', ra.status, '— resposta deste pedido não vai casar com o lote');
    return status === 'falha' ? { status, erro: r.error || 'falha_envio' } : { status, destinatario: contato.email, em: new Date().toISOString() };
  } catch (e) {
    console.error('[pedido-leiloeiro-auto] falhou:', String(e?.message || e).slice(0, 160));
    return { status: 'erro', erro: String(e?.message || e).slice(0, 120) };
  }
}

// Frase para o cliente, a partir do retorno acima. '' quando não há o que dizer.
export function fraseDoPedido(p) {
  if (!p) return '';
  const data = p.em ? new Date(p.em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  if (p.status === 'enviado' || p.status === 'represado' || p.status === 'ja_pedido') {
    return ` Pedimos o documento ao leiloeiro por e-mail${data ? ` em ${data}` : ''}: quando ele responder, o arquivo entra no lote e a análise é gerada automaticamente.`;
  }
  return '';
}
