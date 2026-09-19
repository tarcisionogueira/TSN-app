// RECON DESCARTÁVEL (19/09) — RODADA 4. Rodada 3 achou um objeto JSON embutido em algum
// <script> da página com valorAvaliacao/valorInicial/documentos[]/leiloeiro{} — muito mais
// robusto que regex sobre texto. Esta rodada isola o <script> inteiro, tenta JSON.parse e
// imprime a estrutura completa (chaves de topo + campos de interesse).
const BASE = 'https://www.leilaobrasil.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const c = new AbortController();
const t = setTimeout(() => c.abort(), 20000);
const r = await fetch(`${BASE}/eventos/leilao/apartamento-no-butanta/lote/24171/apartamento-no-butanta`,
  { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow' });
clearTimeout(t);
const html = await r.text();
console.log(`bytes=${html.length}`);

// Acha TODOS os <script> e testa cada um por "valorAvaliacao".
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
console.log(`total de <script> tags: ${scripts.length}`);
let achou = false;
for (let i = 0; i < scripts.length; i++) {
  const corpo = scripts[i][1];
  if (!corpo.includes('valorAvaliacao')) continue;
  achou = true;
  console.log(`\n=== script #${i} contém valorAvaliacao (${corpo.length} chars) ===`);
  console.log('--- primeiros 300 chars (achar o padrão de atribuição) ---');
  console.log(corpo.slice(0, 300));
  // Tenta achar um objeto JSON válido dentro do corpo: procura "= {" ou ": {" e tenta
  // parsear a partir dali até o fim, cortando ; ou </script> se precisar.
  const mAtrib = corpo.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/) || corpo.match(/(\{[\s\S]*\})/);
  if (mAtrib) {
    try {
      const obj = JSON.parse(mAtrib[1]);
      console.log('\n--- JSON.parse OK. Chaves de topo: ---');
      console.log(Object.keys(obj).join(', '));
      for (const campo of ['titulo', 'descricao', 'cidade', 'uf', 'endereco', 'localizacaoLatitude', 'localizacaoLongitude', 'matricula', 'numeroMatricula', 'comitente', 'leiloeiro', 'documentos', 'fotos', 'imagens', 'valorAvaliacao', 'valorInicial', 'valorInicial2', 'valorMinimo', 'dataAbertura1', 'dataFechamento1', 'dataAbertura2', 'dataFechamento2', 'tipo', 'modalidade', 'areaM2', 'area']) {
        if (campo in obj) console.log(`  ${campo}: ${JSON.stringify(obj[campo]).slice(0, 300)}`);
      }
    } catch (e) {
      console.log(`\nJSON.parse FALHOU: ${String(e.message).slice(0, 200)}`);
      console.log('--- últimos 300 chars do corpo (achar onde corta) ---');
      console.log(corpo.slice(-300));
    }
  } else {
    console.log('Não achei um padrão de objeto JSON reconhecível neste script.');
  }
}
if (!achou) console.log('NENHUM <script> continha "valorAvaliacao" — o achado da rodada 3 deve estar noutro lugar (atributo data-*?).');

console.log('\n✅ recon rodada 4 concluído.');
