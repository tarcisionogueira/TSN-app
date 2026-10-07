/**
 * /api/servicos-cartorio — serviços cartorários executados pela EQUIPE BidPro (07/10, pedido do dono).
 * Primeiro serviço: REGISTRO SIMPLES (sem averbação), R$ 2.000 = R$ 1.000 na arrematação + R$ 1.000
 * para DAR ENTRADA. Regra do dono: a parcela de entrada é paga ANTES do protocolo — o banco trava o
 * status 'protocolado' com parcela em aberto (trigger servico_cartorio_trava_protocolo).
 *
 * Cada parcela cobrada vira uma `cobrancas_avulsas` (link público /cobranca/:id, MP Pix/cartão, webhook
 * existente); o gatilho servico_cartorio_baixa_parcela dá a baixa quando o webhook marca paga.
 * Custas, emolumentos e ITBI NÃO entram — são do cliente, pagos à parte.
 *
 *  GET                         → (equipe) todos os serviços + catálogo — aba do Admin
 *  GET ?arrematacao_id=X       → serviços da arrematação (equipe, ou o próprio arrematante)
 *  POST {action:'criar', catalogo_id, arrematacao_id? | cliente_nome, cliente_email, imovel_descricao,
 *        cartorio?, matricula?, observacoes?}    → cria e já cobra a parcela de contratação
 *  POST {action:'cobrar', parcela_id}            → gera (ou devolve) a cobrança da parcela
 *  POST {action:'status', servico_id, status, protocolo_numero?, observacoes?}
 *  POST {action:'catalogo_salvar', id?, chave, nome, descricao, parcelas, ativo}   (só admin)
 */
import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { enviarEmail } from './_email.js';
import { cabecalhoEmailHTML } from './_email-header.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const EQUIPE = ['admin', 'analista', 'advogado'];
const STATUS_VALIDOS = ['aguardando_pagamento', 'em_preparo', 'aguardando_entrada', 'pronto_para_protocolo', 'protocolado', 'exigencia', 'registrado', 'cancelado'];
const uuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Leitura/escrita com o motivo do erro SEMPRE junto (forma #2: não fundir "vazio" com "falhou").
async function db(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  const t = await r.text(); let d; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}
// `perfis` não tem e-mail: ele mora no auth.users (mesmo caminho de enviar-juridico-email.js).
async function emailDoUsuario(id) {
  if (!uuid(id)) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { console.error('[servicos-cartorio] e-mail do cliente: auth devolveu', r.status); return null; }
    return (await r.json())?.email || null;
  } catch (e) { console.error('[servicos-cartorio] e-mail do cliente falhou:', e?.message || e); return null; }
}
const linkDe = (cobId) => (cobId ? `${BASE}/#/cobranca/${cobId}` : null);

async function carregarServicos(filtro) {
  const s = await db(`servicos_cartorio?${filtro}&select=*&order=created_at.desc&limit=500`);
  if (!s.ok) throw new Error(`servicos_cartorio ${s.status}`);
  const ids = (s.data || []).map((x) => x.id);
  if (!ids.length) return [];
  const p = await db(`servicos_cartorio_parcelas?servico_id=in.(${ids.join(',')})&select=*&order=ordem.asc`);
  if (!p.ok) throw new Error(`servicos_cartorio_parcelas ${p.status}`);
  return s.data.map((sv) => ({
    ...sv,
    parcelas: (p.data || []).filter((x) => x.servico_id === sv.id)
      .map((x) => ({ ...x, link: x.status === 'cobrada' ? linkDe(x.cobranca_avulsa_id) : null })),
  }));
}

