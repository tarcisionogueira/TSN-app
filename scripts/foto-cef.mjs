import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { Buffer } from 'buffer';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = 'imoveis-fotos';
const BATCH_SIZE = 250;
const PAGE_TIMEOUT = 15000;
const DELAY_MS = 600;

async function extrairFotoUrl(page, numero) {
  try {
    const url = `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${numero}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

    const src = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      for (const img of imgs) {
        const s = img.src || '';
        // CEF usa src com "foto", "Foto", "imovel" ou blob dinâmico
        if (s && (
          s.includes('foto') || s.includes('Foto') ||
          s.includes('imovel') || s.includes('FotoImovel') ||
          s.includes('/fotos/')
        )) return s;
      }
      // Fallback: primeira imagem que não seja logo/ícone
      const candidates = imgs.filter(i => {
        const s = i.src || '';
        return s.startsWith('http') &&
          !s.includes('logo') && !s.includes('icon') &&
          !s.includes('banner') && !s.includes('btn') &&
          !s.includes('gif') && i.width > 100;
      });
      return candidates[0]?.src || null;
    });

    return src || null;
  } catch {
    return null;
  }
}

async function uploadFoto(imgUrl, fonteId) {
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

    const path = `cef/${fonteId}.${ext}`;
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
    .select('fonte_id, link_foto')
    .eq('fonte', 'CEF')
    .eq('ativo', false)
    .lt('atualizado_em', noventa)
    .not('link_foto', 'is', null);
  if (error) { console.error('limparFotosExpiradas falhou:', error.message); return; }

  if (!data?.length) return;

  const paths = data
    .filter(im => im.link_foto?.includes(SUPABASE_URL))
    .map(im => im.link_foto.split(`${BUCKET}/`)[1])
    .filter(Boolean);

  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  console.log(`🗑️  ${paths.length} fotos expiradas removidas do Storage`);
}

async function main() {
  console.log(`\n📸 Scraper de fotos CEF — ${new Date().toISOString()}\n`);

  // Busca imóveis CEF sem foto no Storage
  const { data: imoveis, error } = await supabase
    .from('imoveis_leilao')
    .select('id, fonte_id, link_foto')
    .eq('fonte', 'CEF')
    .eq('ativo', true)
    .is('link_foto', null)
    .limit(BATCH_SIZE);

  if (error) { console.error('Erro ao buscar imóveis:', error.message); process.exit(1); }
  if (!imoveis?.length) {
    console.log('Nenhum imóvel CEF sem foto. Verificando limpeza...');
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
    const imgUrl = await extrairFotoUrl(page, numero);

    if (!imgUrl) {
      bloqueados++;
      // Se bloqueou 5 seguidos provavelmente IP bloqueado — para
      if (bloqueados >= 5) {
        console.log('⚠️  5 bloqueios seguidos — CEF pode estar bloqueando o IP. Encerrando.');
        break;
      }
      continue;
    }

    bloqueados = 0; // reset contador de bloqueios
    const storedUrl = await uploadFoto(imgUrl, im.fonte_id);
    if (storedUrl) {
      await supabase.from('imoveis_leilao').update({ link_foto: storedUrl }).eq('id', im.id);
      salvos++;
      if (salvos % 10 === 0) console.log(`  ${salvos} fotos salvas...`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await browser.close();
  await limparFotosExpiradas();

  console.log(`\n✅ Concluído: ${salvos}/${imoveis.length} fotos salvas\n`);
  if (salvos === 0) {
    console.log('ℹ️  Nenhuma foto salva — CEF possivelmente bloqueia IPs do GitHub Actions.');
    console.log('   Solução alternativa: rodar scraper de foto localmente ou via VPS.');
  }
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
