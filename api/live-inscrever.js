/**
 * POST /api/live-inscrever — inscrição na aula ao vivo.
 *
 * Faz duas coisas de uma vez, e é esse o ponto: registra a inscrição E transforma o
 * inscrito em USUÁRIO da plataforma. Uma landing de terceiro captaria o e-mail numa lista
 * que não é nossa — o lead nunca chegaria à base, e o rastreio de origem (consertado em
 * 20/08) não o alcançaria.
 *
 * ATRITO MÍNIMO, DE PROPÓSITO: pede nome, e-mail e WhatsApp. Não pede senha. A conta nasce
 * com senha aleatória e a pessoa recebe o link para defini-la junto com a confirmação.
 * Exigir senha numa página de inscrição derruba conversão e não acrescenta nada agora.
 *
 * Mínimo NÃO é frouxo (27/08): os três campos passam pela MESMA régua do cadastro
 * (`_nome.js`, `_telefone.js`), porque esta rota CRIA CONTA — dado que entra por aqui é o
 * mesmo dado que o resto do sistema usa para emitir contrato e para ligar para o cliente.
 * Enquanto a régua daqui era `nome.length >= 2` e `whatsapp.length >= 10`, a landing era a
 * porta dos fundos por onde entrava exatamente o que o cadastro recusa: a inscrição de
 * teste gravou "tarcisio", primeiro nome solto, e teria aceitado celular sem o 9.
 *
 * E-MAIL JÁ CADASTRADO NÃO É ERRO. Aqui isso é o caso NORMAL (cliente que já usa a
 * plataforma e quer assistir): inscreve e segue. Barrar quem já é cliente seria recusar o
 * público mais quente que existe.
 */
export const config = { runtime: 'nodejs' };

