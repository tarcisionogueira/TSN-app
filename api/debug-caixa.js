export const config = { runtime: 'edge' };

const UFS_VALIDAS = new Set(['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']);

export default async function handler(req) {
  const CRON_SECRET = process.env.CRON_SECRET;
  const sent = req.headers.get('x-cron-secret') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || ''; // sem ?secret= (vazaria em logs)
  if (!CRON_SECRET || sent !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(req.url);
  const uf = (url.searchParams.get('uf') || 'SP').toUpperCase();
  if (!UFS_VALIDAS.has(uf)) {
    return new Response(JSON.stringify({ error: 'UF inválida' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const csvUrl = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Referer': 'https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp',
  };

  try {
    const res = await fetch(csvUrl, { headers, signal: AbortSignal.timeout(30000) });
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Detectar encoding: BOM UTF-8 = EF BB BF, BOM UTF-16 = FF FE
    const hasBomUtf8 = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    const hasBomUtf16 = bytes[0] === 0xFF && bytes[1] === 0xFE;

    // Tentar latin1 e utf-8
    const textLatin1 = new TextDecoder('windows-1252').decode(buf);
    const textUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);

    const firstBytesHex = Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const linesLatin1 = textLatin1.split('\n').filter(l => l.trim()).slice(0, 8);
    const linesUtf8 = textUtf8.split('\n').filter(l => l.trim()).slice(0, 8);

    // Contar campos do header com ';' vs ','
    const headerLatin1 = linesLatin1[0] || '';
    const camposSemicolon = headerLatin1.split(';').length;
    const camposVirgula = headerLatin1.split(',').length;

    return new Response(JSON.stringify({
      status_http: res.status,
      content_type: res.headers.get('content-type'),
      tamanho_bytes: buf.byteLength,
      encoding: { bom_utf8: hasBomUtf8, bom_utf16: hasBomUtf16 },
      primeiros_bytes_hex: firstBytesHex,
      separador_detectado: camposSemicolon >= camposVirgula ? ';' : ',',
      campos_semicolon: camposSemicolon,
      campos_virgula: camposVirgula,
      primeiras_linhas_latin1: linesLatin1,
      primeiras_linhas_utf8: linesUtf8,
      total_linhas_latin1: textLatin1.split('\n').filter(l => l.trim()).length,
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ erro: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
