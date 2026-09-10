/**
 * npm run testar:doc-teto — o teto de tamanho não pode recusar a matrícula que a IA leria.
 *
 * 10/09, pergunta do dono: "por que a IA não leu a matrícula para confirmar as informações
 * do lote?". Ela não leu porque NÓS recusamos o arquivo. A matrícula do terreno de Guarapari
 * tem 11,2 MB e o teto era 6 MB. O documento baixa normalmente (HTTP 200, application/pdf) e
 * é legível — 4 páginas, ZERO fontes, 383 imagens JPEG: escaneada. Sem camada de texto, a
 * VISÃO é o único caminho, e era justamente ele que o teto fechava. O relatório saiu com a
 * área do anúncio e o aviso "não confirmada na matrícula" — verdadeiro, e escondendo que a
 * recusa tinha sido nossa. É a forma nº 1 do CLAUDE.md com um disfarce novo: a nossa própria
 * trava entregue ao cliente como ausência de informação no documento.
 *
 * Medido em 11 matrículas do acervo: 0,2 · 0,4 · 0,4 · 0,5 · 0,7 · 1,6 · 2,3 · 3,6 · 11,2 ·
 * 15,2 · 15,6 MB. Três de onze acima de 6 MB.
 *
 * Este teste existe para o teto não voltar a encolher em silêncio, e para não crescer além do
 * que a API aceita — que seria trocar uma recusa nossa por um 400 do fornecedor.
 */
import { classificarDocumento, blocoParaIA, MAX_BYTES_VISAO } from '../../api/_doc-leitura.js';
import { readFileSync } from 'node:fs';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};
// PDF sintético do tamanho pedido: só os magic bytes importam para a classificação.
const pdfDe = (bytes) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, bytes - 9), 0x20)]);

console.log('\nOS TAMANHOS REAIS DO ACERVO (11 matrículas medidas em 10/09)');
for (const mb of [0.2, 0.4, 0.5, 0.7, 1.6, 2.3, 3.6, 11.2, 15.2, 15.6]) {
  const doc = classificarDocumento(pdfDe(Math.round(mb * 1e6)), { contentType: 'application/pdf' });
  checa(`matrícula de ${mb} MB é aceita`, doc.kind === 'pdf', doc.motivo);
}

console.log('\nO TETO NÃO PODE ENCOLHER — foi assim que 3 de 11 sumiram');
checa('o teto cobre o maior caso medido (15,6 MB) com folga', MAX_BYTES_VISAO >= 16_000_000, MAX_BYTES_VISAO);
checa('o teto de 6 MB de antes recusaria a matrícula de Guarapari',
  classificarDocumento(pdfDe(11_216_859), { contentType: 'application/pdf', maxBytes: 6_000_000 }).kind === 'desconhecido');
checa('e com o teto atual ela passa',
  classificarDocumento(pdfDe(11_216_859), { contentType: 'application/pdf' }).kind === 'pdf');

console.log('\nO TETO NÃO PODE CRESCER ALÉM DO QUE A API ACEITA');
{
  // base64 infla 4/3; a API da Anthropic aceita 32 MB por requisição. Estourar isso trocaria
  // a nossa recusa (que ao menos tem motivo) por um 400 do fornecedor no meio do relatório.
  const base64Max = MAX_BYTES_VISAO * 4 / 3;
  checa('documento no teto ainda cabe nos 32 MB da requisição', base64Max < 32_000_000, Math.round(base64Max / 1e6) + ' MB');
  checa('e sobra folga de pelo menos 5 MB para o resto do corpo', 32_000_000 - base64Max >= 5_000_000);
}

console.log('\nA RECUSA CONTINUA DIZENDO O MOTIVO (nunca vazio disfarçado de resposta)');
{
  const d = classificarDocumento(pdfDe(MAX_BYTES_VISAO + 1_000_000), { contentType: 'application/pdf' });
  checa('acima do teto vira desconhecido', d.kind === 'desconhecido');
  checa('com motivo legível e o tamanho dentro dele', /MB acima do limite/.test(d.motivo || ''), d.motivo);
  checa('e blocoParaIA devolve null (não manda lixo para a IA)', blocoParaIA(d, 'matricula') === null);
}

console.log('\nO TETO É UM SÓ — quatro números divergindo foi o que criou o buraco');
{
  const src = readFileSync(new URL('../../api/_edital-extrato.js', import.meta.url), 'utf8')
    + readFileSync(new URL('../../api/gerar-documental.js', import.meta.url), 'utf8');
  checa('nenhum chamador passa maxBytes próprio', !/classificarDocumento\([^)]*maxBytes:\s*\d/.test(src));
}

console.log('\nO ARQUIVO REAL, SE ESTIVER EM CACHE LOCAL (dry-run sobre dado de verdade)');
try {
  const buf = readFileSync(process.env.MATRICULA_REAL || '/tmp/nao-existe.pdf');
  const doc = classificarDocumento(buf, { contentType: 'application/pdf' });
  checa(`arquivo real de ${(buf.length / 1e6).toFixed(1)} MB é aceito`, doc.kind === 'pdf', doc.motivo);
  checa('e vira bloco document para a IA', blocoParaIA(doc, 'matricula')?.type === 'document');
} catch { console.log('  · (sem arquivo local — passe MATRICULA_REAL=<caminho> para rodar este trecho)'); }

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