import { checkRateLimit } from './_rate-limit.js';
import { enviarEmail } from './_email.js';
import { erroNome, normalizarNome } from './_nome.js';
import { erroTelefone, limparTelefone, normalizarTelefoneBR } from './_telefone.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_URL      = process.env.APP_BASE_URL || 'https://www.bidprobrasil.com.br';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Senha aleatória forte: a pessoa nunca a usa (recebe link para definir a dela), mas a
// conta não pode nascer com senha fraca ou previsível.
function senhaAleatoria() {
  const b = new Uint8Array(18);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(b);
  return 'Aa1!' + Buffer.from(b).toString('base64url').slice(0, 20);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'sem-ip';
  const rl = await checkRateLimit(`live:${ip}`, 8, 600);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });

  const b = req.body || {};
  const slug     = String(b.slug || '').trim().slice(0, 80);
  const nome     = normalizarNome(String(b.nome || '').slice(0, 120));
  const email    = String(b.email || '').trim().toLowerCase().slice(0, 160);
  // `normalizarTelefoneBR` tira o "+55" do autopreenchimento ANTES de validar: 13 dígitos
  // reprovariam por tamanho, e reprovar um número certo é tão ruim quanto aceitar um errado.
  const whatsapp = normalizarTelefoneBR(b.whatsapp).slice(0, 15);
  const cidade   = String(b.cidade || '').trim().slice(0, 90);
  const uf       = String(b.uf || '').trim().toUpperCase().slice(0, 2);
  const utm      = (b.utm && typeof b.utm === 'object') ? b.utm : {};

  if (!slug) return res.status(400).json({ error: 'Evento não informado.' });
  const eNome = erroNome(nome);
  if (eNome) return res.status(400).json({ error: eNome });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  // `erroTelefone` deixa passar o VAZIO por contrato (obrigatoriedade é decisão de quem
  // chama). Aqui o WhatsApp é o canal do lembrete e do link da sala: sem ele a inscrição
  // não serve para nada, então o vazio é checado à parte.
  if (!limparTelefone(whatsapp)) return res.status(400).json({ error: 'Informe o seu WhatsApp com DDD.' });
  const eTel = erroTelefone(whatsapp);
  if (eTel) return res.status(400).json({ error: eTel });
  if (cidade.length < 2) return res.status(400).json({ error: 'Informe a sua cidade.' });

  // O evento tem de existir e estar ativo — nunca confiar no que a tela mandou.
  const evRes = await sb(`eventos_live?slug=eq.${encodeURIComponent(slug)}&ativo=eq.true&select=id,titulo,data_hora,link_grupo,whatsapp_direto,vagas_max`);
  const evs = evRes.ok ? await evRes.json().catch(() => []) : [];
  const ev = Array.isArray(evs) && evs[0];
  if (!ev) return res.status(404).json({ error: 'Esta aula não está com inscrições abertas.' });

  // Vagas: contar ANTES de criar conta. A checagem é best-effort contra corrida (duas
  // inscrições simultâneas na última vaga passam), e isso é deliberado — recusar alguém
  // por causa de um empate custa mais do que uma vaga a mais na sala.
  if (ev.vagas_max) {
    const cRes = await sb(`live_inscricoes?evento_id=eq.${ev.id}&select=id`, { headers: { Prefer: 'count=exact' } });
    const total = Number(String(cRes.headers.get('content-range') || '').split('/')[1] || 0);
    if (total >= ev.vagas_max) return res.status(409).json({ error: 'As vagas para esta aula se esgotaram.' });
  }

  // ── A conta ────────────────────────────────────────────────────────────────
  // Já existe? Não é erro: é o cliente que já usa a plataforma querendo assistir.
  let userId = null;
  let contaNova = false;
  const buscaRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (buscaRes.ok) {
    const found = await buscaRes.json().catch(() => ({}));
    const lista = Array.isArray(found?.users) ? found.users : [];
    userId = lista.find(u => String(u.email || '').toLowerCase() === email)?.id || null;
  }

  if (!userId) {
    const meta = { nome, whatsapp, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString(), origem_live: slug };
    const cRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senhaAleatoria(), email_confirm: true, user_metadata: meta }),
    });
    const cData = await cRes.json().catch(() => ({}));
    if (!cRes.ok) {
      const msg = String(cData?.msg || cData?.error_description || cData?.error || cData?.message || '');
      // Corrida com outra inscrição do mesmo e-mail: segue sem conta, a inscrição vale.
      if (!/already.*(registered|exists)|been registered|duplicate/i.test(msg)) {
        console.error('[live-inscrever] conta não criada', cRes.status, msg.slice(0, 200));
      }
    } else {
      userId = cData?.id || cData?.user?.id || null;
      contaNova = !!userId;
      // Perfil com telefone e marketing de origem. Best-effort: sem isto a inscrição
      // continua válida, e o trigger de novo usuário já criou a linha básica.
      if (userId) {
        try {
          await sb('perfis?on_conflict=id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
              id: userId, nome, telefone: whatsapp, role: 'explorador',
              // A cidade vira o primeiro filtro útil do novo usuário: quem entra na
              // plataforma sem região definida vê o acervo do país inteiro e não
              // reconhece nada — a pior primeira impressão possível.
              endereco_cidade: cidade || null, endereco_uf: uf || null,
              lgpd_aceito: true, lgpd_data: meta.lgpd_data,
              mkt_utm_source: utm.utm_source || null, mkt_utm_medium: utm.utm_medium || null,
              mkt_utm_campaign: utm.utm_campaign || null, mkt_gclid: utm.gclid || null,
              // content/term entraram em 27/08: sem eles a inscricao na aula sabia a CAMPANHA
              // mas nao a PECA — e e a peca que decide qual criativo recebe verba.
              mkt_utm_content: utm.utm_content || null, mkt_utm_term: utm.utm_term || null,
              mkt_fbclid: utm.fbclid || null, mkt_referrer: utm.referrer || null,
              mkt_landing: `/live/${slug}`, mkt_capturado_em: new Date().toISOString(),
            }),
          });
        } catch { /* best-effort */ }
      }
    }
  }

  // ── A inscrição ────────────────────────────────────────────────────────────
  // `merge-duplicates` sobre (evento_id, email): reenviar o formulário atualiza os dados
  // em vez de estourar erro na cara de quem só clicou duas vezes.
  const insRes = await sb('live_inscricoes?on_conflict=evento_id,email', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      evento_id: ev.id, user_id: userId, nome, email, whatsapp, cidade: cidade || null, uf: uf || null,
      origem: String(b.origem || utm.utm_source || utm.referrer || '').slice(0, 200) || null,
      utm,
    }),
  });
  // A inscrição é o produto desta rota: se ela não gravou, NÃO se pode dizer "inscrito".
  // Confirmar uma vaga que não existe é a falha que só aparece no dia da aula.
  if (!insRes.ok) {
    const det = await insRes.text().catch(() => '');
    console.error('[live-inscrever] inscrição NÃO gravada', insRes.status, det.slice(0, 300));
    return res.status(500).json({ error: 'Não conseguimos concluir a sua inscrição. Tente de novo em instantes.' });
  }

  // ── Confirmação por e-mail ─────────────────────────────────────────────────
  // Falha de e-mail NÃO derruba a inscrição (ela já está gravada, que é o que importa),
  // mas vai para o log: uma confirmação que não chega vira falta na aula.
  const quando = new Date(ev.data_hora).toLocaleString('pt-BR', {
    timeZone: 'America/Bahia', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const primeiro = nome.split(' ')[0];
  const linkSenha = contaNova ? `${APP_URL}/#/redefinir-senha` : `${APP_URL}/#/login`;
  try {
    await enviarEmail({
      to: email,
      subject: `Inscrição confirmada — ${ev.titulo}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <p style="font-size:15px">Olá, ${esc(primeiro)}!</p>
        <p style="font-size:14px;line-height:1.7">Sua vaga está garantida em <strong>${esc(ev.titulo)}</strong>.</p>
        <p style="font-size:15px;line-height:1.7;background:#f1f5f9;border-radius:10px;padding:14px 16px">
          📅 <strong>${esc(quando)}</strong><br>
          <span style="font-size:13px;color:#475569">Horário de Brasília</span>
        </p>
        ${ev.link_grupo ? `<p style="font-size:14px;line-height:1.7">Entre no grupo do WhatsApp para receber o link da sala e o lembrete antes de começar:</p>
        <p style="margin:18px 0"><a href="${esc(ev.link_grupo)}" style="background:#16a34a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Entrar no grupo do WhatsApp →</a></p>` : ''}
        ${contaNova ? `<p style="font-size:14px;line-height:1.7">Também criamos o seu acesso à plataforma, onde vou mostrar as oportunidades ao vivo. Defina a sua senha quando quiser: <a href="${esc(linkSenha)}">${esc(linkSenha)}</a></p>` : ''}
        <p style="font-size:13px;line-height:1.7;color:#475569">Se não puder comparecer, é só responder este e-mail avisando.</p>
        <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil</p>
      </div>`,
      text: `Olá, ${primeiro}!\n\nSua vaga está garantida em ${ev.titulo}.\n\n${quando} (horário de Brasília)\n${ev.link_grupo ? `\nGrupo do WhatsApp: ${ev.link_grupo}\n` : ''}${contaNova ? `\nSeu acesso à plataforma foi criado. Defina a sua senha em: ${linkSenha}\n` : ''}\nBidPro Brasil`,
      meta: { userId, tipo: 'live_inscricao' },
    });
  } catch (e) {
    console.error('[live-inscrever] e-mail de confirmação falhou', e?.message);
  }

  return res.status(200).json({
    ok: true, contaNova, link_grupo: ev.link_grupo || null, titulo: ev.titulo, data_hora: ev.data_hora,
    // Número vem do BANCO e não do bundle: variável VITE_ obriga novo deploy para
    // trocar, e numa página de campanha isso é número errado no ar até alguém lembrar.
    whatsapp_direto: String(ev.whatsapp_direto || '').replace(/\D/g, '') || null,
  });
}
