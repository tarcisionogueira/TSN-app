// Roda todos os `testar:*` do package.json que não precisam de navegador nem de credencial
// (05/10, pendência 77): eram 95 scripts e o CI rodava 0 deles. Medido no sandbox sem env:
// 93 passam; os 2 que falham são de navegador (Playwright + app no ar) e ficam de fora aqui.
// Teste novo entra sozinho — só o que precisa de navegador vai para a lista abaixo.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PRECISA_NAVEGADOR = new Set(['testar:landing-aula', 'testar:filtros-veiculos']);
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const alvos = Object.keys(scripts).filter((k) => k.startsWith('testar:') && !PRECISA_NAVEGADOR.has(k));

const falhas = [];
for (const k of alvos) {
  const r = spawnSync('npm', ['run', '-s', k], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    falhas.push(k);
    console.log(`✗ ${k}\n${(r.stdout || '').slice(-1500)}${(r.stderr || '').slice(-1500)}`);
  }
}
console.log(`\n${alvos.length - falhas.length}/${alvos.length} testes passaram${falhas.length ? ` — falharam: ${falhas.join(', ')}` : ''}`);
process.exit(falhas.length ? 1 : 0);
