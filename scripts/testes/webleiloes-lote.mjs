/**
 * npm run testar:webleiloes — o card e a URL do WEBLEILÕES depois da reestruturação do site
 * (07/10). TODOS os casos abaixo são texto e href REAIS, copiados do recon na página viva
 * (_temp-recon-webleiloes, 07/10 22:25) — a lição de 12/08 é que contar campo preenchido não
 * valida nada; o que valida é bater com o que a fonte publica.
 */
import assert from 'node:assert/strict';
import { loteDaUrl, pracasDoCard, mapaCardWebLeiloes, caminhoDoHref, descartarFotoGenerica } from '../lib/webleiloes-lote.mjs';

// ─── A URL NOVA ───────────────────────────────────────────────────────────────────────────
const U1 = '/imoveis/casas/sp/itapetininga/casa-em-condominio-44m2-vila-belo-horizonte-itapetininga-sp-25931';
const u1 = loteDaUrl(U1);
assert.equal(u1.id, '25931');
assert.equal(u1.categoria, 'casas');
assert.equal(u1.uf, 'SP');
assert.equal(u1.cidade, 'Itapetininga');
assert.equal(u1.url, 'https://www.webleiloes.com.br' + U1);
// Absoluta e relativa dão o MESMO lote — a página traz as duas formas para o mesmo card, e
// contá-las como lotes diferentes dobraria o acervo.
assert.equal(loteDaUrl('https://www.webleiloes.com.br' + U1).id, '25931');
assert.equal(loteDaUrl('https://www.webleiloes.com.br' + U1).url, loteDaUrl(U1).url);
// Categorias vistas no acervo real
for (const [u, cat] of [
  ['/imoveis/glebas/sp/sorocaba/gleba-de-terras-1437m2-fazenda-genebra-sorocaba-sp-25884', 'glebas'],
  ['/imoveis/imoveis-rurais/sp/guararema/sitio-14-hectares-guararema-sp-25890', 'imoveis-rurais'],
  ['/imoveis/terrenos-e-lotes/pr/maringa/terras-300m2-jardim-novo-oasis-maringa-pr-25939', 'terrenos-e-lotes'],
  ['/imoveis/imoveis-comerciais/sp/sao-paulo/parte-ideal-do-imovel-comercial-75m2-consolacao-sao-paulo-sp-25941', 'imoveis-comerciais'],
]) assert.equal(loteDaUrl(u).categoria, cat, u);
assert.equal(loteDaUrl('/imoveis/terrenos-e-lotes/pr/maringa/terras-300m2-jardim-novo-oasis-maringa-pr-25939').uf, 'PR');

// O que NÃO é lote: menu, filtro e as duas rotas que viraram 404. Deixar qualquer uma passar
// enche o acervo de linha que não é imóvel.
for (const u of ['/imoveis', '/imoveis/apartamentos/sp', '/leiloes/judiciais', '/sp/sao-paulo',
  '/lotes-abertos-para-lance', '/entrar', '/veiculos', 'javascript:void(0);', ''])
  assert.equal(loteDaUrl(u), null, u);
// Outro domínio não entra nem por href absoluto.
assert.equal(caminhoDoHref('https://outro-site.com.br/imoveis/casas/sp/x/y-1'), '');
assert.equal(loteDaUrl('https://outro-site.com.br/imoveis/casas/sp/x/y-1'), null);

// ─── O CARD ───────────────────────────────────────────────────────────────────────────────
// Card REAL da página 2 (lote 25931): 1ª praça 149.980,01 → 2ª 89.988,01, com o selo de 40%.
const C_JUD = '40% abaixo no2º leilão Judicial Aberto 2º leilão encerra em 13D 18:33:58 Casa em Condomínio 44m² Vila Belo Horizonte, Itapetininga/SP Itapetininga, SP 25931 · Lote 1 R$ 89.988,01 1º Leilão 24/09/2026 14:00 28/09/2026 14:00 R$ 149.980,01 2º Leilão 28/09/2026 14:00 21/10/2026 14:00 R$ 89.988,01';
const pj = pracasDoCard(C_JUD);
assert.equal(pj.length, 2);
assert.equal(pj[0].valor, 149980.01);
assert.equal(pj[1].valor, 89988.01);
// A data é a de ENCERRAMENTO (a 2ª de cada praça): o contador diz 13D e 21/10 é 13 dias
// depois de 07/10. Pegar a de abertura mandaria a limpeza horária expirar o lote cedo demais.
assert.equal(pj[0].fim, '2026-09-28T14:00:00-03:00');
assert.equal(pj[1].fim, '2026-10-21T14:00:00-03:00');

