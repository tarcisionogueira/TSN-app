// ANEXO QUE MORA NO LEILOEIRO (07/10) — casos REAIS do acervo, medidos antes de escrever a regra.
// O relato do dono foi "não consigo abrir os anexos": o "Edital" e a "Matricula" do galpão de Feira
// de Santana devolviam alert "Anexo sem arquivo". As duas linhas têm `storage_path` nulo e
// `origem_url` apontando para o PDF público do leiloeiro — o documento existia o tempo todo.
import assert from 'node:assert/strict';
import { linkExternoDoAnexo } from '../../api/_anexo-externo.js';

const S3 = 'https://s3-sa-east-1.amazonaws.com/906de634c48fb7d34136160b4c353ae4/public/anexo/4165671786458292.pdf';

// 1) Edital/matrícula do leiloeiro: sem arquivo nosso, com endereço → abre o link.
assert.equal(linkExternoDoAnexo({ storage_path: null, url: null, origem_url: S3 }), S3);

// 2) Arquivo NOSSO: nunca cai no link. `url` aqui é uma signed URL de 1h já vencida (é por isso
//    que `doc-url.js` assina na hora) — devolvê-la seria recriar o bug que ele veio consertar.
assert.equal(linkExternoDoAnexo({ storage_path: 'arrematacoes/x/y.pdf', url: `${S3}?token=vencido`, origem_url: S3 }), null);

// 3) Marcador sem arquivo em lugar nenhum (≈30 mil linhas em 07/10): null, e o leitor responde
//    "o leiloeiro não disponibilizou", não "anexo sem arquivo" — que lia como defeito nosso.
assert.equal(linkExternoDoAnexo({ storage_path: null, url: null, origem_url: null }), null);

// 4) Só vale http(s): `javascript:` gravado por engano não vira link clicável.
assert.equal(linkExternoDoAnexo({ storage_path: null, url: 'javascript:alert(1)', origem_url: null }), null);
assert.equal(linkExternoDoAnexo({ storage_path: null, url: null, origem_url: '  ' }), null);
assert.equal(linkExternoDoAnexo(null), null);

// 5) `origem_url` tem precedência sobre `url` (o externo estável vem antes do que pode ter vencido).
assert.equal(linkExternoDoAnexo({ storage_path: null, url: 'https://outro/arquivo.pdf', origem_url: S3 }), S3);

console.log('anexo-link-externo: todos os casos passaram');
