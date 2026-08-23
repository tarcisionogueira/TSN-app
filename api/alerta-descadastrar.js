/**
 * GET /api/alerta-descadastrar?token=... — descadastra o alerta "avise-me" (1 clique, LGPD).
 * Mesma capability-token da linha. Marca ativo=false; a pessoa para de receber na hora.
 */
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SITE = 'https://www.bidprobrasil.com.br';

function pagina(titulo, corpo, status = 200) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${titulo} | BidPro Brasil</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:'Inter',-apple-system,sans-serif;background:#f8fafc;color:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;max-width:440px;text-align:center;box-shadow:0 6px 24px rgba(15,23,42,.06)}
h1{font-size:22px;font-weight:900;margin:0 0 10px}p{color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px}
a.b{display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:800;font-size:14px}</style>
</head><body><div class="card">${corpo}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default async function handler(req) {
  const token = String(new URL(req.url, 'http://x').searchParams.get('token') || '').trim();
  if (!/^[0-9a-f]{32,64}$/i.test(token) || !SUPABASE_URL || !SERVICE_KEY) {
    return pagina('Link inválido', `<h1>Link inválido</h1><p>Este link não é válido.</p><a class="b" href="${SITE}/leiloes">Ver imóveis</a>`, 400);
  }
  const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/alerta_publico?token=eq.${token}`, {
      method: 'PATCH', headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ativo: false, atualizado_em: new Date().toISOString() }),
    });
    return pagina('Alerta cancelado', `<h1>Alerta cancelado</h1><p>Você não receberá mais esses avisos. Se foi engano, é só se inscrever de novo em qualquer página de imóveis.</p><a class="b" href="${SITE}/leiloes">Ver imóveis em leilão</a>`);
  } catch {
    return pagina('Erro', `<h1>Não foi possível cancelar</h1><p>Tente novamente em instantes.</p><a class="b" href="${SITE}/leiloes">Ver imóveis</a>`, 500);
  }
}