const j = mapaCardWebLeiloes({ href: U1, texto: C_JUD });
assert.equal(j.fonte_id, 'webleiloes_25931');
assert.equal(j.modalidade, 'judicial');
assert.equal(j.estado, 'SP');
assert.equal(j.cidade, 'Itapetininga');
assert.equal(j.titulo, 'Casa em Condomínio 44m² Vila Belo Horizonte, Itapetininga/SP', 'padrão do acervo: termina em Cidade/UF, sem a linha de localização');
assert.equal(j.area_m2, 44);
assert.equal(j.valor_avaliacao, 149980.01);
assert.equal(j.valor_minimo, 89988.01, 'o mínimo é a praça VIGENTE, não a primeira');
assert.equal(j.data_leilao, '2026-09-28T14:00:00-03:00');
assert.equal(j.data_leilao_2, '2026-10-21T14:00:00-03:00');
// 40% abaixo: a conta do selo bate com os dois valores lidos — se um dia parar de bater, é
// sinal de que o card mudou de forma outra vez.
assert.ok(Math.abs(j.valor_minimo - j.valor_avaliacao * 0.6) < 0.02);

// Card REAL da página 1 (lote 25884) — o caso que torce a regra: a 2ª praça é MAIOR que a 1ª.
const C_EXTRA = 'Extrajudicial Aberto 2º leilão encerra em 18:34:10 Gleba de Terras 1437m² Fazenda Genebra, Sorocaba/SP Sorocaba, SP 25884 · Lote 1 R$ 1.811.647,93 1º Leilão 11/09/2026 14:00 01/10/2026 14:00 R$ 858.000,00 2º Leilão 01/10/2026 14:00 08/10/2026 14:00 R$ 1.811.647,93';
const e = mapaCardWebLeiloes({ href: '/imoveis/glebas/sp/sorocaba/gleba-de-terras-1437m2-fazenda-genebra-sorocaba-sp-25884', texto: C_EXTRA });
assert.equal(e.modalidade, 'extrajudicial');
assert.equal(e.titulo, 'Gleba de Terras 1437m² Fazenda Genebra, Sorocaba/SP');
assert.equal(e.area_m2, 1437);
assert.equal(e.valor_minimo, 1811647.93);
assert.equal(e.valor_avaliacao, 1811647.93, 'avaliação é o MAIOR das praças — aqui a 2ª');
assert.ok(e.valor_minimo <= e.valor_avaliacao, 'mínimo nunca pode sair maior que a avaliação');
assert.equal(e.data_leilao, '2026-10-01T14:00:00-03:00');
assert.equal(e.data_leilao_2, '2026-10-08T14:00:00-03:00');

// TIPO (07/10): a coluna é `tipo`, no conjunto canônico de api/_tipo.js. A 1ª versão deste
// mapeador devolvia `categoria` — coluna que NÃO existe em imoveis_leilao: o upsert do lote
// inteiro daria 400 e o conserto chegaria ao banco como mais um zero.
assert.equal('categoria' in j, false, 'nenhuma chave fora do schema');
assert.equal(j.tipo, 'casa');
assert.equal(e.tipo, 'rural', 'gleba em fazenda é rural');
for (const [href, tipo] of [
  ['/imoveis/apartamentos/sp/suzano/apartamento-49m2-jardim-monte-cristo-suzano-sp-25888', 'apartamento'],
  ['/imoveis/terrenos-e-lotes/sp/barra-bonita/terreno-769m2-estrada-vicinal-barra-bonita-sp-25886', 'terreno'],
  ['/imoveis/imoveis-comerciais/sp/sao-paulo/parte-ideal-do-imovel-comercial-75m2-consolacao-sao-paulo-sp-25941', 'comercial'],
  ['/imoveis/imoveis-rurais/sp/guararema/sitio-14-hectares-guararema-sp-25890', 'rural'],
]) assert.equal(mapaCardWebLeiloes({ href, texto: '' }).tipo, tipo, href);
const CANONICOS = new Set(['apartamento', 'casa', 'terreno', 'comercial', 'rural', 'imovel']);
assert.ok(CANONICOS.has(mapaCardWebLeiloes({ href: '/imoveis/outros/sp/x/qualquer-coisa-sp-1', texto: '' }).tipo));

