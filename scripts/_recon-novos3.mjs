// TEMPORÁRIO — recon rápido (fetch puro, ZERO Bright Data) de 3 leiloeiros candidatos
// achados no cruzamento EDITAL_DJEN (16/09, pedido do dono: "veja o site deles e faça a
// análise pra ver o grau de dificuldade de montar o scraper"). Só relatório, não grava nada.
const SITES = {
  SARAIVA: { base: 'https://saraivaleiloes.com.br', paths: ['/', '/imoveis', '/lotes/imoveis', '/leiloes', '/busca?categoria=imoveis'] },
  MARCOANTONIO: { base: 'https://marcoantonioleiloeiro.com.br', paths: ['/', '/imoveis', '/lotes/imoveis', '/leiloes', '/busca?categoria=imoveis'] },
  KLEILOES: { base: 'https://kleiloes.com.br', paths: ['/', '/imoveis', '/lotes/imoveis', '/leiloes', '/busca?categoria=imoveis'] },
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function assinatura(html) {
  const marcas = [];
  if (/cf-mitigated|Just a moment|__CF\$cv\$params|challenge-platform/i.test(html)) marcas.push('CLOUDFLARE_CHALLENGE');
  if (/leilao\.php\?idLeilao=|Gest[ãa]o de Leil[õo]es/i.test(html)) marcas.push('GESTAO_DE_LEILOES(PHP)');
  if (/stats\.suporteleiloes\.com\.br|static\.suporteleiloes\.com\.br/i.test(html)) marcas.push('SUPORTE_LEILOES(rede)');
  if (/leilaoindex|leilao-index/i.test(html)) marcas.push('LEILAOINDEX');
  if (/superbid|sbid\d/i.test(html)) marcas.push('SUPERBID_REDE');
  if (/wp-content|wordpress/i.test(html)) marcas.push('WORDPRESS');
  if (/window\.__NUXT__|_next\/static|__NEXT_DATA__/i.test(html)) marcas.push('SPA(NUXT/NEXT)');
  if (/<div id="root">\s*<\/div>|<div id="app">\s*<\/div>/i.test(html)) marcas.push('SPA(root-vazio)');
  return marcas;
}

async function main() {
  for (const [nome, cfg] of Object.entries(SITES)) {
    console.log(`\n════ ${nome} (${cfg.base}) ════`);
    for (const p of cfg.paths) {
      const url = cfg.base + p;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
        const html = await r.text();
        const marcas = assinatura(html);
        const temImovelTxt = /im[óo]vel|leil[ãa]o|matr[íi]cula|arremat/i.test(html);
        console.log(`  ${p} -> HTTP ${r.status} · ${html.length} bytes · marcas: [${marcas.join(', ') || 'nenhuma'}] · menciona imóvel/leilão: ${temImovelTxt}`);
      } catch (e) {
        console.log(`  ${p} -> ERRO: ${e.message}`);
      }
      await new Promise(res => setTimeout(res, 300));
    }
  }
}
main();
