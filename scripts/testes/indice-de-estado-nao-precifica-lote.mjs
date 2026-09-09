/**
 * npm run testar:indice — média de estado não vira valor de mercado de um lote.
 *
 * 09/09, dois relatórios do MESMO dia, os dois com o Índice BidPro em nível `estado`:
 *   Santa Mônica / Belo Horizonte, apto 44,98 m² → R$ 157.880 × avaliação R$ 301.000  (−48%)
 *   São Joaquim de Bicas/MG, casa 127,24 m²      → R$ 480.967 × avaliação R$ 196.000  (+145%)
 * Mesmo índice, mesmo estado, erro de 48% para baixo num caso e 145% para cima no outro —
 * 17 e 15 amostras para MINAS GERAIS INTEIRO. E `valorMercado` alimenta o TETO DE LANCE.
 *
 * Este teste vigia as três coisas que quebram sozinhas:
 *   (a) a régua (allowlist, para que um rótulo NOVO não passe a precificar em silêncio);
 *   (b) o servidor de fato usar a régua no fallback, e não a comparação solta de antes;
 *   (c) a tela e o servidor usarem a MESMA régua — foi a divergência de regra duplicada que
 *       produziu metade dos defeitos desta base.
 */
import { readFileSync } from 'node:fs';
import { indicePrecifica, indiceApenasContexto, rotuloNivelIndice, NIVEIS_QUE_PRECIFICAM } from '../../src/lib/indice-precifica.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nA RÉGUA');
checa('bairro precifica', indicePrecifica({ nivel: 'bairro', venda_m2: 5000 }));
checa('grid (entorno) precifica', indicePrecifica({ nivel: 'grid', venda_m2: 5000 }));
checa('cidade precifica', indicePrecifica({ nivel: 'cidade', venda_m2: 5000 }));
checa('estado NÃO precifica (o caso de BH)', !indicePrecifica({ nivel: 'estado', venda_m2: 3900, n_amostras: 17 }));
checa('uf NÃO precifica — é "estado" com outra etiqueta, e o RPC indice_bidpro_regiao a devolve',
  !indicePrecifica({ nivel: 'uf', venda_m2: 4200 }));
checa('rótulo desconhecido NÃO precifica (allowlist, não denylist)',
  !indicePrecifica({ nivel: 'mesorregiao', venda_m2: 4200 }));
checa('sem venda_m2 não precifica nem sendo bairro', !indicePrecifica({ nivel: 'bairro', venda_m2: 0 }));
checa('índice ausente não quebra', indicePrecifica(null) === false && indicePrecifica(undefined) === false);
checa('maiúscula/espaço não burlam a régua', indicePrecifica({ nivel: ' Cidade ', venda_m2: 5000 }));
checa('ESTADO em maiúscula continua fora', !indicePrecifica({ nivel: 'ESTADO', venda_m2: 3900 }));

console.log('\nCONTEXTO É O QUE SOBRA — NÃO É "NÃO TEM ÍNDICE"');
checa('estado com valor vira contexto', indiceApenasContexto({ nivel: 'estado', venda_m2: 3900 }));
checa('cidade com valor NÃO é só contexto', !indiceApenasContexto({ nivel: 'cidade', venda_m2: 3900 }));
checa('sem índice nenhum não é contexto', !indiceApenasContexto(null) && !indiceApenasContexto({ nivel: 'estado', venda_m2: 0 }));
checa('as duas são mutuamente exclusivas', ['bairro', 'grid', 'cidade', 'estado', 'uf', 'xpto'].every(
  (nivel) => { const i = { nivel, venda_m2: 100 }; return indicePrecifica(i) !== indiceApenasContexto(i); }));

console.log('\nRÓTULOS PARA A TELA');
checa('grid vira "entorno" (o cliente não sabe o que é grid)', rotuloNivelIndice('grid') === 'entorno');
checa('uf e estado dizem a mesma palavra', rotuloNivelIndice('uf') === 'estado' && rotuloNivelIndice('estado') === 'estado');
checa('vazio não imprime rótulo em branco', rotuloNivelIndice(null) === 'indefinido');

console.log('\nO SERVIDOR USA A RÉGUA (e não a comparação solta de antes)');
{
  const src = readFileSync(new URL('../../api/gerar-analise.js', import.meta.url), 'utf8');
  checa('gerar-analise importa a régua', /from '\.\.\/src\/lib\/indice-precifica\.js'/.test(src));
  checa('o fallback que define valorMercado passa por indicePrecifica(...)',
    /indicePrecifica\(mercado\.indiceBidPro\)[\s\S]{0,120}?valorMercado = Math\.round\(indiceVenda/.test(src));
  checa('não sobrou o gate antigo "indiceVenda > 0 &&" abrindo o fallback',
    !/!\(precoM2 > 0\) && indiceVenda > 0 && areaSeg > 0/.test(src));
  checa('semIndice também respeita a régua (senão o cliente clica de novo à toa)',
    /e\.semIndice = !indicePrecifica\(/.test(src));
  checa('o caso amplo deixa rastro para a tela (indiceAmploNaoPrecifica)',
    /mercado\.indiceAmploNaoPrecifica = \{/.test(src));
}

console.log('\nA TELA LÊ O MESMO RASTRO');
{
  const tela = readFileSync(new URL('../../src/pages/Analise.jsx', import.meta.url), 'utf8');
  checa('Analise.jsx mostra o painel de índice amplo', /mercado\.indiceAmploNaoPrecifica &&/.test(tela));
  checa('e avisa que a cota não foi cobrada', /não foi cobrado por este relatório/i.test(tela));
}

console.log('\nA RÉGUA NÃO SE AMPLIA SEM QUE ALGUÉM VEJA');
checa('a allowlist tem exatamente bairro, grid e cidade',
  JSON.stringify(NIVEIS_QUE_PRECIFICAM) === JSON.stringify(['bairro', 'grid', 'cidade']), NIVEIS_QUE_PRECIFICAM);

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
