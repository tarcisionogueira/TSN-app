// Classificação de documento pelo conteúdo (api/_doc-tipo.js) — textos no formato real.
import assert from 'node:assert/strict';
import { classificarTipoPorTexto as c } from '../../api/_doc-tipo.js';

const pad = ' texto de corpo '.repeat(20);
assert.equal(c('40ª Vara Cível do Foro Central Cível Edital de 1° e 2° leilão de bem imóvel e para intimação de Fulano, objeto da matrícula nº 12.345 do 4º Registro de Imóveis' + pad), 'edital');
assert.equal(c('EDITAL DE LEILÃO PÚBLICO EXTRAJUDICIAL. O leiloeiro oficial torna público… imóvel matriculado sob nº 98.765 no Registro de Imóveis' + pad), 'edital');
assert.equal(c('REPÚBLICA FEDERATIVA DO BRASIL 2º OFICIAL DE REGISTRO DE IMÓVEIS DE SÃO PAULO LIVRO Nº 2 - REGISTRO GERAL MATRÍCULA 45.678 FICHA 01 IMÓVEL: apartamento nº 12… R.1/45.678 - VENDA' + pad), 'matricula');
assert.equal(c('CNM: 123456.2.0045678-90 Matrícula nº 45678 … AV-1-45678 averbação … R-2-45678 alienação fiduciária' + pad), 'matricula');
assert.equal(c('LAUDO DE AVALIAÇÃO do imóvel situado à Rua X, matrícula 1.234' + pad), 'laudo');
assert.equal(c('Termo de Penhora lavrado nos autos' + pad), null);
assert.equal(c('curto'), null);
console.log('✓ doc-tipo: 7 casos');
