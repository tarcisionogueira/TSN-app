/**
 * /api/casos-acompanhamento-cron — cobra o JURÍDICO das pastas em andamento (10/10, pedido do dono).
 *
 * "Nosso trabalho vai até a posse do imóvel." Enquanto o caso está depois do arremate e SEM posse
 * (casos.posse_em nulo), o e-mail sai do endereço PESSOAL do dono (equipe_email do admin) para o
 * advogado/escritório vinculado ao caso, pedindo:
 *   1) ATUALIZAÇÃO do processo — uma vez por semana (1º dia útil da semana em que rodar);
 *   2) a GUIA DA PRÓXIMA PARCELA do arremate (arrematados.parcelamento) — uma vez por parcela,
 *      a partir de 12 dias antes do vencimento (ou se já atrasou há até 7 dias).
 * Quando caem juntos, vai UM e-mail com os dois pedidos.
 *
 * A resposta volta para tarcisio+<token>@ → inbound-juridico encadeia na conversa (resposta_de) e o
 * gatilho email_caixa_classificar herda o caso_id. Na caixa, o botão "Enviar só o anexo ao cliente"
 * manda a guia ao cliente sem o texto do advogado (api/email-caixa.js, acao cliente_do_caso).
 *
 * Caso sem advogado vinculado NÃO recebe nada (não há para quem cobrar) — sai na contagem
 * `sem_advogado` com o id, para não virar silêncio. Trava: webhook_eventos_processados (mesmo
 * desenho do parcelas-arremate-cron); falhou o envio → libera a trava e tenta no próximo dia.
 * `?seco=1` mostra o que sairia, sem enviar nem travar.
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
const JANELA_PARCELA = 12; // dias antes do vencimento em que a guia é pedida

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
async function emailDoUsuario(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { console.error(`[acompanhamento] usuário ${userId}: HTTP ${r.status}`); return null; }
    const u = await r.json();
    return u?.email ? String(u.email).toLowerCase() : null;
  } catch (e) { console.error('[acompanhamento] emailDoUsuario falhou:', e?.message); return null; }
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

export function textoPedido({ advogado, cliente, endereco, processo, atualizacao, parcela }) {
  const linhas = [
    `${advogado ? `Dr(a). ${advogado}` : 'Prezados'}, tudo bem?`,
    '',
    `Estamos acompanhando a pasta do(a) cliente ${cliente || '(sem nome)'} — ${endereco || 'imóvel arrematado'}${processo ? `, processo nº ${processo}` : ''}.`,
    '',
  ];
  let n = 1;
  if (atualizacao) linhas.push(`${n++}) ATUALIZAÇÃO: poderia nos informar o andamento do processo desde o último contato e a previsão para a imissão na posse?`, '');
  if (parcela) {
    const quando = parcela.dias < 0 ? `venceu em ${dataBR(parcela.venc)}` : `vence em ${dataBR(parcela.venc)}`;
    linhas.push(`${n++}) GUIA DA PARCELA: a ${parcela.rotulo} (valor nominal ${brl(parcela.valor)}) ${quando}. Por gentileza, responda este e-mail com a guia/boleto em anexo para encaminharmos ao cliente.`, '');
  }
  linhas.push('Basta responder este e-mail — a resposta fica registrada na pasta do caso.', '', 'Obrigado!');
  return linhas.join('\n');
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const seco = new URL(req.url, BASE).searchParams.get('seco') === '1';
  const res = { casos: 0, sem_advogado: [], sem_email_advogado: [], enviados: 0, atualizacoes: 0, parcelas: 0, ja_enviados: 0, falhas: 0, seco, previa: [] };
  try {
    // Remetente: o endereço pessoal do admin (o dono).
    const admin = (await ler('perfis?role=eq.admin&ativo=eq.true&select=id,nome&order=created_at.asc&limit=1'))[0];
    const remet = admin ? (await ler(`equipe_email?user_id=eq.${admin.id}&select=endereco`))[0] : null;
    if (!remet?.endereco) throw new Error('admin sem endereço pessoal em equipe_email');

    const casos = await ler(`casos?posse_em=is.null&advogado_id=not.is.null&status_etapa=in.(${ETAPAS.join(',')})&select=id,cliente_id,advogado_id,imovel_id,imovel_endereco`);
    // Os sem advogado não entram no laço, mas aparecem no resultado.
    for (const c of await ler(`casos?posse_em=is.null&advogado_id=is.null&status_etapa=in.(${ETAPAS.join(',')})&select=id`)) res.sem_advogado.push(c.id);
    res.casos = casos.length;

    const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // dia em Brasília
    const semana = semanaIso(new Date(`${hoje}T12:00:00Z`));

    for (const c of casos) {
      const [cli] = await ler(`perfis?id=eq.${c.cliente_id}&select=nome`);
      const [adv] = await ler(`perfis?id=eq.${c.advogado_id}&select=nome`);
      // Parcelamento: o arremate do MESMO imóvel do cliente; sem imóvel no caso, o único arremate dele.
      const arrs = await ler(`arrematados?user_id=eq.${c.cliente_id}&select=id,imovel_id,valor_arrematacao,data_arrematacao,parcelamento`);
      const arr = arrs.find((a) => c.imovel_id && a.imovel_id === c.imovel_id) || (arrs.length === 1 ? arrs[0] : null);
      let parcela = null;
      if (arr?.parcelamento) {
        try {
          const p = proximaPendente(cronograma(arr.parcelamento, { valor: arr.valor_arrematacao, dataArrematacao: arr.data_arrematacao }), hoje);
          if (p && p.dias <= JANELA_PARCELA && p.dias >= -7) parcela = p;
        } catch (e) { res.falhas++; console.error(`[acompanhamento] cronograma ilegível ${arr.id}:`, e?.message); }
      }
      let processo = null;
      if (/^[0-9a-f-]{36}$/i.test(String(c.imovel_id || ''))) {
        processo = (await ler(`imoveis_leilao?id=eq.${c.imovel_id}&select=numero_processo`))[0]?.numero_processo || null;
      }

      const chaveAtu = `atualizacao|${c.id}|${semana}`;
      const chavePar = parcela ? `parcela|${c.id}|${parcela.idx}|${parcela.venc}` : null;
      if (seco) {
        res.previa.push({ caso: c.id, cliente: cli?.nome, atualizacao_semana: semana, parcela: parcela ? `${parcela.rotulo} ${parcela.venc} (${parcela.dias}d)` : null });
        continue;
      }
      const atualizacao = await travar(chaveAtu, c.id);
      const pedeParcela = chavePar ? await travar(chavePar, c.id) : false;
      if (!atualizacao && !pedeParcela) { res.ja_enviados++; continue; }
      const soltar = async () => { if (atualizacao) await liberar(chaveAtu); if (pedeParcela) await liberar(chavePar); };

      const para = await emailDoUsuario(c.advogado_id);
      if (!para) { res.sem_email_advogado.push(c.id); await soltar(); continue; }

      const texto = textoPedido({ advogado: adv?.nome, cliente: cli?.nome, endereco: c.imovel_endereco, processo, atualizacao, parcela: pedeParcela ? parcela : null });
      const assinatura = `${admin.nome || 'Equipe BidPro Brasil'}\nBidPro Brasil`;
      const textoFinal = `${texto}\n\n—\n${assinatura}`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1e293b;line-height:1.6;white-space:pre-wrap">${esc(texto)}</div>`
        + `<p style="font-family:Arial,Helvetica,sans-serif;color:#475569;font-size:13px;margin-top:18px">—<br>${esc(admin.nome || 'Equipe BidPro Brasil')}<br>BidPro Brasil</p>`;
      // Assunto FIXO por caso: as semanas caem na mesma conversa (conversa_chave = contraparte + assunto).
      const assunto = `Acompanhamento — ${cli?.nome || 'cliente'} · ${c.imovel_endereco || 'imóvel arrematado'}`.slice(0, 300);
      const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      try {
        const env = await enviarEmail({
          from: `${admin.nome || 'Equipe'} (BidPro Brasil) <${remet.endereco}>`,
          to: para, replyTo: remet.endereco.replace('@', `+${token}@`),
          subject: assunto, html, text: textoFinal,
          meta: { tipo: 'acompanhamento_caso', userId: admin.id },
          idempotencyKey: `acompanhamento:${chaveAtu}:${chavePar || ''}`,
        });
        if (!env?.ok) throw new Error(env?.error || 'envio sem confirmação');
        // O e-mail JÁ SAIU: falha no registro é só histórico — mas é o registro que liga a resposta
        // ao caso, então grita no log em vez de engolir.
        const ins = await sb('email_caixa', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
          direcao: 'saida', pasta: 'enviados', caixa: remet.endereco, de_email: remet.endereco, de_nome: admin.nome, dono: admin.id,
          para: [para], assunto, texto: textoFinal, html, resend_email_id: env.id || null, lido: true,
          enviado_por: admin.id, resposta_token: token, caso_id: c.id,
        }) });
        if (!ins.ok) console.error(`[acompanhamento] enviado mas NÃO registrado em email_caixa (caso ${c.id}): HTTP ${ins.status} — a resposta do advogado não vai se ligar ao caso`);
        res.enviados++;
        if (atualizacao) res.atualizacoes++;
        if (pedeParcela) res.parcelas++;
      } catch (e) {
        res.falhas++;
        console.error(`[acompanhamento] envio falhou caso ${c.id}:`, e?.message);
        await soltar(); // tenta de novo no próximo dia útil
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
