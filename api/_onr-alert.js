/**
 * Envia alerta por email quando a integração ONR Digital apresenta falha.
 * Usa Resend (mesma infra dos demais alertas do sistema).
 */

const ADMIN_EMAIL = process.env.ONR_ALERT_EMAIL || process.env.ONR_EMAIL || 'tarcisioaraujo@reimob.com.br';

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function enviarAlertaOnr({ tipo, detalhe, ultimoSucesso }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.error('[onr-alert] RESEND_API_KEY não configurada — alerta não enviado');
    return;
  }

  const FROM = process.env.APP_FROM_EMAIL || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
  const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const ultimoOk = ultimoSucesso
    ? new Date(ultimoSucesso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'desconhecido';

  const TITULO = {
    login_falhou:    '⚠️ ONR Digital — Falha no Login',
    campo_alterado:  '⚠️ ONR Digital — Possível Alteração no Formulário',
    api_indisponivel:'⚠️ ONR Digital — API Indisponível',
    sessao_invalida: '⚠️ ONR Digital — Sessão Rejeitada',
  };

  const DICA = {
    login_falhou:    'Verifique se as credenciais ONR_EMAIL e ONR_SENHA no Vercel estão corretas. Se a senha foi alterada, atualize a variável de ambiente.',
    campo_alterado:  'O site do RI Digital pode ter mudado os nomes dos campos do formulário de login. Acesse DevTools e verifique novamente o Payload do POST para /Acesso.aspx.',
    api_indisponivel:'O servidor ridigital.org.br pode estar em manutenção. Tente novamente em alguns minutos.',
    sessao_invalida: 'O cookie de sessão foi rejeitado. O cache foi invalidado automaticamente — o próximo acesso tentará novo login.',
  };

  const titulo = TITULO[tipo] || '⚠️ ONR Digital — Problema Detectado';
  const dica   = DICA[tipo]  || 'Verifique os logs do Vercel para mais detalhes.';

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
  .card { background: white; border-radius: 12px; padding: 28px 32px; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; }
  h2 { color: #dc2626; margin: 0 0 16px; font-size: 18px; }
  .row { margin-bottom: 10px; font-size: 14px; color: #334155; }
  .label { font-weight: 700; color: #111; }
  .dica { background: #fef9c3; border: 1px solid #fde047; border-radius: 8px; padding: 12px 16px; margin-top: 18px; font-size: 13px; color: #713f12; line-height: 1.6; }
  .footer { margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: center; }
</style></head>
<body>
<div class="card">
  <h2>${titulo}</h2>
  <div class="row"><span class="label">Data/hora:</span> ${dataHora}</div>
  <div class="row"><span class="label">Tipo:</span> ${tipo}</div>
  <div class="row"><span class="label">Detalhe:</span> ${escHtml(detalhe) || '—'}</div>
  <div class="row"><span class="label">Último sucesso:</span> ${ultimoOk}</div>
  <div class="dica"><strong>O que fazer:</strong><br>${dica}</div>
  <div class="footer">BidPro Brasil · Integração ONR Digital · ridigital.org.br</div>
</div>
</body>
</html>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: ADMIN_EMAIL, subject: titulo, html }),
    });
  } catch (e) {
    console.error('[onr-alert] falha ao enviar email de alerta:', e.message);
  }
}
