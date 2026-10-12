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

import { getUser, getUserRoleById } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { assinarDocumento } from './_storage.js';
import { classificarDocumento, blocoParaIA } from './_doc-leitura.js';
import { enviarEmail } from './_email.js';
import { cronograma } from '../src/utils/parcelamentoArremate.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const CHAVE_IA     = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
const FROM         = process.env.APP_ALERTS_FROM || process.env.EMAIL_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const EQUIPE_EMAIL = process.env.ADMIN_ALERT_EMAIL || null;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const MODELO       = 'claude-sonnet-4-6';
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
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

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

async function baixar(anexo) {
  const url = await assinarDocumento(anexo.storage_path, 300);
  if (!url) throw new Error('não consegui assinar o arquivo');
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || '' };
}

const SISTEMA = `Você lê guias de depósito judicial (SIF, SISCONDJ, Caixa, Banco do Brasil) e boletos/PIX gerados para elas.
Responda apenas um JSON:
{"valor":number|null, "vencimento":"AAAA-MM-DD"|null, "linha_digitavel":string|null, "pix_copia_cola":string|null,
 "id_deposito":string|null, "banco":string|null, "processo":string|null, "depositante":string|null, "finalidade":string|null}
Regras: copie linha digitável, PIX copia-e-cola e ID EXATAMENTE como impressos (o PIX começa com "000201"). Na dúvida, null. Nunca invente.`;

