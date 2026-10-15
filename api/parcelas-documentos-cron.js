/**
 * /api/parcelas-documentos-cron — guia e comprovante que chegam por e-mail viram estado da parcela (15/10, dono).
 *
 * Fluxo: e-mail no endereço do caso → arquivar-anexos-email-cron → caso-documentos-cron (IA classifica) → AQUI:
 *   A) guia_deposito: lê nº da parcela, valor, validade, PIX/código; liga à parcela em parcelamento.guias[idx]
 *      com `aguardando_aprovacao: true` e avisa o dono. O ENVIO ao arrematante só sai quando o dono aprova na tela
 *      do caso (api/guia-parcela.js, acao 'enviar') — decisão do dono, 15/10.
 *   C) comprovante_pagamento: lê valor e data; se bater com UMA parcela pendente, guarda em
 *      parcelamento.pagamentos[idx], marca a parcela paga e avisa o dono.
 * Na dúvida (número/valor não batem, mais de uma parcela possível) NÃO liga: grava o motivo em
 * caso_documentos.parcela_aviso e avisa o dono para decidir na tela. Falha de IA/rede não marca o documento:
 * ele volta na próxima rodada. `?seco=1` mostra sem gravar nem avisar.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { cronograma } from '../src/utils/parcelamentoArremate.js';
import { lerGuiaArquivo, lerComprovanteArquivo, camposDaGuia, avisosDaGuia, qualParcela } from './_parcela-docs.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM         = process.env.APP_ALERTS_FROM || process.env.EMAIL_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const DONO_EMAIL   = 'tarcisioaraujo@reimob.com.br';
const POR_RODADA   = 6;
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

async function marcarDoc(id, campos) {
  const r = await sb(`caso_documentos?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...campos, parcela_processado_em: new Date().toISOString() }) });
  const linhas = r.ok ? await r.json() : [];
  if (!linhas.length) throw new Error(`marcar documento ${id} HTTP ${r.status}`);
}

async function registrar(arrId, idx, { guia = null, pagamento = null, paga = false }) {
  const r = await sb('rpc/parcelamento_registrar', { method: 'POST',
    body: JSON.stringify({ p_arrematado: arrId, p_idx: idx, p_guia: guia, p_pagamento: pagamento, p_marcar_paga: paga }) });
  if (!r.ok) throw new Error(`registrar parcela HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}

// Arremate do caso: mesmo cliente e mesmo imóvel; sem imóvel em comum, o ÚNICO arremate parcelado do cliente.
async function arremateDoCaso(caso) {
  const arrs = await ler(`arrematados?user_id=eq.${caso.cliente_id}&parcelamento=not.is.null&select=id,user_id,imovel_id,titulo,valor_arrematacao,data_arrematacao,parcelamento`);
  return arrs.find((a) => caso.imovel_id && String(a.imovel_id) === String(caso.imovel_id)) || (arrs.length === 1 ? arrs[0] : null);
}

async function avisarDono({ assunto, linhas, casoId }) {
  const env = await enviarEmail({
    from: FROM, to: DONO_EMAIL, subject: assunto,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1e293b;line-height:1.6">${linhas.map((l) => `<p style="margin:6px 0">${l}</p>`).join('')}
      <p style="margin-top:16px"><a href="${BASE}/#/caso/${casoId}" style="background:#0D63DB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Abrir o caso</a></p></div>`,
    meta: { tipo: 'parcela_documento_dono' },
  }).catch((e) => ({ ok: false, error: e?.message }));
  if (!env?.ok) console.error('[parcelas-documentos] aviso ao dono falhou:', env?.error);
}

async function processar(doc, { seco }) {
  const [caso] = await ler(`casos?id=eq.${doc.caso_id}&select=id,cliente_id,imovel_id,imovel_endereco`);
  const arr = caso ? await arremateDoCaso(caso) : null;
  if (!arr) { if (!seco) await marcarDoc(doc.id, { parcela_status: 'sem_parcelamento', parcela_aviso: 'Caso sem arremate com parcelamento registrado.' }); return { doc: doc.id, sem_parcelamento: true }; }

  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${doc.storage_path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`storage HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ehGuia = doc.tipo === 'guia_deposito';
  const lido = await (ehGuia ? lerGuiaArquivo : lerComprovanteArquivo)(buf, { nome: doc.nome });

  const itens = cronograma(arr.parcelamento, { valor: arr.valor_arrematacao, dataArrematacao: arr.data_arrematacao });
  const guias = arr.parcelamento.guias || {};
  const escolha = qualParcela(ehGuia ? 'guia' : 'comprovante', lido, itens, guias);
  const cliente = (await ler(`perfis?id=eq.${caso.cliente_id}&select=nome`))[0]?.nome || 'cliente';
  const cab = `<b>${esc(cliente)}</b> · ${esc(arr.titulo || caso.imovel_endereco || 'imóvel arrematado')}`;

  if (escolha.aviso) {
    if (!seco) {
      await marcarDoc(doc.id, { parcela_status: 'aviso', parcela_aviso: escolha.aviso, parcela_lido: lido });
      await avisarDono({ casoId: caso.id, assunto: `${ehGuia ? 'Guia' : 'Comprovante'} recebido sem parcela definida · ${cliente}`,
        linhas: [cab, `Chegou ${ehGuia ? 'uma guia' : 'um comprovante'} (${esc(doc.titulo || doc.nome)}), mas não liguei a nenhuma parcela: ${esc(escolha.aviso)}`, 'Confira na tela do caso.'] });
    }
    return { doc: doc.id, aviso: escolha.aviso, lido };
  }
  const parcela = itens.find((x) => x.idx === escolha.idx);

  if (ehGuia) {
    const g = guias[parcela.idx];
    if (parcela.paga || g?.enviada_em) {
      const motivo = parcela.paga ? 'parcela já paga' : `guia desta parcela já enviada em ${dataBR(g.enviada_em)}`;
      if (!seco) await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'ignorado', parcela_aviso: `Guia repetida: ${motivo}.`, parcela_lido: lido });
      return { doc: doc.id, ignorado: motivo };
    }
    const [lote] = arr.imovel_id ? await ler(`imoveis_leilao?id=eq.${arr.imovel_id}&select=numero_processo`) : [];
    const avisos = avisosDaGuia(lido, parcela, lote?.numero_processo || null);
    const guia = { ...camposDaGuia(lido), storage_path: doc.storage_path, caso_documento_id: doc.id, nome: doc.nome, origem: 'email',
      aguardando_aprovacao: true, avisos };
    if (seco) return { doc: doc.id, parcela: parcela.rotulo, por: escolha.por, guia };
    await registrar(arr.id, parcela.idx, { guia });
    await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'vinculada', parcela_aviso: avisos.join(' ') || null, parcela_lido: lido });
    await avisarDono({ casoId: caso.id, assunto: `Guia da ${parcela.rotulo} recebida · aprove o envio · ${cliente}`, linhas: [
      cab,
      `Guia da <b>${esc(parcela.rotulo)}</b>: ${brl(guia.valor || parcela.valor)}. Pagar até <b>${dataBR(parcela.pagar_ate)}</b> (vencimento ${dataBR(parcela.venc)})${guia.vencimento ? `, validade da guia ${dataBR(guia.vencimento)}` : ''}.`,
      ...(avisos.length ? [`<span style="color:#b45309">Atenção: ${esc(avisos.join(' '))}</span>`] : []),
      'O envio ao arrematante só sai depois da sua aprovação, no botão "Aprovar e enviar" da tela do caso.',
    ] });
    return { doc: doc.id, parcela: parcela.rotulo, vinculada: true };
  }

  // Comprovante.
  if (parcela.paga) {
    if (!seco) await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'ignorado', parcela_aviso: 'Parcela já estava paga.', parcela_lido: lido });
    return { doc: doc.id, ignorado: 'parcela já paga' };
  }
  const pagamento = { pago_em: /^\d{4}-\d{2}-\d{2}$/.test(lido?.data_pagamento || '') ? lido.data_pagamento : null,
    valor: typeof lido?.valor === 'number' ? Math.round(lido.valor * 100) / 100 : null,
    storage_path: doc.storage_path, caso_documento_id: doc.id, nome: doc.nome, registrado_em: new Date().toISOString(), por: escolha.por };
  if (seco) return { doc: doc.id, parcela: parcela.rotulo, por: escolha.por, pagamento };
  await registrar(arr.id, parcela.idx, { pagamento, paga: true });
  await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'paga', parcela_lido: lido });
  const atrasado = pagamento.pago_em && pagamento.pago_em > parcela.venc;
  await avisarDono({ casoId: caso.id, assunto: `${parcela.rotulo} paga (comprovante recebido) · ${cliente}`, linhas: [
    cab,
    `Comprovante da <b>${esc(parcela.rotulo)}</b>: ${brl(pagamento.valor)} pago em ${dataBR(pagamento.pago_em)}. Parcela marcada como paga.`,
    ...(atrasado ? [`<span style="color:#b91c1c">Pago DEPOIS do vencimento (${dataBR(parcela.venc)}).</span>`] : []),
  ] });
  return { doc: doc.id, parcela: parcela.rotulo, paga: true };
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const seco = new URL(req.url, BASE).searchParams.get('seco') === '1';
  const res = { seco, processados: 0, falhas: 0, resultados: [] };
  try {
    const docs = await ler('caso_documentos?parcela_processado_em=is.null&tipo=in.(guia_deposito,comprovante_pagamento)&select=id,caso_id,tipo,nome,titulo,storage_path&order=criado_em.asc&limit=' + POR_RODADA);
    for (const d of docs) {
      try { res.resultados.push(await processar(d, { seco })); res.processados++; }
      catch (e) { res.falhas++; res.resultados.push({ doc: d.id, erro: e?.message }); console.error(`[parcelas-documentos] ${d.id}:`, e?.message); }
    }
  } catch (e) {
    console.error('[parcelas-documentos] falhou:', e?.message);
    return new Response(JSON.stringify({ ok: false, erro: e?.message, ...res }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  console.log('[parcelas-documentos]', JSON.stringify({ processados: res.processados, falhas: res.falhas }));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
