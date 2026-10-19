/**
 * POST /api/guia-parcela — a guia de depósito da parcela DENTRO do sistema (12/10, opção 1 do dono).
 *
 * A guia continua sendo gerada no portal do tribunal (o SIF/SISCONDJ têm captcha próprio — não
 * contornamos). O que este endpoint faz depois que a equipe anexa o PDF no caso:
 *
 *   { acao: 'ler',    arrematado_id, anexo_id, parcela_idx }
 *       lê a guia (valor, vencimento, linha digitável, PIX copia-e-cola, ID do depósito) e grava em
 *       arrematados.parcelamento.guias[idx]. Processo da guia ≠ processo do caso, ou valor fora de
 *       ±10% do nominal, volta como AVISO — a guia errada é o pior desfecho aqui.
 *   { acao: 'enviar', arrematado_id, parcela_idx }
 *       manda ao arrematante (cópia para a equipe) o PDF anexado + valor, vencimento, código de
 *       barras e PIX para copiar. Carimba guias[idx].enviada_em.
 *
 * Só equipe (admin/analista/consultor/advogado), em validação. Grava pela RPC
 * salvar_parcelamento_arremate com o token do próprio usuário.
 */
export const config = { runtime: 'nodejs', maxDuration: 90 };

import crypto from 'node:crypto';
import { getUser, getUserRoleById, isCronAuthorized } from './_auth.js';
import { assinarDocumento } from './_storage.js';
import { lerGuiaArquivo, camposDaGuia, avisosDaGuia } from './_parcela-docs.js';
import { enviarEmail } from './_email.js';
import { cronograma } from '../src/utils/parcelamentoArremate.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const CHAVE_IA     = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
const FROM         = process.env.APP_ALERTS_FROM || process.env.EMAIL_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const EQUIPE_EMAIL = process.env.ADMIN_ALERT_EMAIL || null;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const DONO_EMAIL   = 'tarcisioaraujo@reimob.com.br'; // cópia de toda guia enviada (dono, 15/10)
const EQUIPE       = ['admin', 'analista', 'consultor', 'advogado'];

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const dataBR = (s) => String(s || '').slice(0, 10).split('-').reverse().join('/');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Grava o parcelamento como o PRÓPRIO usuário (a RPC confere permissão e carimba atualizado_por).
// Guias de parcela já paga saem do jsonb: a RPC limita o parcelamento a 8 KB e o PDF continua no caso.
async function gravar(token, arrId, parcelamento) {
  const pagas = new Set((parcelamento.pagas || []).map(Number));
  const guias = Object.fromEntries(Object.entries(parcelamento.guias || {}).filter(([k]) => !pagas.has(Number(k))));
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/salvar_parcelamento_arremate`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_arrematado: arrId, p_parcelamento: { ...parcelamento, guias } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`gravar: ${(await r.text().catch(() => '')).slice(0, 160) || `HTTP ${r.status}`}`);
  return r.json();
}

async function registrarServidor(arrId, idx, guia) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/parcelamento_registrar`, {
    method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_arrematado: arrId, p_idx: idx, p_guia: guia }), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`gravar (servidor): ${(await r.text().catch(() => '')).slice(0, 160) || `HTTP ${r.status}`}`);
  return r.json();
}

