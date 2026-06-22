export const maxDuration = 300;

const TODOS_ESTADOS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO',
];

function inferirTipo(descricao) {
  const d = (descricao || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // remove acentos para comparação
  if (d.includes('apartamento') || d.includes('apto')) return 'apartamento';
  if (d.includes('casa') || d.includes('sobrado') || d.includes('vila')) return 'casa';
  if (d.includes('terreno') || d.includes('lote') || d.includes('area ') || d.includes('gleba')) return 'terreno';
  if (d.includes('galp') || d.includes('armazem') || d.includes('deposito') || d.includes('barracão') || d.includes('barracao')) return 'galpao';
  if (d.includes('rural') || d.includes('sitio') || d.includes('chacara') || d.includes('fazenda') || d.includes('stio')) return 'rural';
  if (d.includes('vaga') || d.includes('box garage') || d.includes('vaga de garagem')) return 'vaga';
  // Comercial — vem antes de 'sala' para pegar 'sala comercial', 'ponto comercial', etc.
  if (d.includes('comercial') || d.includes('comercio') || d.includes('ponto com') || d.includes('predio') || d.includes('pavilh')) return 'comercial';
  if (d.includes('sala') || d.includes('loja') || d.includes('conjunto') || d.includes('andar') || d.includes('escritorio') || d.includes('box ')) return 'sala';
  return 'imovel';
}

/**
 * Classifica forma_pagamento para imóveis da Caixa Econômica Federal.
 * CEF não disponibiliza campo explícito de forma de pagamento no CSV/API.
 * Critérios baseados nas regras publicadas pela CEF:
 *   - Venda Direta: aceita financiamento bancário e FGTS → 'financiado'
 *   - 2ª Praça: CEF normalmente aceita FGTS como recurso → 'financiado'
 *   - 1ª Praça / Licitação Aberta: exige recurso próprio → 'a_vista'
 *
 * ⚠️ Marco para futura integração com leiloeiros externos:
 * Quando integrar Superbid, eLeilões, Mega Leilões etc., usar
 * normalizarFormaPagamento() de src/data/pagamento.js (não disponível em Edge Functions).
 * Replicar a lógica da função aqui ou criar api/_pagamento-utils.js compartilhado.
 */
function inferirFormaPagamentoCaixa(modalidadeNormalizada) {
  if (modalidadeNormalizada === 'venda_direta') return 'financiado';
  if (modalidadeNormalizada === 'segundo_leilao') return 'financiado';
  return 'a_vista';
}

function normalizarModalidade(modalidade) {
  const m = (modalidade || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (m.includes('1') && (m.includes('praca') || m.includes('leilao'))) return 'primeiro_leilao';
  if (m.includes('2') && (m.includes('praca') || m.includes('leilao'))) return 'segundo_leilao';
  if (m.includes('venda') && m.includes('direta')) return 'venda_direta';
  if (m.includes('licitacao') || m.includes('licitaçao')) return 'licitacao_aberta';
  if (m.includes('primeiro') || m.includes('1a') || m.includes('1ª')) return 'primeiro_leilao';
  if (m.includes('segundo') || m.includes('2a') || m.includes('2ª')) return 'segundo_leilao';
  return m || null;
}

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
      tipo: inferirTipo(descricao),
      valor_avaliacao: valorAvaliacao,
      valor_minimo: valorMinimo,
      desconto_percentual: descontoPct != null ? Math.round(descontoPct) : null,
      modalidade: normalizarModalidade(modalidade),
      link_edital: linkEdital.trim() || null,
      link_foto: linkFoto.trim() || null,
      descricao: descricao.trim() || null,
      titulo: `${descricao.trim().slice(0, 80) || 'Imóvel'} — ${cidade.trim()}`,
      forma_pagamento: inferirFormaPagamentoCaixa(normalizarModalidade(modalidade)),
      leiloeiro: 'Caixa Econômica Federal',
      ativo: true,
      atualizado_em: new Date().toISOString(),
    });
  }
  return imoveis;
}

const STORAGE_BUCKET = 'imoveis-fotos';

async function uploadFoto(fotoUrl, fonteId, supabaseUrl, serviceKey) {
  if (!fotoUrl) return null;
  // Already stored in our Supabase
  if (fotoUrl.includes(supabaseUrl)) return fotoUrl;

  try {
    const res = await fetch(fotoUrl, {
      headers: {
        ...CAIXA_HEADERS,
        Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const body = await res.arrayBuffer();
    if (body.byteLength < 500) return null; // invalid image

    const path = `cef/${fonteId}.${ext}`;
    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body,
      }
    );
    if (!uploadRes.ok) return null;
    return `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
  } catch {
    return null;
  }
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
  let fotosProcessadas = 0;
  const MAX_FOTOS_POR_RUN = 200;

  // Collect all imoveis first, then upsert, then upload photos
  const todosImoveis = [];

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
      for (let i = 0; i < imoveis.length; i += 100) {
        const chunk = imoveis.slice(i, i + 100);
        await upsertBatch(chunk, supabaseUrl, serviceKey);
      }
      totalProcessados += imoveis.length;
      todosImoveis.push(...imoveis);
      estadosOk.push(uf);
      // Dispara geocodificação em background para novos imóveis (sem aguardar)
      fetch(`${process.env.APP_BASE_URL || 'https://tsn-app-two.vercel.app'}/api/geocodificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limite: Math.min(imoveis.length, 50) }),
      }).catch(() => {});
    } catch (e) {
      estadosErro.push(uf);
      erros.push({ uf, erro: e.message });
    }
  }

  // Upload photos for properties that have a CEF foto URL (not yet stored)
  for (const im of todosImoveis) {
    if (fotosProcessadas >= MAX_FOTOS_POR_RUN) break;
    const originalFoto = im.link_foto;
    if (!originalFoto || originalFoto.includes(supabaseUrl)) continue;

    const storedUrl = await uploadFoto(originalFoto, im.fonte_id, supabaseUrl, serviceKey);
    if (storedUrl) {
      // Update DB row with the stored photo URL
      await fetch(
        `${supabaseUrl}/rest/v1/imoveis_leilao?fonte_id=eq.${encodeURIComponent(im.fonte_id)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ link_foto: storedUrl }),
        }
      );
      fotosProcessadas++;
    }
  }

  return res.status(200).json({
    processados: totalProcessados,
    fotos_salvas: fotosProcessadas,
    estados_ok: estadosOk,
    estados_erro: estadosErro,
    erros,
  });
}
