/**
 * PREVIEW RICO de links compartilhados (WhatsApp/Telegram/redes) — pedido do dono 30/07:
 * "aparece o mesmo layout/texto independente do que eu compartilhe".
 * CAUSA: o app é SPA com HashRouter (/#/rota) e os robôs de preview NÃO leem nada após o
 * "#" — todo link caía no OG genérico do index.html. SOLUÇÃO: rotas SEM hash (rewrites no
 * vercel.json → este endpoint) que servem og:title/description/image ESPECÍFICOS e
 * redirecionam o humano para a rota real (meta refresh + JS; o robô não segue, a pessoa sim).
 *   /c/<token>    → "Assinatura de documento" + título do contrato (destino /#/c/<token>)
 *   /t/<token>    → assinatura da TESTEMUNHA                        (destino /#/t/<token>)
 *   /i/<id>       → imóvel: título, cidade/UF, lance e FOTO         (destino /#/imovel/<id>)
 *   /p/curso/<id> · /p/ebook/<id> → nome/descrição do produto       (destino /#/p/...)
 * PRIVACIDADE: nunca expõe nome/CPF/e-mail/conteúdo — só o TÍTULO do documento (quem tem o
 * link já abre o documento; o preview não vaza nada além do título).
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import { CURSOS, EBOOKS } from '../src/data/cursos.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE = 'https://www.bidprobrasil.com.br';
const OG_PADRAO = {
  titulo: 'BidPro Brasil — Leilões de imóveis com inteligência e segurança',
  desc: 'Imóveis de leilão em todo o Brasil com até 50% abaixo do mercado. Análise jurídica e de viabilidade por IA + assessoria para arrematar com segurança.',
  img: `${SITE}/og-image.png?v=4`,
};

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtBRL = (v) => (Number(v) > 0 ? `R$ ${Math.round(Number(v)).toLocaleString('pt-BR')}` : null);
async function sb(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const tipo = u.searchParams.get('tipo') || '';
  const id = String(u.searchParams.get('id') || '').slice(0, 80);
  const idOk = /^[\w-]+$/.test(id);
  let titulo = OG_PADRAO.titulo, desc = OG_PADRAO.desc, img = OG_PADRAO.img, destino = '/#/';
  try {
    if (tipo === 'contrato' && idOk) {
      destino = `/#/c/${id}`;
      titulo = 'Assinatura de documento — BidPro Brasil';
      desc = 'Você recebeu um documento para leitura e assinatura eletrônica. Abra o link para assinar com segurança.';
      const rows = await sb(`contratos_link?token=eq.${encodeURIComponent(id)}&select=titulo`);
      if (rows?.[0]?.titulo) titulo = `Assinatura de documento: ${rows[0].titulo} — BidPro Brasil`;
    } else if (tipo === 'testemunha' && idOk) {
      destino = `/#/t/${id}`;
      titulo = 'Assinatura de testemunha — BidPro Brasil';
      desc = 'Você foi indicado(a) como testemunha de um documento. Abra o link para preencher seus dados e assinar.';
    } else if (tipo === 'imovel' && idOk) {
      destino = `/#/imovel/${id}`;
      titulo = 'Imóvel em leilão — BidPro Brasil';
      const rows = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=titulo,cidade,estado,valor_minimo,valor_avaliacao,link_foto`);
      const im = rows?.[0];
      if (im) {
        titulo = `${im.titulo || 'Imóvel em leilão'} — BidPro Brasil`;
        const partes = [];
        if (im.cidade) partes.push(`${im.cidade}${im.estado ? '/' + im.estado : ''}`);
        const lance = fmtBRL(im.valor_minimo); if (lance) partes.push(`lance a partir de ${lance}`);
        const aval = fmtBRL(im.valor_avaliacao); if (aval) partes.push(`avaliação ${aval}`);
        desc = `${partes.join(' · ') || 'Imóvel em leilão'} · Fotos, análise de viabilidade e documentos na BidPro Brasil.`;
        if (/^https?:\/\//.test(im.link_foto || '')) img = im.link_foto;
      }
    } else if ((tipo === 'curso' || tipo === 'ebook') && idOk) {
      destino = `/#/p/${tipo}/${id}`;
      const rot = tipo === 'curso' ? 'Curso' : 'E-book';
      const p = (tipo === 'curso' ? CURSOS : EBOOKS || []).find((x) => String(x.id) === id);
      titulo = p ? `${rot}: ${p.titulo} — BidPro Brasil` : `${rot} — BidPro Brasil`;
      desc = String(p?.descricao || p?.subtitulo || 'Conteúdo educacional sobre leilões de imóveis, da BidPro Brasil.').slice(0, 200);
    }
  } catch { /* preview best-effort: cai no padrão */ }

  const pathPub = tipo === 'contrato' ? `/c/${id}` : tipo === 'testemunha' ? `/t/${id}`
    : tipo === 'imovel' ? `/i/${id}` : (tipo === 'curso' || tipo === 'ebook') ? `/p/${tipo}/${id}` : '/';
  const html = `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"/>
<title>${esc(titulo)}</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="BidPro Brasil"/>
<meta property="og:title" content="${esc(titulo)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:image" content="${esc(img)}"/>
<meta property="og:url" content="${esc(SITE + pathPub)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(titulo)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(img)}"/>
<meta name="robots" content="noindex"/>
<meta http-equiv="refresh" content="0;url=${esc(destino)}"/>
<script>location.replace(${JSON.stringify(destino)});</script>
</head><body>Redirecionando… <a href="${esc(destino)}">continuar</a></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.status(200).send(html);
}
