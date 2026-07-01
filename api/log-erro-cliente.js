// Recebe erros de RENDER do cliente (ErrorBoundary) e os registra no log do
// servidor (visível nos Runtime Logs da Vercel). Sem auth (o boundary pode
// disparar antes de logar) e sem PII sensível — só mensagem, stack e contexto.
export const config = { runtime: 'nodejs', maxDuration: 10 };

export default function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const b = req.body || {};
    console.error('[erro-cliente]', JSON.stringify({
      msg: String(b.msg || '').slice(0, 500),
      stack: String(b.stack || '').slice(0, 4000),
      url: String(b.url || '').slice(0, 300),
      ua: String(b.ua || '').slice(0, 300),
      at: new Date().toISOString(),
    }));
  } catch { /* nunca falha o cliente por causa do log */ }
  res.status(204).end();
}