async function baixar(anexo) {
  const url = await assinarDocumento(anexo.storage_path, 300);
  if (!url) throw new Error('não consegui assinar o arquivo');
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || '' };
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  // ENVIO PELO SERVIDOR (15/10): o dono aprovou a guia do Marcos na tela e nada chegou aqui. Com CRON_SECRET, o
  // envio sai em nome de quem APROVOU (aprovado_por = admin/analista), só a ação 'enviar', parâmetros na URL.
  const cron = isCronAuthorized(req);
  if (!cron && req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
  let user, token = null;
  if (cron) {
    const q = req.query || {};
    req.body = { acao: q.acao, arrematado_id: q.arrematado_id, parcela_idx: q.parcela_idx != null ? Number(q.parcela_idx) : undefined };
    if (req.body.acao !== 'enviar' || !/^[0-9a-f-]{36}$/i.test(String(q.aprovado_por || ''))) { res.status(400).json({ error: 'cron: só acao=enviar com aprovado_por' }); return; }
    user = { id: String(q.aprovado_por) };
    if (!['admin', 'analista'].includes(await getUserRoleById(user.id))) { res.status(403).json({ error: 'aprovado_por precisa ser admin/analista' }); return; }
  } else {
    user = await getUser(req);
    if (!user?.id) { res.status(401).json({ error: 'Faça login' }); return; }
    const role = await getUserRoleById(user.id);
    if (!EQUIPE.includes(role)) { res.status(403).json({ error: 'Recurso em validação — só equipe' }); return; }
    token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  }

  const { acao } = req.body || {};

  // LISTAR (15/10): as parcelas do arremate de um CASO para a tela do caso — cronograma com data de pagamento,
  // guias (recebidas, aguardando aprovação, enviadas), pagamentos e os documentos que não puderam ser ligados.
  if (acao === 'listar') {
    const casoId = String(req.body?.caso_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(casoId)) { res.status(400).json({ error: 'caso_id inválido' }); return; }
    try {
      const [caso] = await sbGet(`casos?id=eq.${casoId}&select=id,cliente_id,imovel_id`);
      if (!caso) { res.status(404).json({ error: 'Caso não encontrado' }); return; }
      const arrs = await sbGet(`arrematados?user_id=eq.${caso.cliente_id}&parcelamento=not.is.null&select=id,imovel_id,titulo,valor_arrematacao,data_arrematacao,parcelamento`);
      const a = arrs.find((x) => caso.imovel_id && String(x.imovel_id) === String(caso.imovel_id)) || (!caso.imovel_id && arrs.length === 1 ? arrs[0] : null); // 19/10: caso com imóvel não herda o arremate de OUTRO imóvel
      const docs = await sbGet(`caso_documentos?caso_id=eq.${casoId}&tipo=in.(guia_deposito,comprovante_pagamento)&select=id,tipo,titulo,nome,parcela_idx,parcela_status,parcela_aviso,criado_em&order=criado_em.desc&limit=40`);
      if (!a) { res.status(200).json({ ok: true, arrematado: null, itens: [], docs }); return; }
      const itens = cronograma(a.parcelamento, { valor: a.valor_arrematacao, dataArrematacao: a.data_arrematacao });
      // Referência para a conferência da guia (17/10): nome do arrematante e processo do caso.
      const [cli] = await sbGet(`perfis?id=eq.${caso.cliente_id}&select=nome`);
      const [lote] = a.imovel_id ? await sbGet(`imoveis_leilao?id=eq.${a.imovel_id}&select=numero_processo`) : [];
      res.status(200).json({ ok: true, conferir: { cliente: cli?.nome || null, processo: lote?.numero_processo || a.parcelamento?.fonte_doc?.processo || null },
        arrematado: { id: a.id, titulo: a.titulo, folga_dias: a.parcelamento.folga_dias ?? 1, entrada_paga_em: a.parcelamento.entrada_paga_em || null },
        itens, guias: a.parcelamento.guias || {}, pagamentos: a.parcelamento.pagamentos || {}, docs });
    } catch (e) {
      console.error('[guia-parcela] listar:', e.message);
      res.status(502).json({ error: `Não consegui ler as parcelas: ${e.message}` });
    }
    return;
  }

  const arrId = String(req.body?.arrematado_id || '');
  const idx = Number(req.body?.parcela_idx);
  if (!/^[0-9a-f-]{36}$/i.test(arrId) || !Number.isInteger(idx) || idx < 0 || idx > 60) { res.status(400).json({ error: 'arrematado_id/parcela_idx inválidos' }); return; }

  let arr, imovel;
  try {
    [arr] = await sbGet(`arrematados?id=eq.${arrId}&select=id,user_id,imovel_id,titulo,valor_arrematacao,data_arrematacao,parcelamento`);
    if (!arr?.parcelamento) { res.status(404).json({ error: 'Arremate sem cronograma registrado' }); return; }
    [imovel] = arr.imovel_id ? await sbGet(`imoveis_leilao?id=eq.${arr.imovel_id}&select=numero_processo`) : [];
  } catch (e) {
    console.error('[guia-parcela] banco:', e.message);
    res.status(502).json({ error: `Não consegui ler o caso: ${e.message}` }); return;
  }
  const parcela = cronograma(arr.parcelamento, { valor: arr.valor_arrematacao, dataArrematacao: arr.data_arrematacao }).find((x) => x.idx === idx);
  if (!parcela) { res.status(400).json({ error: 'Parcela inexistente no cronograma' }); return; }
  const guias = { ...(arr.parcelamento.guias || {}) };

  if (acao === 'ler') {
    if (!CHAVE_IA) { res.status(500).json({ error: 'chave da IA ausente' }); return; }
    const anexoId = String(req.body?.anexo_id || '');
    let anexo, lido;
    try {
      [anexo] = await sbGet(`imovel_anexos?id=eq.${encodeURIComponent(anexoId)}&imovel_id=eq.${arr.imovel_id}&select=id,nome,storage_path`);
      if (!anexo?.storage_path) { res.status(404).json({ error: 'Guia não encontrada neste caso' }); return; }
      const { buf, contentType } = await baixar(anexo);
      lido = await lerGuiaArquivo(buf, { contentType, nome: anexo.nome });
    } catch (e) {
      console.error('[guia-parcela] ler:', e.message);
      res.status(502).json({ error: `Não consegui ler a guia: ${e.message}` }); return;
    }
    const avisos = avisosDaGuia(lido, parcela, imovel?.numero_processo);
    guias[idx] = { ...camposDaGuia(lido), anexo_id: anexo.id, aguardando_aprovacao: true, avisos };
    try {
      const parcelamento = await gravar(token, arr.id, { ...arr.parcelamento, guias });
      res.status(200).json({ ok: true, guia: guias[idx], avisos, parcelamento });
    } catch (e) {
      console.error('[guia-parcela] gravar:', e.message);
      res.status(502).json({ error: `Li a guia mas não consegui gravar: ${e.message}`, guia: guias[idx] });
    }
    return;
  }

  // ENVIAR = APROVAR (15/10, dono: "envio após minha aprovação"). Só sai por este clique da equipe. Vai ao
  // arrematante com cópia ao dono; o "responder" cai no CASO (tarcisio+<token>@), então o comprovante que o cliente
  // devolver entra pelo mesmo caminho dos e-mails do caso e o parcelas-documentos-cron marca a parcela paga.
  if (acao === 'enviar') {
    const g = guias[idx];
    if (!g?.anexo_id && !g?.storage_path) { res.status(400).json({ error: 'Esta parcela ainda não tem guia' }); return; }
    let destino, pdf, nomeArq, caso = null, remet = null;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${arr.user_id}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`e-mail do cliente: HTTP ${r.status}`);
      destino = String((await r.json())?.email || '').toLowerCase();
      if (!destino) throw new Error('cliente sem e-mail cadastrado');
      let path = g.storage_path || null;
      nomeArq = g.nome || 'guia.pdf';
      if (!path) {
        const [anexo] = await sbGet(`imovel_anexos?id=eq.${g.anexo_id}&select=nome,storage_path`);
        path = anexo?.storage_path || null;
        nomeArq = anexo?.nome || nomeArq;
      }
      if (!path) throw new Error('PDF da guia não está mais no caso');
      pdf = (await baixar({ storage_path: path })).buf;
      [caso] = await sbGet(`casos?cliente_id=eq.${arr.user_id}&imovel_id=eq.${arr.imovel_id}&select=id&order=created_at.desc&limit=1`);
      const [admin] = await sbGet('perfis?role=eq.admin&ativo=eq.true&select=id&order=created_at.asc&limit=1');
      [remet] = admin ? await sbGet(`equipe_email?user_id=eq.${admin.id}&select=endereco`) : [];
    } catch (e) {
      console.error('[guia-parcela] enviar:', e.message);
      res.status(502).json({ error: `Não consegui preparar o envio: ${e.message}` }); return;
    }
    const valor = g.valor || parcela.valor;
    // Pagar até: a data com folga do cronograma; se a guia vencer antes, vale a validade da guia.
    const pagarAte = g.vencimento && g.vencimento < (parcela.pagar_ate || parcela.venc) ? g.vencimento : (parcela.pagar_ate || parcela.venc);
    const codigo = (rot, v) => (v ? `<p style="margin:12px 0 4px;font-size:13px;color:#475569">${rot}</p><div style="font-family:monospace;font-size:13px;background:#f1f5f9;border-radius:8px;padding:10px;word-break:break-all">${esc(v)}</div>` : '');
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="margin:0 0 6px">Guia da ${esc(parcela.rotulo)}</h2>
  <p style="margin:0 0 14px;color:#475569">${esc(arr.titulo || 'Imóvel arrematado')}${imovel?.numero_processo ? ` · Processo ${esc(imovel.numero_processo)}` : ''}</p>
  <table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#64748b">Parcela</td><td><b>${esc(parcela.rotulo)}</b></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Valor</td><td><b>${brl(valor)}</b></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Pagar até</td><td><b style="color:#0D63DB">${dataBR(pagarAte)}</b></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vencimento</td><td>${dataBR(parcela.venc)}</td></tr></table>
  ${codigo('PIX copia e cola', g.pix)}${codigo('Código de barras', g.linha_digitavel)}${codigo('ID do depósito', g.id_deposito)}
  <p style="margin:16px 0 0;font-size:13px">A guia em PDF segue em anexo. Depois de pagar, <b>responda este e-mail com o comprovante</b>: ele é registrado no seu caso e a parcela é baixada.</p>
  <p style="margin:12px 0 0;font-size:12px;color:#b45309">Atraso em qualquer parcela pode gerar multa de 10% sobre a parcela e as vincendas (art. 895, §§ 4º e 5º, do CPC).</p>
  <p style="margin:16px 0 0"><a href="${BASE}/#/arrematados" style="background:#0D63DB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Ver cronograma</a></p></div>`;
    // 19/10: chave de idempotência por ENVIO (o reenvio depois de um envio que saiu ganha chave nova) e token
    // de resposta derivado dela — com token aleatório o conteúdo mudava a cada clique: o reenvio em < 24 h
    // batia 409 no Resend ("E-mail não saiu") e o duplo toque não era deduplicado.
    const chaveEnvio = `guia-${arr.id}-${idx}-${g.anexo_id || g.storage_path}-${g.enviada_em || 'v1'}`;
    const tokenResposta = caso && remet?.endereco ? crypto.createHash('sha256').update(chaveEnvio).digest('hex').slice(0, 24) : null;
    const replyTo = tokenResposta ? remet.endereco.replace('@', `+${tokenResposta}@`) : (remet?.endereco || undefined);
    const cc = [...new Set([DONO_EMAIL, EQUIPE_EMAIL].filter(Boolean).map((e) => e.toLowerCase()))].filter((e) => e !== destino);
    const assunto = `Guia da ${parcela.rotulo} · pagar até ${dataBR(pagarAte)} · ${brl(valor)}`;
    // Com anexo não entra na fila do orçamento diário (a fila não guarda anexo).
    const envio = await enviarEmail({
      from: FROM, to: destino, cc: cc.length ? cc : undefined, replyTo, subject: assunto,
      html, attachments: [{ filename: String(nomeArq).replace(/[^\w.\-]+/g, '_'), content: pdf.toString('base64') }],
      meta: { tipo: 'guia_parcela_arremate', userId: arr.user_id }, semFila: true,
      idempotencyKey: chaveEnvio,
    });
    if (!envio?.ok) {
      console.error('[guia-parcela] envio recusado:', envio?.error);
      res.status(502).json({ error: `E-mail não saiu: ${envio?.error || 'falha no envio'}` }); return;
    }
    // O registro em email_caixa é o que liga a RESPOSTA do cliente (com o comprovante) ao caso.
    if (tokenResposta) {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/email_caixa`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ direcao: 'saida', pasta: 'enviados', caixa: remet.endereco, de_email: remet.endereco, para: [destino], cc, assunto, html,
          texto: `Guia da ${parcela.rotulo} enviada ao arrematante. Pagar até ${dataBR(pagarAte)} (vencimento ${dataBR(parcela.venc)}).`,
          resend_email_id: envio.id || null, lido: true, enviado_por: user.id, resposta_token: tokenResposta, caso_id: caso.id }) }).catch((e) => ({ ok: false, status: e?.message }));
      if (!ins.ok) console.error(`[guia-parcela] guia enviada mas NÃO registrada em email_caixa (caso ${caso.id}): ${ins.status} — o comprovante respondido não vai se ligar ao caso`);
    }
    const carimbo = { aguardando_aprovacao: false, aprovado_por: user.id, enviada_em: new Date().toISOString(), enviada_para: destino, pagar_ate_enviado: pagarAte };
    guias[idx] = { ...g, ...carimbo };
    try {
      // Pelo servidor não há token de usuário: grava pela função atômica (só service_role), só a chave da parcela.
      const parcelamento = cron ? await registrarServidor(arr.id, idx, carimbo) : await gravar(token, arr.id, { ...arr.parcelamento, guias });
      res.status(200).json({ ok: true, enviada_para: destino, parcelamento });
    } catch (e) {
      console.error('[guia-parcela] carimbo de envio:', e.message);
      res.status(200).json({ ok: true, enviada_para: destino, aviso: `E-mail enviado, mas não gravei o registro do envio: ${e.message}` });
    }
    return;
  }

  res.status(400).json({ error: 'acao deve ser "listar", "ler" ou "enviar"' });
}
