// #371 (16/11): cidade do slug do LOTE da família SUPORTE — URLs reais do acervo.
import assert from 'node:assert/strict';
import { cidadeDoSlugLote as f } from '../lib/cidade-slug-lote.mjs';
const B = 'https://bessaleiloes.com.br/eventos/leilao/leilao-judicial-de-gov-valadares-mg/lote/';
assert.deepEqual(f(`${B}321/apto-no-centro-de-gov-valadares-701`), { cidade: 'Governador Valadares', estado: 'MG' });
// Sem acento: o IBGE local guarda o nome normalizado (o acervo já tem 642 "Sao Paulo" e os filtros normalizam).
assert.deepEqual(f('https://valeroleiloes.com.br/eventos/leilao/x/lote/1548/apto-71-c-383m-condominio-edificio-castelbianco-higienopolis-sao-paulo'), { cidade: 'Sao Paulo', estado: 'SP' });
// O evento é a comarca (Ipatinga); o bem está em Trancoso, distrito de Porto Seguro — sem cidade é melhor que Ipatinga.
assert.deepEqual(f('https://bessaleiloes.com.br/eventos/leilao/leilao-judicial-de-ipatinga-mg/lote/327/50-de-casa-alto-padrao-em-trancoso-ba'), { cidade: null, estado: null });
// Sem lugar no slug do lote → nada (o "gov-valadares-mg" do EVENTO não conta).
assert.deepEqual(f(`${B}317/apto-no-edificio-coelho-martins`), { cidade: null, estado: null });
assert.deepEqual(f(`${B}316/apto-1001`), { cidade: null, estado: null });
// "<cidade>-<uf>" no lote.
assert.deepEqual(f('https://x.com.br/eventos/leilao/y/lote/9/casa-em-uba-mg'), { cidade: 'Uba', estado: 'MG' });
// Evento que NÃO é foro nomeia o bem ("na-cidade-de-bage" — "cidade de" aceita nome de uma palavra); evento de comarca não.
assert.deepEqual(f('https://peterlongo.leilao.br/eventos/leilao/venda-direta-de-terreno-na-cidade-de-bage/lote/9/lote-02-terreno-urbano'), { cidade: 'Bage', estado: 'RS' });
assert.deepEqual(f('https://leiloesmonteiro.com.br/eventos/leilao/venda-direta-da-comarca-de-guarabira-pb/lote/4801/01-um-imovel-lote-65'), { cidade: null, estado: null });
// "em-sarandi": existe no RS e no PR — palavra só, sem UF, fica sem cidade.
assert.deepEqual(f('https://peterlongo.leilao.br/eventos/leilao/venda-direta-de-terras-em-sarandi/lote/6372/20648'), { cidade: null, estado: null });
console.log('ok — cidade do slug do lote: Gov. Valadares, São Paulo pelo fim do slug; comarca do evento e distrito ignorados');