// Gera a cobrança avulsa de UMA parcela e avisa o cliente por e-mail. Idempotente: parcela já
// cobrada devolve o mesmo link (duplo clique não cria 2 cobranças vivas do mesmo valor).
async function cobrarParcela(parcela, servico, userId) {
  if (parcela.status === 'paga') return { erro: 'Parcela já paga.', status: 409 };
  if (parcela.status === 'cancelada') return { erro: 'Parcela cancelada.', status: 409 };
  // Idempotente SÓ enquanto a cobrança está viva (07/10): o admin pode cancelar a cobrança pela tela
  // do Financeiro, onde ela não se distingue das demais, e devolver esse link seria mandar o cliente
  // a um boleto que não aceita mais pagamento — parcela presa em 'cobrada' para sempre. O gatilho
  // `servico_cartorio_baixa_parcela` já solta a parcela nesse caso; aqui é a rede de segurança para
  // o que foi cancelado antes dele existir (ou direto no banco, sem passar pelo gatilho).
  if (parcela.status === 'cobrada' && parcela.cobranca_avulsa_id) {
    const c = await db(`cobrancas_avulsas?id=eq.${parcela.cobranca_avulsa_id}&select=id,status`);
    const viva = c.ok && c.data?.[0]?.status === 'aberta';
    if (viva) return { link: linkDe(parcela.cobranca_avulsa_id), jaExistia: true };
    if (!c.ok) return { erro: 'Não consegui conferir a cobrança desta parcela agora. Tente em instantes.', status: 503 };
    if (c.data?.[0]?.status === 'paga') return { erro: 'A cobrança desta parcela já foi paga.', status: 409 };
    const solta = await db(`servicos_cartorio_parcelas?id=eq.${parcela.id}&status=eq.cobrada`, {
      method: 'PATCH', body: JSON.stringify({ status: 'pendente', cobranca_avulsa_id: null }),
    });
    if (!solta.ok || !(solta.data || []).length) return { erro: 'A parcela mudou enquanto eu conferia a cobrança — atualize a tela.', status: 409 };
  }
  // BOLETO + CUSTAS NO MESMO PAGAMENTO (07/10, dono): boleto é o meio mais barato (R$ 3,49 fixo, absorvido);
  // quando o cartório tem tabela prévia (certidões), as custas vão somadas no mesmo boleto.
  const custas = Number(parcela.custas) || 0;
  const total = Math.round((Number(parcela.valor) + custas) * 100) / 100;
  const composicao = custas > 0 && Number(parcela.valor) > 0 ? ` (serviço ${fmt(parcela.valor)} + custas do cartório ${fmt(custas)})` : '';
  const descricao = `${servico.servico_nome} — ${parcela.rotulo}${composicao}${servico.imovel_descricao ? ` — ${servico.imovel_descricao}` : ''}`.slice(0, 500);
  const cob = await db('cobrancas_avulsas', {
    method: 'POST',
    body: JSON.stringify({
      descricao, valor: total, meio: 'boleto',
      destinatario_nome: servico.cliente_nome || null, destinatario_email: servico.cliente_email || null, criado_por: userId,
    }),
  });
  if (!cob.ok || !cob.data?.[0]?.id) return { erro: 'Não foi possível criar a cobrança.', status: 500, detalhe: cob.data };
  const cobId = cob.data[0].id;
  // Só vincula se a parcela ainda estava pendente (corrida entre dois cliques).
  const up = await db(`servicos_cartorio_parcelas?id=eq.${parcela.id}&status=eq.pendente`, {
    method: 'PATCH', body: JSON.stringify({ status: 'cobrada', cobranca_avulsa_id: cobId }),
  });
  if (!up.ok || !(up.data || []).length) {
    await db(`cobrancas_avulsas?id=eq.${cobId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelada' }) });
    return { erro: 'A parcela mudou enquanto a cobrança era criada — atualize a tela.', status: 409 };
  }
  if (parcela.momento === 'entrada' && ['em_preparo', 'aguardando_pagamento'].includes(servico.status)) {
    const st = await db(`servicos_cartorio?id=eq.${servico.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'aguardando_entrada' }) });
    if (!st.ok) console.error('[servicos-cartorio] status aguardando_entrada não gravou', st.status, st.data);
  }
  const link = linkDe(cobId);
  let emailEnviado = false;
  if (servico.cliente_email) {
    const r = await enviarEmail({
      from: 'BidPro Brasil <noreply@bidprobrasil.com.br>',
      to: servico.cliente_email,
      subject: `${servico.servico_nome}: ${parcela.rotulo} — ${fmt(total)}`,
      html: `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;">${cabecalhoEmailHTML({ subtitulo: 'Serviços de cartório' })}
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px;padding:24px 28px;color:#0f172a;font-size:14px;line-height:1.6;">
          <p>Olá${servico.cliente_nome ? `, ${String(servico.cliente_nome).split(' ')[0]}` : ''}!</p>
          <p><strong>${servico.servico_nome}</strong>${servico.imovel_descricao ? ` — ${servico.imovel_descricao}` : ''}</p>
          <p>${parcela.rotulo}: <strong>${fmt(total)}</strong>${composicao ? `<br><span style="font-size:12px;color:#64748b;">${composicao.slice(2, -1)}</span>` : ''}</p>
          ${parcela.momento === 'entrada' ? '<p>Seu registro está preparado. Assim que o pagamento for confirmado, damos entrada no cartório.</p>' : ''}
          ${parcela.momento === 'custas' ? '<p>Estas são as custas informadas pelo cartório após a análise do registro.</p>' : ''}
          <p style="text-align:center;margin:24px 0;"><a href="${link}" style="background:#0D63DB;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;">Gerar boleto</a></p>
          ${custas > 0 || parcela.momento === 'custas' ? '' : '<p style="font-size:12px;color:#64748b;">Custas do cartório e ITBI não estão incluídos neste valor.</p>'}
        </div></div>`,
      meta: { tipo: 'servico_cartorio_cobranca', userId: servico.cliente_id || null },
      idempotencyKey: `servico-cartorio-${parcela.id}`,
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
    emailEnviado = !!r?.ok;
    if (!r?.ok) console.error('[servicos-cartorio] e-mail da cobrança não saiu', r?.error);
  }
  return { link, cobranca_id: cobId, emailEnviado };
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });
  const role = await getUserRoleById(user.id);
  const ehEquipe = EQUIPE.includes(role);

  try {
    if (req.method === 'GET') {
      const arrId = req.query?.arrematacao_id;
      if (arrId) {
        if (!uuid(arrId)) return res.status(400).json({ error: 'arrematacao_id inválido' });
        if (!ehEquipe) {
          const a = await db(`arrematacoes?id=eq.${arrId}&select=arrematante_id`);
          if (!a.ok) return res.status(503).json({ error: 'Não consegui verificar a arrematação.' });
          if (a.data?.[0]?.arrematante_id !== user.id) return res.status(403).json({ error: 'Sem acesso.' });
        }
        const servicos = await carregarServicos(`arrematacao_id=eq.${arrId}`);
        const cat = ehEquipe ? await db('servicos_cartorio_catalogo?ativo=eq.true&select=*&order=nome.asc') : { ok: true, data: [] };
        return res.status(200).json({ servicos, catalogo: cat.ok ? cat.data : [] });
      }
      if (!ehEquipe) return res.status(403).json({ error: 'Sem acesso.' });
      const servicos = await carregarServicos('id=not.is.null');
      const cat = await db('servicos_cartorio_catalogo?select=*&order=nome.asc');
      if (!cat.ok) return res.status(503).json({ error: 'Não consegui ler o catálogo.' });
      return res.status(200).json({ servicos, catalogo: cat.data || [] });
    }

    if (req.method !== 'POST') return res.status(405).end();
    if (!ehEquipe) return res.status(403).json({ error: 'Só a equipe gerencia serviços de cartório.' });
    const rl = await checkRateLimit(`servicos-cartorio:${user.id}`, 30, 60_000);
    if (!rl.ok) return res.status(429).json({ error: 'Muitas ações seguidas. Aguarde.' });
    const body = req.body || {};
    const ip = getIP(req);

    if (body.action === 'criar') {
      if (!uuid(body.catalogo_id)) return res.status(400).json({ error: 'Escolha o serviço.' });
      const c = await db(`servicos_cartorio_catalogo?id=eq.${body.catalogo_id}&ativo=eq.true&select=*`);
      const cat = c.data?.[0];
      if (!c.ok || !cat) return res.status(400).json({ error: 'Serviço não encontrado no catálogo.' });
      const parcelas = Array.isArray(cat.parcelas) ? cat.parcelas.filter((p) => (Number(p.valor) || 0) + (Number(p.custas) || 0) > 0) : [];
      if (!parcelas.length) return res.status(400).json({ error: 'Serviço sem parcelas configuradas.' });

      const novo = {
        catalogo_id: cat.id, servico_nome: cat.nome, criado_por: user.id,
        cartorio: body.cartorio ? String(body.cartorio).slice(0, 200) : null,
        matricula: body.matricula ? String(body.matricula).slice(0, 60) : null,
        observacoes: body.observacoes ? String(body.observacoes).slice(0, 2000) : null,
      };
      if (body.arrematacao_id) {
        if (!uuid(body.arrematacao_id)) return res.status(400).json({ error: 'arrematacao_id inválido' });
        const a = await db(`arrematacoes?id=eq.${body.arrematacao_id}&select=id,caso_id,arrematante_id,imovel_id`);
        const arr = a.data?.[0];
        if (!a.ok || !arr) return res.status(404).json({ error: 'Arrematação não encontrada.' });
        const dup = await db(`servicos_cartorio?arrematacao_id=eq.${arr.id}&catalogo_id=eq.${cat.id}&status=neq.cancelado&select=id`);
        if (!dup.ok) return res.status(503).json({ error: 'Não consegui checar duplicidade.' });
        if ((dup.data || []).length) return res.status(409).json({ error: 'Este serviço já está contratado para esta arrematação.' });
        const [p, im, emailCli] = await Promise.all([
          db(`perfis?id=eq.${arr.arrematante_id}&select=nome`),
          arr.imovel_id ? db(`imoveis_leilao?id=eq.${arr.imovel_id}&select=titulo,cidade,estado,numero_matricula`) : Promise.resolve({ ok: true, data: [] }),
          emailDoUsuario(arr.arrematante_id),
        ]);
        const pf = p.data?.[0] || {}; const imv = im.data?.[0] || {};
        Object.assign(novo, {
          arrematacao_id: arr.id, caso_id: arr.caso_id || null, cliente_id: arr.arrematante_id || null,
          cliente_nome: pf.nome || null, cliente_email: emailCli || null,
          imovel_descricao: [imv.titulo, [imv.cidade, imv.estado].filter(Boolean).join('/')].filter(Boolean).join(' — ').slice(0, 300) || null,
          matricula: novo.matricula || imv.numero_matricula || null,
        });
      } else {
        // OPERAÇÃO AVULSA: cliente fora de uma arrematação nossa.
        const nome = String(body.cliente_nome || '').trim();
        const email = String(body.cliente_email || '').trim().toLowerCase();
        if (nome.length < 3) return res.status(400).json({ error: 'Informe o nome do cliente.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido do cliente (é para onde vai a cobrança).' });
        Object.assign(novo, {
          cliente_nome: nome.slice(0, 200), cliente_email: email.slice(0, 200),
          imovel_descricao: body.imovel_descricao ? String(body.imovel_descricao).slice(0, 300) : null,
        });
      }

      const s = await db('servicos_cartorio', { method: 'POST', body: JSON.stringify(novo) });
      const servico = s.data?.[0];
      if (!s.ok || !servico) return res.status(500).json({ error: 'Não foi possível criar o serviço.', detalhe: s.data });
      const pi = await db('servicos_cartorio_parcelas', {
        method: 'POST',
        body: JSON.stringify(parcelas.map((p, i) => ({
          servico_id: servico.id, ordem: i + 1, rotulo: String(p.rotulo || `Parcela ${i + 1}`).slice(0, 120),
          momento: ['contratacao', 'entrada'].includes(p.momento) ? p.momento : 'outro', valor: Number(p.valor) || 0,
          custas: Math.max(0, Number(p.custas) || 0),
        }))),
      });
      if (!pi.ok) {
        await db(`servicos_cartorio?id=eq.${servico.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelado', observacoes: 'Parcelas não gravaram na criação' }) });
        return res.status(500).json({ error: 'Não foi possível criar as parcelas.', detalhe: pi.data });
      }
      const primeira = (pi.data || []).find((p) => p.momento === 'contratacao') || null;
      const cobranca = primeira ? await cobrarParcela(primeira, servico, user.id) : null;
      await auditLog({ acao: 'servico_cartorio_criado', user_id: user.id, ip, detalhes: { servico_id: servico.id, catalogo: cat.chave, arrematacao_id: servico.arrematacao_id }, sucesso: true });
      return res.status(200).json({ ok: true, servico_id: servico.id, cobranca });
    }

    if (body.action === 'cobrar') {
      if (!uuid(body.parcela_id)) return res.status(400).json({ error: 'parcela_id inválido' });
      const p = await db(`servicos_cartorio_parcelas?id=eq.${body.parcela_id}&select=*`);
      const parcela = p.data?.[0];
      if (!p.ok || !parcela) return res.status(404).json({ error: 'Parcela não encontrada.' });
      const s = await db(`servicos_cartorio?id=eq.${parcela.servico_id}&select=*`);
      const servico = s.data?.[0];
      if (!s.ok || !servico) return res.status(404).json({ error: 'Serviço não encontrado.' });
      if (servico.status === 'cancelado') return res.status(409).json({ error: 'Serviço cancelado.' });
      const r = await cobrarParcela(parcela, servico, user.id);
      if (r.erro) return res.status(r.status || 500).json({ error: r.erro });
      await auditLog({ acao: 'servico_cartorio_cobrado', user_id: user.id, ip, detalhes: { parcela_id: parcela.id, servico_id: servico.id }, sucesso: true });
      return res.status(200).json({ ok: true, ...r });
    }

    // CUSTAS PÓS-DEVOLUTIVA (07/10, dono): no registro o cartório só informa as custas depois da entrada
    // (faixa de valor do imóvel). A equipe lança o valor e o cliente recebe o boleto — não trava o
    // protocolo (já feito), trava o 'registrado'.
    if (body.action === 'adicionar_custas') {
      if (!uuid(body.servico_id)) return res.status(400).json({ error: 'servico_id inválido' });
      const v = Math.round(Number(String(body.valor || '').replace(',', '.')) * 100) / 100;
      if (!(v > 0)) return res.status(400).json({ error: 'Informe o valor das custas.' });
      const s = await db(`servicos_cartorio?id=eq.${body.servico_id}&select=*`);
      const servico = s.data?.[0];
      if (!s.ok || !servico) return res.status(404).json({ error: 'Serviço não encontrado.' });
      if (['registrado', 'cancelado'].includes(servico.status)) return res.status(409).json({ error: 'Serviço já encerrado.' });
      const ult = await db(`servicos_cartorio_parcelas?servico_id=eq.${servico.id}&select=ordem&order=ordem.desc&limit=1`);
      if (!ult.ok) return res.status(503).json({ error: 'Não consegui ler as parcelas.' });
      const ins = await db('servicos_cartorio_parcelas', {
        method: 'POST',
        body: JSON.stringify({
          servico_id: servico.id, ordem: (ult.data?.[0]?.ordem || 0) + 1,
          rotulo: String(body.rotulo || 'Custas do cartório').trim().slice(0, 120) || 'Custas do cartório',
          momento: 'custas', valor: 0, custas: v,
        }),
      });
      const parcela = ins.data?.[0];
      if (!ins.ok || !parcela) return res.status(500).json({ error: 'Não foi possível lançar as custas.', detalhe: ins.data });
      const r = await cobrarParcela(parcela, servico, user.id);
      if (r.erro) return res.status(r.status || 500).json({ error: r.erro });
      await auditLog({ acao: 'servico_cartorio_custas', user_id: user.id, ip, detalhes: { servico_id: servico.id, valor: v }, sucesso: true });
      return res.status(200).json({ ok: true, ...r });
    }

    if (body.action === 'status') {
      if (!uuid(body.servico_id)) return res.status(400).json({ error: 'servico_id inválido' });
      if (!STATUS_VALIDOS.includes(body.status)) return res.status(400).json({ error: 'Status inválido.' });
      const patch = { status: body.status };
      if (body.protocolo_numero !== undefined) patch.protocolo_numero = body.protocolo_numero ? String(body.protocolo_numero).slice(0, 60) : null;
      if (body.observacoes !== undefined) patch.observacoes = body.observacoes ? String(body.observacoes).slice(0, 2000) : null;
      if (body.status === 'protocolado' && !patch.protocolo_numero) return res.status(400).json({ error: 'Informe o número do protocolo.' });
      const up = await db(`servicos_cartorio?id=eq.${body.servico_id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      if (!up.ok) {
        // P0001 = trava do banco (parcela em aberto) — é recusa de regra, não erro do servidor.
        if (up.data?.code === 'P0001') return res.status(409).json({ error: up.data.message });
        return res.status(500).json({ error: 'Não foi possível atualizar.', detalhe: up.data });
      }
      if (!(up.data || []).length) return res.status(404).json({ error: 'Serviço não encontrado.' });
      if (body.status === 'cancelado') {
        // Cobranças ainda abertas deste serviço deixam de valer (o link para de aceitar pagamento).
        const ps = await db(`servicos_cartorio_parcelas?servico_id=eq.${body.servico_id}&status=eq.cobrada&select=id,cobranca_avulsa_id`);
        for (const p of ps.data || []) {
          const c = await db(`cobrancas_avulsas?id=eq.${p.cobranca_avulsa_id}&status=eq.aberta`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelada' }) });
          if (!c.ok) console.error('[servicos-cartorio] não cancelou cobrança', p.cobranca_avulsa_id, c.status);
          const pc = await db(`servicos_cartorio_parcelas?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelada' }) });
          if (!pc.ok) console.error('[servicos-cartorio] não cancelou parcela', p.id, pc.status);
        }
      }
      await auditLog({ acao: 'servico_cartorio_status', user_id: user.id, ip, detalhes: { servico_id: body.servico_id, status: body.status }, sucesso: true });
      return res.status(200).json({ ok: true, servico: up.data[0] });
    }

    if (body.action === 'catalogo_salvar') {
      if (role !== 'admin') return res.status(403).json({ error: 'Só o admin altera o catálogo.' });
      const nome = String(body.nome || '').trim();
      const chave = String(body.chave || nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
      const parcelas = (Array.isArray(body.parcelas) ? body.parcelas : [])
        .map((p) => ({
          rotulo: String(p.rotulo || '').trim().slice(0, 120),
          valor: Math.max(0, Math.round((Number(p.valor) || 0) * 100) / 100),
          custas: Math.max(0, Math.round((Number(p.custas) || 0) * 100) / 100),
          momento: ['contratacao', 'entrada'].includes(p.momento) ? p.momento : 'outro',
        }))
        .filter((p) => p.rotulo && p.valor + p.custas > 0);
      if (nome.length < 3 || !chave) return res.status(400).json({ error: 'Informe o nome do serviço.' });
      if (!parcelas.length) return res.status(400).json({ error: 'Informe ao menos uma parcela com valor.' });
      const reg = { chave, nome: nome.slice(0, 120), descricao: body.descricao ? String(body.descricao).slice(0, 1000) : null, parcelas, ativo: body.ativo !== false };
      // Alterar o catálogo NÃO muda serviços já contratados: as parcelas foram copiadas na criação.
      const r = uuid(body.id)
        ? await db(`servicos_cartorio_catalogo?id=eq.${body.id}`, { method: 'PATCH', body: JSON.stringify(reg) })
        : await db('servicos_cartorio_catalogo', { method: 'POST', body: JSON.stringify(reg) });
      if (!r.ok) return res.status(r.data?.code === '23505' ? 409 : 500).json({ error: r.data?.code === '23505' ? 'Já existe um serviço com esse nome.' : 'Não foi possível salvar.' });
      return res.status(200).json({ ok: true, item: r.data?.[0] || null });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error('[servicos-cartorio]', e?.message || e);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
