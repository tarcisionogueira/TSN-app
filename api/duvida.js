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
  let telefone = onlyDigits(body.telefone).slice(0, 15);
  const mensagem = String(body.mensagem || '').trim().slice(0, 2000);
  const origem = String(body.origem || 'duvida_planos').slice(0, 40);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Informe um e-mail válido para receber a resposta.' }, 400);
  if (mensagem.length < 5) return json({ error: 'Escreva sua dúvida.' }, 400);

  // TELEFONE DO LOGADO VEM DO SERVIDOR, NÃO DO CORPO (16/08).
  //
  // A tela de Alavancagem virou CONFIRMAÇÃO: ela lê `perfis.telefone` no navegador e reenvia
  // no corpo. Se essa leitura falhar ou vier vazia, `setPerfil({})` e o botão continua
  // habilitado — o lead é gravado sem telefone e o aviso à equipe sai dizendo "WhatsApp: não
  // informado". O contato em UM clique, que é a razão de existir daquele e-mail, morre em
  // silêncio: nada dá erro, o cliente vê "Interesse registrado" e ninguém consegue ligar.
  // Aconteceu no teste do dono em 16/08, com o telefone dele preenchido no perfil o tempo todo.
  //
  // Com o token na mão, o servidor não precisa acreditar no cliente: busca com a service key,
  // sem depender de RLS nem do estado da tela. O corpo vira só um atalho — se veio, prevalece
  // (é o caminho do VISITANTE, que digita o número na hora e não tem perfil).
  if (!telefone && usuario?.id) {
    try {
      const r = await sb(`perfis?id=eq.${usuario.id}&select=telefone&limit=1`);
      // `.ok` conferido: um 4xx/5xx aqui não é "cliente sem telefone" — é leitura que não
      // aconteceu, e tratar as duas como a mesma coisa é o defeito que este bloco corrige.
      if (r.ok) {
        const [p] = await r.json().catch(() => []);
        telefone = onlyDigits(p?.telefone).slice(0, 15);
      } else {
        console.error('[duvida] telefone do perfil NÃO lido', r.status, (await r.text().catch(() => '')).slice(0, 200));
      }
    } catch (e) { console.error('[duvida] telefone do perfil (exceção)', String(e?.message || e)); }
  }

  // 1. LEAD — não duplica (busca por email ou whatsapp)
  let leadId = null, leadConsultorId = null, leadStatus = null;
  try {
    const filtros = [`email.eq.${encodeURIComponent(email)}`];
    if (telefone) filtros.push(`whatsapp.eq.${encodeURIComponent(telefone)}`);
    const existentes = await (await sb(`sdr_leads?or=(${filtros.join(',')})&select=id,nome,whatsapp,user_id,consultor_id,status&limit=1`)).json();
    if (Array.isArray(existentes) && existentes.length) {
      // Atualiza dados que estavam vazios, sem criar novo lead
      const lead = existentes[0];
      leadId = lead.id; leadConsultorId = lead.consultor_id || null; leadStatus = lead.status || null;
      const patch = {};
      if (!lead.nome && nome) patch.nome = nome;
      if (!lead.whatsapp && telefone) patch.whatsapp = telefone;
      // Preenche o vínculo que faltou nos leads criados antes de 16/08 (e em qualquer um
      // que tenha nascido de visitante e depois virou conta).
      if (!lead.user_id && usuario?.id) patch.user_id = usuario.id;
      if (Object.keys(patch).length) {
        await sb(`sdr_leads?id=eq.${lead.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      }
    } else {
      // whatsapp era NOT NULL: dúvida sem telefone (campo opcional na Landing) violava a
      // constraint e o lead sumia no catch. Coluna agora aceita nulo — e o erro, se houver,
      // aparece no log em vez de virar silêncio.
      // `user_id` vai junto quando há TOKEN — igual ao chamado logo abaixo, que já fazia isso.
      // A assimetria custava caro: o chamado nascia ligado ao cliente e o LEAD nascia órfão,
      // então a mesma pessoa aparecia como cliente numa tela e como estranho na outra, e o
      // Cliente 360 não conseguia cruzar interesse com conta. Nunca vem do corpo — é o token
      // que diz quem é, senão daria para abrir lead no nome de outro.
      // `return=representation`: o id do lead novo alimenta a atribuição por ?ref abaixo.
      const leadRes = await sb('sdr_leads', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ nome, email, whatsapp: telefone || null, user_id: usuario?.id || null, origem, status: 'novo' }) });
      if (!leadRes.ok) {
        const det = await leadRes.text().catch(() => '');
        console.error('[duvida] lead NÃO gravado', leadRes.status, det.slice(0, 300));
      } else {
        const [novo] = await leadRes.json().catch(() => []);
        if (novo?.id) { leadId = novo.id; leadConsultorId = null; leadStatus = 'novo'; }
      }
    }
  } catch (e) { console.error('[duvida] lead NÃO gravado (exceção)', String(e?.message || e)); }

  // 1b. ATRIBUIÇÃO PELO LINK DO CONSULTOR (?ref) — F3 do plano comercial (21/08).
  // Só para lead de ALAVANCAGEM ainda SEM dono. O corpo manda apenas o CÓDIGO; quem
  // resolve para uma pessoa é o servidor, e só aceita quem tem a capacidade comercial
  // (vendedor_tipo='consultor' ou role consultor/admin) — consultor_id nunca vem do
  // cliente. Best-effort: falha aqui não derruba o registro do interesse.
  try {
    const refCodigo = String(body.ref || '').trim().slice(0, 80);
    if (leadId && !leadConsultorId && refCodigo && origem.startsWith('alavancagem')) {
      const campo = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refCodigo) ? 'id' : 'codigo_indicacao';
      const consRes = await sb(`perfis?${campo}=eq.${encodeURIComponent(refCodigo)}&select=id,nome,role,vendedor_tipo&limit=1`);
      const [cons] = consRes.ok ? await consRes.json().catch(() => []) : [];
      const elegivel = cons && (cons.vendedor_tipo === 'consultor' || ['consultor', 'admin'].includes(cons.role));
      if (elegivel) {
        const upd = await sb(`sdr_leads?id=eq.${leadId}&consultor_id=is.null`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ consultor_id: cons.id, ...(leadStatus === 'novo' ? { status: 'atribuido' } : {}) }),
        });
        const atualizados = upd.ok ? await upd.json().catch(() => []) : [];
        // Só registra o evento se a atribuição ACONTECEU (o filtro consultor_id=is.null
        // perde a corrida se outro processo atribuiu antes — e aí não é nosso evento).
        if (Array.isArray(atualizados) && atualizados.length) {
          await sb('sdr_lead_eventos', {
            method: 'POST', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ lead_id: leadId, autor_id: cons.id, autor_papel: 'sistema', tipo: 'atribuido', comentario: `Atribuído pelo link do consultor (?ref) — ${cons.nome || cons.id}` }),
          });
        }
      }
    }
  } catch (e) { console.error('[duvida] atribuicao por ref falhou', String(e?.message || e)); }

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
