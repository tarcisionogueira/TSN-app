import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { Buffer } from 'buffer';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = 'imoveis-fotos';
// 18/09: virou GALERIA (era só a capa) — pedido do dono, CEF é 72% do acervo ativo
// (a maior fonte, de longe) e é onde o padrão "risco de acessão/benfeitoria" (área
// construída não averbada) mais aparece — o cruzamento com foto no relatório
// documental só funciona se houver mais de uma foto pra olhar. Cada propriedade
// agora faz VÁRIOS uploads (1 por foto da galeria), então o lote por rodada cai —
// era 250 (1 upload cada), o tempo por item aumentou.
const BATCH_SIZE = 120;
const MAX_FOTOS_POR_IMOVEL = 8;
const PAGE_TIMEOUT = 15000;
const DELAY_MS = 600;

// Antes retornava a PRIMEIRA <img> que batesse no padrão — agora retorna TODAS (dedup por
// src), pra virar galeria. Mesmo critério de sempre: CEF usa src com "foto"/"Foto"/"imovel",
// e o fallback (tamanho>100, sem logo/ícone/banner) cobre o resto.
// 21/09: devolve o MOTIVO junto (mesmo princípio já aplicado no diagnóstico do SOLD) — um
// `catch { return [] }` cego não deixa distinguir "página bloqueou/redirecionou" de "imóvel
// realmente sem foto na Caixa", e foi exatamente essa falta de motivo que impediu confirmar
// se o "5 bloqueios seguidos" (achado 21/09, rodando de casa) é bloqueio de verdade ou outra
// coisa (captcha, redirect, detecção de headless) — de datacenter E de IP residencial deu o
// mesmo resultado, contrariando a suposição inicial de bloqueio por reputação de IP.
async function extrairFotosUrls(page, numero) {
  let resp;
  try {
    const url = `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${numero}`;
    resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    // 21/09 (achado ao vivo, rodando de casa): "0 imgs" vinha com HTTP 200 e título certo,
    // sem redirect nenhum — não é bloqueio, a página carrega normal. A galeria da Caixa
    // provavelmente é preenchida por JS depois do DOMContentLoaded; `domcontentloaded` não
    // espera isso. Dá uma folga curta antes de ler o DOM.
    await new Promise(r => setTimeout(r, 2500));
  } catch (e) {
    return { srcs: [], motivo: `erro: ${e?.message || e}` };
  }

  const status = resp?.status();
  const urlFinal = resp?.url();
  let titulo = '';
  try {
    const srcs = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const vistos = new Set();
      const ordenados = [];
      const bate = (s) => s && (
        s.includes('foto') || s.includes('Foto') ||
        s.includes('imovel') || s.includes('FotoImovel') ||
        s.includes('/fotos/')
      );
      for (const img of imgs) {
        const s = img.src || '';
        if (bate(s) && !vistos.has(s)) { vistos.add(s); ordenados.push(s); }
      }
      if (ordenados.length) return ordenados;
      // Fallback: nenhuma bateu no padrão — pega candidatas genéricas (mesmo critério de antes).
      const candidates = imgs.filter(i => {
        const s = i.src || '';
        return s.startsWith('http') &&
          !s.includes('logo') && !s.includes('icon') &&
          !s.includes('banner') && !s.includes('btn') &&
          !s.includes('gif') && i.width > 100 && !vistos.has(s);
      });
      return candidates.map(c => c.src);
    });
    titulo = await page.title().catch(() => '');
    const lista = Array.isArray(srcs) ? srcs.slice(0, MAX_FOTOS_POR_IMOVEL) : [];
    if (lista.length) return { srcs: lista, motivo: null };
    return { srcs: [], motivo: `0 imgs (HTTP ${status ?? '?'}, título "${titulo}", url final ${urlFinal})` };
  } catch (e) {
    return { srcs: [], motivo: `erro no evaluate (HTTP ${status ?? '?'}): ${e?.message || e}` };
  }
}

