/**
 * /api/lancamento-veiculos — COMUNICADO da nova funcionalidade de leilão de veículos (23/10, pedido do dono)
 * para quem ABRE os nossos e-mails (abriu algum nos últimos 60 dias). É um comunicado, não uma vitrine: explica
 * o leilão de PÁTIO (o leiloeiro só apresenta veículo que já está no pátio — sem retomada, mais simples e
 * seguro) e leva ao questionário (interesse, tipos, faixa de FIPE). Veículo no e-mail só para quem já declarou
 * interesse, e pela intenção dele, nunca pela distância (_curadoria-veiculos.js).
 *
 * Modos (CRON_SECRET; chamado pelo workflow "cron-manual" ou pelo cron diário):
 *   ?modo=seco    (padrão) só conta o público e quantos ainda faltam — não envia nada.
 *   ?modo=teste   manda UMA cópia a cada admin, com assunto [TESTE] — para o dono aprovar o texto.
 *   ?modo=enviar  envio real, SÓ se app_config.lancamento_veiculos = 'liberado' (o dono aprova antes).
 *
 * Orçamento: o Resend tem 100/dia somando tudo. O envio real para em `POR_CHAMADA` e nunca desce o saldo do
 * dia abaixo de `RESERVA` (transacional + oportunidades) — quem ficou de fora sai na próxima chamada; quem já
 * recebeu nunca recebe de novo (emails_log). tipo 'lancamento_veiculos' casa a regra de CAMPANHA de _email.js
 * (limite semanal por cliente, supressão de bounce).
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail, orcamentoRestanteHoje } from './_email.js';
import { emailsDoLote } from './_produto-email.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { linkRastreado } from './_link-email.js';
import { utmEmail } from './_utm.js';
import { escapeHtml } from './_sanitize.js';
import { cabecalhoEmailHTML } from './_email-header.js';
import { perfilVeiculo, selecionarVeiculos, consultaPoolVeiculos } from './_curadoria-veiculos.js';
import { motivoCurto } from './_curadoria.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const PROX = String(BASE).replace(/:\/\/(www\.)?bidprobrasil\.com\.br/, '://www.bidprobrasil.com.br');
const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const TIPO = 'lancamento_veiculos';
const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
const POR_CHAMADA = 35;
const RESERVA = 40;
const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Leitura que DIZ que falhou (null), para o público nunca sair "vazio" por um 400.
async function ler(path) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: hdr, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { console.error('[lancamento-veiculos] GET', r.status, path.slice(0, 160), (await r.text().catch(() => '')).slice(0, 200)); return null; }
    return await r.json();
  } catch (e) { console.error('[lancamento-veiculos] GET erro', path.slice(0, 160), e?.message); return null; }
}

// O PostgREST corta cada resposta no max-rows (~1000) sem erro: `limit=20000` não passava disso. Lista que
// decide público/dedup/opt-out vem paginada até a última página — cortada, o "já foi" voltava a mandar.
async function lerTudo(path, pagina = 1000) {
  const out = [];
  for (let off = 0; off < 50000; off += pagina) {
    const fatia = await ler(`${path}&order=user_id.asc&limit=${pagina}&offset=${off}`);
    if (!fatia) return null;
    out.push(...fatia);
    if (fatia.length < pagina) return out;
  }
  return out;
}

const fmtBRL = (v) => (v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—');
const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');

async function publico() {
  const desde = new Date(Date.now() - 60 * 864e5).toISOString();
  const [abriram, jaFoi, optout] = await Promise.all([
    lerTudo(`emails_log?aberto_em=gte.${desde}&user_id=not.is.null&select=user_id`),
    // 24/10: o webhook do Resend troca 'enviado' por entregue/bounce/aberto — com in.(enviado,enfileirado)
    // os 33 de 23/10 voltavam para a fila. Já foi = toda linha, menos a que comprovadamente não saiu.
    lerTudo(`emails_log?tipo=eq.${TIPO}&status=not.in.(limitado,suprimido,falha)&user_id=not.is.null&select=user_id`),
    lerTudo('alertas_email?ativo=eq.false&select=user_id'),
  ]);
  if (!abriram || !jaFoi || !optout) return null;
  const fora = new Set([...jaFoi, ...optout].map(r => r.user_id));
  const ids = [...new Set(abriram.map(r => r.user_id))];
  const perfis = [];
  for (let i = 0; i < ids.length; i += 150) {
    const fatia = await ler(`perfis?id=in.(${ids.slice(i, i + 150).join(',')})&ativo=eq.true&role=in.(${ROLES_CLIENTE.join(',')})&select=id,nome,interesse_veiculos,veiculo_tipos,veiculo_faixa_fipe`);
    if (!fatia) return null;
    perfis.push(...fatia);
  }
  return { total: perfis.length, faltam: perfis.filter(p => !fora.has(p.id) && p.interesse_veiculos !== 'nao') };
}

const poolCache = new Map();
async function veiculosPara(p) {
  const pv = perfilVeiculo(p, [], { limite: 4 });
  if (!pv.quantidade) return [];   // não declarou: o comunicado convida, não adivinha
  const { chave, qs } = consultaPoolVeiculos(pv);
  if (!poolCache.has(chave)) poolCache.set(chave, ((await ler(qs)) || []).map(v => ({ ...v, fotos: v.capa ? [v.capa] : [] })));
  return selecionarVeiculos(poolCache.get(chave), pv);
}

function html(p, sel, tipoLog) {
  const nome = p.nome ? escapeHtml(String(p.nome).split(' ')[0]) : '';
  const cards = sel.map(({ v, motivos }) => {
    const url = linkRastreado(p.id, tipoLog, `/#/veiculo/${v.id}?${utmEmail(TIPO, 'card')}`);
    const titulo = [v.marca, v.modelo, v.ano_modelo || v.ano_fabricacao].filter(Boolean).join(' ') || 'Veículo em leilão';
    const desc = Number(v.desconto_fipe_percentual) || 0;
    const mot = motivoCurto(motivos);
    return `<td style="width:50%;padding:6px;vertical-align:top;">
      <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fff;">
        <a href="${url}"><img src="${PROX}/api/img-proxy?veiculo=${v.id}&i=0" alt="" style="width:100%;height:110px;object-fit:cover;display:block;"></a>
        <div style="padding:10px 12px;">
          <a href="${url}" style="text-decoration:none;color:#0f172a;font-size:13px;font-weight:700;">${escapeHtml(titulo)}</a>
          <div style="font-size:11px;color:#64748b;margin:3px 0 6px;">📍 ${escapeHtml(v.cidade || '')}${v.estado ? '/' + escapeHtml(v.estado) : ''}${fmtData(v.data_leilao) ? ` · ${fmtData(v.data_leilao)}` : ''}</div>
          <div style="font-size:15px;font-weight:800;color:#0f172a;">${fmtBRL(v.valor_minimo)}</div>
          ${desc > 0 ? `<div style="font-size:11px;color:#059669;font-weight:700;">${Math.round(desc)}% abaixo da FIPE${v.valor_fipe ? ` (${fmtBRL(v.valor_fipe)})` : ''}</div>` : ''}
          ${mot ? `<div style="font-size:11px;color:#0f766e;margin-top:4px;">💡 ${escapeHtml(mot)}</div>` : ''}
        </div>
      </div></td>`;
  });
  const linhas = [];
  for (let i = 0; i < cards.length; i += 2) linhas.push(`<tr>${cards[i]}${cards[i + 1] || '<td style="width:50%;"></td>'}</tr>`);
  const urlBusca = linkRastreado(p.id, tipoLog, `/#/veiculos?${utmEmail(TIPO, 'botao')}`);
  const urlPerfil = linkRastreado(p.id, tipoLog, `/#/perfil?responder=1&${utmEmail(TIPO, 'perfil')}`);
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <a href="${BASE}/#/veiculos" style="text-decoration:none;">${cabecalhoEmailHTML()}</a>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="display:inline-block;background:#ccfbf1;color:#0f766e;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:4px 10px;border-radius:6px;margin-bottom:12px;">Novidade na plataforma</div>
    <h2 style="margin:0 0 10px;font-size:20px;color:#0f172a;">Olá${nome ? ', ' + nome : ''}! Agora a BidPro também tem leilão de veículos 🚗</h2>
    <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.65;">É um leilão <strong>seguro</strong>: o leiloeiro só apresenta veículos que <strong>já estão no pátio dele</strong>. Você não precisa fazer a retomada nem ir atrás do veículo — arrematou, pagou, retira ou contrata o frete. Uma operação <strong>muito mais simples e segura</strong> do que tomar posse de um bem.</p>
    <ul style="margin:0 0 18px;padding-left:18px;color:#334155;font-size:13.5px;line-height:1.8;">
      <li><strong>De qualquer lugar do Brasil</strong> — a distância não pesa, você paga só o frete</li>
      <li><strong>FIPE ao lado do lance mínimo</strong>, para ver na hora o desconto</li>
      <li>Carros, motos, caminhões, vans e utilitários</li>
      <li><strong>Relatório por IA</strong> do lote: condição, sinistro, FIPE e teto de lance</li>
    </ul>
    <div style="padding:16px 18px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;font-size:13.5px;color:#115e59;line-height:1.55;margin-bottom:16px;">
      <strong>Quer receber veículos no seu e-mail de oportunidades?</strong> Responda o seu perfil de investidor — se você já respondeu, faltam só 3 perguntas de veículos: se tem interesse, que tipo e a faixa de FIPE. Leva menos de 1 minuto.
      <div style="margin-top:12px;text-align:center;"><a href="${urlPerfil}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:800;font-size:14px;">Responder perfil de investidor →</a></div>
    </div>
    ${linhas.length ? `<div style="font-size:13px;font-weight:800;color:#0f172a;margin:4px 0 6px;">Pelo seu perfil, alguns no pátio agora</div>
    <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:0 -6px 8px;">${linhas.join('')}</table>` : ''}
    <div style="text-align:center;margin:10px 0 4px;"><a href="${urlBusca}" style="color:#0f766e;font-weight:700;font-size:13.5px;text-decoration:none;">Ver os veículos em leilão →</a></div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:20px;">BidPro Brasil · <a href="{{UNSUB}}" style="color:#94a3b8;">Não quero receber e-mails de oportunidades</a></p>
  </div>
</div></body></html>`;
}

async function registrarEnviados(userId, sel) {
  if (!sel.length) return;
  try {
    const r = await fetch(`${SB}/rest/v1/veiculos_email_sinal?on_conflict=user_id,veiculo_id,sinal`, {
      method: 'POST',
      headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(sel.map(({ v }) => ({ user_id: userId, veiculo_id: v.id, sinal: 'enviado', contexto: TIPO }))),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error('[lancamento-veiculos] sinal enviado', r.status);
  } catch (e) { console.error('[lancamento-veiculos] sinal enviado erro', e?.message); }
}

const resp = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SB || !KEY) return resp({ error: 'Supabase ausente' }, 500);
  const modo = new URL(req.url, 'http://x').searchParams.get('modo') || 'seco';

  if (modo === 'teste') {
    const admins = await ler('perfis?role=eq.admin&ativo=eq.true&select=id,nome,interesse_veiculos,veiculo_tipos,veiculo_faixa_fipe');
    if (!admins) return resp({ ok: false, motivo: 'leitura de admins falhou' }, 503);
    const emails = await emailsDoLote(admins.map(a => a.id));
    const out = [];
    for (const a of admins) {
      const email = emails.get(a.id);
      if (!email) { out.push({ id: a.id, enviado: false, motivo: 'sem e-mail' }); continue; }
      const sel = await veiculosPara(a);
      const r = await enviarEmail({ from: FROM, to: email, subject: '[TESTE] 🚗 Novidade na BidPro: leilão de veículos no pátio, simples e seguro',
        html: html(a, sel, `${TIPO}_teste`).replace('{{UNSUB}}', `${BASE}/api/cancelar-alertas?token=${assinarUnsub(a.id)}`),
        meta: { tipo: `${TIPO}_teste`, userId: a.id } });
      out.push({ id: a.id, enviado: !!r?.ok, veiculos: sel.length, erro: r?.ok ? undefined : r?.error });
    }
    return resp({ ok: true, modo, out });
  }

  const pub = await publico();
  if (!pub) return resp({ ok: false, motivo: 'leitura do público falhou — nada enviado' }, 503);
  if (modo !== 'enviar') return resp({ ok: true, modo: 'seco', publico_total: pub.total, faltam: pub.faltam.length });

  const flag = await ler('app_config?key=eq.lancamento_veiculos&select=value');
  if (!flag) return resp({ ok: false, motivo: 'não consegui ler a liberação — nada enviado' }, 503);
  if (flag[0]?.value !== 'liberado') return resp({ ok: true, modo, enviados: 0, motivo: 'aguardando liberação do dono (app_config.lancamento_veiculos)', faltam: pub.faltam.length });

  let restante = await orcamentoRestanteHoje();
  // Candidatos além das vagas: quem é barrado (limite semanal, sem e-mail) não pode ocupar a vaga do dia
  // inteiro e travar a fila para sempre — percorre até completar POR_CHAMADA saídas.
  const candidatos = pub.faltam.slice(0, POR_CHAMADA * 3);
  const emails = await emailsDoLote(candidatos.map(p => p.id));
  let enviados = 0, enfileirados = 0, limitados = 0, falhas = 0, semEmail = 0;
  for (const p of candidatos) {
    if (enviados + enfileirados >= POR_CHAMADA) break;
    if (restante <= RESERVA) break;   // o resto do dia é do transacional e das oportunidades
    const email = emails.get(p.id);
    if (!email) { semEmail++; continue; }
    const sel = await veiculosPara(p);
    const r = await enviarEmail({ from: FROM, to: email, subject: '🚗 Novidade na BidPro: leilão de veículos no pátio, simples e seguro',
      html: html(p, sel, TIPO).replace('{{UNSUB}}', `${BASE}/api/cancelar-alertas?token=${assinarUnsub(p.id)}`),
      meta: { tipo: TIPO, userId: p.id } });
    if (r?.ok) { enviados++; restante--; await registrarEnviados(p.id, sel); }
    else if (r?.enfileirado) enfileirados++;
    else if (r?.limitado) limitados++;
    else { falhas++; console.error('[lancamento-veiculos] falha', p.id, r?.error); }
  }
  return resp({ ok: true, modo, enviados, enfileirados, limitados, falhas, sem_email: semEmail,
    faltam: pub.faltam.length - enviados - enfileirados, orcamento_restante: restante });
}
