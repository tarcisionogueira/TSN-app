/**
 * /api/whatsapp-disparos-cron — FILA DE MENSAGENS ATIVAS do WhatsApp (cron a cada minuto).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Pedido do dono (22/11): "mensagens de início de conversa variadas, intervalo de 2 min entre
 * mensagens ativas e um fluxo de ativação". A partir da resposta da pessoa, quem conduz é a IA
 * (whatsapp-responder) — este cron só ABRE conversas.
 *
 * REGRAS (cada uma existe para não queimar o número — conexão não oficial é banida por volume e
 * por denúncia, não por existir):
 *  - no máximo 1 envio a cada WA_DISPARO_INTERVALO_S (padrão 120 s), contado do ÚLTIMO envio
 *    gravado no banco — não do relógio do cron, que pode rodar duas vezes;
 *  - só em horário comercial (seg–sáb, 9h–19h de Brasília);
 *  - teto diário WA_DISPARO_TETO_DIA (padrão 150);
 *  - texto sorteado entre as aberturas ATIVAS (wa_aberturas) da etapa, com o primeiro nome;
 *  - pula quem pediu SAIR e quem já está conversando (escreveu nos últimos 7 dias);
 *  - etapa 2 (lembrete) só para quem não respondeu a abertura em 3 dias (wa_disparos_lembretes,
 *    1x por hora); depois disso, para.
 *  - SÓ pela Evolution: na Cloud API oficial, mensagem ativa exige template aprovado pela Meta.
 *
 * Também vigia a CONEXÃO da Evolution (o chip do número atual está inativo): caiu → e-mail ao dono,
 * uma vez por queda (wa_canal_estado.alertado_em).
 *
 * LIGA/DESLIGA: WA_DISPAROS_ATIVO=1 (padrão: dormente — só conta a fila e vigia a conexão).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { enviarTextoWhatsapp, canalWhatsapp, faltaParaEnviar, estadoConexaoEvolution } from './_whatsapp-envio.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Hora/dia em Brasília sem depender do fuso do servidor. */
export function relogioBrasilia(agora = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23', weekday: 'short', minute: 'numeric' })
    .formatToParts(agora).map((x) => [x.type, x.value]));
  return { hora: Number(p.hour), minuto: Number(p.minute), diaSemana: p.weekday };
}
export function emHorarioComercial(agora = new Date()) {
  const { hora, diaSemana } = relogioBrasilia(agora);
  return diaSemana !== 'Sun' && hora >= 9 && hora < 19;
}

