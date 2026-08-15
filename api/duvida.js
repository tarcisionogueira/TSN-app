/**
 * POST /api/duvida  (público, sem login)
 * Dúvida de quem ainda não tem conta. Captura nome/email/telefone:
 *  1. Registra/atualiza o LEAD em sdr_leads (sem duplicar por email/whatsapp).
 *  2. Abre um CHAMADO (chamados + chamados_mensagens) para o consultor ver na
 *     tela de Atendimento e responder — a resposta de encerramento vai ao
 *     e-mail do cliente pelo fluxo do Atendimento.
 */
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { getAuthUser } from './_auth.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
}
function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors() } });
}
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors() });

  // Rate limit por IP: endpoint público que grava com service key (bypassa RLS) —
  // limita flood de leads/chamados. 5/min por IP (fail-open se o Redis cair).
  const rl = await checkRateLimit(`duvida:${getIP(req)}`, 5, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // CLIENTE LOGADO: o e-mail e o nome vêm do TOKEN, nunca do corpo (14/08).
  //
  // A tela de Alavancagem deixou de pedir dados que já temos e virou confirmação — o front
  // manda o `Authorization` e nada mais de identidade. Se aceitássemos o e-mail do corpo,
  // qualquer um poderia abrir chamado em nome de outra pessoa e, pior, vincular `user_id`
  // alheio. Aqui a identidade é a do token; o corpo só é usado para VISITANTE.
  const usuario = await getAuthUser(req);

  const nome = String((usuario ? (usuario.user_metadata?.nome || body.nome) : body.nome) || '').trim().slice(0, 120);
  const email = String((usuario?.email || body.email) || '').trim().toLowerCase().slice(0, 160);
  const telefone = onlyDigits(body.telefone).slice(0, 15);
  const mensagem = String(body.mensagem || '').trim().slice(0, 2000);
  const origem = String(body.origem || 'duvida_planos').slice(0, 40);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Informe um e-mail válido para receber a resposta.' }, 400);
  if (mensagem.length < 5) return json({ error: 'Escreva sua dúvida.' }, 400);

  // 1. LEAD — não duplica (busca por email ou whatsapp)
  try {
    const filtros = [`email.eq.${encodeURIComponent(email)}`];
    if (telefone) filtros.push(`whatsapp.eq.${encodeURIComponent(telefone)}`);
    const existentes = await (await sb(`sdr_leads?or=(${filtros.join(',')})&select=id,nome,whatsapp&limit=1`)).json();
    if (Array.isArray(existentes) && existentes.length) {
      // Atualiza dados que estavam vazios, sem criar novo lead
      const lead = existentes[0];
      const patch = {};
      if (!lead.nome && nome) patch.nome = nome;
      if (!lead.whatsapp && telefone) patch.whatsapp = telefone;
      if (Object.keys(patch).length) {
        await sb(`sdr_leads?id=eq.${lead.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      }
    } else {
      // whatsapp era NOT NULL: dúvida sem telefone (campo opcional na Landing) violava a
      // constraint e o lead sumia no catch. Coluna agora aceita nulo — e o erro, se houver,
      // aparece no log em vez de virar silêncio.
      const leadRes = await sb('sdr_leads', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ nome, email, whatsapp: telefone || null, origem, status: 'novo' }) });
      if (!leadRes.ok) {
        const det = await leadRes.text().catch(() => '');
        console.error('[duvida] lead NÃO gravado', leadRes.status, det.slice(0, 300));
      }
    }
  } catch (e) { console.error('[duvida] lead NÃO gravado (exceção)', String(e?.message || e)); }

  // 2. CHAMADO + 1ª mensagem (consultor responde pelo Atendimento)
  try {
    const titulo = (mensagem.length > 70 ? mensagem.slice(0, 67) + '…' : mensagem) || 'Dúvida sobre planos';
    const chamadoRes = await sb('chamados', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      // `user_id` só quando há TOKEN válido: aí o chamado aparece em "Meus chamados" da
      // pessoa e o Cliente 360 o liga ao cliente certo. Visitante segue com `null`.
      body: JSON.stringify({ user_id: usuario?.id || null, user_email: email, user_nome: nome || email, titulo, status: 'aberto', segmento: 'curioso' }),
    });
    // O corpo de erro do PostgREST é um OBJETO, não um array: `const [x] = await res.json()`
    // sobre ele lança "not iterable", cai no catch e devolve 500 genérico ao visitante —
    // sem nenhuma pista do motivo no log. Foi assim que a `user_id NOT NULL` (corrigida em
    // 12/08) ficou invisível: a dúvida do visitante nunca virava chamado e ninguém sabia.
    if (!chamadoRes.ok) {
      const det = await chamadoRes.text().catch(() => '');
      console.error('[duvida] chamado NÃO criado', chamadoRes.status, det.slice(0, 300));
      return json({ error: 'Não foi possível registrar sua dúvida agora. Tente novamente.' }, 500);
    }
    const [chamado] = await chamadoRes.json();
    if (chamado?.id) {
      await sb('chamados_mensagens', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          chamado_id: chamado.id,
          autor_tipo: 'cliente',
          autor_nome: nome || email,
          remetente_role: 'cliente',
          conteudo: `${mensagem}${telefone ? `\n\n(Telefone: ${telefone})` : ''}`,
        }),
      });
    }
  } catch (e) {
    return json({ error: 'Não foi possível registrar sua dúvida agora. Tente novamente.' }, 500);
  }

  // 3. AVISO À EQUIPE (só nas origens que PROMETEM contato ativo).
  //
  // Por que existe: o chamado é o REGISTRO, não o aviso. Ninguém é notificado quando um
  // entra — medido em 14/08: 22 chamados abertos, 11 criados nos últimos 7 dias. Numa dúvida
  // sobre planos isso é tolerável (a pessoa está navegando e volta). Na tela de Alavancagem
  // não é: ali a plataforma promete, com essas palavras, que "alguém da equipe entra em
  // contato" — e promessa sem aviso é fila.
  //
  // 15/08 — DEIXOU DE SER RESTRITO À ALAVANCAGEM, por decisão do dono: "os pedidos de
  // reunião, assim como os chamados, devem cair para mim". A restrição anterior partia da
  // ideia de que o fluxo de planos não promete contato ativo; a decisão agora é que TODO
  // chamado tem dono e aviso. O que sustentava a exceção deixou de valer: não há analista
  // nem consultor ativo no sistema, então a alternativa ao aviso não é "a equipe vê no
  // painel" — é ninguém ver. Eram 22 chamados abertos, 11 criados numa semana.
  //
  // O e-mail é desenhado para o contato acontecer em UM clique: `reply_to` é o interessado
  // (responder já fala com ele) e o corpo traz o link direto do WhatsApp quando há telefone.
  // Best-effort: falha de e-mail NUNCA derruba o registro, que já está gravado acima.
  {
    try {
      const { enviarEmail } = await import('./_email.js');
      const equipe = process.env.ADMIN_EMAIL || process.env.APP_ADMIN_EMAIL;
      if (equipe) {
        const ehAlavancagem = origem.startsWith('alavancagem');
        const modalidade = origem.includes('home_equity') ? 'Home Equity'
          : origem.includes('consorcio') ? 'Consórcio'
          : ehAlavancagem ? 'Alavancagem'
          : `contato (${origem})`;
        const base = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
        const wa = telefone ? `https://wa.me/55${telefone}` : null;
        await enviarEmail({
          to: equipe,
          replyTo: email,
          subject: `${ehAlavancagem ? 'Interesse em' : 'Novo chamado —'} ${modalidade}: ${nome || email}`,
          meta: { tipo: ehAlavancagem ? 'lead_alavancagem' : 'chamado_novo' },
          html: `
            <div style="font-family:Arial,sans-serif;font-size:14px;color:#111;line-height:1.6">
              <p><strong>${nome || '(sem nome)'}</strong> pediu contato sobre <strong>${modalidade}</strong>.</p>
              <p>E-mail: <a href="mailto:${email}">${email}</a><br>
                 ${telefone ? `WhatsApp: <a href="${wa}">${telefone}</a>` : 'WhatsApp: não informado'}</p>
              <p style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px">${mensagem}</p>
              <p>${wa ? `<a href="${wa}" style="background:#059669;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Chamar no WhatsApp</a>&nbsp;` : ''}<a href="${base}/#/atendimento" style="background:#0D63DB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Abrir no Atendimento</a></p>
              <p style="color:#64748b;font-size:12px">Responder este e-mail fala direto com a pessoa. O chamado já está registrado no Atendimento.</p>
            </div>`,
        });
      } else {
        console.error('[duvida] chamado SEM aviso: ADMIN_EMAIL não definido', JSON.stringify({ origem }));
      }
    } catch (e) {
      console.error('[duvida] aviso de chamado falhou', JSON.stringify({ origem, erro: String(e?.message || e) }));
    }
  }

  return json({ ok: true });
}
