// Teste do leitor do Comprei (PGFN) — #185. Campos do bem de uma resposta real de
// /gateway/anuncio/visitar/75694 (08/10), sem os dados do corretor.
import { idAnuncioComprei, fichaComprei } from '../lib/comprei-pgfn.mjs';

let ok = 0, falhou = 0;
const caso = (nome, r, esperado) => {
  if (JSON.stringify(r) === JSON.stringify(esperado)) ok++;
  else { falhou++; console.log(`✗ ${nome}\n  esperado ${JSON.stringify(esperado)}\n  veio     ${JSON.stringify(r)}`); }
};

const real = {
  id: 75694, cep: 38301088, idBem: 1231005, juizo: '01-VARA CIVEL-FRUTAL', bairro: 'Maria Vilela', ufSigla: 'MG',
  cartorio: '21.293.410/0001-48 - ITUIUTABA CARTORIO DO 1 OFICIO DE REG DE IMOVEIS', gravames: true,
  matricula: ' 9330 a 9332', processos: ['13361613020098130271'], bemVendido: false,
  logradouro: 'Tupaciguara - - De 399 Ao Fim - Lado Impar - De 399 Ao Fim Lado Impar', numeroEndereco: 's/n°', tipoLogradouro: 'R',
  observacaoGravames: '9.330- Hipoteca (R-07), Ajuizamento (Av-08)\n9.331- Hipoteca (R-08)',
};

caso('id da url', idAnuncioComprei('https://comprei.pgfn.gov.br/anuncio/detalhe/75694'), '75694');
caso('url sem anúncio', idAnuncioComprei('https://globoleiloes.com.br/leiloes/x/3290'), null);
caso('ficha real', fichaComprei(real), {
  endereco: 'Rua Tupaciguara, s/n', bairro: 'Maria Vilela', cep: '38301088', numero_matricula: '9330 a 9332',
  numero_processo: '13361613020098130271', vendido: false,
  bloco: 'Dados do Comprei (PGFN): Matrícula(s): 9330 a 9332 — Cartório: 21.293.410/0001-48 - ITUIUTABA CARTORIO DO 1 OFICIO DE REG DE IMOVEIS — Processo: 13361613020098130271 — Juízo: 01-VARA CIVEL-FRUTAL — Ônus na matrícula: 9.330- Hipoteca (R-07), Ajuizamento (Av-08); 9.331- Hipoteca (R-08).',
});
caso('cep com zero à esquerda', fichaComprei({ id: 1, cep: 1026001 }).cep, '01026001');
caso('avenida com número', fichaComprei({ id: 1, tipoLogradouro: 'AV', logradouro: 'Brasil', numeroEndereco: '120' }).endereco, 'Avenida Brasil, 120');
caso('sem logradouro não inventa', fichaComprei({ id: 1, matricula: '123' }).endereco, '');
caso('vendido', fichaComprei({ id: 1, bemVendido: true }).vendido, true);
caso('resposta de erro', fichaComprei({ status: 401, error: 'Unauthorized' }), null);

console.log(`${falhou ? '✗' : '✓'} ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
