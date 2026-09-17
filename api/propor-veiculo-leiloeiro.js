/**
 * POST /api/propor-veiculo-leiloeiro   (equipe)
 * Body: { veiculo_id, action?: 'preview'|'enviar', texto? }
 *
 * Pedido do dono (17/09): em `veiculos_leilao`, um leilão que já passou sem sinal de
 * comprador ("leilão negativo" — ver retencaoVeiculosVencidos em scraper-puppeteer.mjs) pode
 * virar oportunidade de negociar a compra direta com o leiloeiro, fora do processo de leilão.
 * Este endpoint dispara esse contato — mesmo padrão em DOIS PASSOS de
 * `api/pedir-documento-leiloeiro.js` (11-12/09): `action='preview'` monta um rascunho e
 * devolve SEM enviar nem gastar rate limit; `action='enviar'` manda o texto que o CHAMADOR
 * devolveu (editado, se houve edição) — o servidor só garante o CABEÇALHO (veículo/link),
 * nunca o corpo livre, que é sempre do punho de quem está propondo.
 *
 * ACESSO: restrito à equipe (admin/analista/suporte) — decisão de implementação (não pedido
 * explícito do dono), porque isto é negociação de aquisição em nome da empresa, não um pedido
 * de documento em nome de um cliente pagante (diferente de ROLES_PEDIDO_LEILOEIRO, que também
 * libera Assessorado). Fácil de ampliar depois se o dono quiser.
 *
 * SÓ para veículo com leilão negativo (`data_leilao` no passado) — propor compra de algo
 * ainda em pregão não faz sentido de negócio e seria uma mensagem estranha pro leiloeiro.
 *
 * Reply-to = o PRÓPRIO e-mail de quem está enviando: o leiloeiro responde direto, sem exigir
 * infraestrutura de ingestão de resposta.
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

const ROLES_PROPOSTA_VEICULO = ['admin', 'analista', 'suporte'];
const MAX_TEXTO_EDITADO = 4000;

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
    await fetch(`${SUPABASE_URL}/rest/v1/veiculo_propostas_leiloeiro`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch { /* padrao-ok: auditoria não pode derrubar a resposta ao cliente */ }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtBRL = (v) => (v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null);
