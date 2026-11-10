/**
 * GET /feed-produtos.xml — lista de produtos (RSS 2.0 do Google Merchant Center) dos e-books ATIVOS e pagos.
 *
 * 09/11 (dono): quer o e-book na vitrine de compras do Google ("livro leilão" → carrossel com capa, preço e loja).
 * Essa vitrine (listagens gratuitas do Google Shopping) lê o Merchant Center; este endereço é o que se cadastra lá
 * como "feed programado". Cada item aponta para a página do produto montada no servidor (api/publico.js), que tem o
 * mesmo preço em JSON-LD Product — o Merchant Center confere os dois. Produto grátis fica de fora (não é venda).
 */
export const config = { runtime: 'nodejs', maxDuration: 15 };

const SITE = 'https://www.bidprobrasil.com.br';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
// Título do feed com o ASSUNTO (10/11): o Shopping casa a busca ("livro leilão") principalmente pelo título, e dois
// dos três e-books não tinham a palavra "leilão" no nome. A página do produto segue com o título original.
const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function ler(tabela, tipo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?ativo=eq.true&gratuito=eq.false&select=id,titulo,descricao,capa_url,preco`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`${tabela} HTTP ${r.status}`);
  return (await r.json()).filter((p) => Number(p.preco) > 0 && p.capa_url).map((p) => ({ ...p, tipo }));
}

export default async function handler(req, res) {
  try {
    // Só e-book: o Google Shopping não aceita serviço, e curso online arrisca reprovação que pesa na conta.
    // Os cursos aparecem no Google pela página com JSON-LD Course (api/publico.js).
    const itens = await ler('ebooks_admin', 'ebook');
    const corpo = itens.map((p) => {
      const desc = String(p.descricao || p.titulo).replace(/\s+/g, ' ').trim().slice(0, 4900);
      return `<item>
<g:id>${xml(`${p.tipo}-${p.id}`)}</g:id>
<title>${xml(`${p.titulo} — E-book sobre leilão de imóveis`.slice(0, 150))}</title>
<description>${xml(desc)}</description>
<link>${xml(`${SITE}/${p.tipo}/${p.id}/${slug(p.titulo)}`)}</link>
<g:image_link>${xml(p.capa_url)}</g:image_link>
<g:availability>in_stock</g:availability>
<g:price>${Number(p.preco).toFixed(2)} BRL</g:price>
<g:condition>new</g:condition>
<g:brand>BidPro Brasil</g:brand>
<g:identifier_exists>no</g:identifier_exists>
<g:google_product_category>784</g:google_product_category>
<g:product_type>${p.tipo === 'ebook' ? 'Livros &gt; E-books &gt; Leilão de imóveis' : 'Educação &gt; Cursos online &gt; Leilão de imóveis'}</g:product_type>
<g:is_bundle>no</g:is_bundle>
</item>`;
    }).join('\n');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>BidPro Brasil — Cursos e e-books</title><link>${SITE}/educacao</link><description>E-books e cursos sobre leilão de imóveis</description>
${corpo}
</channel></rss>`);
  } catch (e) {
    // Falha de leitura NÃO devolve feed vazio: o Merchant Center tiraria todos os produtos do ar. 500 = ele tenta depois.
    console.error('[feed-produtos]', e?.message || e);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send('indisponível');
  }
}
