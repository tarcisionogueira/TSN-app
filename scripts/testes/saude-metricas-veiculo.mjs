// metricasColeta (05/10): linha de VEÍCULO usa link_lote e fotos[] — antes media link/foto 0% sempre
// (NORDESTE_VEICULOS desde 30/09). Linha de imóvel continua medida igual.
import assert from 'node:assert/strict';
import { metricasColeta } from '../_saude-fonte.mjs';

const veic = metricasColeta([
  { estado: 'BA', valor_minimo: 5000, link_lote: 'https://nordesteleiloes.com.br/lotes/1', fotos: ['https://x/a.png'] },
  { estado: 'BA', valor_minimo: 7000, link_lote: 'https://nordesteleiloes.com.br/lotes/2' },
]);
assert.deepEqual([veic.link_pct, veic.foto_pct, veic.uf_pct], [1, 0.5, 1]);
const imov = metricasColeta([
  { estado: 'SP', valor_minimo: 100000, link_edital: 'https://x/edital.pdf', link_foto: 'https://x/f.jpg' },
  { estado: 'SP', valor_minimo: 100000, url_lote: 'https://x/lote', fotos: [] },
]);
assert.deepEqual([imov.link_pct, imov.foto_pct], [1, 0.5]);   // fotos [] vazio não conta como foto
console.log('saude-metricas-veiculo: todos os casos passaram');
