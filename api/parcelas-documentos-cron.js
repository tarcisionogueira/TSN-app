/**
 * /api/parcelas-documentos-cron — guia e comprovante que chegam por e-mail viram estado da parcela (15/10, dono).
 *
 * Fluxo: e-mail no endereço do caso → arquivar-anexos-email-cron → caso-documentos-cron (IA classifica) → AQUI:
 *   A) guia_deposito: lê nº da parcela, valor, validade, PIX/código; liga à parcela em parcelamento.guias[idx]
 *      com `aguardando_aprovacao: true` e avisa o dono. O ENVIO ao arrematante só sai quando o dono aprova na tela
 *      do caso (api/guia-parcela.js, acao 'enviar') — decisão do dono, 15/10.
 *   C) comprovante_pagamento: lê valor e data; se bater com UMA parcela pendente, guarda em
 *      parcelamento.pagamentos[idx], marca a parcela paga e avisa o dono.
 * Duas fontes (16/10, dono): (1) caso_documentos — anexos de e-mail do caso (guia_deposito/comprovante_pagamento);
 * (2) imovel_anexos — upload na tela do arremate com os tipos guia_parcela/comprovante_parcela. O que chega por
 * e-mail e liga a uma parcela é ESPELHADO em imovel_anexos, para aparecer nos documentos do arremate.
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

async function marcar(fonte, campos) {
  const tabela = fonte.kind === 'anexo' ? 'imovel_anexos' : 'caso_documentos';
  const r = await sb(`${tabela}?id=eq.${fonte.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...campos, parcela_processado_em: new Date().toISOString() }) });
  const linhas = r.ok ? await r.json() : [];
  if (!linhas.length) throw new Error(`marcar ${tabela} ${fonte.id} HTTP ${r.status}`);
}

// Documento de e-mail ligado a uma parcela → também nos documentos do ARREMATE (imovel_anexos), já processado.
async function espelharNoArremate(arr, fonte, tipoAnexo, parcela) {
  if (fonte.kind !== 'caso' || !arr.imovel_id) return;
  const ja = await ler(`imovel_anexos?imovel_id=eq.${arr.imovel_id}&storage_path=eq.${encodeURIComponent(fonte.storage_path)}&select=id`);
  if (ja.length) return;
  const r = await sb('imovel_anexos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    imovel_id: arr.imovel_id, tipo: tipoAnexo, nome: String(fonte.nome || fonte.titulo || 'documento').slice(0, 200), storage_path: fonte.storage_path,
    arrematado: true, role_criador: 'sistema', descricao: `${parcela.rotulo} · recebido por e-mail no caso`,
    parcela_idx: parcela.idx, parcela_status: tipoAnexo === 'guia_parcela' ? 'vinculada' : 'paga', parcela_processado_em: new Date().toISOString() }) });
  const linhas = r.ok ? await r.json() : [];
  if (!linhas.length) console.error(`[parcelas-documentos] espelho em imovel_anexos falhou: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`);
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

async function arremateDoImovel(imovelId) {
  const arrs = await ler(`arrematados?imovel_id=eq.${imovelId}&parcelamento=not.is.null&select=id,user_id,imovel_id,titulo,valor_arrematacao,data_arrematacao,parcelamento`);
  return arrs.length === 1 ? arrs[0] : null;
}

async function avisarDono({ assunto, linhas, casoId }) {
  const env = await enviarEmail({
    from: FROM, to: DONO_EMAIL, subject: assunto,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1e293b;line-height:1.6">${linhas.map((l) => `<p style="margin:6px 0">${l}</p>`).join('')}
      <p style="margin-top:16px"><a href="${casoId ? `${BASE}/#/caso/${casoId}` : `${BASE}/#/arrematados`}" style="background:#0D63DB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">${casoId ? 'Abrir o caso' : 'Abrir o arremate'}</a></p></div>`,
    meta: { tipo: 'parcela_documento_dono' },
  }).catch((e) => ({ ok: false, error: e?.message }));
  if (!env?.ok) console.error('[parcelas-documentos] aviso ao dono falhou:', env?.error);
}

async function processar(doc, { seco }) {
  // doc: { kind: 'caso'|'anexo', id, ehGuia, nome, titulo, storage_path, caso_id?, imovel_id? }
  let caso = null, arr = null;
  if (doc.kind === 'caso') {
    [caso] = await ler(`casos?id=eq.${doc.caso_id}&select=id,cliente_id,imovel_id,imovel_endereco`);
    arr = caso ? await arremateDoCaso(caso) : null;
  } else {
    arr = await arremateDoImovel(doc.imovel_id);
    if (arr) [caso] = await ler(`casos?cliente_id=eq.${arr.user_id}&imovel_id=eq.${arr.imovel_id}&select=id,cliente_id,imovel_id,imovel_endereco&order=created_at.desc&limit=1`);
  }
  if (!arr) { if (!seco) await marcar(doc, { parcela_status: 'sem_parcelamento', parcela_aviso: 'Sem arremate com parcelamento registrado.' }); return { doc: doc.id, sem_parcelamento: true }; }
  const clienteId = caso?.cliente_id || arr.user_id;
  const casoId = caso?.id || null;
  const marcarDoc = (_id, campos) => marcar(doc, campos);

  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${doc.storage_path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`storage HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ehGuia = doc.ehGuia;
  const lido = await (ehGuia ? lerGuiaArquivo : lerComprovanteArquivo)(buf, { nome: doc.nome });

  const itens = cronograma(arr.parcelamento, { valor: arr.valor_arrematacao, dataArrematacao: arr.data_arrematacao });
  const guias = arr.parcelamento.guias || {};
  const escolha = qualParcela(ehGuia ? 'guia' : 'comprovante', lido, itens, guias);
  const cliente = (await ler(`perfis?id=eq.${clienteId}&select=nome`))[0]?.nome || 'cliente';
  const cab = `<b>${esc(cliente)}</b> · ${esc(arr.titulo || caso?.imovel_endereco || 'imóvel arrematado')}`;

  if (escolha.aviso) {
    if (!seco) {
      await marcarDoc(doc.id, { parcela_status: 'aviso', parcela_aviso: escolha.aviso, ...(doc.kind === 'caso' ? { parcela_lido: lido } : {}) });
      await avisarDono({ casoId, assunto: `${ehGuia ? 'Guia' : 'Comprovante'} recebido sem parcela definida · ${cliente}`,
        linhas: [cab, `Chegou ${ehGuia ? 'uma guia' : 'um comprovante'} (${esc(doc.titulo || doc.nome)}), mas não liguei a nenhuma parcela: ${esc(escolha.aviso)}`, 'Confira na tela do caso.'] });
    }
    return { doc: doc.id, aviso: escolha.aviso, lido };
  }
  const parcela = itens.find((x) => x.idx === escolha.idx);

  if (ehGuia) {
    const g = guias[parcela.idx];
    if (parcela.paga || g?.enviada_em) {
      const motivo = parcela.paga ? 'parcela já paga' : `guia desta parcela já enviada em ${dataBR(g.enviada_em)}`;
      if (!seco) await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'ignorado', parcela_aviso: `Guia repetida: ${motivo}.`, ...(doc.kind === 'caso' ? { parcela_lido: lido } : {}) });
      return { doc: doc.id, ignorado: motivo };
    }
    const [lote] = arr.imovel_id ? await ler(`imoveis_leilao?id=eq.${arr.imovel_id}&select=numero_processo`) : [];
    const avisos = avisosDaGuia(lido, parcela, lote?.numero_processo || null);
    const guia = { ...camposDaGuia(lido), storage_path: doc.storage_path, nome: doc.nome, origem: doc.kind === 'caso' ? 'email' : 'upload',
      ...(doc.kind === 'caso' ? { caso_documento_id: doc.id } : { anexo_id: doc.id }),
      aguardando_aprovacao: true, avisos };
    if (seco) return { doc: doc.id, parcela: parcela.rotulo, por: escolha.por, guia };
    await registrar(arr.id, parcela.idx, { guia });
    await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'vinculada', parcela_aviso: avisos.join(' ') || null, ...(doc.kind === 'caso' ? { parcela_lido: lido } : {}) });
    await espelharNoArremate(arr, doc, 'guia_parcela', parcela);
    await avisarDono({ casoId, assunto: `Guia da ${parcela.rotulo} recebida · aprove o envio · ${cliente}`, linhas: [
      cab,
      `Guia da <b>${esc(parcela.rotulo)}</b>: ${brl(guia.valor || parcela.valor)}. Pagar até <b>${dataBR(parcela.pagar_ate)}</b> (vencimento ${dataBR(parcela.venc)})${guia.vencimento ? `, validade da guia ${dataBR(guia.vencimento)}` : ''}.`,
      `Conferir: <b>nome</b> ${esc(guia.depositante || 'não lido')} (cliente: ${esc(cliente)}) · <b>processo</b> ${esc(guia.processo || 'não lido')} (caso: ${esc(lote?.numero_processo || '—')}) · <b>valor</b> ${brl(guia.valor)} (parcela: ${brl(parcela.valor)}).`,
      ...(avisos.length ? [`<span style="color:#b45309">Atenção: ${esc(avisos.join(' '))}</span>`] : []),
      'O envio ao arrematante só sai depois da sua aprovação, no botão "Aprovar e enviar" da tela do caso.',
    ] });
    return { doc: doc.id, parcela: parcela.rotulo, vinculada: true };
  }

  // Comprovante.
  if (parcela.paga) {
    if (!seco) await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'ignorado', parcela_aviso: 'Parcela já estava paga.', ...(doc.kind === 'caso' ? { parcela_lido: lido } : {}) });
    return { doc: doc.id, ignorado: 'parcela já paga' };
  }
  const pagamento = { pago_em: /^\d{4}-\d{2}-\d{2}$/.test(lido?.data_pagamento || '') ? lido.data_pagamento : null,
    valor: typeof lido?.valor === 'number' ? Math.round(lido.valor * 100) / 100 : null,
    storage_path: doc.storage_path, nome: doc.nome, registrado_em: new Date().toISOString(), por: escolha.por,
    ...(doc.kind === 'caso' ? { caso_documento_id: doc.id } : { anexo_id: doc.id }) };
  if (seco) return { doc: doc.id, parcela: parcela.rotulo, por: escolha.por, pagamento };
  await registrar(arr.id, parcela.idx, { pagamento, paga: true });
  await marcarDoc(doc.id, { parcela_idx: parcela.idx, parcela_status: 'paga', ...(doc.kind === 'caso' ? { parcela_lido: lido } : {}) });
  await espelharNoArremate(arr, doc, 'comprovante_parcela', parcela);
  const atrasado = pagamento.pago_em && pagamento.pago_em > parcela.venc;
  await avisarDono({ casoId, assunto: `${parcela.rotulo} paga (comprovante recebido) · ${cliente}`, linhas: [
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
    const doCaso = (await ler('caso_documentos?parcela_processado_em=is.null&tipo=in.(guia_deposito,comprovante_pagamento)&select=id,caso_id,tipo,nome,titulo,storage_path&order=criado_em.asc&limit=' + POR_RODADA))
      .map((d) => ({ ...d, kind: 'caso', ehGuia: d.tipo === 'guia_deposito' }));
    const doArremate = (await ler('imovel_anexos?parcela_processado_em=is.null&storage_path=not.is.null&tipo=in.(guia_parcela,comprovante_parcela)&select=id,imovel_id,tipo,nome,storage_path&order=criado_em.asc&limit=' + POR_RODADA))
      .map((d) => ({ ...d, kind: 'anexo', ehGuia: d.tipo === 'guia_parcela', titulo: d.nome }));
    const docs = [...doArremate, ...doCaso].slice(0, POR_RODADA);
    for (const d of docs) {
      try { res.resultados.push(await processar(d, { seco })); res.processados++; }
      catch (e) {
        res.falhas++; res.resultados.push({ doc: d.id, erro: e?.message }); console.error(`[parcelas-documentos] ${d.id}:`, e?.message);
        // 18/10 (bug bounty): erro PERMANENTE (formato que não lemos, arquivo sumido do storage, resposta da
        // IA sem JSON) deixava o documento sem `parcela_processado_em` — voltava em toda rodada, repetia a IA
        // e, com 6 deles, ocupava a fila inteira para sempre. Agora sai da fila como aviso e o dono fica sabendo.
        // Erro transitório (rede, 5xx) continua tentando na próxima rodada.
        const msg = String(e?.message || '');
        const permanente = /formato|n[ãa]o lid|desconhecid|storage HTTP 4\d\d|JSON|Unexpected token/i.test(msg);
        if (permanente && !seco) {
          try {
            await marcar(d, { parcela_status: 'aviso', parcela_aviso: `Não consegui ler este documento: ${msg.slice(0, 200)}` });
            await avisarDono({ assunto: `Documento de parcela não lido · ${d.titulo || d.nome || d.id}`, casoId: d.caso_id || null,
              linhas: [`Não consegui ler <b>${esc(d.titulo || d.nome || 'o documento')}</b> (${d.ehGuia ? 'guia' : 'comprovante'} de parcela).`,
                `Motivo: ${esc(msg.slice(0, 200))}`, 'Confira o arquivo e registre a parcela pela tela, se for o caso.'] });
          } catch (e2) { console.error(`[parcelas-documentos] ${d.id}: não consegui tirar da fila:`, e2?.message); }
        }
      }
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