// VENDA DIRETA mantém a modalidade própria: é ela que liga a reconferência de preço na página
// do lote (`reconferirPreco` em scraper-puppeteer.mjs).
assert.equal(mapaCardWebLeiloes({ href: U1, texto: 'Venda Direta Aberto Casa 44m² · Lote 1 R$ 10,00' }).modalidade, 'venda_direta');

// ─── FORMAS QUE SÓ O ENSAIO EM SECO MOSTROU (07/10, 49 cards reais) ─────────────────────────
// LEILÃO ÚNICO: 12 dos 49. Sem esta forma, saíam sem data — e lote sem data nunca expira.
const C_UNICO = 'Judicial Aberto Encerra em 22D 18:12:10 Sítio 14 hectares Guararema/SP Guararema, SP 25890 · Lote 1 R$ 2.112.435,00 Leilão Único 24/09/2026 14:00 30/10/2026 14:00 R$ 2.112.435,00';
const un = mapaCardWebLeiloes({ href: '/imoveis/imoveis-rurais/sp/guararema/sitio-14-hectares-guararema-sp-25890', texto: C_UNICO });
assert.equal(un.data_leilao, '2026-10-30T14:00:00-03:00', 'encerramento da praça única');
assert.equal(un.data_leilao_2, null);
assert.equal(un.valor_minimo, 2112435);
assert.equal(un.valor_avaliacao, 2112435);
// Título sem vírgula antes da cidade: saía "Sítio 14 hectares Guararema/" (e "Casa 100m² Americana/").
assert.equal(un.titulo, 'Sítio 14 hectares Guararema/SP');
assert.equal(un.area_m2, 140000, '14 ha = 140.000 m² (saía 0)');
assert.equal(un.tipo, 'rural');
// "INICIA EM" (leilão que ainda não abriu): 11 dos 49 caíam no título do slug, sem acento.
const C_BREVE = 'Judicial Em breve Inicia em 14D 18:12:10 Imóvel Residencial, 250m², Higienópolis, Piracicaba/SP Piracicaba, SP 25946 · Lote 1 R$ 282.411,06 Leilão Único 22/10/2026 14:00 23/11/2026 14:00 R$ 282.411,06';
const br = mapaCardWebLeiloes({ href: '/imoveis/casas/sp/piracicaba/imovel-residencial-250m2-higienopolis-piracicaba-sp-25946', texto: C_BREVE });
assert.equal(br.titulo, 'Imóvel Residencial, 250m², Higienópolis, Piracicaba/SP');
assert.equal(br.area_m2, 250);
assert.equal(br.data_leilao, '2026-11-23T14:00:00-03:00');
assert.equal(br.tipo, 'casa');
// Cidade com acento e várias palavras: o corte é pela UF da URL, não por nome de cidade.
const C_SJC = 'Judicial Aberto Encerra em 12D 18:12:19 Apartamento 43m² Vila Iracema, São José dos Campos/SP São José Dos Campos, SP 25903 · Lote 1 R$ 215.356,00 Leilão Único 20/07/2026 14:00 20/10/2026 14:00 R$ 215.356,00';
assert.equal(mapaCardWebLeiloes({ href: '/imoveis/apartamentos/sp/sao-jose-dos-campos/apartamento-43m2-vila-iracema-sao-jose-dos-campos-sp-25903', texto: C_SJC }).titulo, 'Apartamento 43m² Vila Iracema, São José dos Campos/SP');

// "extrajudicial" contém "judicial": sem a exceção, todo lote extrajudicial viraria judicial.
assert.equal(mapaCardWebLeiloes({ href: U1, texto: 'Extrajudicial Aberto' }).modalidade, 'extrajudicial');

