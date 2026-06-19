export const maxDuration = 60;

const TODOS_ESTADOS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO',
];

function parseNumeric(str) {
  if (!str) return null;
  const s = String(str).replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDesconto(str) {
  if (!str) return null;
  const s = String(str).replace('%', '').replace(',', '.').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ';' && !inQuote) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

const CAIXA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp',
  'Connection': 'keep-alive',
};

async function fetchEstado(uf) {
  // Tenta URL principal
  const urls = [
    `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`,
    `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf.toLowerCase()}.csv`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: CAIXA_HEADERS,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const text = new TextDecoder('latin1').decode(buf);
      if (text.length > 100) return text; // arquivo válido
    } catch (_) {}
  }
  return null;
}

function csvToImoveis(csv, uf) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const imoveis = [];
  // Skip header (first line)
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 5) continue;
    const numeroImovel = cols[0] || '';
    if (!numeroImovel) continue;
    const estado = cols[1] || uf;
    const cidade = cols[2] || '';
    const bairro = cols[3] || '';
    const endereco = cols[4] || '';
    const valorMinimo = parseNumeric(cols[5]);
    const valorAvaliacao = parseNumeric(cols[6]);
    const descontoPct = parseDesconto(cols[7]);
    const descricao = cols[8] || '';
    const modalidade = cols[9] || '';
    const linkEdital = cols[10] || '';
    const linkFoto = cols[11] || '';

    imoveis.push({
      fonte: 'caixa',
      fonte_id: `caixa_${numeroImovel}`,
      estado: estado.trim().toUpperCase(),
      cidade: cidade.trim(),
      bairro: bairro.trim(),
      endereco: endereco.trim(),
      tipo: 'imovel',
      valor_avaliacao: valorAvaliacao,
      valor_minimo: valorMinimo,
      desconto_percentual: descontoPct != null ? Math.round(descontoPct) : null,
      modalidade: modalidade.trim().toLowerCase() || null,
      link_edital: linkEdital.trim() || null,
      link_foto: linkFoto.trim() || null,
      descricao: descricao.trim() || null,
      titulo: `${descricao.trim().slice(0, 80) || 'Imóvel'} — ${cidade.trim()}`,
      leiloeiro: 'Caixa Econômica Federal',
      ativo: true,
      atualizado_em: new Date().toISOString(),
    });
  }
  return imoveis;
}

async function upsertBatch(rows, supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/imoveis_leilao?on_conflict=fonte,fonte_id`,
    {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert failed (${res.status}): ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }

  let estados = TODOS_ESTADOS;
  if (req.method === 'POST' && req.body?.estados?.length > 0) {
    estados = req.body.estados;
  }

  const estadosOk = [];
  const estadosErro = [];
  const erros = [];
  let totalProcessados = 0;

  for (const uf of estados) {
    try {
      const csv = await fetchEstado(uf);
      if (!csv) {
        estadosErro.push(uf);
        erros.push({ uf, erro: 'CSV não retornado (bloqueio, timeout ou URL inválida)' });
        continue;
      }
      const imoveis = csvToImoveis(csv, uf);
      if (imoveis.length === 0) {
        estadosOk.push(uf);
        continue;
      }
      // Batch in chunks of 100
      for (let i = 0; i < imoveis.length; i += 100) {
        const chunk = imoveis.slice(i, i + 100);
        await upsertBatch(chunk, supabaseUrl, serviceKey);
      }
      totalProcessados += imoveis.length;
      estadosOk.push(uf);
    } catch (e) {
      estadosErro.push(uf);
      erros.push({ uf, erro: e.message });
    }
  }

  return res.status(200).json({
    processados: totalProcessados,
    estados_ok: estadosOk,
    estados_erro: estadosErro,
    erros,
  });
}
