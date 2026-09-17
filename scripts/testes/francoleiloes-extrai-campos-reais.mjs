/**
 * npm run testar:francoleiloes — o parser do FRANCOLEILOES extrai os campos certos do texto
 * REAL colhido no recon (17/09, lote 9728 — Apartamento, São Paulo/SP, GitHub Actions,
 * Puppeteer headless com isolarSessao). Não inventa nada além do que a página realmente
 * devolveu: sem rótulo de "Avaliação" separado (só "Lance Mínimo"), sem modalidade no corpo
 * (vem do slug da URL), matrícula com prefixo "CNM:" entre o rótulo e o número.
 */
import { extrairUrlsDeLote, idDaUrl, parseDetalhe } from '../lib/francoleiloes-parse.mjs';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

const BASE = 'https://www.francoleiloes.com.br';

// Recorte real da HOME (17/09) — <a> reais achados via $$eval pós-JS, mesmo leilão-slug se
// repetindo em vários lotes ("leilao-banco-inter"), confirma que o ID tem que ser o número.
const homeHtml = `
<a href="https://www.francoleiloes.com.br/lote/leilao-banco-inter/9728/">Aberto para lance</a>
<a href="https://www.francoleiloes.com.br/lote/leilao-banco-inter/9734/">Aberto para lance</a>
<a href="/lote/leilao-judicial-tjmg/8566/">Leilão Online</a>
<a href="/lote/leilao-judicial-tjmg/9225/">Leilão Online</a>
`;

console.log('\nHOME — descobre os lotes, ID pelo número (slug do leilão se repete)');
{
  const urls = extrairUrlsDeLote(homeHtml, BASE);
  checa('achou os 4 lotes (2 leilões diferentes)', urls.size === 4, [...urls.keys()]);
  checa('idDaUrl pega o número, não o slug', idDaUrl(`${BASE}/lote/leilao-banco-inter/9728/`) === '9728');
}

console.log('\nMODALIDADE — vem do slug da URL (não tem no corpo do texto)');
{
  checa('"leilao-banco-inter" → extrajudicial',
    parseDetalhe('<html><body>nada</body></html>', `${BASE}/lote/leilao-banco-inter/9728/`).modalidade === 'extrajudicial');
  checa('"leilao-judicial-tjmg" → judicial',
    parseDetalhe('<html><body>nada</body></html>', `${BASE}/lote/leilao-judicial-tjmg/8566/`).modalidade === 'judicial');
}

// Texto REAL do corpo renderizado (recon 17/09, lote 9728) — trecho fiel, sem inventar rótulo
// de avaliação que a página não tinha.
const textoReal = `Login | Cadastrar QUEM SOMOS CONTATO DÚVIDAS BLOG Home Residenciais Leilão Banco Inter
Leilão Banco Inter São Paulo/SP - Vila Gomes Cardim - Apartamento com 425m² Avise-me sobre a
abertura Fale com o especialista Adicionar aos Favoritos São Paulo/SP - Vila Gomes Cardim -
Apartamento com 425m² Residenciais | Cód do leilão: 02226/LOTE 004 ONLINE Praça Única Abertura
11/09/2026 - 09:00 Fechamento 25/09/2026 - 10:00 R$ 6.046.287,22 Tempo para o Fechamento da
Praça Única 07 dias 21 horas 30 min 40 seg Aceita Financiamento Aberto para lance Lance
Mínimo: R$ 6.046.287,22 Lance atual: Incremento: R$ 30.000,00 Comissão do Leiloeiro: 5,00%
ÁREA DE LANCES AUTOMÁTICO SALA DO LEILÃO HABILITAR NO LEILÃO Descrição INFORMAÇÕES Endereço:
Rua Antonio Camardo, nº 593, Apto nº 321, Condomínio Edifício Amedeo Modigliani, Vila Gomes
Cardim, 27º subdistrito – Tatuapé, São Paulo/SP Área privativa: 425,23m² Vagas de garagem: 07
DESCRIÇÃO DO IMÓVEL Apartamento nº 321, localizado no 32º andar do Condomínio Edifício Amedeo
Modigliani, e caracterizado na matrícula abaixo mencionada. Imóvel objeto da Matrícula CNM:
113779, situado na Rua Antonio Camardo, nº 593, na Vila Gomes Cardim, 27º subdistrito –
Tatuapé, São Paulo/SP, contendo uma área real privativa de 425,23m².`;
const htmlReal = `<html><head><title>São Paulo/SP - Vila Gomes Cardim - Apartamento com 425m² Apartamentos em leilão | Franco Leilões</title></head><body>${textoReal}
<a href="https://www.francoleiloes.com.br/preview/3ccaf68d-0fdd-46d5-b0bb-99b6d7261d55.pdf">Visualizar</a>
<a href="https://www.francoleiloes.com.br/download/3ccaf68d-0fdd-46d5-b0bb-99b6d7261d55.pdf">Baixar</a>
<a href="https://www.francoleiloes.com.br/preview/73dee847-f43d-4f2b-8525-39a8456ba864.pdf">Visualizar</a>
<a href="https://www.francoleiloes.com.br/download/73dee847-f43d-4f2b-8525-39a8456ba864.pdf">Baixar</a>
</body></html>`;

console.log('\nDETALHE (lote 9728, texto real) — extrai os campos certinho');
{
  const url = `${BASE}/lote/leilao-banco-inter/9728/`;
  const det = parseDetalhe(htmlReal, url);
  checa('título bate com o heading real (sem o sufixo de categoria/domínio)',
    det.titulo === 'São Paulo/SP - Vila Gomes Cardim - Apartamento com 425m²', det.titulo);
  checa('cidade São Paulo, estado SP', det.cidade === 'São Paulo' && det.estado === 'SP', det);
  checa('valor mínimo R$6.046.287,22 (via "Lance Mínimo:")', det.valor_minimo === 6046287.22, det.valor_minimo);
  checa('sem rótulo de avaliação separado → avaliação = mínimo (praça única, não inventa 2ª praça)',
    det.valor_avaliacao === det.valor_minimo, det);
  checa('matrícula 113779 (pula o "CNM:" entre o rótulo e o número)', det.numero_matricula === '113779', det.numero_matricula);
  checa('modalidade extrajudicial (slug "leilao-banco-inter")', det.modalidade === 'extrajudicial');
  checa('2 anexos únicos (só /download/, dedup do /preview/ — mesmo documento)', det.anexos.length === 2, det.anexos);
  checa('nenhum anexo classificado como edital/matrícula (UUID opaco, não inventa qual é qual)',
    det.anexos.every(a => a.tipo === 'outro') && !det.link_edital && !det.link_matricula);
}

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
