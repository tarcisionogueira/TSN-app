/**
 * /api/casos-acompanhamento-cron — cobra o JURÍDICO das pastas em andamento (10/10, pedido do dono).
 *
 * "Nosso trabalho vai até a posse do imóvel." Enquanto o caso está depois do arremate e SEM posse
 * (casos.posse_em nulo), o e-mail sai do endereço PESSOAL do dono (equipe_email do admin) para o
 * advogado/escritório vinculado ao caso, pedindo:
 *   1) ATUALIZAÇÃO do processo — uma vez por semana (1º dia útil da semana em que rodar);
 *   2) a GUIA DE CADA PARCELA do arremate (arrematados.parcelamento) — por VENCIMENTO, não por
 *      semana: pedido a 5 dias do vencimento (dono, 12/10 — antes eram ~10); novo pedido na véspera/
 *      atraso SÓ se a guia ainda não chegou (nenhuma resposta com anexo no caso desde o 1º pedido,
 *      nem guia anexada pela equipe no painel do arremate).
 * Os dois vão em e-mails SEPARADOS, com assunto próprio: a guia não se perde no meio da atualização.
 *
 * A resposta volta para tarcisio+<token>@ → inbound-juridico encadeia na conversa (resposta_de) e o
 * gatilho email_caixa_classificar herda o caso_id. Na caixa, o botão "Enviar só o anexo ao cliente"
 * manda a guia ao cliente sem o texto do advogado (api/email-caixa.js, acao cliente_do_caso).
 *
 * Caso sem advogado vinculado: não há jurídico a cobrar — o pedido da guia vira AVISO para a equipe
 * (12/10: a 1ª parcela do Marcos ia vencer sem ninguém pedir a guia) e o id sai em `sem_advogado`. Trava: webhook_eventos_processados (mesmo
 * desenho do parcelas-arremate-cron); falhou o envio → libera a trava e tenta no próximo dia.
 * `?seco=1` mostra o que sairia (texto completo, Para/Cc, assunto), sem enviar nem travar.
 *
 * 15/10 (dono): (a) caso SEM conta de advogado mas com os e-mails do escritório no próprio caso
 * (casos.acompanhamento_para/_cc) é cobrado igual — só depois de casos.acompanhamento_liberado_em (o dono
 * aprova o 1º rascunho); (b) a ATUALIZAÇÃO semanal sai às QUARTAS (a guia segue o vencimento, qualquer dia
 * útil); (c) o e-mail RESPONDE à última mensagem do caso em email_caixa (In-Reply-To/References) com
 * "Re: <casos.acompanhamento_assunto>" — fica na mesma conversa do imóvel que o escritório já tem, e a
 * conversa importada do Gmail da Reimob entra na mesma pasta; (d) o juridico-devolutivas-cron lê as
 * respostas e ajusta casos.acompanhamento_intervalo_dias (14 = quinzenal quando o que se espera é lento)
 * e a referência ao último ponto citada no pedido de atualização.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { cronograma, proximaPendente } from '../src/utils/parcelamentoArremate.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
// Etapas depois do arremate em que o caso ainda é nosso (até a posse).
const ETAPAS = ['arrematado', 'honorarios_pagos', 'procuracao_assinada', 'pos_arrematacao'];
// Marcos do pedido da guia (dias até o vencimento → marco). Janela, não dia exato: o cron roda só em
// dia útil, e um marco que cai no fim de semana ainda é pego no dia útil seguinte.
const DIA_ATUALIZACAO = 3; // quarta-feira (getUTCDay sobre a data de Brasília)
// "Operação atribuída pela equipe" / "Arremate atribuído pela equipe" são marcadores do cadastro manual,
// não endereço — não vão para o assunto nem para o texto do e-mail ao escritório.
const RE_PLACEHOLDER = /atribu[ií]d[ao] pela equipe/i;
// Guia já no sistema: anexada na tela (imovel_anexos → anexo_id) ou vinda por e-mail (caso_documentos → storage_path).
const temGuia = (arr, idx) => { const g = arr?.parcelamento?.guias?.[idx]; return !!(g?.anexo_id || g?.storage_path); };
const marcoGuia = (dias) => (dias >= 2 && dias <= 5 ? 5 : dias >= -7 && dias <= 1 ? 0 : null);

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const dataBR = (s) => String(s).slice(0, 10).split('-').reverse().join('/');

// Leitura que LANÇA: lista vazia por erro de leitura viraria "nenhum caso" com cara de resposta.
async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}
async function usuarioAuth(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { console.error(`[acompanhamento] usuário ${userId}: HTTP ${r.status}`); return null; }
    return await r.json();
  } catch (e) { console.error('[acompanhamento] usuarioAuth falhou:', e?.message); return null; }
}
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Para quem vai (10/10): os e-mails de comunicação do advogado (juridico_destinatarios — o
// "Para" é quem não é cópia); sem lista ainda, os informados no cadastro (metadata); por fim, o
// e-mail da conta. Mesma ordem de preferência que o portal mostra em "Meu Escritório".
async function destinatarios(advogadoId) {
  const lista = await ler(`juridico_destinatarios?advogado_id=eq.${advogadoId}&ativo=eq.true&select=email,copia&order=criado_em.asc`);
  let to = lista.filter(d => d.copia === false).map(d => d.email.toLowerCase());
  let cc = lista.filter(d => d.copia !== false).map(d => d.email.toLowerCase());
  if (!to.length && cc.length) to = [cc.shift()];
  if (!to.length) {
    const u = await usuarioAuth(advogadoId);
    const doCadastro = String(u?.user_metadata?.emails_comunicacao || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => RE_EMAIL.test(e));
    if (doCadastro.length) { to = [doCadastro[0]]; cc = doCadastro.slice(1); }
    else if (u?.email) to = [String(u.email).toLowerCase()];
  }
  cc = [...new Set(cc)].filter(e => !to.includes(e));
  return { to, cc };
}
// O INSERT é a trava (PK única). Erro inesperado → trata como já enviado (não duplica).
async function travar(chave, casoId) {
  try {
    const r = await sb('webhook_eventos_processados', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ gateway: 'acompanhamento_caso', gateway_payment_id: casoId, evento: chave }) });
    if (r.status === 201 || r.ok) return true;
    if (r.status !== 409) console.error(`[acompanhamento] trava ${chave}: HTTP ${r.status}`);
    return false;
  } catch (e) { console.error('[acompanhamento] trava falhou (não envia):', e?.message); return false; }
}
async function liberar(chave) {
  const r = await sb(`webhook_eventos_processados?gateway=eq.acompanhamento_caso&evento=eq.${encodeURIComponent(chave)}`, { method: 'DELETE' })
    .catch((e) => ({ ok: false, status: e?.message }));
  if (!r.ok) console.error('[acompanhamento] liberar trava falhou:', r.status);
}
// Semana ISO (2026-W41): a chave da atualização semanal.
function semanaIso(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const ano = t.getUTCFullYear();
  const sem = Math.ceil(((t - Date.UTC(ano, 0, 1)) / 86400000 + 1) / 7);
  return `${ano}-W${String(sem).padStart(2, '0')}`;
}

// Modelo do dono (15/10): só pede a atualização desde a última comunicação — sem prazo de posse (depende
// do juiz) e sem travessões. Cada e-mail leva UM pedido (atualização e guia saem separados).
// Endereço vindo do acervo traz " - "/"—" como separador ("Galpão em ruína -Feira de Santana/BA"): vira vírgula.
const semTracos = (s) => String(s || '').replace(/\s*[—–]\s*|\s+-\s*|\s*-\s+/g, ', ').replace(/,\s*,/g, ',').trim();
export const ASSINATURA = 'Tarcísio Nogueira'; // como o dono assina com o escritório (15/10)

export function textoPedido({ advogado, cliente, endereco, processo, atualizacao, parcela, insistencia = false, referencia = null }) {
  const imovel = semTracos(endereco) || 'imóvel arrematado';
  const linhas = [
    `${advogado ? `Dr(a). ${advogado}` : 'Prezados'}, tudo bem?`,
    '',
    `Estamos acompanhando a pasta do(a) cliente ${cliente || '(sem nome)'}, ${imovel}${processo ? `, processo nº ${processo}` : ''}.`,
    '',
  ];
  // referencia: o último ponto lido das devolutivas pela IA (juridico-devolutivas-cron), quando houver.
  const ref = semTracos(referencia).replace(/[.?!]+$/, '');
  if (atualizacao) linhas.push(`Por gentileza, poderiam nos informar o andamento do processo desde a última comunicação${ref ? `, sobre ${ref}` : ''}?`, '');
  if (parcela) {
    const quando = parcela.dias < 0 ? `venceu em ${dataBR(parcela.venc)}` : `vence em ${dataBR(parcela.venc)}`;
    linhas.push(`A ${parcela.rotulo} (valor nominal ${brl(parcela.valor)}) ${quando}.${insistencia ? ' Ainda não recebemos a guia. Por gentileza,' : ' Por gentileza,'} respondam este e-mail com a guia/boleto em anexo para encaminharmos ao cliente.`, '');
  }
  linhas.push('Basta responder este e-mail. A resposta fica registrada na pasta do caso.', '', 'Obrigado!');
  return linhas.join('\n');
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const seco = new URL(req.url, BASE).searchParams.get('seco') === '1';
  // ?atualizar_agora=1 (dono, 15/10: 1º envio aprovado fora da quarta) — a trava por semana impede repetir.
  const atualizarAgora = new URL(req.url, BASE).searchParams.get('atualizar_agora') === '1';
  const res = { casos: 0, sem_advogado: [], sem_email_advogado: [], enviados: 0, atualizacoes: 0, parcelas: 0, ja_enviados: 0, falhas: 0, seco, previa: [] };
  try {
    // Remetente: o endereço pessoal do admin (o dono).
    const admin = (await ler('perfis?role=eq.admin&ativo=eq.true&select=id,nome&order=created_at.asc&limit=1'))[0];
    const remet = admin ? (await ler(`equipe_email?user_id=eq.${admin.id}&select=endereco`))[0] : null;
    if (!remet?.endereco) throw new Error('admin sem endereço pessoal em equipe_email');

    const COLS = 'id,cliente_id,advogado_id,imovel_id,imovel_endereco,acompanhamento_para,acompanhamento_cc,acompanhamento_liberado_em,acompanhamento_assunto,acompanhamento_intervalo_dias';
    const todos = await ler(`casos?posse_em=is.null&status_etapa=in.(${ETAPAS.join(',')})&select=${COLS}`);
    const temEscritorio = (c) => Array.isArray(c.acompanhamento_para) && c.acompanhamento_para.length > 0;
    // Cobrado: conta de advogado vinculada, OU e-mails do escritório no caso com o 1º envio já aprovado.
    // Escritório no caso mas sem aprovação: entra no laço só em modo rascunho (previa), nunca envia.
    const casos = todos.filter((c) => c.advogado_id || temEscritorio(c));
    // Sem ninguém a cobrar (ou ainda não aprovado): a guia vira aviso para a equipe, como antes.
    const semAdv = todos.filter((c) => !c.advogado_id && (!temEscritorio(c) || !c.acompanhamento_liberado_em));
    for (const c of semAdv) res.sem_advogado.push(c.id);
    res.casos = casos.length;

    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // dia em Brasília

    // Sem advogado, a guia não tem a quem ser pedida: avisa a equipe no mesmo marco (5 dias / véspera).
    for (const c of semAdv) {
      const arrs = await ler(`arrematados?user_id=eq.${c.cliente_id}&select=id,imovel_id,valor_arrematacao,data_arrematacao,parcelamento`);
      const arr = arrs.find((a) => c.imovel_id && a.imovel_id === c.imovel_id) || (arrs.length === 1 ? arrs[0] : null);
      if (!arr?.parcelamento) continue;
      let p;
      try { p = proximaPendente(cronograma(arr.parcelamento, { valor: arr.valor_arrematacao, dataArrematacao: arr.data_arrematacao }), hoje); }
      catch (e) { res.falhas++; console.error(`[acompanhamento] cronograma ilegível ${arr.id}:`, e?.message); continue; }
      const marco = p ? marcoGuia(p.dias) : null;
      if (marco === null || temGuia(arr, p.idx)) continue;
      const chave = `semadv|${c.id}|${p.idx}|${p.venc}|${marco}`;
      if (seco) { res.previa.push({ caso: c.id, aviso_equipe_sem_advogado: chave }); continue; }
      if (!(await travar(chave, c.id))) { res.ja_enviados++; continue; }
      const [cli] = await ler(`perfis?id=eq.${c.cliente_id}&select=nome`);
      const env = await enviarEmail({
        from: `BidPro Brasil <${remet.endereco}>`, to: process.env.ADMIN_ALERT_EMAIL || remet.endereco,
        subject: `⚠️ Guia da ${p.rotulo} (vence ${dataBR(p.venc)}) — ${cli?.nome || 'cliente'}: caso SEM advogado`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1e293b;line-height:1.6"><p>A <b>${esc(p.rotulo)}</b> de ${esc(cli?.nome || 'cliente')} (${esc(c.imovel_endereco || 'imóvel arrematado')}) vence em <b>${dataBR(p.venc)}</b> — valor nominal ${brl(p.valor)}.</p><p>O caso está <b>sem advogado vinculado</b>, então ninguém recebeu o pedido da guia. Vincule o escritório no caso ou gere a guia pelo painel "Emitir guia" em <a href="${BASE}/arrematados">${BASE}/arrematados</a>.</p></div>`,
        meta: { tipo: 'acompanhamento_sem_advogado' }, idempotencyKey: `acompanhamento:${chave}`,
      }).catch((e) => ({ ok: false, error: e?.message }));
      // 19/10: represado no orçamento diário (enfileirado) SAI amanhã pela fila — liberar a trava duplicava.
      if (env?.ok || env?.enfileirado) res.avisos_sem_advogado = (res.avisos_sem_advogado || 0) + 1;
      else { res.falhas++; console.error(`[acompanhamento] aviso sem advogado falhou caso ${c.id}:`, env?.error); await liberar(chave); }
    }
    const semana = semanaIso(new Date(`${hoje}T12:00:00Z`));
    const diaDeAtualizacao = atualizarAgora || new Date(`${hoje}T12:00:00Z`).getUTCDay() === DIA_ATUALIZACAO;

    for (const c of casos) {
      const [cli] = await ler(`perfis?id=eq.${c.cliente_id}&select=nome`);
      const [adv] = c.advogado_id ? await ler(`perfis?id=eq.${c.advogado_id}&select=nome`) : [null];
      const liberado = Boolean(c.advogado_id || c.acompanhamento_liberado_em);
      // Parcelamento: o arremate do MESMO imóvel do cliente; sem imóvel no caso, o único arremate dele.
      const arrs = await ler(`arrematados?user_id=eq.${c.cliente_id}&select=id,imovel_id,valor_arrematacao,data_arrematacao,parcelamento`);
      const arr = arrs.find((a) => c.imovel_id && a.imovel_id === c.imovel_id) || (arrs.length === 1 ? arrs[0] : null);
      let parcela = null;
      if (arr?.parcelamento) {
        try {
          const p = proximaPendente(cronograma(arr.parcelamento, { valor: arr.valor_arrematacao, dataArrematacao: arr.data_arrematacao }), hoje);
          if (p && marcoGuia(p.dias) !== null) parcela = { ...p, marco: marcoGuia(p.dias) };
        } catch (e) { res.falhas++; console.error(`[acompanhamento] cronograma ilegível ${arr.id}:`, e?.message); }
      }
      let processo = null;
      let endereco = RE_PLACEHOLDER.test(c.imovel_endereco || '') ? null : c.imovel_endereco;
      if (/^[0-9a-f-]{36}$/i.test(String(c.imovel_id || ''))) {
        const im = (await ler(`imoveis_leilao?id=eq.${c.imovel_id}&select=numero_processo,titulo`))[0];
        processo = im?.numero_processo || null;
        if (!endereco && im?.titulo && !RE_PLACEHOLDER.test(im.titulo)) endereco = im.titulo;
      }

      // Guia já anexada no sistema pela equipe (painel "Emitir guia", 12/10): não pede ao jurídico.
      if (parcela && temGuia(arr, parcela.idx)) { res.guia_ja_no_sistema = (res.guia_ja_no_sistema || 0) + 1; parcela = null; }
      // Guia já chegou? Insistir (véspera/atraso) só se nenhuma resposta com anexo entrou no caso
      // desde o 1º pedido desta parcela (5 dias antes do vencimento; margem para fim de semana).
      if (parcela && parcela.marco !== 5) {
        const desde = new Date(Date.parse(`${parcela.venc}T12:00:00Z`) - 7 * 864e5).toISOString();
        // `anexos` nunca é nulo (default '[]'): o filtro antigo `not.is.null` contava qualquer resposta como guia.
        const veio = await ler(`email_caixa?caso_id=eq.${c.id}&direcao=eq.entrada&anexos=neq.[]&criado_em=gte.${desde}&select=id&limit=1`);
        if (veio.length) { res.guia_ja_recebida = (res.guia_ja_recebida || 0) + 1; parcela = null; }
      }
      // Intervalo aprendido das devolutivas (7 = toda quarta; 14 = quarta sim, quarta não): conta desde o
      // último acompanhamento ENVIADO pelo cron (resposta_token só existe nos envios dele).
      let atualizaHoje = diaDeAtualizacao;
      if (atualizaHoje && !atualizarAgora && Number(c.acompanhamento_intervalo_dias) === 14) {
        const [ultEnvio] = await ler(`email_caixa?caso_id=eq.${c.id}&direcao=eq.saida&resposta_token=not.is.null&select=criado_em&order=criado_em.desc&limit=1`);
        if (ultEnvio && Date.now() - Date.parse(ultEnvio.criado_em) < 12 * 864e5) { atualizaHoje = false; res.quinzenal_aguardando = (res.quinzenal_aguardando || 0) + 1; }
      }
      const [analise] = await ler(`caso_acompanhamento_analise?caso_id=eq.${c.id}&select=referencia_curta&order=criado_em.desc&limit=1`);
      // Conversa do imóvel: assunto da conversa que o escritório já tem → "Re: …" para os dois e-mails.
      const assuntoConversa = c.acompanhamento_assunto ? `Re: ${c.acompanhamento_assunto.replace(/^(re|res|fwd?):\s*/i, '')}` : null;
      const envios = [
        ...((atualizaHoje || seco) ? [{ tipo: 'atualizacao', chave: `atualizacao|${c.id}|${semana}`,
          assunto: assuntoConversa || `Acompanhamento — ${cli?.nome || 'cliente'} · ${endereco || 'imóvel arrematado'}`,
          texto: textoPedido({ advogado: adv?.nome, cliente: cli?.nome, endereco, processo, atualizacao: true, parcela: null, referencia: analise?.referencia_curta }) }] : []),
        ...(parcela ? [{ tipo: 'parcela', chave: `parcela|${c.id}|${parcela.idx}|${parcela.venc}|${parcela.marco}`,
          assunto: assuntoConversa || `Guia da ${parcela.rotulo} (vence ${dataBR(parcela.venc)}) — ${cli?.nome || 'cliente'} · ${endereco || 'imóvel arrematado'}`,
          texto: textoPedido({ advogado: adv?.nome, cliente: cli?.nome, endereco, processo, atualizacao: false, parcela, insistencia: parcela.marco !== 5 }) }] : []),
      ];
      const destinosDoCaso = () => (c.advogado_id ? destinatarios(c.advogado_id)
        : { to: c.acompanhamento_para.map((e) => e.toLowerCase()), cc: (c.acompanhamento_cc || []).map((e) => e.toLowerCase()).filter((e) => !c.acompanhamento_para.includes(e)) });
      if (seco || !liberado) {
        const d = await destinosDoCaso();
        res.previa.push({ caso: c.id, cliente: cli?.nome, aguardando_aprovacao: !liberado, para: d.to, cc: d.cc,
          envios: envios.map((e) => ({ chave: e.chave, assunto: e.assunto, texto: e.texto })) });
        continue;
      }
      // Última mensagem conhecida do caso (importada do Gmail, resposta do escritório ou envio anterior):
      // o e-mail responde a ela e entra na mesma conversa do lado do escritório.
      // Fora: reencaminhamentos internos (Fwd: do Gmail da Reimob para a caixa do BidPro, 15/10) e âncoras —
      // o escritório nunca recebeu essas mensagens, e responder a elas partiria a conversa do lado dele.
      const [ult] = await ler(`email_caixa?caso_id=eq.${c.id}&message_id=not.is.null&assunto=not.ilike.fwd:*&assunto=not.ilike.*ncora:*&select=message_id,referencias&order=criado_em.desc&limit=1`);
      const fio = ult ? { 'In-Reply-To': ult.message_id, References: `${ult.referencias || ''} ${ult.message_id}`.trim().split(/\s+/).slice(-20).join(' ') } : null;
      let destinos = null;
      for (const ev of envios) {
        if (!(await travar(ev.chave, c.id))) { res.ja_enviados++; continue; }
        destinos = destinos || await destinosDoCaso();
        const { to: para, cc } = destinos;
        if (!para.length) { res.sem_email_advogado.push(c.id); await liberar(ev.chave); continue; }
        const textoFinal = `${ev.texto}\n\n${ASSINATURA}\nBidPro Brasil`;
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1e293b;line-height:1.6;white-space:pre-wrap">${esc(ev.texto)}</div>`
          + `<p style="font-family:Arial,Helvetica,sans-serif;color:#475569;font-size:13px;margin-top:18px">${esc(ASSINATURA)}<br>BidPro Brasil</p>`;
        const assunto = ev.assunto.slice(0, 300);
        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
        try {
          const env = await enviarEmail({
            from: `${ASSINATURA} (BidPro Brasil) <${remet.endereco}>`,
            to: para, cc: cc.length ? cc : undefined, replyTo: remet.endereco.replace('@', `+${token}@`),
            subject: assunto, html, text: textoFinal, ...(fio ? { headers: fio } : {}),
            meta: { tipo: 'acompanhamento_caso', userId: admin.id },
            idempotencyKey: `acompanhamento:${ev.chave}`,
            semFila: true, // 19/10: a fila não guarda remetente/fio/anexo — represado sairia por noreply@, fora do fio, e em dobro
          });
          if (!env?.ok && !env?.enfileirado) throw new Error(env?.error || 'envio sem confirmação'); // enfileirado = a fila entrega (19/10)
          // O e-mail JÁ SAIU: falha no registro é só histórico — mas é o registro que liga a resposta
          // ao caso, então grita no log em vez de engolir.
          const ins = await sb('email_caixa', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
            direcao: 'saida', pasta: 'enviados', caixa: remet.endereco, de_email: remet.endereco, de_nome: ASSINATURA, dono: admin.id,
            para, cc, assunto, texto: textoFinal, html, resend_email_id: env.id || null, lido: true,
            enviado_por: admin.id, resposta_token: token, caso_id: c.id,
            in_reply_to: fio?.['In-Reply-To'] || null, referencias: fio?.References || null,
          }) });
          if (!ins.ok) console.error(`[acompanhamento] enviado mas NÃO registrado em email_caixa (caso ${c.id}): HTTP ${ins.status} — a resposta do advogado não vai se ligar ao caso`);
          res.enviados++;
          if (ev.tipo === 'atualizacao') res.atualizacoes++; else res.parcelas++;
        } catch (e) {
          res.falhas++;
          console.error(`[acompanhamento] envio falhou caso ${c.id} (${ev.tipo}):`, e?.message);
          await liberar(ev.chave); // tenta de novo no próximo dia útil
        }
      }
    }
  } catch (e) {
    console.error('[acompanhamento] falhou:', e?.message);
    return new Response(JSON.stringify({ ok: false, erro: e?.message, ...res }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  console.log('[acompanhamento]', JSON.stringify(res));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
