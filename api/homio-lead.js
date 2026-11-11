/**
 * POST /api/homio-lead?campanha=<nome> — inscrição vinda da página de lançamento na Homio (11/11).
 *
 * Quem se inscreve na página da Homio ganha uma conta Explorador (plano grátis) aqui, na hora.
 * A conta nasce TRANCADA: senha aleatória, sem aceite dos termos. Ela só abre pelo link de
 * ativação mandado ao e-mail — é a prova de posse do endereço que a regra de #251 exige, porque a
 * Homio não tem como provar que o e-mail digitado é de quem digitou. No primeiro acesso, a pessoa
 * define a senha (/redefinir-senha) e o popup de cadastro incompleto pede cidade e o aceite.
 *
 * Proteções:
 * - segredo no cabeçalho `x-homio-secret` (HOMIO_WEBHOOK_SECRET); sem ele configurado, recusa tudo;
 * - e-mail que JÁ tem conta não é tocado (nem senha, nem plano, nem origem): só fica registrado;
 * - a mesma inscrição repetida (a Homio reenvia em falha) não cria nada de novo;
 * - o link de ativação NUNCA volta na resposta: ele autentica (bug bounty de 19/10).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { checkRateLimit } from './_rate-limit.js';
import { erroNome, normalizarNome } from './_nome.js';
import { erroTelefone, limparTelefone, normalizarTelefoneBR } from './_telefone.js';
import { lerLeadHomio, campanhaDe, segredoConfere, tokenAtivacao, VALIDADE_ATIVACAO_DIAS } from './_homio.js';
import { SUPABASE_URL, SERVICE_KEY, SEGREDO, sb, atualizarLead, enviarEmailAtivacao, avisarHomio } from './_homio-io.js';

function senhaAleatoria() {
  const b = new Uint8Array(18);
  globalThis.crypto.getRandomValues(b);
  return 'Aa1!' + Buffer.from(b).toString('base64url').slice(0, 20);
}

async function contaPorEmail(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  // Leitura que FALHOU não é "não existe": seguir criaria conta duplicada ou daria erro confuso.
  if (!r.ok) throw new Error(`busca de conta HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));
  const lista = Array.isArray(j?.users) ? j.users : [];
  return lista.find((u) => String(u.email || '').toLowerCase() === email) || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const segredo = SEGREDO();
  if (!segredo) {
    console.error('[homio-lead] HOMIO_WEBHOOK_SECRET não configurado — recusando');
    return res.status(503).json({ error: 'Integração não configurada' });
  }
  if (!segredoConfere(req.headers['x-homio-secret'], segredo)) return res.status(401).json({ error: 'Não autorizado' });

  // Teto global (todas as chamadas vêm dos servidores da Homio): protege o cadastro em massa
  // se o segredo vazar, sem atrapalhar um lançamento de verdade (600 por 10 min).
  const rl = await checkRateLimit('homio-lead:global', 600, 600_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas inscrições seguidas. A Homio tenta de novo.' });

  const lido = lerLeadHomio(req.body);
  if (lido.faltando.length) return res.status(400).json({ error: 'Campos obrigatórios ausentes', faltando: lido.faltando });
  const campanha = campanhaDe(req.query?.campanha);
  const { email } = lido;

  // Nome e telefone passam pela MESMA régua do cadastro; o que não passa fica vazio e o popup de
  // cadastro incompleto pede no primeiro acesso (melhor que gravar "Joao" ou celular sem o 9).
  const nomeNorm = normalizarNome(lido.nome);
  const nome = nomeNorm && !erroNome(nomeNorm) ? nomeNorm : null;
  const telNorm = normalizarTelefoneBR(lido.telefone).slice(0, 15);
  const telefone = limparTelefone(telNorm) && !erroTelefone(telNorm) ? telNorm : null;

  // ── O lead: uma linha por (e-mail, campanha). Reenvio da Homio cai na mesma linha. ──
  const ex = await sb(`homio_leads?email=eq.${encodeURIComponent(email)}&campanha=eq.${encodeURIComponent(campanha)}&select=*`);
  if (!ex.ok) return res.status(502).json({ error: 'Não foi possível registrar agora. Tente de novo.' });
  let [lead] = await ex.json().catch(() => []);
  if (lead && (lead.situacao === 'conta_criada' || lead.situacao === 'ja_tinha_conta')) {
    return res.status(200).json({ ok: true, repetido: true, situacao: lead.situacao });
  }
  if (!lead) {
    const ins = await sb('homio_leads?on_conflict=email,campanha', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        email, campanha, nome: nome || lido.nome || null, telefone: telefone || lido.telefone || null,
        homio_contact_id: lido.contactId || null, utm: lido.utm, payload: req.body ?? null,
      }),
    });
    if (!ins.ok) {
      console.error('[homio-lead] lead não gravado', ins.status, (await ins.text().catch(() => '')).slice(0, 200));
      return res.status(502).json({ error: 'Não foi possível registrar agora. Tente de novo.' });
    }
    [lead] = await ins.json().catch(() => []);
    if (!lead?.id) return res.status(502).json({ error: 'Não foi possível registrar agora. Tente de novo.' });
  }

  // ── A conta ──
  let existente;
  try { existente = await contaPorEmail(email); } catch (e) {
    await atualizarLead(lead.id, { situacao: 'erro', erro: String(e.message).slice(0, 300) });
    return res.status(502).json({ error: 'Não foi possível registrar agora. Tente de novo.' });
  }
  let userId = existente?.id || null;
  // Conta que ESTA integração criou numa tentativa anterior que caiu no meio (lead ficou em `erro`):
  // retoma de onde parou em vez de tratá-la como cliente antigo e nunca mandar a ativação.
  const retomada = !!existente && lead.situacao === 'erro' && existente.user_metadata?.origem_homio === campanha;

  if (userId && !retomada) {
    // Já é cliente: não muda nada na conta. Registra e avisa a Homio para tratar como cliente.
    await atualizarLead(lead.id, { situacao: 'ja_tinha_conta', user_id: userId, erro: null });
    lead = { ...lead, situacao: 'ja_tinha_conta', user_id: userId };
    await avisarHomio('ja_tinha_conta', lead);
    return res.status(200).json({ ok: true, situacao: 'ja_tinha_conta' });
  }

  if (!retomada) {
  const meta = { role: 'explorador', origem_homio: campanha, ...(nome ? { nome } : {}), ...(telefone ? { whatsapp: telefone } : {}) };
  const cRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    // email_confirm: a conta fica inacessível sem o link (senha aleatória que ninguém conhece);
    // abrir o link mandado AO E-MAIL é a confirmação de posse.
    body: JSON.stringify({ email, password: senhaAleatoria(), email_confirm: true, user_metadata: meta }),
    signal: AbortSignal.timeout(10000),
  });
  const cData = await cRes.json().catch(() => ({}));
  if (!cRes.ok) {
    const msg = String(cData?.msg || cData?.error_description || cData?.error || cData?.message || '');
    // Corrida com outro caminho de cadastro do mesmo e-mail: agora a conta existe — trata como já cliente.
    if (/already.*(registered|exists)|been registered|duplicate/i.test(msg)) {
      const u2 = await contaPorEmail(email).catch((e) => { console.error('[homio-lead] releitura da conta falhou', e?.message); return null; });
      await atualizarLead(lead.id, { situacao: 'ja_tinha_conta', user_id: u2?.id || null, erro: null });
      return res.status(200).json({ ok: true, situacao: 'ja_tinha_conta' });
    }
    await atualizarLead(lead.id, { situacao: 'erro', erro: `criação da conta: HTTP ${cRes.status} ${msg}`.slice(0, 300) });
    return res.status(502).json({ error: 'Não foi possível criar a conta agora. Tente de novo.' });
  }
  userId = cData?.id || cData?.user?.id || null;

  // Perfil: Explorador, senha pendente (dispara o popup de definir senha), SEM aceite dos termos
  // (o popup de cadastro incompleto pede), e a origem do lançamento para medir o funil.
  const u = lido.utm;
  const perfil = {
    id: userId, role: 'explorador', senha_pendente: true, lgpd_aceito: false,
    ...(nome ? { nome } : {}), ...(telefone ? { telefone } : {}),
    mkt_utm_source: u.utm_source || 'homio', mkt_utm_medium: u.utm_medium || null,
    mkt_utm_campaign: u.utm_campaign || campanha, mkt_utm_content: u.utm_content || null,
    mkt_utm_term: u.utm_term || null, mkt_gclid: u.gclid || null, mkt_fbclid: u.fbclid || null,
    mkt_landing: `homio:${campanha}`, mkt_capturado_em: new Date().toISOString(),
  };
  const gravarPerfil = (corpo) => sb('perfis?on_conflict=id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(corpo),
  });
  try {
    let rp = await gravarPerfil(perfil);
    if (rp.status === 409 && perfil.telefone) {
      // Índice único de telefone: WhatsApp já usado por outra conta. Grava o resto sem ele.
      const { telefone: _t, ...semTel } = perfil;
      rp = await gravarPerfil(semTel);
    }
    if (!rp.ok) console.error('[homio-lead] perfil não gravado', rp.status, (await rp.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('[homio-lead] perfil não gravado', e?.message || e); }
  } // fim do `if (!retomada)`

  const tok = tokenAtivacao(lead.id, segredo);
  const expira = new Date(Date.now() + VALIDADE_ATIVACAO_DIAS * 86400000).toISOString();
  const okGrav = await atualizarLead(lead.id, {
    situacao: 'conta_criada', user_id: userId, conta_nova: true, erro: null,
    token_hash: tok.hash, token_expira_em: expira,
  });
  lead = { ...lead, situacao: 'conta_criada', user_id: userId, conta_nova: true, token_hash: tok.hash, token_expira_em: expira };
  if (!okGrav) {
    // Sem o hash no banco o link não abriria: não manda e-mail que levaria a "link inválido".
    return res.status(502).json({ error: 'Conta criada, ativação não registrada. Tente de novo.' });
  }

  const em = await enviarEmailAtivacao(lead);
  await avisarHomio('conta_criada', lead);
  return res.status(200).json({ ok: true, situacao: 'conta_criada', email_ativacao: em.ok ? 'enviado' : (em.enfileirado ? 'enfileirado' : 'falhou') });
}
