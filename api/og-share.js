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
      // VISITANTE VAI PARA A PÁGINA PÚBLICA DO LOTE, não para o teaser (14/08, pedido do dono).
      // O botão Compartilhar existe para mostrar um imóvel a quem NÃO é da plataforma, e o
      // teaser (`ImovelGate`) dava menos do que a página pública `/leilao/:id` — que é
      // renderizada no servidor, abre sem JS, tem a ficha completa, a descrição do lote e o
      // convite de cadastro. Quem JÁ tem conta continua indo direto para a tela do app.
      // A escolha é feita no NAVEGADOR (script abaixo): a sessão do Supabase mora no
      // localStorage, então o servidor não tem como saber quem está logado — e um redirect
      // server-side erraria com metade das pessoas.
      destino = `/leilao/${id}`;
      titulo = 'Imóvel em leilão — BidPro Brasil';
      // A descrição do preview é a VITRINE do botão Compartilhar: é o que a pessoa de fora vê
      // no WhatsApp antes de decidir se abre. Área, desconto e data da praça entram porque são
      // o que faz alguém clicar, custam ZERO (a mesma leitura de sempre, um campo a mais no
      // select) e já são públicos na página `/leilao/:id` deste mesmo lote desde 02/08 —
      // nenhuma exposição nova. Endereço, edital, matrícula e análise seguem fora, como manda
      // a decisão de 08/08. (14/08, pedido do dono.)
      const rows = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=titulo,cidade,estado,bairro,area_m2,valor_minimo,valor_avaliacao,desconto_percentual,data_leilao,link_foto`);
      const im = rows?.[0];
      if (im) {
        titulo = `${im.titulo || 'Imóvel em leilão'} — BidPro Brasil`;
        const partes = [];
        const ondeE = [im.bairro, im.cidade].filter(Boolean).join(', ');
        if (ondeE) partes.push(`${ondeE}${im.estado ? '/' + im.estado : ''}`);
        if (Number(im.area_m2) > 0) partes.push(`${Math.round(im.area_m2)} m²`);
        const lance = fmtBRL(im.valor_minimo); if (lance) partes.push(`lance a partir de ${lance}`);
        const aval = fmtBRL(im.valor_avaliacao); if (aval) partes.push(`avaliação ${aval}`);
        const d = Math.round(Number(im.desconto_percentual) || 0); if (d > 0) partes.push(`${d}% abaixo da avaliação`);
        const praca = String(im.data_leilao || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (praca) partes.push(`praça em ${praca[3]}/${praca[2]}/${praca[1]}`);
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
<script>${tipo === 'imovel' && idOk ? `
// Quem tem sessão válida do Supabase (chave sb-<ref>-auth-token no localStorage) vai para a
// tela COMPLETA do app; os demais para a página pública do lote. Sessão EXPIRADA conta como
// visitante — mandar para o app só para cair no teaser é um passo a mais sem nada em troca.
(function () {
  var app = ${JSON.stringify(`/#/imovel/${id}`)}, publico = ${JSON.stringify(destino)}, logado = false;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      var s = JSON.parse(localStorage.getItem(k) || 'null');
      var exp = s && (s.expires_at || (s.currentSession && s.currentSession.expires_at));
      if (s && (!exp || Number(exp) * 1000 > Date.now())) { logado = true; break; }
    }
  } catch (e) { /* storage bloqueado (aba privada): trata como visitante */ }
  location.replace(logado ? app : publico);
})();` : `location.replace(${JSON.stringify(destino)});`}</script>
</head><body>Redirecionando… <a href="${esc(destino)}">continuar</a></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.status(200).send(html);
}
