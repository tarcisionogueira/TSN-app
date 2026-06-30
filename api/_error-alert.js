/**
 * Alerta de erro em produção via email (Resend).
 * Fire-and-forget: nunca bloqueia a resposta principal.
 * Só envia em produção para evitar spam em desenvolvimento.
 */

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.APP_FROM_EMAIL || 'BidPro Brasil <alertas@bidprobrasil.com.br>';
const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'tarcisioaraujo@reimob.com.br';
const IS_PROD = process.env.VERCEL_ENV === 'production';

// Debounce simples: evita enviar o mesmo erro repetido em rajada
const recentAlerts = new Map();
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutos

/**
 * @param {object} params
 * @param {string} params.rota    - ex: '/api/asaas'
 * @param {string} params.erro    - mensagem do erro
 * @param {object} [params.extra] - dados adicionais (sem PII)
 */
export function alertarErro({ rota, erro, extra }) {
  if (!RESEND_KEY || !IS_PROD) return;

  const chave = `${rota}:${erro}`.slice(0, 100);
  const agora = Date.now();
  if (recentAlerts.has(chave) && agora - recentAlerts.get(chave) < DEBOUNCE_MS) return;
  recentAlerts.set(chave, agora);

  const html = `
    <div style="font-family:monospace;padding:16px;">
      <h3 style="color:#dc2626;">⚠️ Erro em produção — BidPro Brasil</h3>
      <p><strong>Rota:</strong> ${rota}</p>
      <p><strong>Erro:</strong> ${erro}</p>
      <p><strong>Hora:</strong> ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      ${extra ? `<pre style="background:#f1f5f9;padding:12px;border-radius:6px;">${JSON.stringify(extra, null, 2)}</pre>` : ''}
    </div>
  `;

  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `[BidPro] Erro em ${rota}`,
      html,
    }),
  }).catch(() => {});
}