async function lerGuia(doc, nome) {
  const bloco = blocoParaIA(doc, nome) || (doc.kind === 'texto' ? { type: 'text', text: doc.texto.slice(0, 40000) } : null);
  if (!bloco) throw new Error(doc.motivo || 'formato não lido');
  const r = await anthropicFetch({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': CHAVE_IA, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELO, max_tokens: 800, system: SISTEMA, messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Extraia os dados desta guia.' }] }] }),
  }, { retries: 1, timeoutMs: 60000, noFallback: true });
  if (!r.ok) throw new Error(`IA respondeu HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  const data = await r.json();
  if (data.stop_reason === 'max_tokens') throw new Error('resposta da IA cortada');
  const t = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Faça login' }); return; }
  const role = await getUserRoleById(user.id);
  if (!EQUIPE.includes(role)) { res.status(403).json({ error: 'Recurso em validação — só equipe' }); return; }
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');

  const { acao } = req.body || {};
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
      lido = await lerGuia(classificarDocumento(buf, { contentType }), anexo.nome);
    } catch (e) {
      console.error('[guia-parcela] ler:', e.message);
      res.status(502).json({ error: `Não consegui ler a guia: ${e.message}` }); return;
    }
    const valor = typeof lido?.valor === 'number' && lido.valor > 0 ? Math.round(lido.valor * 100) / 100 : null;
    const avisos = [];
    if (!valor) avisos.push('Não achei o valor na guia — confira o PDF.');
    else if (Math.abs(valor - parcela.valor) / parcela.valor > 0.10) avisos.push(`Valor da guia ${brl(valor)} longe do nominal ${brl(parcela.valor)} (> 10%) — é a guia desta parcela?`);
    const procGuia = soDigitos(lido?.processo);
    const procCaso = soDigitos(imovel?.numero_processo);
    if (procGuia && procCaso && procGuia !== procCaso) avisos.push(`Processo da guia (${lido.processo}) diferente do caso (${imovel.numero_processo}).`);
    if (!lido?.linha_digitavel && !lido?.pix_copia_cola && !lido?.id_deposito) avisos.push('Sem código de barras, PIX ou ID de depósito legível — o cliente vai precisar do PDF.');
    const str = (s, n) => (typeof s === 'string' && s.trim() && s.trim().toLowerCase() !== 'null' ? s.trim().slice(0, n) : null);
    guias[idx] = {
      anexo_id: anexo.id, valor, vencimento: /^\d{4}-\d{2}-\d{2}$/.test(lido?.vencimento || '') ? lido.vencimento : null,
      linha_digitavel: str(lido?.linha_digitavel, 70), pix: str(lido?.pix_copia_cola, 400), id_deposito: str(lido?.id_deposito, 30),
      banco: str(lido?.banco, 40), lida_em: new Date().toISOString(),
    };
    try {
      const parcelamento = await gravar(token, arr.id, { ...arr.parcelamento, guias });
      res.status(200).json({ ok: true, guia: guias[idx], avisos, parcelamento });
    } catch (e) {
      console.error('[guia-parcela] gravar:', e.message);
      res.status(502).json({ error: `Li a guia mas não consegui gravar: ${e.message}`, guia: guias[idx] });
    }
    return;
  }

  if (acao === 'enviar') {
    const g = guias[idx];
    if (!g?.anexo_id) { res.status(400).json({ error: 'Anexe e leia a guia desta parcela antes de enviar' }); return; }
    let destino, anexo, pdf;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${arr.user_id}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`e-mail do cliente: HTTP ${r.status}`);
      destino = String((await r.json())?.email || '').toLowerCase();
      if (!destino) throw new Error('cliente sem e-mail cadastrado');
      [anexo] = await sbGet(`imovel_anexos?id=eq.${g.anexo_id}&select=nome,storage_path`);
      if (!anexo?.storage_path) throw new Error('PDF da guia não está mais no caso');
      pdf = (await baixar(anexo)).buf;
    } catch (e) {
      console.error('[guia-parcela] enviar:', e.message);
      res.status(502).json({ error: `Não consegui preparar o envio: ${e.message}` }); return;
    }
    const valor = g.valor || parcela.valor;
    const venc = g.vencimento || parcela.venc;
    const codigo = (rot, v) => (v ? `<p style="margin:12px 0 4px;font-size:13px;color:#475569">${rot}</p><div style="font-family:monospace;font-size:13px;background:#f1f5f9;border-radius:8px;padding:10px;word-break:break-all">${esc(v)}</div>` : '');
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="margin:0 0 6px">Guia da ${esc(parcela.rotulo)}</h2>
  <p style="margin:0 0 14px;color:#475569">${esc(arr.titulo || 'Imóvel arrematado')}${imovel?.numero_processo ? ` · Processo ${esc(imovel.numero_processo)}` : ''}</p>
  <table style="font-size:14px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#64748b">Valor</td><td><b>${brl(valor)}</b></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vencimento</td><td><b>${dataBR(venc)}</b></td></tr></table>
  ${codigo('PIX copia e cola', g.pix)}${codigo('Código de barras', g.linha_digitavel)}${codigo('ID do depósito', g.id_deposito)}
  <p style="margin:16px 0 0;font-size:13px">A guia em PDF segue em anexo. Depois de pagar, envie o comprovante respondendo este e-mail ou pelo sistema.</p>
  <p style="margin:12px 0 0;font-size:12px;color:#b45309">Atraso em qualquer parcela pode gerar multa de 10% sobre a parcela e as vincendas (art. 895, §§ 4º e 5º, do CPC).</p>
  <p style="margin:16px 0 0"><a href="${BASE}/arrematados" style="background:#0D63DB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Ver cronograma</a></p></div>`;
    // Com anexo não entra na fila do orçamento diário (a fila não guarda anexo).
    const envio = await enviarEmail({
      from: FROM, to: destino, cc: EQUIPE_EMAIL || undefined,
      subject: `Guia da ${parcela.rotulo} — vence ${dataBR(venc)} — ${brl(valor)}`,
      html, attachments: [{ filename: (anexo.nome || 'guia.pdf').replace(/[^\w.\-]+/g, '_'), content: pdf.toString('base64') }],
      meta: { tipo: 'guia_parcela_arremate', userId: arr.user_id }, semFila: true,
      idempotencyKey: `guia-${arr.id}-${idx}-${g.anexo_id}`,
    });
    if (!envio?.ok) {
      console.error('[guia-parcela] envio recusado:', envio?.error);
      res.status(502).json({ error: `E-mail não saiu: ${envio?.error || 'falha no envio'}` }); return;
    }
    guias[idx] = { ...g, enviada_em: new Date().toISOString(), enviada_para: destino };
    try {
      const parcelamento = await gravar(token, arr.id, { ...arr.parcelamento, guias });
      res.status(200).json({ ok: true, enviada_para: destino, parcelamento });
    } catch (e) {
      console.error('[guia-parcela] carimbo de envio:', e.message);
      res.status(200).json({ ok: true, enviada_para: destino, aviso: `E-mail enviado, mas não gravei o registro do envio: ${e.message}` });
    }
    return;
  }

  res.status(400).json({ error: 'acao deve ser "ler" ou "enviar"' });
}
