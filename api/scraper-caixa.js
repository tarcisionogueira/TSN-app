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
 * Extrai forma_pagamento do texto livre da descrição do imóvel (CEF).
 *
 * O CSV da CEF NÃO tem coluna dedicada de forma de pagamento.
 * A informação aparece (quando existe) dentro do campo descrição ou modalidade.
 * Inferir pelo tipo de modalidade (venda_direta, 2ª praça etc.) é INCORRETO:
 * há imóveis em venda direta que são à vista e há 2ª praça que aceita FGTS.
 *
 * Regra: se não encontrar indicação explícita no texto → retorna null.
 * null = "não sabemos" — melhor não exibir do que exibir errado.
 *
 * ⚠️ Marco leiloeiros externos (Superbid, eLeilões, Mega Leilões etc.):
 * Ao integrar, verificar se o leiloeiro fornece campo de pagamento.
 * Se fornecer: usar normalizarFormaPagamento() (replicar lógica abaixo no scraper).
 * Se não fornecer: gravar null — nunca inventar.
 */
function extrairFormaPagamentoCaixa(descricao, modalidadeRaw) {
  const texto = `${descricao || ''} ${modalidadeRaw || ''}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Hipotecado — menção explícita a ônus/hipoteca
  if (/hipotec|com onus|gravame/.test(texto)) return 'hipotecado';

  // Financiado — indica que banco/FGTS/parcelamento é aceito
  if (/fgts|financiamento|financiado|aceita financ|parcelamento/.test(texto)) return 'financiado';

  // À vista — menção explícita
  if (/a vista|avista|recursos proprios/.test(texto)) return 'a_vista';

  // Nenhuma informação confiável encontrada — não adivinhar
  return null;
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
  const urls = [
    `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`,
    `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf.toLowerCase()}.csv`,
  ];
  let lastStatus = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: CAIXA_HEADERS,
        signal: AbortSignal.timeout(30000),
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      // Tentar windows-1252 (padrão Caixa); fallback para UTF-8 se BOM presente
      const bytes = new Uint8Array(buf);
      const hasBomUtf8 = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
      const text = new TextDecoder(hasBomUtf8 ? 'utf-8' : 'windows-1252').decode(buf);
      if (text.length > 100) return { csv: text, encoding: hasBomUtf8 ? 'utf-8' : 'windows-1252' };
    } catch (e) {
      return { erro: `Timeout/rede: ${e.message}` };
    }
  }
  return { erro: `HTTP ${lastStatus} — Caixa recusou a requisição (possível bloqueio de IP de cloud)` };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectarSeparador(header) {
  const semis = (header.match(/;/g) || []).length;
  const commas = (header.match(/,/g) || []).length;
  return semis >= commas ? ';' : ',';
}

function parseCsvLineWith(line, sep) {
  if (sep === ';') return parseCsvLine(line);
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === sep && !inQuote) { fields.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  fields.push(cur.trim());
  return fields;
}

function csvToImoveis(csv, uf) {
  // Remove BOM UTF-8 se presente
  const csvClean = csv.replace(/^﻿/, '');
  const lines = csvClean.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = detectarSeparador(lines[0]);
  const imoveis = [];
  // Skip header (first line)
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLineWith(lines[i], sep);
    if (cols.length < 5) continue;
    const numeroImovel = cols[0] || '';
    if (!numeroImovel) continue;
    const estado = cols[1] || uf;
    const cidade = cols[2] || '';
    const bairro = cols[3] || '';
    const enderecoRaw = cols[4] || '';
    // CEP embutido no campo endereco: "..., PLANO DIRETOR SUL - CEP: 77016-366, PALMAS..."
    const cepMatch = enderecoRaw.match(/CEP[:\s]+(\d{5}-?\d{3})/i);
    const cep = cepMatch ? cepMatch[1].replace('-', '') : null;
    // Remove o trecho "- CEP: XXXXX-XXX" do endereco para não poluir a geocodificação
    const endereco = enderecoRaw.replace(/\s*[-–]\s*CEP[:\s]+\d{5}-?\d{3}/i, '').trim();
    const valorMinimo = parseNumeric(cols[5]);
    const valorAvaliacao = parseNumeric(cols[6]);
    const descontoPct = parseDesconto(cols[7]);
    const descricao = cols[8] || '';
    const modalidade = cols[9] || '';
    const linkDocumento = cols[10] || '';
    const linkFoto = cols[11] || '';
    const nomeLeiloeiro = cols[12]?.trim() || '';
    const dataLeilaoRaw = cols[13]?.trim() || '';

    const modalidadeNorm = normalizarModalidade(modalidade);
    const ehVendaDireta = modalidadeNorm === 'venda_direta' ||
      (modalidade || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes('venda');
    const leiloeiro = nomeLeiloeiro || 'Caixa Econômica Federal';

    // URL da página do imóvel no portal da Caixa (funciona para todos os imóveis)
    const urlLote = numeroImovel
      ? `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${numeroImovel}`
      : null;

    // A Caixa removeu o endpoint direto de matrícula (matricula.asp -> HTTP 404).
    // A matrícula segue acessível pela página do imóvel (urlLote / "Ver no portal da Caixa").
    const linkMatricula = null;

    // Parse data do leilão (formato DD/MM/YYYY ou YYYY-MM-DD)
    let dataLeilao = null;
    if (dataLeilaoRaw) {
      const dmY = dataLeilaoRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (dmY) dataLeilao = `${dmY[3]}-${dmY[2]}-${dmY[1]}`;
      else if (/^\d{4}-\d{2}-\d{2}/.test(dataLeilaoRaw)) dataLeilao = dataLeilaoRaw.slice(0, 10);
    }

    imoveis.push({
      fonte: 'caixa',
      fonte_id: `caixa_${numeroImovel}`,
      estado: estado.trim().toUpperCase(),
      cidade: cidade.trim(),
      bairro: bairro.trim(),
      endereco: endereco,
      cep: cep || null,
      tipo: inferirTipo(descricao),
      valor_avaliacao: valorAvaliacao,
      valor_minimo: valorMinimo,
      desconto_percentual: descontoPct != null ? Math.round(descontoPct) : null,
      modalidade: modalidadeNorm,
      // Caixa venda direta → "regras de venda online"; leiloeiro → edital.
      // Só guarda se for URL real — a CSV às vezes traz só o rótulo do documento
      // (ex.: "Venda Direta Online", "Leilão SFI - Edital Único"), que não é link.
      link_edital: (!ehVendaDireta && /^https?:\/\//i.test(linkDocumento.trim())) ? linkDocumento.trim() : null,
      link_regras_venda: (ehVendaDireta && /^https?:\/\//i.test(linkDocumento.trim())) ? linkDocumento.trim() : null,
      link_matricula: linkMatricula,
      url_lote: urlLote,
      link_foto: linkFoto.trim() || null,
      descricao: descricao.trim() || null,
      titulo: `${descricao.trim().slice(0, 80) || 'Imóvel'} — ${cidade.trim()}`,
      forma_pagamento: extrairFormaPagamentoCaixa(descricao, modalidade),
      leiloeiro,
      data_leilao: dataLeilao,
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

  // Protege contra chamadas externas não autorizadas.
  // Aceita: (1) CRON_SECRET via x-cron-secret header ou Authorization: Bearer, (2) JWT de admin.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[scraper-caixa] CRON_SECRET não configurado — acesso bloqueado');
    return res.status(500).json({ error: 'Endpoint não configurado' });
  }
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const bearerVal = authHeader.replace(/^Bearer\s+/i, '').trim();
    const sent = req.headers['x-cron-secret'] || bearerVal || '';
    if (sent !== cronSecret) {
      // Fallback: aceitar JWT de usuário admin (chamada manual pelo painel)
      const token = bearerVal;
      let isAdmin = false;
      if (token) {
        try {
          const supabaseUrl = process.env.VITE_SUPABASE_URL;
          const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
          const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5000),
          });
          if (userRes.ok) {
            const userData = await userRes.json();
            const profileRes = await fetch(`${supabaseUrl}/rest/v1/perfis?id=eq.${userData.id}&select=role`, {
              headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(5000),
            });
            if (profileRes.ok) {
              const profiles = await profileRes.json();
              const role = profiles?.[0]?.role;
              isAdmin = role === 'admin' || role === 'analista';
            }
          }
        } catch (_) {}
      }
      if (!isAdmin) return res.status(401).json({ error: 'Não autorizado' });
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }

  const url = new URL(req.url || '', 'http://localhost');
  const qEstados = req.query?.estados || url.searchParams.get('estados');

  // ── Modo cron (GET sem ?estados=) ──────────────────────────────────────────
  // Cron */2 22 * * *:
  //   Minutos 00–52 (índices 0-26) → processa TODOS_ESTADOS[idx]
  //   Minutos 54–58 (índices 27+)  → slot de retry: reprocessa estados que falharam
  if (req.method === 'GET' && !qEstados) {
    const minuto = new Date().getUTCMinutes();
    const idx = Math.floor(minuto / 2);

    if (idx < TODOS_ESTADOS.length) {
      // ── Rodada normal: 1ª tentativa + retry de 30s se falhar ──────────────
      const uf = TODOS_ESTADOS[idx];
      let resultado = await fetchEstado(uf);

      if (!resultado?.csv) {
        // Falhou: espera 30s (cobre sobrecarga de servidor) e tenta uma vez mais
        await sleep(30000);
        resultado = await fetchEstado(uf);
      }

      if (!resultado?.csv) {
        // 2ª falha: envia para fila de retry (final da fila — minutos 54-58)
        await fetch(`${supabaseUrl}/rest/v1/scraper_retry`, {
          method: 'POST',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ uf, tentativas: 1, ultimo_erro: resultado?.erro || 'sem CSV', falhou_em: new Date().toISOString() }),
        }).catch(() => {});
        return res.status(200).json({ uf, status: 'retry_agendado', erro: resultado?.erro });
      }

      // Sucesso: processa e remove da fila de retry se estava lá
      await fetch(`${supabaseUrl}/rest/v1/scraper_retry?uf=eq.${uf}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' },
      }).catch(() => {});

      const runStart = new Date().toISOString();
      const imoveis = csvToImoveis(resultado.csv, uf);
      for (let j = 0; j < imoveis.length; j += 100) await upsertBatch(imoveis.slice(j, j + 100), supabaseUrl, serviceKey);

      // Remove imóveis que saíram da Caixa: sweep temporal — apaga os do estado que
      // NÃO foram tocados neste run (atualizado_em < início). Evita o bug do not.in
      // em chunks (que apagava os recém-inseridos) e não estoura URL.
      if (imoveis.length > 0) {
        await fetch(
          `${supabaseUrl}/rest/v1/imoveis_leilao?estado=eq.${uf}&fonte=eq.caixa&ativo=eq.true&atualizado_em=lt.${runStart}`,
          { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' } }
        ).catch(() => {});
      }

      return res.status(200).json({ uf, status: 'ok', processados: imoveis.length });

    } else {
      // ── Slot de retry (minutos 54–58): pega o estado com mais tentativas pendentes ──
      const retryRes = await fetch(`${supabaseUrl}/rest/v1/scraper_retry?order=tentativas.asc&limit=1`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      const retryList = retryRes.ok ? await retryRes.json() : [];
      if (!retryList.length) return res.status(200).json({ msg: 'retry_vazio' });

      const { uf, tentativas } = retryList[0];
      const resultado = await fetchEstado(uf);

      if (resultado?.csv) {
        // Retry bem-sucedido: processa e limpa da fila
        await fetch(`${supabaseUrl}/rest/v1/scraper_retry?uf=eq.${uf}`, {
          method: 'DELETE',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' },
        }).catch(() => {});
        const runStart = new Date().toISOString();
        const imoveis = csvToImoveis(resultado.csv, uf);
        for (let j = 0; j < imoveis.length; j += 100) await upsertBatch(imoveis.slice(j, j + 100), supabaseUrl, serviceKey);
        if (imoveis.length > 0) {
          await fetch(
            `${supabaseUrl}/rest/v1/imoveis_leilao?estado=eq.${uf}&fonte=eq.caixa&ativo=eq.true&atualizado_em=lt.${runStart}`,
            { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'return=minimal' } }
          ).catch(() => {});
        }
        return res.status(200).json({ uf, status: 'retry_ok', processados: imoveis.length, tentativas });
      } else {
        // Retry falhou: incrementa tentativas (admin verá no painel)
        await fetch(`${supabaseUrl}/rest/v1/scraper_retry?uf=eq.${uf}`, {
          method: 'PATCH',
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ tentativas: tentativas + 1, ultimo_erro: resultado?.erro, falhou_em: new Date().toISOString() }),
        }).catch(() => {});
        return res.status(200).json({ uf, status: 'retry_falhou', tentativas: tentativas + 1, erro: resultado?.erro });
      }
    }
  }

  // ── Modo manual (POST ou GET com ?estados=) ────────────────────────────────
  let estados = TODOS_ESTADOS;
  if (qEstados) {
    estados = qEstados.split(',').map(s => s.trim()).filter(Boolean);
  } else if (req.body?.estados?.length > 0) {
    estados = req.body.estados;
  }

  const estadosOk = [];
  const estadosErro = [];
  const erros = [];
  let totalProcessados = 0;
  let fotosProcessadas = 0;
  const MAX_FOTOS_POR_RUN = 200;
  const todosImoveis = [];

  for (let i = 0; i < estados.length; i++) {
    const uf = estados[i];
    if (i > 0 && estados.length > 1) await sleep(5000);

    // Modo manual: 1 tentativa. Se falhar, 30s e mais 1 tentativa.
    let resultado = await fetchEstado(uf);
    if (!resultado?.csv) {
      await sleep(30000);
      resultado = await fetchEstado(uf);
    }

    try {
      if (!resultado?.csv) {
        estadosErro.push(uf);
        erros.push({ uf, erro: resultado?.erro || 'CSV não retornado' });
        continue;
      }
      const imoveis = csvToImoveis(resultado.csv, uf);
      if (imoveis.length === 0) {
        const linhas = resultado.csv.split('\n').filter(l => l.trim()).slice(0, 5);
        erros.push({
          uf,
          erro: 'CSV recebido mas 0 imóveis parseados',
          csv_tamanho: resultado.csv.length,
          csv_primeiras_linhas: linhas,
        });
        estadosOk.push(uf);
        continue;
      }
      for (let j = 0; j < imoveis.length; j += 100) {
        const chunk = imoveis.slice(j, j + 100);
        await upsertBatch(chunk, supabaseUrl, serviceKey);
      }
      totalProcessados += imoveis.length;
      todosImoveis.push(...imoveis);
      estadosOk.push(uf);
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