const fmtData = (d) => { try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return null; } };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const veiculoId = String(body?.veiculo_id || '').trim();
  if (!veiculoId) return json({ error: 'veiculo_id obrigatório' }, 400);
  const acao = String(body?.action || 'preview') === 'enviar' ? 'enviar' : 'preview';

  // ACESSO: papel do usuário AUTENTICADO, nunca o que o body diz.
  const resPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!resPerfil.ok) return json({ error: 'Não foi possível verificar seu acesso agora. Tente novamente.' }, 500);
  const [perfil] = await resPerfil.json();
  if (!ROLES_PROPOSTA_VEICULO.includes(perfil?.role)) {
    return json({ error: 'Este recurso está disponível apenas para a equipe.' }, 403);
  }

  // Rate limit SÓ no envio de verdade — o preview não gasta cota. Duas chaves: por usuário
  // (evita bombardear vários leiloeiros) e por veículo (evita reenviar pro mesmo lote).
  if (acao === 'enviar') {
    const rlUser = await checkRateLimit(`proposta-veiculo:user:${user.id}`, 10, 86_400_000);
    if (!rlUser.ok) return rateLimitedResponse(rlUser.resetAt);
    const rlVeiculo = await checkRateLimit(`proposta-veiculo:veiculo:${veiculoId}`, 1, 7 * 24 * 3_600_000);
    if (!rlVeiculo.ok) {
      return json({ error: 'Já foi enviada uma proposta para este veículo recentemente. Aguarde a resposta do leiloeiro antes de propor de novo.', jaEnviado: true }, 429);
    }
  }

  const [veiculo] = await (await sb(`veiculos_leilao?id=eq.${encodeURIComponent(veiculoId)}&select=id,fonte,leiloeiro,titulo,marca,modelo,ano_fabricacao,placa,valor_minimo,valor_avaliacao,cidade,estado,link_lote,data_leilao`)).json();
  if (!veiculo) return json({ error: 'Veículo não encontrado' }, 404);

  // SÓ leilão negativo: propor compra de algo ainda em pregão não faz sentido — e como
  // "negativo" aqui é inferido só pela data (nenhuma fonte informa o resultado), aceitar
  // qualquer data futura seria uma mensagem sem fundamento pro leiloeiro.
  if (!veiculo.data_leilao || new Date(veiculo.data_leilao) >= new Date()) {
    return json({ error: 'Este veículo ainda não teve o leilão encerrado — proposta de compra direta só faz sentido para leilão negativo (já ocorrido, sem comprador).' }, 400);
  }

  const veiculoLabel = [veiculo.marca, veiculo.modelo, veiculo.ano_fabricacao].filter(Boolean).join(' ') || veiculo.titulo || `Veículo ${veiculoId}`;
  const localLabel = [veiculo.cidade, veiculo.estado].filter(Boolean).join(', ');

  const nomeCliente = user.user_metadata?.nome || user.user_metadata?.full_name || 'Interessado(a)';
  const assunto = `Proposta de compra direta — ${veiculoLabel}${veiculo.placa ? ` (placa ${veiculo.placa})` : ''}`;
  const detalhes = [
    `Veículo: ${veiculoLabel}`,
    veiculo.placa ? `Placa: ${veiculo.placa}` : null,
    localLabel ? `Local: ${localLabel}` : null,
    veiculo.data_leilao ? `Leilão: ${fmtData(veiculo.data_leilao)} (encerrado)` : null,
    veiculo.link_lote ? `Página do lote: ${veiculo.link_lote}` : null,
    fmtBRL(veiculo.valor_minimo) ? `Último lance mínimo: ${fmtBRL(veiculo.valor_minimo)}` : null,
  ].filter(Boolean).join('\n');
  const corpoTextoPuro = `Prezados,\n\nNotamos que o leilão do veículo abaixo já foi encerrado sem arrematação:\n\n${detalhes}\n\nTemos interesse em negociar a compra direta deste bem, fora do processo de leilão. Poderiam nos informar se há essa possibilidade e, em caso positivo, as condições?\n\nAgradecemos desde já a atenção.\n\n${nomeCliente}`;

  const [contato] = await (await sb(`leiloeiro_contato?fonte=eq.${encodeURIComponent(veiculo.fonte || '')}&select=email`)).json();

  // PASSO 1 — PREVIEW: devolve o rascunho pronto, sem mandar nada e sem gastar rate limit.
  if (acao === 'preview') {
    return json({ ok: true, texto: corpoTextoPuro, linkLote: veiculo.link_lote || null, contatoDisponivel: !!contato?.email });
  }

  // PASSO 2 — ENVIAR: o corpo é o que o CHAMADOR mandou (o editado, se editou).
  const textoFinal = String(body?.texto || '').trim().slice(0, MAX_TEXTO_EDITADO) || corpoTextoPuro;

  if (!contato?.email) {
    await auditar({ veiculo_id: veiculoId, user_id: user.id, fonte: veiculo.fonte || null, destinatario_email: null, texto_enviado: null, status: 'sem_contato' });
    return json({ ok: false, semContato: true, texto: textoFinal, linkLote: veiculo.link_lote || null });
  }

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;white-space:pre-wrap;line-height:1.6">${esc(textoFinal)}
    <p style="color:#94a3b8;font-size:11px;margin-top:24px;white-space:normal">Enviado via BidPro Brasil.</p>
  </div>`;

  const r = await enviarEmail({
    to: contato.email,
    replyTo: user.email,
    subject: assunto,
    html,
    text: textoFinal,
    meta: { tipo: 'proposta_veiculo_leiloeiro', userId: user.id },
  });

  await auditar({
    veiculo_id: veiculoId, user_id: user.id, fonte: veiculo.fonte || null,
    destinatario_email: contato.email, texto_enviado: textoFinal,
    resend_id: r.ok ? (r.id || null) : null, status: r.ok ? 'enviado' : 'falha',
  });

  if (!r.ok) return json({ error: 'Não foi possível enviar o e-mail agora: ' + (r.error || 'falha desconhecida'), texto: textoFinal, linkLote: veiculo.link_lote || null }, 502);

  return json({ ok: true, destinatario: contato.email });
}
