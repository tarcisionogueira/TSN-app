// _temp: recon descartável — confirma o formato real da API FIPE gratuita (deividfortuna/fipe)
// antes de escrever o casamento marca/modelo. Não grava nada; só imprime no log do Actions.
const BASE = 'https://fipe.parallelum.com.br/api/v2';

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  const texto = await r.text();
  console.log(`\nGET ${path} -> status ${r.status}`);
  console.log(texto.slice(0, 2000));
  if (!r.ok) return null;
  try { return JSON.parse(texto); } catch { return null; }
}

const marcas = await get('/cars/brands');
if (Array.isArray(marcas)) {
  console.log(`\ntotal marcas: ${marcas.length}`);
  const alvo = ['volkswagen', 'chevrolet', 'fiat', 'mercedes', 'gm'];
  console.log('amostra relevante:', marcas.filter(m => alvo.some(a => String(m.name || m.nome || '').toLowerCase().includes(a))));
}

const vw = (marcas || []).find(m => /volks|vw/i.test(m.name || m.nome || ''));
if (vw) {
  const modelos = await get(`/cars/brands/${vw.code || vw.codigo}/models`);
  if (Array.isArray(modelos)) {
    console.log(`\ntotal modelos VW: ${modelos.length}`);
    console.log('amostra Gol:', modelos.filter(m => /gol\b/i.test(m.name || m.nome || '')).slice(0, 10));
    const gol = modelos.find(m => /gol\b/i.test(m.name || m.nome || ''));
    if (gol) {
      const anos = await get(`/cars/brands/${vw.code || vw.codigo}/models/${gol.code || gol.codigo}/years`);
      if (Array.isArray(anos) && anos.length) {
        const ano = anos[0];
        await get(`/cars/brands/${vw.code || vw.codigo}/models/${gol.code || gol.codigo}/years/${ano.code || ano.codigo}`);
      }
    }
  }
}
console.log('\nrecon-fipe-api: fim.');
