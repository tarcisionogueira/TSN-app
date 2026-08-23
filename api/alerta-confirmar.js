/**
 * GET /api/alerta-confirmar?token=... — confirma o alerta "avise-me" (duplo opt-in).
 * O token é uma capability aleatória (64 hex) da própria linha; não carrega segredo nem id
 * legível. Marca confirmado=true e devolve uma página simples e da marca.
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
a.b{display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:800;font-size:14px;margin:4px}
a.g{display:inline-block;color:#0D63DB;text-decoration:none;font-weight:700;font-size:13px}</style>
</head><body><div class="card">${corpo}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default async function handler(req) {
  const token = String(new URL(req.url, 'http://x').searchParams.get('token') || '').trim();
  if (!/^[0-9a-f]{32,64}$/i.test(token) || !SUPABASE_URL || !SERVICE_KEY) {
    return pagina('Link inválido', `<h1>Link inválido</h1><p>Este link de confirmação não é válido ou expirou.</p><a class="b" href="${SITE}/leiloes">Ver imóveis em leilão</a>`, 400);
  }
  const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/alerta_publico?token=eq.${token}&select=id,cidade,uf&limit=1`, { headers: hdr });
    const [row] = r.ok ? await r.json().catch(() => []) : [];
    if (!row) return pagina('Alerta não encontrado', `<h1>Alerta não encontrado</h1><p>Não localizamos este alerta. Ele pode já ter sido removido.</p><a class="b" href="${SITE}/leiloes">Ver imóveis em leilão</a>`, 404);
    await fetch(`${SUPABASE_URL}/rest/v1/alerta_publico?id=eq.${row.id}`, {
      method: 'PATCH', headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ confirmado: true, confirmado_em: new Date().toISOString(), ativo: true }),
    });
    const local = row.cidade ? `${row.cidade}/${row.uf}` : row.uf;
    return pagina('Alerta confirmado', `<h1>Alerta confirmado ✅</h1>
      <p>Pronto! Vamos avisar você por e-mail quando surgirem novos imóveis em leilão em <strong>${String(local).replace(/[<>&]/g, '')}</strong>.</p>
      <a class="b" href="${SITE}/leiloes">Ver imóveis agora</a>
      <p style="margin-top:18px;font-size:13px">Quer a ficha completa (mapa, análise e parecer)?<br><a class="g" href="${SITE}/#/login?modo=cadastro">Criar conta grátis →</a></p>`);
  } catch {
    return pagina('Erro', `<h1>Não foi possível confirmar</h1><p>Tente novamente em instantes.</p><a class="b" href="${SITE}/leiloes">Ver imóveis em leilão</a>`, 500);
  }
}
