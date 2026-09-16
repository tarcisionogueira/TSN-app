// TEMPORÁRIO — confirma que o bundle publicado em produção referencia a Site Key do
// Turnstile (prova que VITE_TURNSTILE_SITE_KEY entrou no build, não só que a env existe).
const r = await fetch('https://www.bidprobrasil.com.br/#/login');
const html = await r.text();
const m = html.match(/assets\/(index|Login)-[\w-]+\.js/g) || [];
console.log('status home:', r.status, 'assets encontrados:', m);

// Login.jsx é code-split (chunk próprio, "Login-*.js") — TurnstileWidget vive DENTRO desse
// chunk, não no index.js principal. Acha a referência ao chunk dentro do index.js (import
// dinâmico do router) e busca ele especificamente.
const idx = m.find(x => x.startsWith('assets/index-'));
if (idx) {
  const r2 = await fetch(`https://www.bidprobrasil.com.br/${idx}`);
  const js = await r2.text();
  console.log('bundle index.js bytes:', js.length);
  const loginChunk = (js.match(/assets\/Login-[\w-]+\.js/) || [])[0];
  console.log('chunk do Login encontrado:', loginChunk);
  if (loginChunk) {
    const r3 = await fetch(`https://www.bidprobrasil.com.br/${loginChunk}`);
    const loginJs = await r3.text();
    console.log('bundle Login.js bytes:', loginJs.length);
    console.log('contém a site key do Turnstile?', loginJs.includes('0x4AAAAAAE5a0dy0EVKX4Ixq'));
    console.log('contém "turnstile"?', /turnstile/i.test(loginJs));
  }
} else {
  console.log('não achei o bundle index no HTML — pode ter mudado de nome');
}