// Card SEM praça nenhuma (formato inesperado): não inventa data nem avaliação, e o lote ainda
// entra pelo que a URL garante. Zero aqui é ausência honesta, não um valor plausível.
const sem = mapaCardWebLeiloes({ href: U1, texto: 'Judicial Encerrado' });
assert.equal(sem.data_leilao, null);
assert.equal(sem.data_leilao_2, null);
assert.equal(sem.valor_avaliacao, 0);
assert.equal(sem.titulo, 'Casa Em Condominio 44m2 Vila Belo Horizonte Itapetininga Sp', 'sem o card, o título sai do slug');

// ÁREA — as duas formas mordem, cada uma de um jeito:
//  · "1437m²" (sem separador) virava 437 m² com o padrão de grupos de 3 — o motor casava "143",
//    falhava no "7m²" e recomeçava em "437". É o caso real do lote 25884, acima.
//  · "22.677,54 m²" vira 677 m² se o padrão aceitar grupo de milhar incompleto (achado de 03/09).
assert.equal(mapaCardWebLeiloes({ href: U1, texto: 'Judicial Aberto 2º leilão encerra em 10:00:00 Sítio 22.677,54 m² Zona Rural, Itapetininga/SP Itapetininga, SP 25931 · Lote 1 R$ 1,00' }).area_m2, 22677.54);
assert.equal(mapaCardWebLeiloes({ href: U1, texto: 'Judicial Aberto 2º leilão encerra em 10:00:00 Casa 1437m² Centro, Itapetininga/SP Itapetininga, SP 25931 · Lote 1 R$ 1,00' }).area_m2, 1437);
assert.equal(mapaCardWebLeiloes({ href: U1, texto: 'Judicial Aberto 2º leilão encerra em 10:00:00 Casa 44m² Centro, Itapetininga/SP Itapetininga, SP 25931 · Lote 1 R$ 1,00' }).area_m2, 44);

// Foto só entra se for URL absoluta (o mapeador antigo já fazia assim).
assert.equal(mapaCardWebLeiloes({ href: U1, texto: C_JUD, img: '/img/placeholder.png' }).link_foto, null);
assert.equal(mapaCardWebLeiloes({ href: U1, texto: C_JUD, img: 'https://x/y.jpg' }).link_foto, 'https://x/y.jpg');

// FOTO GENÉRICA — URLs REAIS do ensaio de 07/10: a pasta muda por lote, o arquivo não.
{
  const F = (id, pasta, arq) => ({ fonte_id: `webleiloes_${id}`, link_foto: `https://webleiloes.com.br/storage/batches/${pasta}/${id}/${arq}` });
  const rows = [
    F(25893, '30', '4a47a0db6e60853dedfcfdf08a5ca249_thumb.png'),
    F(25898, 'fc', '4a47a0db6e60853dedfcfdf08a5ca249_thumb.png'),
    F(25889, '0d', '2d21d1b771467b22d4e6e95a1a0627ca_thumb.png'),
    F(25901, '2c', '2d21d1b771467b22d4e6e95a1a0627ca_thumb.png'),
    F(25886, 'a8', 'eea97a1af59c98ecd09edd31521f88f1_thumb.jpg'),   // foto própria do lote
    { fonte_id: 'webleiloes_1', link_foto: null },
  ];
  const { descartadas } = descartarFotoGenerica(rows);
  assert.equal(descartadas, 4);
  assert.deepEqual(rows.map((r) => r.link_foto && r.link_foto.split('/').pop()), [null, null, null, null, 'eea97a1af59c98ecd09edd31521f88f1_thumb.jpg', null]);
  // A versão GRANDE do mesmo placeholder (sem `_thumb`), que o enriquecimento traz da página do
  // lote — 18 lotes na 1ª coleta real. Nome diferente do thumb, mas repetido entre lotes: sai.
  const grande = [F(25891, 'f6', '4a47a0db6e60853dedfcfdf08a5ca249.png'), F(25926, '1d', '4a47a0db6e60853dedfcfdf08a5ca249.png')];
  assert.equal(descartarFotoGenerica(grande).descartadas, 2);
  // O mesmo lote lido duas vezes (link absoluto e relativo) não conta como "2 lotes".
  const dup = [F(1, 'aa', 'x.png'), F(1, 'aa', 'x.png')];
  assert.equal(descartarFotoGenerica(dup).descartadas, 0);
}

console.log('webleiloes-lote: todos os casos passaram');
