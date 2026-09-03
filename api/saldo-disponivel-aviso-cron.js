/**
 * /api/saldo-disponivel-aviso-cron — todo usuário com valores a resgatar é notificado.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Pedido do dono (03/09): "todo usuario que tiver valores a resgatar deve ser notificado
 * por email sinalizando para se programar para o saque."
 *
 * A DECISÃO — quem tem saldo novo desde a última rodada — vive em SQL
 * (`saldo_avisos_pendentes()`), não aqui. É a mesma separação usada em `saque_avaliar` e
 * nas outras regras de `regra_negocio`: o motor lê a MESMA linha que o planejamento, e a
 * auditoria (`auditoria_regras_negocio()`) confere que a função realmente existe e cita a
 * chave — regra que só vive em comentário é letra morta (foi assim que "explorador não
 * saca" apodreceu uma vez).
 *
 * ⚠️ SEM ISSO ESTE CRON SERIA ESPECIALMENTE FÁCIL DE FAZER ERRADO: comparar o saldo de hoje
 * contra "o que já foi avisado" parece trivial até existir um SAQUE PARCIAL. Ensaiado antes
 * de aplicar: saldo 99,84 → avisa → saque de 50 → chega comissão nova de 10 (saldo vira
 * 59,84, ABAIXO do pico de 99,84) — a versão ingênua nunca mais avisaria esse usuário,
 * porque o snapshot ficava preso no pico. `saldo_avisos_sincronizar()`, chamada no fim de
 * TODA rodada (avisando ou não), é o que evita a catraca — ver o comentário na migração.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { enviarEmail } from './_email.js';

const FROM = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';
const fmtBRL = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function emailAviso({ nome, saldo, novo }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const saudacao = primeiro ? `Olá, ${primeiro}!` : 'Olá!';
  // `novo` só aparece quando é genuinamente dinheiro adicional desde o último aviso — quem
  // nunca foi avisado (saldo_anterior = 0) não precisa ler "novo valor disponível: X" duas
  // vezes seguidas dizendo a mesma coisa que "saldo disponível".
  const linhaNovo = novo > 0 && novo < saldo
    ? `<p style="font-size:14px;line-height:1.7">Desse total, <strong>${fmtBRL(novo)}</strong> é valor novo desde o último aviso.</p>` : '';
  return {
    subject: `Você tem ${fmtBRL(saldo)} disponível para saque — BidPro Brasil`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <p style="font-size:15px">${saudacao}</p>
      <p style="font-size:14px;line-height:1.7">Você tem <strong>${fmtBRL(saldo)}</strong> disponível para saque na plataforma.</p>
      ${linhaNovo}
      <p style="font-size:14px;line-height:1.7">Pode se programar: os pagamentos aprovados são liberados às sextas-feiras a partir das 12h (horário de Brasília). Acima de R$ 2.500,00 sacados no mês-calendário, o saque seguinte exige nota fiscal.</p>
      <p style="font-size:13px;color:#475569">Para solicitar, acesse o seu perfil na plataforma e peça o saque quando quiser — o valor fica disponível até lá.</p>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil</p>
    </div>`,
    text: `${saudacao}\n\nVocê tem ${fmtBRL(saldo)} disponível para saque na plataforma.${novo > 0 && novo < saldo ? ` Desse total, ${fmtBRL(novo)} é valor novo desde o último aviso.` : ''}\n\nPagamentos aprovados são liberados às sextas-feiras a partir das 12h (horário de Brasília). Acima de R$ 2.500,00 sacados no mês-calendário, o saque seguinte exige nota fiscal.\n\nAcesse o seu perfil na plataforma para solicitar quando quiser.\n\nBidPro Brasil`,
  };
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let pendentes = [];
  try {
    const { data, error } = await supabase.rpc('saldo_avisos_pendentes');
    if (error) throw new Error(error.message);
    pendentes = data || [];
  } catch (e) {
    // Leitura que falhou NÃO pode virar "ninguém a avisar" — os dois desfechos levam a
    // decisões opostas, e um cron silencioso aqui significa dinheiro do cliente esquecido.
    console.error('[saldo-disponivel-aviso] não consegui ler pendentes:', e?.message || e);
    return new Response(JSON.stringify({ ok: false, erro: String(e?.message || e) }), { status: 502 });
  }

  let enviados = 0, semEmail = 0, falhas = 0;
  for (const p of pendentes) {
    let email = null;
    try { const u = await supabase.auth.admin.getUserById(p.user_id); email = u?.data?.user?.email || null; } catch { /* segue sem email */ }
    if (!email) { semEmail++; continue; }

    const conteudo = emailAviso({ nome: p.nome, saldo: Number(p.saldo_disponivel), novo: Number(p.saldo_disponivel) - Number(p.saldo_anterior || 0) });
    try {
      const r = await enviarEmail({ from: FROM, to: email, subject: conteudo.subject, html: conteudo.html, text: conteudo.text,
        meta: { tipo: 'saldo_disponivel_aviso', userId: p.user_id } });
      if (r?.ok !== false) enviados++; else falhas++;
    } catch (e) {
      falhas++;
      console.error('[saldo-disponivel-aviso] falha ao enviar', p.user_id, e?.message || e);
    }
  }

  // SINCRONIZA SEMPRE, no fim — inclusive quando `pendentes` veio vazio. É o que impede a
  // catraca: um saque parcial baixa o snapshot mesmo sem ninguém ter sido avisado nesta
  // rodada, e é essa baixa que deixa a PRÓXIMA comissão nova disparar aviso de novo.
  let sincronizados = 0;
  try {
    const { data, error } = await supabase.rpc('saldo_avisos_sincronizar');
    if (error) throw new Error(error.message);
    sincronizados = Number(data) || 0;
  } catch (e) {
    console.error('[saldo-disponivel-aviso] sincronização falhou — o snapshot pode ficar desatualizado:', e?.message || e);
  }

  return new Response(JSON.stringify({ ok: true, pendentes: pendentes.length, enviados, sem_email: semEmail, falhas, sincronizados }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
