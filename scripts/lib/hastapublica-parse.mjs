/**
 * Parser puro — HASTAPÚBLICA, página ESTÁTICA do leilão (`/leilao/<id>`).
 *
 * Por que esta página (28/09): o coletor lia só o `innerText` do Auditório (`/leilao/painel/<id>`),
 * que é montado por socket.io — nunca viu uma <img>, e 126 de 126 lotes saíam sem foto. A página
 * `/leilao/<id>` vem pronta do servidor (medido pelo servidor do banco: 100 de 100 leilões ativos,
 * 129 cartões) e cada cartão amarra NÚMERO do lote + foto + link do lote no mesmo bloco — a foto é
 * do lote pelo HTML, não por posição ou adivinhação.
 *
 * Também traz o LEILOEIRO de verdade ("Leiloeiro: Euclides Maraschi Junior"). O coletor gravava
 * em `leiloeiro` o "Comitente:" do painel — a vara, o banco, e às vezes a data da praça junto.
 *
 * O LOTE INTEIRO, NÃO SÓ A FOTO (03/11). O painel chega "pronto" e as linhas de lote vêm pelo socket.io
 * (porta 8080) segundos depois; em 02/11, 88 de 180 painéis não mostraram lote nenhum em 15 s (eram 18 em
 * 30/10) e esses leilões ficavam só protegidos do sweep, com preço e data parados — o lote 104650 (Águas
 * Claras/DF) estava sem leitura desde 23/10 com a praça no dia. O cartão desta página já traz título,
 * Cidade/UF, data, status e o valor da praça VIGENTE (o par 1ª/2ª fica num comentário HTML, que é
 * descartado antes de ler); o cabeçalho traz judicial/extrajudicial, a vara e o encerramento de cada praça.
 * O coletor usa isto quando o painel não renderizou.
 *
 * Fixtures reais: scripts/testes/fixtures/hastapublica-leilao-*.html.
 */

// Só a foto enviada ao CDN do site (hash de 32 hex). O cartão sem foto usa
// `util/img/nopicfull.png`, e o cabeçalho do leilão traz o logo do tribunal (`medium-TJSP.png`)
// — nenhum dos dois pode virar capa do imóvel.
const RE_FOTO_REAL = /^https:\/\/s3-sa-east-1\.amazonaws\.com\/cdnhp\/content\/[0-9a-f]{32}\.(?:jpe?g|png|webp)$/i;

const limpar = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// "29/10/2026 14:30:00" → ISO com o fuso de Brasília (o site não diz o fuso; é o mesmo que o painel assume).
const dataISO = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00` : null;
};

export function parseLeilaoHasta(html) {
  // O par "Valor 1ª Praça / Valor 2ª Praça" fica comentado (<!--div ... div-->) e o visível é só o da praça
  // vigente: sem tirar os comentários, o 1º valor achado seria sempre o da 1ª praça.
  const h = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const leiloeiro = limpar((h.match(/<strong>\s*Leiloeir[oa]:\s*<\/strong>\s*([^<]+)/i) || [])[1]) || null;

  // A cor do selo muda com o estado ("Em andamento" greenbg, "Aguarda Início" yellowbg).
  const selo = limpar((h.match(/class="\w+bg rounded">([^<]*)</i) || [])[1]);
  const judicial = selo ? /\bJudicial\b/i.test(selo) : null;
  const mCab = h.match(/<strong>\s*#\d+[^<]*<\/strong>\s*<br>\s*([^<]+)<br>\s*([^<]+)<\/p>/i);
  const varaComarca = mCab ? limpar(mCab[1]) : '';
  const mCidUfLeilao = mCab && limpar(mCab[2]).match(/\|\s*(.+?)\s*\/\s*([A-Za-z]{2})$/);
  const pracas = {};
  for (const m of h.matchAll(/Encerramento\s*-\s*(1ª Praça|2ª Praça|Praça Única)\s*<\/small>\s*<div>\s*<strong>([^<]+)</gi)) {
    pracas[/2ª/.test(m[1]) ? 'praca2' : 'praca1'] = dataISO(m[2]);
  }

  const lotes = new Map();
  for (const card of h.split('class="card card-leilao"').slice(1)) {
    const num = (card.match(/<dt>\s*Lote\s*<\/dt>\s*<dd>\s*(\d+)\s*<\/dd>/i) || [])[1];
    if (!num || lotes.has(num)) continue;
    // Recorta o bloco da imagem: sem o recorte, um cartão sem <img> pegaria a do seguinte.
    const bloco = (card.split(/class="imgLoteSmall"/i)[1] || '').split(/class="card-body"/i)[0];
    const src = (bloco.match(/<img[^>]*\ssrc="([^"]+)"/i) || [])[1] || '';
    const href = (bloco.match(/href="(https?:\/\/[^"]*\/lote\/\d+\/[^"]*)"/i) || [])[1] || null;
    const mTit = card.match(/<dt>\s*<small>([^<]*)<br>\s*<\/small>([^<]+)<\/dt>/i);
    // Na 2ª praça o número vem dentro de um <span> (leilão 18416, medido em 03/11).
    const valorTxt = (card.match(/<dt>\s*Valor\s+(?:1ª Praça|2ª Praça|Praça Única)\s*<\/dt>\s*<dd>\s*(?:<span[^>]*>)?\s*([\d.,]+)/i) || [])[1] || null;
    lotes.set(num, {
      foto: RE_FOTO_REAL.test(src) ? src : null,
      urlLote: href,
      titulo: mTit ? limpar(mTit[2]) : '',
      cidadeUf: mTit ? limpar(mTit[1]) : '',
      status: limpar((card.match(/<dt>\s*Status\s*<\/dt>\s*<dd>([^<]*)</i) || [])[1]) || null,
      dataLote: dataISO((card.match(/Data do Leil[ãa]o\s*<\/dt>\s*<dd>\s*<span[^>]*>([^<]+)</i) || [])[1]),
      valorTxt,
    });
  }
  return {
    leiloeiro, lotes, judicial, varaComarca,
    cidadeLeilao: mCidUfLeilao ? mCidUfLeilao[1] : '', ufLeilao: mCidUfLeilao ? mCidUfLeilao[2].toUpperCase() : '',
    ...pracas,
  };
}
