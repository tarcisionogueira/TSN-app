/**
 * npm run testar:fatos-multi-lote — enriquecer a ficha a partir do PDF não pode vazar
 * identidade/matrícula de OUTRO lote do mesmo documento.
 *
 * Achado real (14/09, TORRES3, item 31 do HANDOFF): `publicarFatosDoPdf`
 * (scripts/captura-documentos.mjs) lia o PDF do edital INTEIRO, sem isolar por lote — um
 * edital judicial multi-lote gravou endereço "Rua Aristopho Saadi, Arapiraca/AL" e área
 * 534,60 m² num imóvel que é, de verdade, "São Joaquim de Bicas/MG" (área real 127,24 m²).
 * `api/_edital-extrato.js` já resolvia exatamente esse problema para o mercadológico via
 * `isolarBlocoDoLote` — o bug era ela nunca ter sido chamada aqui.
 *
 * Este teste reproduz o formato real (2 lotes, cada um com sua Avaliação e endereço) e prova
 * duas coisas: (a) com o valor do imóvel de destino, `isolarBlocoDoLote` isola só o bloco
 * certo; (b) sem valor conhecido (chamador não tem valor_minimo/valor_avaliacao ainda, ou
 * documento de lote único), o comportamento cai para o texto inteiro — igual a antes, sem
 * regressão pros milhares de documentos de lote único que já funcionavam.
 */
import { isolarBlocoDoLote } from '../../api/_edital-extrato.js';
import { extrairIdentidadeTexto } from '../../api/_doc-extracao.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

// Mesma forma do achado real: 2 lotes, cada um com "Lote N" + Avaliação + endereço próprio.
const editalMultiLote = `
EDITAL DE LEILÃO JUDICIAL — VÁRIOS LOTES, MESMO PROCESSO

Lote 1
Avaliação: R$ 300.000,00
Imóvel situado na Rua Aristopho Saadi, Arapiraca/AL, área privativa 534,60 m².

Lote 2
Avaliação: R$ 150.000,00
Imóvel situado na Rua das Palmeiras, São Joaquim de Bicas/MG, área privativa 127,24 m².
`;

console.log('\nCOM valor conhecido do imóvel — isola o bloco certo');
{
  // Imóvel de destino é o Lote 2 (avaliação 150.000) — isolarBlocoDoLote precisa achar
  // o bloco que CASA com esse valor, não o primeiro do documento.
  const bloco = isolarBlocoDoLote(editalMultiLote, { valorMinimo: 0, valorAvaliacao: 150000 });
  checa('achou um bloco (não null)', !!bloco);
  checa('o bloco é o do Lote 2, não o do Lote 1', /S[ãa]o Joaquim de Bicas/i.test(bloco || ''));
  checa('o bloco NÃO contém o endereço do Lote 1', !/Aristopho Saadi|Arapiraca/i.test(bloco || ''), bloco);

  const identidade = extrairIdentidadeTexto(bloco);
  checa('extrairIdentidadeTexto sobre o bloco isolado não cita Arapiraca',
    !JSON.stringify(identidade || {}).match(/Aristopho|Arapiraca/i), identidade);
}

console.log('\nSEM isolar (mesmo texto, direto — é o bug reproduzido)');
{
  const identidadeSemIsolar = extrairIdentidadeTexto(editalMultiLote);
  // Prova que o bug É REAL neste texto de teste (se isto passasse a não vazar mais sozinho,
  // o teste acima pararia de provar que o isolamento é NECESSÁRIO).
  checa('sem isolamento, o texto inteiro VAZA o logradouro do Lote 1 (é o defeito original)',
    JSON.stringify(identidadeSemIsolar || {}).includes('Aristopho Saadi'), identidadeSemIsolar);
}

console.log('\nSEM valor conhecido — cai pro texto inteiro, sem regressão em documento de lote único');
{
  const doc = `EDITAL DE LEILÃO — LOTE ÚNICO, PROCESSO Nº 0001234-56.2026.8.26.0000.
Avaliação: R$ 220.000,00. Imóvel situado na Rua Central, 45, Bauru/SP, área privativa 80 m².`;
  const bloco = isolarBlocoDoLote(doc, {});
  checa('documento de lote único devolve null (usa o texto inteiro, igual a antes)', bloco === null);
  const identidade = extrairIdentidadeTexto(bloco || doc);
  checa('e a identidade do lote único continua saindo normal', /Rua Central/i.test(JSON.stringify(identidade || {})));
}

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
