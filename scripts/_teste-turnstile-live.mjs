// TEMPORÁRIO — confirma que o bundle publicado em produção referencia a Site Key do
// Turnstile (prova que VITE_TURNSTILE_SITE_KEY entrou no build, não só que a env existe).
const r = await fetch('https://www.bidprobrasil.com.br/#/login');
const html = await r.text();
const m = html.match(/assets\/(index|Login)-[\w-]+\.js/g) || [];
console.log('status home:', r.status, 'assets encontrados:', m);

// O app é SPA (Vite) — o HTML inicial não muda por rota; precisamos abrir o JS principal
// (index-*.js) e procurar o SITE KEY (0x4AAAAAAE5a0dy0EVKX4Ixq) literal no bundle.
const idx = m.find(x => x.startsWith('assets/index-'));
if (idx) {
  const r2 = await fetch(`https://www.bidprobrasil.com.br/${idx}`);
  const js = await r2.text();
  console.log('bundle index.js bytes:', js.length);
  console.log('contém a site key do Turnstile?', js.includes('0x4AAAAAAE5a0dy0EVKX4Ixq'));
  console.log('contém "turnstile"?', /turnstile/i.test(js));
} else {
  console.log('não achei o bundle index no HTML — pode ter mudado de nome');
}
