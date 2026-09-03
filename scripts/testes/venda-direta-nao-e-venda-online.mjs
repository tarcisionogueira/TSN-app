/**
 * npm run testar:modalidade-cef — venda direta não é venda online, e praça única não é 1ª praça.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ACHADO DO DONO (03/09, com print): um imóvel CEF em Santana de Parnaíba/SP — Rua Morisot,
 * anunciado pela PRÓPRIA CAIXA como "Venda Online" (com contador de encerramento na página do
 * lote) — aparecia na ficha do BidPro como "Venda Direta". `normalizarModalidadeCEF` (aqui:
 * scripts/scraper.js, a fonte de verdade do acervo CEF — `api/scraper-caixa.js` é o scraper
 * ANTIGO de índice fixo, já substituído, ver comentário em api/trigger-scraper.js) empilhava
 * as duas em 'venda_direta' de propósito ("vendas sem data (contínuas)"). Mas venda direta é
 * compra imediata sem prazo, e venda online tem prazo/contador publicado pela Caixa — são
 * coisas DIFERENTES para o cliente, e a regra do dono é literal: "a classificação deve ser de
 * acordo como está no leiloeiro que o disponibiliza".
 *
 * Mesmo raciocínio pediu a separação de "praça única" (leilão datado, com edital) de "1ª
 * praça" — não pode virar sinônimo de uma coisa que não é.
 *
 * O que NÃO mudou (documentado aqui para não regredir por engano): venda_direta e venda_online
 * continuam tratadas como a MESMA coisa para fins de DOCUMENTO exigido (as duas usam o PDF
 * padrão "Regras da Venda Online" da Caixa, nunca um edital de leilão) e de EXIGÊNCIA DE DATA
 * no fluxo (nenhuma das duas tem praça/edital) — só o RÓTULO de exibição diverge. Ver
 * `ehVendaSemPraca` em scripts/scraper.js e os regex /venda_(direta|online)/ nos demais
 * arquivos que decidem isso (api/enriquecer-lote.js, src/utils/leilaoEncerrado.js,
 * src/pages/Analise.jsx, src/pages/ImovelDetalhe.jsx, api/gerar-documental.js).
 */
import { normalizarModalidadeCEF } from '../scraper.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};
const eq = (raw, esperado, rotulo) => {
  const r = normalizarModalidadeCEF(raw);
  checa(rotulo ?? JSON.stringify(raw), r === esperado, { obtido: r, esperado });
};

console.log('\nVENDA DIRETA ≠ VENDA ONLINE — o caso exato do print (Rua Morisot, Tambore)');
eq('Venda Direta', 'venda_direta', '"Venda Direta" pura');
eq('Venda Direta Online', 'venda_online', '"Venda Direta Online" (rótulo real do CSV) é venda online, não direta');
eq('Venda Online', 'venda_online', '"Venda Online" pura');
eq('VENDA ONLINE', 'venda_online', 'maiúsculas não mudam o resultado');
eq('venda direta', 'venda_direta', 'minúsculas — venda direta sem "online" continua venda_direta');

console.log('\nPRAÇA ÚNICA ≠ 1ª PRAÇA');
eq('Praça Única', 'praca_unica', '"Praça Única" pura');
eq('1ª Praça', 'primeiro_leilao', '1ª praça continua 1ª praça (não vira praça única)');
eq('2º Leilão', 'segundo_leilao', '2º leilão continua 2ª praça');

console.log('\nRESTO DO CONJUNTO CANÔNICO SEGUE INTACTO (não regrediu com a mudança)');
eq('Licitação Aberta', 'licitacao_aberta', 'licitação aberta');
eq('Leilão SFI - Edital Único', 'extrajudicial', 'leilão/praça genérico cai em extrajudicial');
eq('', 'extrajudicial', 'texto vazio cai no fallback seguro (nunca descarta o lote)');
eq(null, 'extrajudicial', 'null cai no fallback seguro');

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 11) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
