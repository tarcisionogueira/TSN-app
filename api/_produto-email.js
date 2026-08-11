/**
 * Template e helpers do e-mail de PRODUTO (curso/eBook) — compartilhado por dois disparos:
 *   • /api/anunciar-produto  → o admin dispara na hora, para toda a base ("saiu material novo")
 *   • /api/divulgacao-cron   → quinzenal e SEGMENTADO, só para quem ainda não viu aquele material
 *
 * Por que compartilhado: eram dois e-mails do mesmo produto com o mesmo objetivo. Manter duas
 * cópias do HTML garante que uma melhora feita em uma nunca chegue na outra — e é assim que a
 * marca fica inconsistente sem ninguém decidir isso.
 */
import { escapeHtml } from './_sanitize.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

const hdr = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => escapeHtml(String(s ?? ''));

// Capa p/ e-mail: só URL http(s) direta (bucket público membros-capas). Drive/relativa → sem imagem.
export function capaEmail(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) && !/drive\.google\.com/i.test(u) ? u : null;
}

/**
 * @param {'novidade'|'lembrete'} contexto  'novidade' = acabou de sair; 'lembrete' = você ainda
 *   não viu este material. O segundo é o da divulgação quinzenal: dizer "novidade" sobre algo
 *   publicado há três meses queima a confiança de quem lê.
 */
export function corpoEmailProduto({ tipo, produto, nome, contexto = 'novidade' }) {
  const rotulo = tipo === 'curso' ? 'curso' : 'eBook';
  const link = `${BASE}/#/p/${tipo}/${produto.id}`;
  const isPago = Number(produto.preco || 0) > 0;
  const preco = isPago ? fmtBRL(produto.preco) : 'Incluído no seu acesso';
  const capa = capaEmail(produto.capa_url);
  const desc = String(produto.descricao || '').slice(0, 320);
  const cor = produto.cor || '#0D63DB';
  const primeiro = nome ? String(nome).split(' ')[0] : '';
  const selo = contexto === 'lembrete' ? `Ainda não visto · ${rotulo}` : `Novidade · ${rotulo}`;
  const abertura = contexto === 'lembrete'
    ? `${primeiro ? `${esc(primeiro)}, e` : 'E'}ste ${rotulo} está disponível para você e ainda não foi aberto. São poucos minutos e ele muda o que você consegue enxergar num leilão.`
    : `${primeiro ? `Olá, ${esc(primeiro)}! A` : 'A'}cabamos de disponibilizar este ${rotulo} na plataforma.`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <a href="${BASE}/#/membros" style="text-decoration:none;">
    <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:22px 28px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:#fff;">BidPro Brasil</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Leilão &amp; Investimentos</div>
    </div>
  </a>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="font-size:11px;font-weight:800;color:${esc(cor)};text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;">${esc(selo)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;line-height:1.3;">${esc(produto.titulo || 'Material')}</h2>
    <p style="margin:0 0 14px;color:#475569;font-size:14px;">${abertura}</p>
    ${capa ? `<a href="${link}"><img src="${esc(capa)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:12px;margin-bottom:18px;display:block;"></a>` : ''}
    ${desc ? `<p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.7;">${esc(desc)}${produto.descricao && produto.descricao.length > 320 ? '…' : ''}</p>` : ''}
    <div style="font-size:13px;color:#64748b;margin-bottom:18px;"><strong style="color:#0f172a;${isPago ? 'font-size:18px;' : ''}">${preco}</strong></div>
    <div style="text-align:center;margin:8px 0 6px;">
      <a href="${link}" style="display:inline-block;background:${esc(cor)};color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-weight:800;font-size:15px;">
        ${isPago ? 'Ver e adquirir →' : 'Acessar agora →'}
      </a>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:22px;">BidPro Brasil · Novidades da plataforma · <a href="{{UNSUB}}" style="color:#94a3b8;">Cancelar e-mails</a></p>
  </div>
</div></body></html>`;
}

/** E-mails do lote (auth.users via GoTrue admin), concorrência limitada. */
export async function emailsDoLote(ids) {
  const map = new Map(); const CONC = 8;
  for (let i = 0; i < ids.length; i += CONC) {
    const res = await Promise.all(ids.slice(i, i + CONC).map(async (uid) => {
      try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
        if (!r.ok) return null;
        const u = await r.json();
        return u?.email ? [uid, String(u.email).toLowerCase()] : null;
      } catch { return null; }
    }));
    for (const e of res) if (e) map.set(e[0], e[1]);
  }
  return map;
}
