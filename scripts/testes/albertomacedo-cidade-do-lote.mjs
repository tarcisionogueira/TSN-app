// Cidade da Alberto Macedo: votação entre "Cidade - UF"/"Cidade/UF" da página (validados no IBGE)
// e a cidade do slug. Trechos REAIS do recon de 23/09 (lote Onda Verde/SP).
import assert from 'node:assert/strict';
import { cidadeDoLote, cidadeDoSlug } from '../lib/albertomacedo-parse.mjs';

const onda = 'Uma casa residencial, localizada em Onda Verde – SP com área construída de 52,36 m² município de Onde Verde – SP '
  + 'Registro de Imóveis de Nova Granada - SP RG SSP/SP SSP/SP Município de Onda Verde - SP Localização Rua Nestor Pestana, 125, São Paulo - SP';
assert.deepEqual(cidadeDoLote(onda, '2-uma-casa-residencial-localizada-na-rua-jose-antonio-caldas-nr935-qg-l004-onda-verde-sp-com-area-construida-de-5236-m'),
  { cidade: 'Onda Verde', estado: 'SP' });                       // nem "Ssp", nem o escritório (São Paulo)
assert.deepEqual(cidadeDoSlug('cnp-seguradora-imovel-em-sete-lagoasmg'), { cidade: 'Sete Lagoas', estado: 'MG' });
assert.deepEqual(cidadeDoSlug('02-imoveis-em-burisp'), { cidade: 'Buri', estado: 'SP' });
assert.equal(cidadeDoSlug('1-area-rural-centro-itajacuru'), null);
assert.deepEqual(cidadeDoLote('Estado UF AC - Acre AL - Alagoas SP - São Paulo', 'x'), { cidade: null, estado: null }); // menu lateral não vira cidade
console.log('albertomacedo-cidade-do-lote: todos os casos passaram');
