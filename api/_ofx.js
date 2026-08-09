/**
 * LEITOR DE OFX — extrato de banco que não tem API, virando lançamento conciliável.
 *
 * POR QUE EXISTE (08/08): Mercado Pago e Asaas entram sozinhos pela API, e o Inter tem API
 * própria. Bradesco, C6 e Caixa não têm caminho automático viável hoje — Open Finance exige
 * ser instituição autorizada pelo Banco Central, e agregador cobra mensalidade que não se
 * justifica no volume atual. Mas TODOS eles exportam OFX pelo internet banking. Então o
 * caminho de menor custo é ler o arquivo: zero mensalidade, zero contrato, e a DRE fecha.
 *
 * DOIS FORMATOS, UM PARSER. O OFX 1.x é SGML (tags que podem não fechar: `<MEMO>texto`
 * termina na próxima tag). O 2.x é XML de verdade. Em vez de dois leitores, normalizamos:
 * fechamos as tags de valor do SGML e daí em diante é o mesmo caminho. Bancos brasileiros
 * usam predominantemente o 1.x, mas alguns já exportam 2.x — e descobrir isso na hora do
 * fechamento contábil seria péssimo.
 *
 * ENCODING: os bancos exportam em ISO-8859-1 com frequência. Lemos o cabeçalho `CHARSET`/
 * `ENCODING` e decodificamos de acordo; sem isso "TRANSFERÊNCIA" chega como "TRANSFERÊNCIA"
 * e vira um credor novo na conciliação, separado do mesmo credor grafado certo.
 *
 * O QUE NÃO FAZ: não inventa banco nem data. Arquivo sem FITID é recusado — o FITID é o que
 * garante a idempotência (reimportar o mesmo extrato não duplica lançamento), e sem ele a
 * segunda importação dobraria o mês.
 */

// Tags de VALOR que no SGML podem vir sem fechamento.
const TAGS_VALOR = [
  'DTSERVER', 'LANGUAGE', 'ORG', 'FID', 'BANKID', 'BRANCHID', 'ACCTID', 'ACCTTYPE',
  'DTSTART', 'DTEND', 'TRNTYPE', 'DTPOSTED', 'DTUSER', 'DTAVAIL', 'TRNAMT', 'FITID',
  'CHECKNUM', 'REFNUM', 'MEMO', 'NAME', 'PAYEEID', 'BALAMT', 'DTASOF', 'CURDEF', 'CODE',
  'SEVERITY', 'MARKETING', 'TRNUID', 'STATUS',
];

function decodificar(bytes) {
  const cabecalho = Buffer.from(bytes.slice(0, 512)).toString('latin1');
  const m = /CHARSET:\s*([^\s]+)/i.exec(cabecalho) || /encoding=["']([^"']+)["']/i.exec(cabecalho);
  const cs = String(m?.[1] || '').toUpperCase();
  // 1252/8859-1/ISO-8859-1 → latin1. UTF-8 e o resto → utf8.
  const latin = cs.includes('1252') || cs.includes('8859') || cs === 'LATIN1';
  return Buffer.from(bytes).toString(latin ? 'latin1' : 'utf8');
}

// Fecha as tags de valor do SGML para o texto virar algo previsível de varrer.
function normalizar(txt) {
  let s = String(txt).replace(/\r\n?/g, '\n');
  for (const tag of TAGS_VALOR) {
    const re = new RegExp(`<${tag}>([^<\\n]*)(?!</${tag}>)`, 'gi');
    s = s.replace(re, (todo, valor) => `<${tag}>${valor}</${tag}>`);
  }
  return s;
}

const pegar = (bloco, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(bloco);
  return m ? m[1].trim() : '';
};

// OFX data: AAAAMMDD[HHMMSS][.XXX][[fuso:TZ]] — só o dia importa para competência.
function dataOfx(v) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(v || '').trim());
  if (!m) return null;
  const [, a, mes, d] = m;
  const iso = `${a}-${mes}-${d}`;
  return Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) ? null : iso;
}

const numero = (v) => {
  // Bancos usam ponto OU vírgula como decimal. "-1.234,56" e "-1234.56" chegam aqui.
  let s = String(v || '').trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Lê um OFX e devolve { ok, banco, conta, periodo, lancamentos[], erros[] }.
 * @param {Buffer|Uint8Array|string} conteudo
 * @param {string} [bancoRotulo] nome amigável do banco (o OFX traz código, não nome)
 */
export function lerOFX(conteudo, bancoRotulo) {
  const bruto = typeof conteudo === 'string' ? conteudo : decodificar(conteudo);
  if (!/<OFX>/i.test(bruto)) {
    return { ok: false, error: 'O arquivo não parece um OFX. Exporte o extrato no formato OFX (Money/Dinheiro) no internet banking.' };
  }
  const txt = normalizar(bruto);

  const bankId = pegar(txt, 'BANKID');
  const acctId = pegar(txt, 'ACCTID');
  const banco = String(bancoRotulo || '').trim() || (bankId ? `Banco ${bankId}` : 'Banco (OFX)');

  const blocos = txt.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  if (!blocos.length) {
    return { ok: false, error: 'Não encontrei lançamentos no arquivo. Confira se o extrato exportado cobre o período desejado.' };
  }

  const lancamentos = [];
  const erros = [];
  const vistos = new Set();

  for (const b of blocos) {
    const fitid = pegar(b, 'FITID');
    const data = dataOfx(pegar(b, 'DTPOSTED') || pegar(b, 'DTUSER') || pegar(b, 'DTAVAIL'));
    const valor = numero(pegar(b, 'TRNAMT'));
    const memo = pegar(b, 'MEMO');
    const nome = pegar(b, 'NAME');
    const tipo = pegar(b, 'TRNTYPE');

    // Sem FITID não há idempotência: a segunda importação duplicaria o mês inteiro.
    // Recusar a linha é melhor que dobrar o extrato sem ninguém perceber.
    if (!fitid) { erros.push('Lançamento sem identificador (FITID) — ignorado.'); continue; }
    if (!data) { erros.push(`Lançamento ${fitid} sem data válida — ignorado.`); continue; }
    if (valor === null || valor === 0) { erros.push(`Lançamento ${fitid} sem valor — ignorado.`); continue; }

    // O MESMO FITID repetido dentro do arquivo é erro do banco, não do nosso lado.
    const chave = `${acctId || ''}:${fitid}`;
    if (vistos.has(chave)) { erros.push(`Lançamento ${fitid} aparece duas vezes no arquivo — mantida a primeira.`); continue; }
    vistos.add(chave);

    const descricao = [nome, memo].filter(Boolean).join(' — ').slice(0, 300)
      || tipo || 'Lançamento bancário';

    lancamentos.push({
      banco,
      // A chave inclui a CONTA: a mesma pessoa pode ter duas contas no mesmo banco, e
      // FITID só é único dentro da conta que o emitiu.
      chave_origem: chave,
      data,
      descricao,
      direcao: valor < 0 ? 'saida' : 'entrada',
      valor_bruto: Math.abs(valor),
      valor_liquido: Math.abs(valor),
      taxa: 0,
      metodo: tipo || null,
    });
  }

  const datas = lancamentos.map((l) => l.data).sort();
  return {
    ok: lancamentos.length > 0,
    error: lancamentos.length ? null : 'Nenhum lançamento aproveitável no arquivo.',
    banco,
    conta: acctId || null,
    periodo: datas.length ? { de: datas[0], ate: datas[datas.length - 1] } : null,
    lancamentos,
    erros,
  };
}
