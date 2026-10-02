// npm run testar:doc-blocos — qualquer formato aceito no upload vira bloco legível para a IA
// (02/10: matrícula em FOTO chegava à IA rotulada de PDF). E o que não abre volta com motivo.
import assert from 'node:assert/strict';
import { blocosDoArquivo } from '../../api/_doc-blocos.js';
import { detectarArquivoAceito } from '../../api/_tipo-arquivo.js';
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };

const sharp = (await import('sharp')).default;
const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
let r = await blocosDoArquivo(png, { nome: 'matricula.png' });
assert.equal(r.blocos[0]?.type, 'image'); ok('foto PNG → bloco image (não "document" PDF)');

r = await blocosDoArquivo(Buffer.from('%PDF-1.4\n' + 'x'.repeat(500)), { nome: 'edital.pdf' });
assert.equal(r.blocos[0]?.type, 'document'); ok('PDF → bloco document');

r = await blocosDoArquivo(Buffer.from('MATRÍCULA 12.345 — Imóvel: apartamento 101, Rua das Flores, 200. '.repeat(5)), { nome: 'matricula.txt' });
assert.equal(r.blocos[0]?.type, 'text'); assert.match(r.blocos[0].text, /Rua das Flores/); ok('texto .txt → bloco text com o conteúdo');

const JSZip = (await import('jszip')).default;
const z = new JSZip();
z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Contrato de compra e venda do imóvel situado na Rua das Palmeiras, 50, em Feira de Santana, com área de 300 m².</w:t></w:r></w:p></w:body></w:document>');
const docx = await z.generateAsync({ type: 'nodebuffer' });
assert.equal(detectarArquivoAceito(docx, 'contrato.docx').ext, 'docx');
r = await blocosDoArquivo(docx, { nome: 'contrato.docx' });
assert.equal(r.blocos[0]?.type, 'text'); assert.match(r.blocos[0].text, /Palmeiras/); ok('Word .docx → aceito no upload e lido como texto');

r = await blocosDoArquivo(Buffer.from([0, 1, 2, 3, 0, 5, 6]), { nome: 'x.bin' });
assert.equal(r.blocos.length, 0); assert.ok(r.falhas[0]); ok('binário desconhecido → nenhum bloco, falha COM motivo');

assert.equal(detectarArquivoAceito(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'a.doc').ok, false);
ok('Word antigo .doc → recusado no upload com instrução (salvar como .docx/PDF)');
console.log(`\n✓ doc-blocos: ${n} casos`);
