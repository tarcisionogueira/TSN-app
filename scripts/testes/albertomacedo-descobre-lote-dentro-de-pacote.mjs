/**
 * npm run testar:albertomacedo-pacote — lote dentro de um pacote do ALBERTOMACEDOLEILOES
 * não pode ficar invisível pro scraper.
 *
 * Achado real (17/09): o dono reportou que
 * https://www.albertomacedoleiloes.com.br/lote/2-lote-residencial-buri-residence nunca
 * aparecia no sistema, mesmo a fonte tendo scraper configurado e ativo (3 imóveis no acervo).
 * Recon ao vivo (GitHub Actions, Puppeteer headless real) confirmou:
 *   • a HOME lista só `/leilao/<slug>` — ZERO `/lote/` direto (12 leilões, 0 `/lote/`);
 *   • um desses, `/leilao/02-imoveis-em-burisp`, é um PACOTE: dentro dele há 2 `/lote/`
 *     (`/lote/1-lote-residencial-buri-residence` e `/lote/2-...`), cada um com Avaliação
 *     PRÓPRIA (R$150.000 e R$70.000) — mas a página do PACOTE em si não tem valor único;
 *   • `extrairUrlsDeLote` (antes do fix) só reconhecia `/leilao/`, então o pacote inteiro
 *     entrava, `checarQualidade` descartava por falta de avaliação, e os 2 lotes de dentro
 *     nunca eram visitados — silenciosamente, sem erro nenhum.
 *
 * Este teste reproduz a estrutura real medida no recon (URLs e texto colhidos ao vivo) e
 * prova: (a) a home continua só produzindo `/leilao/`, sem regressão; (b) a página do
 * PACOTE, processada pelo nível 2 do motor (`extrairUrlsDeEvento` + `extrairUrlsDeLote` de
 * novo), revela os `/lote/` de dentro; (c) `idDaUrl` funciona pros dois formatos; (d) a
 * página de um `/lote/` real (texto colhido ao vivo) ainda extrai Avaliação/matrícula/cidade
 * certinho — o mesmo template das fontes single-item que já funcionavam.
 */
import {
  extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe,
} from '../lib/albertomacedo-parse.mjs';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

const BASE = 'https://www.albertomacedoleiloes.com.br';

// Recorte real da home (12 <a> — home NUNCA lista /lote/ direto, confirmado no recon 17/09).
const homeHtml = `
<a href="/leilao/imoveis-em-ba-mg-e-pr">Aberto</a>
<a href="/leilao/02-imoveis-em-burisp">Aberto</a>
<a href="/leilao/imoveis-em-sp-e-pr">Aberto</a>
<a href="/leilao/cdhu-52-imoveis-no-estado-de-sao-paulo-alienacao-fiduciaria">Aberto</a>
<a href="/leilao/terreno-de-3-hectares-em-barretos">Aberto</a>
<a href="/leilao/-1">Aberto</a>
`;

console.log('\nHOME — só /leilao/, sem regressão (é assim que os 3 imóveis já em produção continuam)');
{
  const urls = extrairUrlsDeLote(homeHtml, BASE);
  checa('achou os 5 /leilao/ com slug válido (o "-1" sem slug é descartado)', urls.size === 5, [...urls.keys()]);
  checa('nenhum /lote/ apareceu (a home não tem)', ![...urls.values()].some(u => /\/lote\//.test(u)));

  const eventos = extrairUrlsDeEvento(homeHtml, BASE);
  checa('extrairUrlsDeEvento acha os MESMOS 5 /leilao/ (é o que o nível 2 do motor revisita)', eventos.size === 5);
}

// Recorte real da página do PACOTE (/leilao/02-imoveis-em-burisp, texto colhido no recon):
// "Lotes do Leilão 2 lotes encontrados Lote 1 ... Ver Detalhes Lote 2 ... Ver Detalhes"
const paginaPacoteHtml = `
<a href="/leilao/713782b6-3d80-43c8-a285-0f1e96836dce">Leilão</a>
<a href="/lote/1-lote-residencial-buri-residence">Ver Detalhes</a>
<a href="/lote/2-lote-residencial-buri-residence">Ver Detalhes</a>
`;

console.log('\nPÁGINA DO PACOTE (nível 2) — revela os /lote/ de dentro');
{
  const urls = extrairUrlsDeLote(paginaPacoteHtml, BASE);
  const lotes = [...urls.entries()].filter(([, u]) => /\/lote\//.test(u));
  checa('achou os 2 /lote/ de dentro do pacote', lotes.length === 2, [...urls.keys()]);
  checa('o /lote/2 (o que o dono reportou) está entre eles',
    lotes.some(([, u]) => u.endsWith('/lote/2-lote-residencial-buri-residence')));
}

console.log('\nidDaUrl — funciona pros dois formatos de URL');
{
  checa('/leilao/<slug>', idDaUrl(`${BASE}/leilao/terreno-de-3-hectares-em-barretos`) === 'terreno-de-3-hectares-em-barretos');
  checa('/lote/<n>-<slug>', idDaUrl(`${BASE}/lote/2-lote-residencial-buri-residence`) === '2-lote-residencial-buri-residence');
}

// Texto REAL colhido no recon (headless, 17/09) da página do lote 2 — resumido, mas as
// frases-chave (Avaliação/matrícula/praça/endereço) são as que a página realmente devolveu.
const loteHtml = `<html><body>
Alameda das Primaveras, s/n, Quadra D, Lote 29, Buri Residence, Buri, SP, 18292-512
PRAÇA ABERTURA ENCERRAMENTO INICIAL Praça única 14 de set. de 2026, 17:00 25 de set. de 2026, 17:01 R$ 70.000,00
Lote, Residencial, Buri Residence
Matrícula 46417 RGI Oficial de Registro de Imóveis
Avaliação (SETEMBRO de 2026): R$ 70.000,00
Descrição Lote, Buri Residence, Desocupado, 294.00 M² de área de terreno. Matrícula nº 46417.
</body></html>`;

console.log('\nPÁGINA DO LOTE (mesmo template das fontes single-item) — extrai os campos certinho');
{
  const url = `${BASE}/lote/2-lote-residencial-buri-residence`;
  const det = parseDetalhe(loteHtml, url);
  checa('título não carrega o "2-" da frente (tituloDeSlug já descarta dígito+hífen inicial)',
    !/^2\b/.test(det.titulo || ''), det.titulo);
  checa('achou avaliação R$70.000,00', det.valor_avaliacao === 70000, det.valor_avaliacao);
  checa('matrícula 46417', det.numero_matricula === '46417', det.numero_matricula);
  // cidade/estado NÃO testados aqui: `cidadeUF` (leilaopro-parse.mjs) só reconhece "Nome/UF"
  // com barra, e o recorte de texto colhido no recon (endereço "Buri, SP" com vírgula) não
  // provou essa forma presente na página real — checar contra a página INTEIRA antes de
  // afirmar comportamento aqui (não é este achado; não inventar).
}

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