// Ganhou `indice`: cada foto da galeria precisa de um path próprio no Storage
// (`cef/${fonteId}_1.ext`, `_2.ext`...) — sem isto a 2ª foto sobrescreveria a 1ª.
async function uploadFoto(imgUrl, fonteId, indice) {
  try {
    const res = await fetch(imgUrl, {
      headers: {
        'Referer': 'https://venda-imoveis.caixa.gov.br/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 500) return null;

    const path = `cef/${fonteId}_${indice}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType, upsert: true,
    });
    if (error) return null;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

async function limparFotosExpiradas() {
  const noventa = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // `imoveis_leilao` não tem coluna `arrematado` (esse conceito vive em analises_mercado/
  // analises_documental/analises_laudo/arrematados) — o filtro devolvia 400 do PostgREST,
  // e sem checar `error` isso virava "nenhuma foto expirada" em toda execução (bug bounty
  // 03/09). `ativo=false` + idade de `atualizado_em` já cobrem "fora do acervo há 90 dias".
  const { data, error } = await supabase
    .from('imoveis_leilao')
    .select('fonte_id, link_foto, fotos')
    .eq('fonte', 'CEF')
    .eq('ativo', false)
    .lt('atualizado_em', noventa)
    .or('link_foto.not.is.null,fotos.not.is.null');
  if (error) { console.error('limparFotosExpiradas falhou:', error.message); return; }

  if (!data?.length) return;

  // Path derivado da URL pública (`cef/<fonte_id>...`), cobre tanto o `link_foto` isolado
  // (formato antigo) quanto cada entrada de `fotos` (galeria) — mesmo bucket, mesmo prefixo.
  const paths = new Set();
  for (const im of data) {
    for (const u of [im.link_foto, ...(Array.isArray(im.fotos) ? im.fotos : [])]) {
      if (u?.includes(SUPABASE_URL)) {
        const p = u.split(`${BUCKET}/`)[1];
        if (p) paths.add(p);
      }
    }
  }

  if (paths.size) await supabase.storage.from(BUCKET).remove([...paths]);
  console.log(`🗑️  ${paths.size} fotos expiradas removidas do Storage`);
}

async function main() {
  console.log(`\n📸 Scraper de GALERIA de fotos CEF — ${new Date().toISOString()}\n`);

  // Alvo: imóveis CEF ativos que AINDA não têm galeria capturada — cobre tanto quem nunca
  // teve foto quanto quem só tem a capa (`link_foto`) hotlinkada pelo scraper principal
  // (`api/scraper-caixa.js`, que só traz 1 foto do feed). `fotos` fica null até este
  // script rodar pela primeira vez naquele imóvel; depois disso, mesmo que a galeria
  // encontrada tenha só 1 foto, ela é gravada — não reprocessa à toa.
  const { data: imoveis, error } = await supabase
    .from('imoveis_leilao')
    .select('id, fonte_id, link_foto')
    .eq('fonte', 'CEF')
    .eq('ativo', true)
    .is('fotos', null)
    .limit(BATCH_SIZE);

  if (error) { console.error('Erro ao buscar imóveis:', error.message); process.exit(1); }
  if (!imoveis?.length) {
    console.log('Nenhum imóvel CEF sem galeria. Verificando limpeza...');
    await limparFotosExpiradas();
    return;
  }

  console.log(`Processando ${imoveis.length} imóveis...\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  let salvos = 0;
  let bloqueados = 0;

  for (const im of imoveis) {
    const numero = im.fonte_id.replace('cef_', '');
    const { srcs: urlsGaleria, motivo } = await extrairFotosUrls(page, numero);

    if (!urlsGaleria.length) {
      bloqueados++;
      console.log(`  ⚠️  ${im.fonte_id}: sem foto — ${motivo}`);
      // Se bloqueou 5 seguidos provavelmente IP bloqueado — para
      if (bloqueados >= 5) {
        console.log('⚠️  5 falhas seguidas — encerrando (ver motivos acima).');
        break;
      }
      continue;
    }

    bloqueados = 0; // reset contador de bloqueios
    const fotosArmazenadas = [];
    for (let i = 0; i < urlsGaleria.length; i++) {
      const storedUrl = await uploadFoto(urlsGaleria[i], im.fonte_id, i + 1);
      if (storedUrl) fotosArmazenadas.push(storedUrl);
    }

    if (fotosArmazenadas.length) {
      // `link_foto` só é sobrescrito se ainda não existia — a capa hotlinkada pelo
      // scraper principal continua servindo normalmente, não precisa trocar.
      const patch = { fotos: fotosArmazenadas };
      if (!im.link_foto) patch.link_foto = fotosArmazenadas[0];
      await supabase.from('imoveis_leilao').update(patch).eq('id', im.id);
      salvos++;
      if (salvos % 10 === 0) console.log(`  ${salvos} galerias salvas...`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await browser.close();
  await limparFotosExpiradas();

  console.log(`\n✅ Concluído: ${salvos}/${imoveis.length} galerias salvas\n`);
  if (salvos === 0) {
    console.log('ℹ️  Nenhuma galeria salva — CEF possivelmente bloqueia IPs do GitHub Actions.');
    console.log('   Solução alternativa: rodar scraper de foto localmente ou via VPS.');
  }
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
