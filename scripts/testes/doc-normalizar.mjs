// npm run testar:doc-normalizar — "ler o arquivo do leiloeiro independente de formato" (01/10).
// Gera os arquivos aqui mesmo (sem rede) e confere que cada formato que a IA não lê nativamente
// ganha uma rota de leitura — e que o que não abre volta com MOTIVO, nunca como "lido".
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { normalizarDocumento } from '../../api/_doc-normalizar.js';
const sharp = (await import('sharp')).default;
function lixoZip() { return Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 7) % 256)); }
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };

const pixel = { create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 50, b: 50 } } };

// TIFF (matrícula digitalizada em scanner antigo) → JPEG
const tiff = await sharp(pixel).tiff().toBuffer();
const rt = await normalizarDocumento(tiff, { url: 'x.tif' });
assert.equal(rt.kind, 'imagem'); assert.equal(rt.mediaType, 'image/jpeg'); assert.ok(rt.base64.length > 100);
ok('TIFF vira JPEG legível pela IA');

// BMP → JPEG (sharp não grava BMP; monta o cabeçalho à mão, 2×2 px 24 bits)
const bmp = Buffer.alloc(70); bmp.write('BM', 0, 'latin1'); bmp.writeUInt32LE(70, 2); bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(2, 18); bmp.writeInt32LE(2, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(16, 34);
const rb = await normalizarDocumento(bmp, { url: 'x.bmp' });
assert.ok(rb.kind === 'imagem' || (rb.kind === 'ilegivel' && rb.motivo), 'BMP: convertido ou com motivo');
ok(`BMP → ${rb.kind}${rb.motivo ? ` (${rb.motivo})` : ''}`);

// JPEG enorme (acima do teto de bytes) → reduzido
const grande = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg({ quality: 100 }).toBuffer();
const big = Buffer.concat([grande, Buffer.alloc(Math.max(0, 19_000_000 - grande.length))]); // força > 18 MB
const rg = await normalizarDocumento(big, { url: 'x.jpg' });
assert.equal(rg.kind, 'imagem'); assert.ok(Buffer.from(rg.base64, 'base64').length < 18_000_000);
ok('JPEG acima de 18 MB é reduzido e lido');

// DOCX real mínimo (zip com word/document.xml), montado com a lib de zip do próprio mammoth
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const z = new JSZip();
z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>EDITAL DE LEILÃO JUDICIAL. Primeira praça em 10/11/2026 pelo valor da avaliação de R$ 350.000,00; segunda praça em 24/11/2026 por 60% da avaliação. Comissão do leiloeiro de 5%.</w:t></w:r></w:p></w:body></w:document>');
const docx = await z.generateAsync({ type: 'nodebuffer' });
const rd = await normalizarDocumento(docx, { url: 'edital.docx' });
assert.equal(rd.kind, 'texto'); assert.match(rd.texto, /Primeira praça em 10\/11\/2026/);
ok('DOCX vira texto (edital em Word)');

// ZIP com documentos dentro → PACOTE, cada arquivo lido pela mesma rota
const pac = new JSZip(); pac.file('edital.docx', docx); pac.file('matricula.tif', tiff); pac.file('lixo.bin', lixoZip());
const rp = await normalizarDocumento(await pac.generateAsync({ type: 'nodebuffer' }), { url: 'docs.zip' });
assert.equal(rp.kind, 'pacote'); assert.equal(rp.itens.length, 2); assert.equal(rp.falhas.length, 1);
assert.deepEqual(rp.itens.map((i) => i.kind).sort(), ['imagem', 'texto']);
ok('ZIP com edital (DOCX) + matrícula (TIFF) + lixo → pacote com os 2 legíveis e a falha registrada');

// ZIP só com texto curto → ilegível COM motivo
const zz = new JSZip(); zz.file('a.txt', 'oi');
const rz = await normalizarDocumento(await zz.generateAsync({ type: 'nodebuffer' }), { url: 'docs.zip' });
assert.equal(rz.kind, 'ilegivel'); assert.ok(rz.motivo);
ok(`ZIP sem documento → ilegível com motivo ("${rz.motivo.slice(0, 50)}…")`);

// Binário qualquer → ilegível COM motivo (nunca "lido")
const lixo = Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 7) % 256));
const rl = await normalizarDocumento(lixo, { url: 'x.bin' });
assert.equal(rl.kind, 'ilegivel'); assert.ok(rl.motivo);
ok('binário desconhecido → ilegível com motivo');

// PDF e JPEG normais continuam pela rota nativa (sem conversão)
const jpg = await sharp(pixel).jpeg().toBuffer();
const rj = await normalizarDocumento(jpg, { url: 'x.jpg' });
assert.equal(rj.kind, 'imagem'); assert.equal(rj.convertido, undefined);
ok('JPEG comum segue nativo, sem conversão');

console.log(`\n✓ doc-normalizar: ${n} casos`);