/** Primeiro nome "bonito" (MARIA DA SILVA → Maria). Vazio se não parecer nome. */
export function primeiroNome(nome) {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  if (!/^[\p{L}'-]{2,20}$/u.test(p)) return '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}
/** "{nome}" → " Maria" (com espaço) ou some — "Oi{nome}!" vira "Oi Maria!" ou "Oi!". */
export function montarAbertura(modelo, nome) {
  const n = primeiroNome(nome);
  return String(modelo || '').replace(/\{nome\}/g, n ? ` ${n}` : '').replace(/\s+([,!?.])/g, '$1').trim();
}

async function vigiarConexao(resumo) {
  if (canalWhatsapp() !== 'evolution' || faltaParaEnviar('evolution').length) return;
  const estado = await estadoConexaoEvolution().catch(() => null);
  if (!estado) { resumo.conexao = 'ilegivel'; return; }
  resumo.conexao = estado;
  const [atual] = (await sb('GET', 'wa_canal_estado?canal=eq.evolution&select=estado,alertado_em')) || [];
  const agora = new Date().toISOString();
  if (estado === 'open') {
    await sb('POST', 'wa_canal_estado?on_conflict=canal', { canal: 'evolution', estado, atualizado_em: agora, alertado_em: null }, 'resolution=merge-duplicates,return=minimal');
    return;
  }
  await sb('POST', 'wa_canal_estado?on_conflict=canal', { canal: 'evolution', estado, atualizado_em: agora }, 'resolution=merge-duplicates,return=minimal');
  if (atual?.alertado_em) return; // já avisou desta queda
  const env = await enviarEmail({
    to: process.env.ADMIN_ALERT_EMAIL || 'tarcisioaraujo@reimob.com.br',
    subject: `WhatsApp DESCONECTADO (${estado}) — leia o QR code de novo`,
    html: `<p>A sessão do WhatsApp na Evolution está <b>${estado}</b>. Enquanto não reconectar, a IA não responde e a fila ativa fica parada.</p>
           <p>Abra o painel da Evolution, entre na instância e leia o QR code com o celular do número. Se o número tiver sido desativado pela operadora, ele não volta — veja a portabilidade.</p>`,
    meta: { tipo: 'whatsapp_desconectado' },
  }).catch((e) => ({ ok: false, error: e?.message }));
  if (env?.ok) await sb('PATCH', 'wa_canal_estado?canal=eq.evolution', { alertado_em: agora }, 'return=minimal');
  else console.error('[wa-disp] aviso de queda NÃO saiu:', env?.error || 'motivo desconhecido');
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SB || !SVC) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  const resumo = {};
  try { await vigiarConexao(resumo); } catch (e) { console.warn('[wa-disp] vigia da conexão falhou:', e?.message || e); }

  try {
    const { minuto } = relogioBrasilia();
    if (minuto === 0) resumo.lembretes = await sb('POST', 'rpc/wa_disparos_lembretes', { p_dias: 3 }).catch((e) => `erro: ${e.message}`);

    if (process.env.WA_DISPAROS_ATIVO !== '1') { res.status(200).json({ ok: true, dormente: true, ...resumo }); return; }
    if (canalWhatsapp() !== 'evolution') { res.status(200).json({ ok: true, pulado: 'canal oficial exige template aprovado para mensagem ativa', ...resumo }); return; }
    const falta = faltaParaEnviar();
    if (falta.length) { res.status(500).json({ ok: false, erro: 'configuração incompleta', faltam: falta, ...resumo }); return; }
    if (resumo.conexao && resumo.conexao !== 'open') { res.status(200).json({ ok: true, pulado: 'whatsapp desconectado', ...resumo }); return; }
    if (!emHorarioComercial()) { res.status(200).json({ ok: true, pulado: 'fora do horário comercial', ...resumo }); return; }

    const intervaloS = Math.max(60, Number(process.env.WA_DISPARO_INTERVALO_S) || 120);
    const tetoDia = Math.max(1, Number(process.env.WA_DISPARO_TETO_DIA) || 150);
    const [ultimo] = (await sb('GET', 'wa_disparos?enviado_em=not.is.null&select=enviado_em&order=enviado_em.desc&limit=1')) || [];
    if (ultimo && Date.now() - Date.parse(ultimo.enviado_em) < intervaloS * 1000) { res.status(200).json({ ok: true, pulado: 'intervalo', ...resumo }); return; }
    // "Enviando" largado há 10+ min (a função morreu no meio): volta para a fila.
    await sb('PATCH', `wa_disparos?status=eq.enviando&agendado_para=lt.${new Date(Date.now() - 10 * 60000).toISOString()}`, { status: 'agendado' }, 'return=minimal').catch(() => {});
    const inicioDia = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const hoje = (await sb('GET', `wa_disparos?enviado_em=gte.${inicioDia}&select=id`)) || [];
    if (hoje.length >= tetoDia) { res.status(200).json({ ok: true, pulado: `teto de ${tetoDia}/24h`, ...resumo }); return; }

    // Próximo da fila — reivindicado com filtro de status (dois crons simultâneos não pegam o mesmo).
    const [prox] = (await sb('GET', `wa_disparos?status=eq.agendado&agendado_para=lte.${new Date().toISOString()}&select=*&order=etapa.desc,agendado_para.asc&limit=1`)) || [];
    if (!prox) { res.status(200).json({ ok: true, fila: 0, ...resumo }); return; }
    const pego = await sb('PATCH', `wa_disparos?id=eq.${prox.id}&status=eq.agendado&select=id`, { status: 'enviando', agendado_para: new Date().toISOString() }, 'return=representation');
    if (!pego?.length) { res.status(200).json({ ok: true, pulado: 'reivindicado por outro', ...resumo }); return; }

    // Reconfere na hora: pediu SAIR ou começou a conversar desde que entrou na fila → cancela.
    const [conv] = (await sb('GET', `wa_conversas?telefone=eq.${encodeURIComponent(prox.telefone)}&select=optout_em,nome,user_id`)) || [];
    const recentes = (await sb('GET', `wa_mensagens?telefone=eq.${encodeURIComponent(prox.telefone)}&autor=eq.pessoa&criado_em=gte.${new Date(Date.now() - 7 * 86400000).toISOString()}&select=id&limit=1`)) || [];
    if (conv?.optout_em || recentes.length) {
      await sb('PATCH', `wa_disparos?id=eq.${prox.id}`, { status: 'cancelado', erro: conv?.optout_em ? 'pediu SAIR' : 'já está conversando' }, 'return=minimal');
      res.status(200).json({ ok: true, cancelado: prox.id, ...resumo }); return;
    }

    const modelos = (await sb('GET', `wa_aberturas?etapa=eq.${prox.etapa}&ativo=eq.true&select=texto`)) || [];
    if (!modelos.length) {
      await sb('PATCH', `wa_disparos?id=eq.${prox.id}`, { status: 'agendado' }, 'return=minimal');
      res.status(500).json({ ok: false, erro: `nenhuma abertura ativa para a etapa ${prox.etapa} em wa_aberturas`, ...resumo }); return;
    }
    const texto = montarAbertura(modelos[Math.floor(Math.random() * modelos.length)].texto, prox.nome || conv?.nome);

    let wamid;
    try { wamid = await enviarTextoWhatsapp(prox.telefone, texto); }
    catch (e) {
      await sb('PATCH', `wa_disparos?id=eq.${prox.id}`, { status: 'erro', erro: String(e?.message || e).slice(0, 200), enviado_em: new Date().toISOString() }, 'return=minimal');
      res.status(200).json({ ok: false, erro_envio: String(e?.message || e).slice(0, 200), ...resumo }); return;
    }
    const agora = new Date().toISOString();
    // Conversa antes da mensagem (FK) — e o gatilho abre o chamado 'saudacao' na tela de Atendimento.
    await sb('POST', 'wa_conversas?on_conflict=telefone', {
      telefone: prox.telefone, ...(prox.nome && !conv?.nome ? { nome: prox.nome } : {}), ...(prox.user_id && !conv?.user_id ? { user_id: prox.user_id } : {}), atualizado_em: agora,
    }, 'resolution=merge-duplicates,return=minimal');
    await sb('POST', 'wa_mensagens?on_conflict=wamid', { wamid, telefone: prox.telefone, direcao: 'enviada', autor: 'ia', tipo: 'ativa', texto, ocorrido_em: agora }, 'resolution=ignore-duplicates,return=minimal');
    await sb('PATCH', `wa_disparos?id=eq.${prox.id}`, { status: 'enviado', enviado_em: agora, wamid, texto }, 'return=minimal');
    res.status(200).json({ ok: true, enviado: prox.id, etapa: prox.etapa, ...resumo });
  } catch (e) {
    console.error('[wa-disp]', e?.message || e);
    res.status(500).json({ ok: false, erro: String(e?.message || e).slice(0, 200), ...resumo });
  }
}
