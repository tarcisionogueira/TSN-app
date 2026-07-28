/**
 * POST /api/agendar-reuniao
 * Cliente reserva um slot disponível → cria reuniao + sala Daily.co + envia email.
 *
 * Body: { slot_id, caso_id, reuniao_numero (1|2) }
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { criarEventoAgenda } from './_gcal.js';
import { registrarUso } from './_uso.js';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const DAILY_API     = 'https://api.daily.co/v1';
const DAILY_DOMAIN  = 'tsn-reunioes';
const RESEND_KEY    = process.env.RESEND_API_KEY;
const APP_URL       = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function fmtDataHora(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 }); }

  const { slot_id, caso_id, reuniao_numero } = body;
  if (!slot_id || !caso_id || !reuniao_numero) {
    return new Response(JSON.stringify({ error: 'slot_id, caso_id e reuniao_numero são obrigatórios' }), { status: 400 });
  }
  // slot_id/caso_id vão crus em filtros PostgREST → exige UUID (defesa contra injeção de parâmetros).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(String(slot_id)) || !UUID_RE.test(String(caso_id))) {
    return new Response(JSON.stringify({ error: 'slot_id ou caso_id inválido' }), { status: 400 });
  }

  // 1. Valida que o caso pertence ao cliente
  const casoRes = await sb(`casos?id=eq.${caso_id}&select=id,cliente_id,analista_id,imovel_endereco,imovel_id`);
  const [caso] = await casoRes.json();
  if (!caso || caso.cliente_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Caso não encontrado ou sem permissão' }), { status: 403 });
  }

  // 1.5. GATE: a reunião com o analista só é liberada com os TRÊS relatórios concluídos
  // (Mercadológico + Documental + Laudo de Viabilidade). O gate do front (Analise.jsx) é
  // burlável por POST direto, então revalidamos no servidor. Aplica só à 1ª reunião — a 2ª é a
  // aprovação pós-análise, já dentro do fluxo assistido. Paridade com o front: documental/laudo
  // só contam quando NÃO estão pendentes (precisaDocumentos/precisaRelatorios != true).
  if (Number(reuniao_numero) === 1 && caso.imovel_id) {
    const enc = encodeURIComponent(caso.imovel_id);
    const uid = encodeURIComponent(user.id);
    try {
      const [mR, dR, lR] = await Promise.all([
        sb(`analises_mercado?user_id=eq.${uid}&imovel_id=eq.${enc}&status=eq.concluida&select=imovel_id&limit=1`),
        sb(`analises_documental?user_id=eq.${uid}&imovel_id=eq.${enc}&status=eq.concluida&select=result&limit=1`),
        sb(`analises_laudo?user_id=eq.${uid}&imovel_id=eq.${enc}&status=eq.concluida&select=result&limit=1`),
      ]);
      const [m, d2, l] = await Promise.all([mR.json(), dR.json(), lR.json()]);
      const mercadoOk = Array.isArray(m) && m.length > 0;
      const docOk = Array.isArray(d2) && d2.length > 0 && d2[0]?.result?.precisaDocumentos !== true;
      const laudoOk = Array.isArray(l) && l.length > 0 && l[0]?.result?.precisaRelatorios !== true;
      if (!(mercadoOk && docOk && laudoOk)) {
        return new Response(JSON.stringify({ error: 'É necessário gerar os três relatórios (Mercadológico, Documental e Laudo de Viabilidade) antes de agendar a reunião com o analista.' }), { status: 403 });
      }
    } catch {
      return new Response(JSON.stringify({ error: 'Não foi possível validar seus relatórios agora. Tente novamente em instantes.' }), { status: 503 });
    }
  }

  // 2. Busca e reserva o slot atomicamente (usa update com condição disponivel=true)
  const slotRes = await sb(
    `slots_reuniao?id=eq.${slot_id}&disponivel=eq.true`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        disponivel: false,
        reservado_por: user.id,
        caso_id,
        reuniao_numero,
      }),
    }
  );

  if (!slotRes.ok || slotRes.status === 404) {
    return new Response(JSON.stringify({ error: 'Slot indisponível ou já reservado' }), { status: 409 });
  }
  const [slot] = await slotRes.json();
  if (!slot) return new Response(JSON.stringify({ error: 'Slot não encontrado ou já reservado' }), { status: 409 });

  // Sorteio/fixação do analista: definido na 1ª reunião e mantido no caso.
  // Usa o analista do slot; se ausente, sorteia entre os analistas ativos.
  if (!caso.analista_id) {
    let analistaId = slot.analista_id;
    if (!analistaId) {
      const ans = await (await sb('perfis?role=eq.analista&ativo=eq.true&select=id')).json();
      if (Array.isArray(ans) && ans.length) analistaId = ans[Math.floor(Math.random() * ans.length)].id;
    }
    // Fallback: sem NENHUM analista ativo, o ADMIN assume a função (mantém o fluxo
    // funcionando na largada). Quando um analista for habilitado, os novos casos
    // passam a sorteá-lo automaticamente (admin só entra como último recurso).
    if (!analistaId) {
      const adm = await (await sb('perfis?role=eq.admin&ativo=not.is.false&select=id&limit=1')).json();
      if (Array.isArray(adm) && adm.length) analistaId = adm[0].id;
    }
    if (analistaId) {
      await sb(`casos?id=eq.${caso_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ analista_id: analistaId }) });
      caso.analista_id = analistaId;
    }
  }

  // 3. Cria sala Daily.co
  const DAILY_KEY = process.env.DAILY_API_KEY;
  let meetLink = null;
  let roomName = null;

  if (DAILY_KEY) {
    const inicioTs   = Math.floor(new Date(slot.data_hora).getTime() / 1000);
    const expiracaoTs = inicioTs + (30 + 90) * 60;
    roomName = `tsn-${caso_id.slice(0, 8)}-r${reuniao_numero}-${Date.now()}`;

    const dailyRes = await fetch(`${DAILY_API}/rooms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${DAILY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: roomName,
        privacy: 'private',
        properties: {
          exp: expiracaoTs,
          transcription_enabled_default: true,
          max_participants: 2,
          lang: 'pt',
          redirect_on_meeting_exit: APP_URL,
          enable_prejoin_ui: true,
          prejoin_ui_title: 'BidPro Brasil — Reunião de Assessoria',
          prejoin_ui_description: '⚠️ Esta reunião é automaticamente transcrita para fins de qualidade e auditoria interna (Lei 9.296/1996, Art. 10 e LGPD Art. 7º, I).',
        },
      }),
    });

    if (dailyRes.ok) {
      meetLink = `https://${DAILY_DOMAIN}.daily.co/${roomName}`;
      registrarUso('daily', 'sala', { unidades: 1 });
    }
  }

  // 4. Registra na tabela reunioes
  const reuniaoRes = await sb('reunioes', {
    method: 'POST',
    body: JSON.stringify({
      caso_id,
      numero: reuniao_numero,
      analista_id: caso.analista_id || slot.analista_id,
      cliente_id: user.id,
      data_hora: slot.data_hora,
      status: 'agendada',
      link_videochamada: meetLink,
      agendado_em: new Date().toISOString(),
    }),
  });
  const [reuniao] = await reuniaoRes.json();

  // 5. Busca dados do cliente e analista para email
  const [clienteRes, analistaRes] = await Promise.all([
    sb(`perfis?id=eq.${user.id}&select=nome,email`),
    caso.analista_id ? sb(`perfis?id=eq.${caso.analista_id}&select=nome,email`) : Promise.resolve({ json: async () => [] }),
  ]);
  const [cliente] = await clienteRes.json();
  const [analista] = await analistaRes.json();

  const dataFormatada = fmtDataHora(slot.data_hora);
  const tituloReu = reuniao_numero === 1 ? '1ª Reunião de Análise' : '2ª Reunião — Aprovação';

  // 5.5. Cria evento REAL no Google Calendar (convite + lembretes nativos).
  // Best-effort: se a Google falhar ou não estiver configurada, o agendamento segue.
  let gcalLink = null;
  try {
    const descricaoEvento = [
      'Reunião de assessoria imobiliária — BidPro Brasil.',
      caso.imovel_endereco ? `Imóvel: ${caso.imovel_endereco}` : '',
      meetLink ? `Videochamada: ${meetLink}` : '',
      `Caso: ${APP_URL}/#/caso/${caso_id}`,
      '⚠️ A reunião é transcrita (sem gravação de vídeo) para registro e melhoria da análise (LGPD Art. 7º, I).',
    ].filter(Boolean).join('\n');

    const ev = await criarEventoAgenda({
      titulo: `🏠 BidPro Brasil — ${tituloReu}`,
      descricao: descricaoEvento,
      local: meetLink || caso.imovel_endereco || undefined,
      inicioISO: slot.data_hora,
      duracaoMin: slot.duracao_min || 30,
      convidados: [
        cliente?.email ? { email: cliente.email, nome: cliente.nome } : null,
        analista?.email ? { email: analista.email, nome: analista.nome } : null,
      ].filter(Boolean),
    });
    if (ev) {
      gcalLink = ev.htmlLink;
      await sb(`reunioes?id=eq.${reuniao?.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ gcal_event_id: ev.eventId, gcal_html_link: ev.htmlLink }),
      });
    }
  } catch (e) {
    console.error('[agendar-reuniao] Google Calendar falhou:', e?.message || e);
  }

  // 6. Envia email ao cliente
  if (RESEND_KEY && cliente?.email) {
    const calLink = (() => {
      const d = new Date(slot.data_hora);
      const fmt = (dt) => dt.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
      const fim = new Date(d.getTime() + 30 * 60000);
      const p = new URLSearchParams({
        action: 'TEMPLATE',
        text: `BidPro Brasil — ${tituloReu}`,
        dates: `${fmt(d)}/${fmt(fim)}`,
        details: `Reunião de assessoria imobiliária.\n\n${meetLink ? `Link: ${meetLink}` : ''}\nImóvel: ${caso.imovel_endereco || ''}`,
      });
      return `https://calendar.google.com/calendar/render?${p.toString()}`;
    })();

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BidPro Brasil <noreply@bidprobrasil.com.br>',
        to: [cliente.email],
        subject: `✅ ${tituloReu} agendada — ${dataFormatada}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#0D63DB">Reunião confirmada!</h2>
            <p>Olá, <strong>${cliente.nome || 'cliente'}</strong>.</p>
            <p>Sua <strong>${tituloReu}</strong> foi agendada com sucesso:</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:16px 0">
              <div><b>Data e hora:</b> ${dataFormatada}</div>
              <div><b>Duração:</b> 30 minutos</div>
              ${analista ? `<div><b>Analista:</b> ${analista.nome}</div>` : ''}
              <div><b>Imóvel:</b> ${caso.imovel_endereco || '-'}</div>
            </div>
            ${meetLink ? `<a href="${meetLink}" style="display:inline-block;padding:12px 24px;background:#0D63DB;color:white;border-radius:8px;text-decoration:none;font-weight:700">Acessar videochamada</a>` : ''}
            <p style="margin-top:20px"><a href="${gcalLink || calLink}" style="color:#0D63DB">📅 ${gcalLink ? 'Ver na sua Google Agenda' : 'Adicionar ao Google Agenda'}</a></p>
            <p style="font-size:12px;color:#94a3b8;margin-top:24px">⚠️ Esta reunião é transcrita (sem gravação de vídeo) para registro e melhoria da análise.</p>
          </div>
        `,
      }),
    });
  }

  // 7. Notifica analista por email
  if (RESEND_KEY && analista?.email) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BidPro Brasil <noreply@bidprobrasil.com.br>',
        to: [analista.email],
        subject: `📅 Nova ${tituloReu} agendada — ${dataFormatada}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#0D63DB">Nova reunião agendada</h2>
            <p><strong>${tituloReu}</strong> marcada pelo cliente:</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:16px 0">
              <div><b>Cliente:</b> ${cliente?.nome || user.id}</div>
              <div><b>Data e hora:</b> ${dataFormatada}</div>
              <div><b>Imóvel:</b> ${caso.imovel_endereco || '-'}</div>
            </div>
            ${meetLink ? `<a href="${meetLink}" style="display:inline-block;padding:12px 24px;background:#0D63DB;color:white;border-radius:8px;text-decoration:none;font-weight:700">Acessar videochamada</a>` : ''}
          </div>
        `,
      }),
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    reuniao_id: reuniao?.id,
    data_hora: slot.data_hora,
    meet_link: meetLink,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
