/**
 * npm run testar:cidade-slug — `cidadeUFDeSlug` não trunca a cidade no conector INTERNO ao
 * próprio nome dela.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Achado real (07/09, construindo o parser da JELEILOES): o slug
 * "imovel-c-10-alq-em-nova-america-da-colina-pr" saía com `cidade: "Colina"` — o `.*` guloso
 * antes de "(?:em|de|do|da|no|na)" pega o ÚLTIMO conector da string, e "Nova América da
 * Colina" (município real do Paraná) TEM um "da" dentro do próprio nome. A regex parava aí e
 * devolvia só o pedaço depois do último "da".
 *
 * NÃO é caso hipotético: é um município real, e a mesma ambiguidade vale para qualquer nome
 * composto com "da/do/de" embutido (comum em português — "Conceição do Mato Dentro", "Santo
 * Antônio de Jesus" etc.). Cidade errada (não nula) é PIOR que cidade nula: passa no filtro de
 * qualidade e chega ao geocode/relatório com a localização errada, sem nenhum sinal de alerta.
 *
 * O CONSERTO: tentar "em/no/na" (quase nunca aparece DENTRO de um nome de cidade brasileiro,
 * quase sempre é o separador tipo→cidade) ANTES de "de/do/da" (que aparece nos dois papéis).
 * Isto NÃO pode regredir o caso que a função já acertava (comentário original, ALFA 21/08):
 * "leilao-de-fazenda-em-manhumirim-mg" → cidade "Manhumirim", não "Fazenda Em Manhumirim".
 */
import { cidadeUFDeSlug } from '../lib/dom-parse-util.mjs';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nCIDADE COMPOSTA COM CONECTOR INTERNO — não pode truncar no "da/do/de" de dentro do nome');
checa('"nova-america-da-colina" (JELEILOES, real) → cidade inteira, não só "Colina"',
  (() => { const r = cidadeUFDeSlug('imovel-c-10-alq-em-nova-america-da-colina-pr');
    return r.cidade === 'Nova America da Colina' && r.estado === 'PR'; })(),
  cidadeUFDeSlug('imovel-c-10-alq-em-nova-america-da-colina-pr'));

console.log('\nNÃO REGREDIR O CASO JÁ CORRIGIDO (ALFA, 21/08)');
checa('"leilao-de-fazenda-em-manhumirim-mg" → cidade "Manhumirim", não "Fazenda Em Manhumirim"',
  (() => { const r = cidadeUFDeSlug('leilao-de-fazenda-em-manhumirim-mg');
    return r.cidade === 'Manhumirim' && r.estado === 'MG'; })(),
  cidadeUFDeSlug('leilao-de-fazenda-em-manhumirim-mg'));

console.log('\nSEM CONECTOR RECONHECÍVEL OU SEM UF VÁLIDA → null (não inventa)');
checa('sem conector nem UF de 2 letras → cidade/estado null',
  (() => { const r = cidadeUFDeSlug('123-bem-generico-sem-padrao');
    return r.cidade === null && r.estado === null; })());
checa('"sigla" de 2 letras que não é UF real → null (não finge sigla)',
  (() => { const r = cidadeUFDeSlug('leilao-em-cidade-xx'); return r.estado === null; })());

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 4) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
