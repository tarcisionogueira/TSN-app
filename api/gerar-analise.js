// Geração da análise mercadológica + laudo NO SERVIDOR (persistente).
// O cliente dispara e pode FECHAR a aba: a função Vercel continua rodando até o
// fim e grava o resultado em `analises_mercado`. Ao reabrir (qualquer device), o
// app lê o resultado do banco. Espelha os prompts de src/utils/claude.js.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { resumoAprendizadoTexto } from './_arremate-aprendizado.js';
import { ehCidadeTemporada, motivoTemporada } from './_temporada.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const REUSE_DIAS = Number(process.env.ANALISE_REUSE_DIAS || 7); // reaproveita a pesquisa de mercado deste imóvel se feita há < N dias

const brl = (v) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertAnalise(row) {
  // upsert por (user_id, imovel_id)
  await sb('analises_mercado?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

export function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
export function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}

// O agente que aprende com os relatórios SINALIZA anomalias (o gerador achou algo errado
// nos dados) para a verificação de saúde — sem custo, sem gerar relatório.
async function registrarAnomalia(tipo, fonte, imovelId, campo, detalhe) {
  try {
    await sb('rpc/registrar_anomalia_relatorio', {
      method: 'POST',
      body: JSON.stringify({ p_tipo: tipo, p_fonte: fonte || '', p_imovel_id: String(imovelId || ''), p_campo: campo || '', p_detalhe: detalhe || '' }),
    });
  } catch { /* nunca bloqueia o relatório */ }
}

// APRENDER NA EMISSÃO: ao emitir o relatório, grava uma lição DURÁVEL (corpus + sinais de
// qualidade) em agente_aprendizado — SEM chamada de IA extra (custo zero). Sobrevive à
// exclusão do relatório (tabela separada de analises_*). Guarda só dado POISON-RESISTENTE:
// valores do imóvel (scraper) e da pesquisa (servidor) — nunca derivados de input do
// usuário (ex.: valorMercado depende de areaM2 do cliente), p/ não envenenar o coletivo.
async function aprenderNaEmissao(imovel, mercado, temParecer, avalReal, minReal) {
  try {
    // Usa os valores VALIDADOS do imóvel (avalDb/vminImovel: lidos de imoveis_leilao após
    // garantirValores, já com as travas de sentinela/implausível) quando o chamador os passa.
    // Antes lia só imovel.valor_avaliacao (snake_case), mas a tela /analise envia valorAvaliacao
    // (camelCase) → Number(...) = NaN → avaliacao_ausente:true em TODO relatório (sinal de
    // aprendizado 100% ruído). Fallback aceita as duas grafias se os validados não vierem.
    const aval = Number(avalReal) > 0 ? Number(avalReal)
      : (Number(imovel?.valor_avaliacao) || Number(imovel?.valorAvaliacao) || null);
    const min  = Number(minReal) > 0 ? Number(minReal)
      : (Number(imovel?.valor_minimo) || Number(imovel?.valorMinimo) || null);
    const nAmostras = mercado?.amostras?.length || mercado?.comparaveis?.length || mercado?.anuncios?.length || 0;
    const precoM2 = Number(mercado?.precoMedioM2) || null;
    const corpus = {
      valor_avaliacao: aval, valor_minimo: min,
      desconto_pct: (aval > 0 && min > 0) ? Math.round((1 - min / aval) * 100) : null,
      preco_medio_m2: precoM2,
      aluguel_medio: Number(mercado?.aluguelMedio) || null,
      fipe_zap_m2: Number(mercado?.referenciaFipeZap?.precoMedioM2) || null,
      n_amostras: nAmostras,
      // Particularidade do imóvel (objetivo p/ que serve): revenda/locação/temporada — o agente
      // aprende o perfil de adequação por região/tipo. Derivado de desconto/yield/cidade (poison-resistente).
      intencao: mercado?.classificacaoIntencao
        ? { revenda: !!mercado.classificacaoIntencao.revenda, locacao: !!mercado.classificacaoIntencao.locacao, temporada: !!mercado.classificacaoIntencao.temporada }
        : null,
    };
    const qualidade = {
      avaliacao_ausente: !(aval > 0),
      minimo_ausente: !(min > 0),
      mercado_vazio: !(precoM2 > 0) && nAmostras === 0,
      sem_parecer: !temParecer,
    };
    await sb('agente_aprendizado', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        agente: 'mercadologico', imovel_id: String(imovel?.id || ''),
        cidade: imovel?.cidade || null, uf: imovel?.estado || null,
        tipo: imovel?.tipo || null, modalidade: imovel?.modalidade || null,
        corpus, qualidade,
      }),
    });
  } catch { /* aprendizado é best-effort: nunca bloqueia o relatório */ }
}

// Corpus coletivo (emissões anteriores) da MESMA região/tipo, como referência
// observacional no prompt. Só valores poison-resistentes (pesquisa/scraper). Custo: 1 SELECT.
async function corpusDaRegiao(uf, tipo) {
  try {
    if (!uf || !tipo) return '';
    const rows = await (await sb(`agente_aprendizado?agente=eq.mercadologico&uf=eq.${encodeURIComponent(uf)}&tipo=eq.${encodeURIComponent(tipo)}&select=corpus&order=criado_em.desc&limit=40`)).json();
    if (!Array.isArray(rows)) return '';
    const m2 = rows.map(r => Number(r?.corpus?.preco_medio_m2)).filter(v => v > 0);
    if (m2.length < 3) return '';
    const desc = rows.map(r => Number(r?.corpus?.desconto_pct)).filter(v => v >= 0);
    const med = Math.round(m2.reduce((a, b) => a + b, 0) / m2.length);
    const descMed = desc.length ? Math.round(desc.reduce((a, b) => a + b, 0) / desc.length) : null;
    return `\n\nCORPUS DA REGIÃO (${tipo} em ${uf}, ${m2.length} análises recentes, referência OBSERVACIONAL): preço médio observado ~R$ ${med}/m²${descMed != null ? `, desconto médio ~${descMed}%` : ''}. Use como sanity-check, nunca como verdade absoluta.`;
  } catch { return ''; }
}

// ÍNDICE BIDPRO — base própria de mercado por microrregião (cidade_indicadores). Cada relatório
// SEMEIA (aprende) e LÊ o índice consolidado, sem depender de fonte externa. Best-effort: nunca
// bloqueia o relatório. Recebe cidade_norm JÁ normalizado (coluna gerada) + bairro/lat/lng crus.
async function semearIndiceBidPro(imDb, precoM2, aluguelM2, nAmostras) {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return;
    const venda = Number(precoM2) > 0 ? Number(precoM2) : null;
    const aluguel = Number(aluguelM2) > 0 ? Number(aluguelM2) : null;
    if (venda == null && aluguel == null) return;
    await sb('rpc/semear_indice_relatorio', {
      method: 'POST',
      body: JSON.stringify({
        p_cidade_norm: imDb.cidade_norm, p_uf: imDb.estado, p_bairro: imDb.bairro || '',
        p_lat: imDb.latitude ?? null, p_lng: imDb.longitude ?? null,
        p_tipo: 'residencial', p_venda_m2: venda, p_aluguel_m2: aluguel, p_n: Number(nAmostras) || 0,
      }),
    });
  } catch { /* semeadura best-effort */ }
}
async function lerIndiceBidPro(imDb) {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    const r = await sb('rpc/indice_bidpro_regiao', {
      method: 'POST',
      body: JSON.stringify({
        p_cidade_norm: imDb.cidade_norm, p_uf: imDb.estado, p_bairro: imDb.bairro || '',
        p_lat: imDb.latitude ?? null, p_lng: imDb.longitude ?? null, p_tipo: 'residencial',
      }),
    });
    const j = await r.json().catch(() => null);
    return (j && (Number(j.venda_m2) > 0 || Number(j.aluguel_m2) > 0)) ? j : null;
  } catch { return null; }
}

// Grava as amostras DATADAS deste relatório em indice_amostra (base da valorização por
// ano e da recência real). Só residencial, poison-resistente (dados da pesquisa). O prompt
// já descarta leilão das amostras → arremate NUNCA entra aqui. Dedup pelo índice único.
async function gravarAmostrasIndice(imDb, mercado, imovelId) {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return;
    const uf = String(imDb.estado).toUpperCase();
    const nowMes = new Date().toISOString().slice(0, 7);
    const dref = (d) => (/^\d{4}-\d{2}$/.test(String(d || '')) ? `${d}-01` : `${nowMes}-01`);
    const vendas = [...(mercado.nivel1?.vendas || []), ...(mercado.nivel2?.vendas || [])];
    const locs   = [...(mercado.nivel1?.locacoes || []), ...(mercado.nivel2?.locacoes || [])];
    const rows = [];
    for (const s of vendas) {
      const m2 = Number(s?.valorM2);
      if (!(m2 >= 200 && m2 <= 50000)) continue;
      rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: '', geo_grid: '', tipo: 'residencial',
        especie: 'venda', valor_m2: Math.round(m2), valor_total: Number(s?.valor) || null, area_m2: Number(s?.m2) || null,
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), origem: 'relatorio', imovel_id: String(imovelId || '') });
    }
    for (const s of locs) {
      const mensal = Number(s?.valorMensal); const area = Number(s?.m2);
      if (!(mensal > 0)) continue;
      const vm2 = area > 0 ? Math.round((mensal / area) * 100) / 100 : null;
      rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: '', geo_grid: '', tipo: 'residencial',
        especie: 'locacao', valor_m2: (vm2 && vm2 >= 1 && vm2 <= 1000) ? vm2 : null, valor_total: mensal, area_m2: area || null,
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), origem: 'relatorio', imovel_id: String(imovelId || '') });
    }
    if (!rows.length) return;
    await sb('indice_amostra', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(rows) });
  } catch { /* aprendizado é best-effort: nunca bloqueia o relatório */ }
}

// Valorização por ano (mediana de R$/m² de VENDA) da microrregião — vai no relatório
// como MAIS UMA referência (curva no tempo), independente do FipeZAP.
async function lerValorizacao(imDb) {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    const r = await sb('rpc/indice_valorizacao_anual', { method: 'POST', body: JSON.stringify({
      p_cidade_norm: imDb.cidade_norm, p_uf: imDb.estado, p_tipo: 'residencial', p_especie: 'venda', p_anos: 6 }) });
    if (!r.ok) return null;
    const v = await r.json().catch(() => null);
    return (v && Array.isArray(v.serie) && v.serie.length >= 2) ? v : null;
  } catch { return null; }
}

// CLASSIFICAÇÃO DE INTENÇÃO — o mesmo objetivo dos filtros da busca (revenda/locação/temporada),
// agora DENTRO do relatório: diz para QUÊ o imóvel é bom (um, vários ou os três) e POR QUÊ.
// Alimenta a defesa do parecer e o aprendizado. Critérios ancorados nos dados que já temos.
function classificarIntencao({ baseTipo, desconto, yieldBruto, cidadeNorm }) {
  const residencial = baseTipo === 'residencial';
  const liquido = baseTipo === 'residencial' || baseTipo === 'comercial';
  const cls = { revenda: false, locacao: false, temporada: false, motivos: {} };
  if (liquido && Number(desconto) >= 30) {
    cls.revenda = true;
    cls.motivos.revenda = `Desconto de ${Math.round(desconto)}% frente à avaliação: margem de revenda (flip) saudável e boa liquidez do tipo.`;
  }
  const y = Number(yieldBruto) || 0;
  if (residencial && y >= 6) {
    cls.locacao = true;
    cls.motivos.locacao = `Yield bruto de locação ~${y.toFixed(1)}% a.a.: renda de aluguel atrativa para o perfil de renda.`;
  }
  if (residencial && ehCidadeTemporada(cidadeNorm)) {
    cls.temporada = true;
    cls.motivos.temporada = motivoTemporada(cidadeNorm) || 'Cidade de destino turístico: potencial de aluguel por temporada (curta duração).';
  }
  cls.algum = cls.revenda || cls.locacao || cls.temporada;
  return cls;
}

// Anti-SSRF simples: as URLs vêm do banco (leiloeiro/anexos) — bloqueia destinos internos/
// metadados; libera o resto. Evita que um anexo com host interno vire uma requisição indevida.
function hostExterno(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === '::1' || h === 'metadata.google.internal') return false;
    return true;
  } catch { return false; }
}
// EDITAL/MATRÍCULA em PDF: extração FOCADA via IA (só avaliação + lance mínimo) — barata e curta,
// disparada apenas quando o valor falta E o documento é PDF (o fetch grátis não dá pra regex).
async function extrairValoresPdf(base64, deadline) {
  const budget = deadline - Date.now();
  if (budget < 12000) return null; // sem tempo suficiente p/ a IA ler o PDF
  const data = await anthropic({
    model: MODEL, max_tokens: 300,
    system: 'Você lê documentos de leilão de imóvel. Responda SOMENTE JSON válido, sem markdown.',
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 }, title: 'documento do lote' },
      { type: 'text', text: 'Extraia do edital/matrícula: {"avaliacao": number, "lanceMinimo": number}. avaliacao = valor de AVALIAÇÃO do imóvel (auto/laudo de avaliação) em reais; lanceMinimo = menor lance admitido (1º leilão/praça) em reais. SÓ números (sem "R$", sem pontos de milhar). Se não constar no documento, use 0. NUNCA invente.' },
    ] }],
  }, false, { retries: 0, timeoutMs: Math.min(30000, budget - 3000), noFallback: true });
  return parseJSON(extractText(data));
}

// Confirmação SOB DEMANDA de VALORES consultando o EDITAL (só quando um relatório é pedido —
// sem varredura em massa). Cobre dois casos:
//  - AVALIAÇÃO ausente (ex.: GrupoLance/LJUD judicial — só vem no edital/laudo, não no card);
//  - LANCE MÍNIMO ausente/sentinela (ex.: o scraper anulou um 999999999 — regra do dono:
//    "se vier valor assim, acessar o edital pra confirmar o valor da venda").
// ASSERTIVIDADE: consulta VÁRIAS fontes (edital, matrícula, anexos, página do lote), não só o
// card — HTML por regex; PDF por IA focada. Fetch DIRETO (grátis); o Bright Data (pago) fica para
// o relatório documental. Corrige no banco (com desconto/score) e o que não confirmar vira anomalia.
async function garantirValores(imovelId, deadline) {
  let im = null;
  try {
    const rows = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=fonte,url_lote,link_edital,link_matricula,anexos,valor_avaliacao,valor_minimo&limit=1`)).json();
    im = Array.isArray(rows) ? rows[0] : null;
  } catch { return; }
  if (!im) return;
  const SENT = new Set([999999999, 99999999, 9999999999, 111111111, 123456789]);
  const limpo = (v) => { const n = Number(v) || 0; return SENT.has(n) ? 0 : n; };
  let aval = limpo(im.valor_avaliacao);
  let vmin = limpo(im.valor_minimo);
  const faltaAval = aval <= 0, faltaMin = vmin <= 0;
  if (!faltaAval && !faltaMin) return; // nada a confirmar
  const jaTem = () => (!faltaAval || aval > 0) && (!faltaMin || vmin > 0);

  // Fontes candidatas, do documento mais provável (edital/matrícula/anexos = onde a avaliação
  // realmente consta) para o menos (página do lote, em geral SPA sem o valor). Dedup + externas.
  const anexosUrls = Array.isArray(im.anexos) ? im.anexos.map(a => a?.url).filter(Boolean) : [];
  const candidatos = [...new Set([im.link_edital, im.link_matricula, ...anexosUrls, im.url_lote])]
    .filter(u => u && /^https?:\/\//.test(u) && hostExterno(u));
  // Prioriza DOCUMENTOS (PDF / endpoint de edital) sobre PÁGINAS de lote: a página costuma ser
  // SPA (Grupo Lance/LJUD) — o valor é renderizado por JS e NÃO está no HTML cru do fetch, além
  // de a leitura por IA do PDF exigir ≥12s de orçamento. Tentar o PDF PRIMEIRO garante que ele
  // pegue o tempo (era o bug: o edital-PDF vinha por último e ficava sem orçamento → avaliação
  // "não informada" mesmo com o edital em mãos, ex.: terreno Grupo Lance de Santana de Parnaíba).
  const ehDoc = (u) => /\.pdf(\?|#|$)|\/edital|documentacao/i.test(u) ? 0 : 1;
  candidatos.sort((a, b) => ehDoc(a) - ehDoc(b));

  let usei = im.url_lote || im.link_edital || '';
  for (const url of candidatos) {
    if (jaTem() || Date.now() > deadline) break;
    usei = url;
    let doc = null;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (!buf.length) continue;
      const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
      if (ehPdf) doc = { kind: 'pdf', base64: buf.length <= 6_500_000 ? buf.toString('base64') : null };
      else doc = { kind: 'text', text: buf.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ') };
    } catch { continue; } // fonte inacessível → tenta a próxima
    if (doc.kind === 'text' && doc.text) {
      const txt = doc.text;
      const maior = (re) => { let best = 0; for (const m of txt.matchAll(re)) { const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0; if (v > best) best = v; } return best; };
      if (faltaAval && aval <= 0) { const a = maior(/avalia[çc][aã]o[^R]{0,40}R\$\s*([\d.]+,\d{2})/gi); if (a >= 1000) aval = a; }
      if (faltaMin && vmin <= 0) { const mn = maior(/(?:lance\s*m[íi]nimo|valor\s*m[íi]nimo|lance\s*inicial|1[ºoª°]?\s*(?:leil[aã]o|pra[çc]a)|2[ºoª°]?\s*(?:leil[aã]o|pra[çc]a))[^R]{0,40}R\$\s*([\d.]+,\d{2})/gi); if (mn >= 1000) vmin = mn; }
    } else if (doc.kind === 'pdf' && doc.base64 && Date.now() < deadline) {
      try {
        const ext = await extrairValoresPdf(doc.base64, deadline);
        if (faltaAval && aval <= 0 && Number(ext?.avaliacao) >= 1000) aval = Number(ext.avaliacao);
        if (faltaMin && vmin <= 0 && Number(ext?.lanceMinimo) >= 1000) vmin = Number(ext.lanceMinimo);
      } catch { /* IA falhou nesta fonte → tenta a próxima */ }
    }
  }

  // SANIDADE do valor LIDO do edital: uma avaliação muito acima do lance mínimo (desconto
  // implícito > 90%) é quase sempre MIS-READ (a IA/regex pegou um total de vários lotes, outra
  // métrica, ou erro) — não pode virar um "94% de desconto" FALSO no card. Descarta e sinaliza.
  if (faltaAval && aval > 0 && vmin > 0 && aval > vmin * 10) {
    await registrarAnomalia('avaliacao_incoerente', im.fonte, imovelId, 'valor_avaliacao',
      `Avaliação lida R$${Math.round(aval)} vs lance mínimo R$${Math.round(vmin)} (${(aval / vmin).toFixed(1)}x = desconto ~${Math.round((1 - vmin / aval) * 100)}%) — provável leitura errada do edital. Descartada (mantém sem avaliação).`);
    aval = 0;
  }

  const patch = {};
  if (faltaAval && aval > 0) patch.valor_avaliacao = aval;
  if (faltaMin && vmin > 0) patch.valor_minimo = vmin;
  const par = aval > 0 && vmin > 0 && aval >= vmin; // desconto só faz sentido com avaliação >= mínimo
  if (par && (patch.valor_avaliacao != null || patch.valor_minimo != null)) {
    patch.desconto_percentual = Math.round((1 - vmin / aval) * 100);
    patch.viavel = (1 - vmin / aval) >= 0.3;
    patch.score_viabilidade = Math.min(100, Math.round((1 - vmin / aval) * 150));
  }
  if (Object.keys(patch).length) {
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  }
  if (aval <= 0) await registrarAnomalia('avaliacao_ausente', im.fonte, imovelId, 'valor_avaliacao', `Avaliação não confirmada no edital/matrícula/anexos (${usei || 'sem url'}).`);
  if (vmin <= 0) await registrarAnomalia('valor_minimo_ausente', im.fonte, imovelId, 'valor_minimo', `Lance mínimo não confirmado no edital/matrícula/anexos (${usei || 'sem url'}).`);
}
// Pesquisa de mercado recente do MESMO imóvel (de qualquer usuário). Reaproveitada
// para não refazer a busca cara a cada pedido — só a data é renovada. O laudo
// (parecer) continua sendo gerado por pedido, pois depende do lance/cenário de cada um.
async function mercadoRecente(imovelId) {
  const desde = new Date(Date.now() - REUSE_DIAS * 24 * 3600 * 1000).toISOString();
  const r = await sb(`analises_mercado?imovel_id=eq.${encodeURIComponent(imovelId)}&status=eq.concluida&updated_at=gte.${desde}&select=result,updated_at&order=updated_at.desc&limit=1`);
  if (!r.ok) return null;
  const [row] = await r.json().catch(() => []);
  const mkt = row?.result?.mercado;
  // NÃO reaproveita pesquisa VAZIA (sem amostras nem preço): reusar um resultado
  // ruim propagaria o "mercadológico sem amostras". Melhor refazer a busca.
  if (mkt && (((mkt.vendas?.length || 0) + (mkt.locacoes?.length || 0)) > 0 || mkt.precoMedioM2 > 0)) {
    return { mercado: mkt, em: row.updated_at };
  }
  return null;
}

async function anthropic(payload, useSearch, fetchOpts) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) }, fetchOpts);
  return r.json();
}

export function promptMercado({ endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio }) {
  return `Você é um perito avaliador imobiliário. Realize pesquisa de mercado COMPLETA em DOIS NÍVEIS para o imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

REGRA OBRIGATÓRIA — MESMO TIPO: considere SOMENTE imóveis do MESMO TIPO (${tipoImovel}).
Descarte qualquer amostra de tipo diferente. Compare sempre ${tipoImovel} com ${tipoImovel}.

MÉTODO DE AVALIAÇÃO POR TIPO (DIRECIONE a avaliação pelo tipo "${tipoImovel}" — cada tipo tem
uma BASE DE CÁLCULO e itens próprios; usar a régua errada gera valor irreal):
- Apartamento / unidade em CONDOMÍNIO: preço por m² PRIVATIVO de aptos do mesmo condomínio/edifício e região; ajuste por andar, nº de VAGAS, estado, lazer.
- Casa de rua (urbana): preço por m² CONSTRUÍDO da região/padrão (o terreno padrão já está embutido no comparável de casas); ajuste por padrão construtivo, idade e garagem.
- Imóvel com TERRENO EXCEDENTE (edificação em lote MUITO acima do padrão da quadra): avalie a CONSTRUÇÃO por m² construído E SOME, À PARTE, a ÁREA DE TERRENO EXCEDENTE (o que passa do padrão) por R$/m² de TERRENO. NUNCA multiplique o R$/m² de construção pela área total do lote. Considere potencial de desmembramento/incorporação (zoneamento).
- Terreno / lote urbano: preço por m² de TERRENO (nunca de construção); considere ZONEAMENTO/coeficiente de aproveitamento (potencial construtivo), frente, esquina e topografia.
- Áreas / GLEBAS (grande porte): por m² OU por hectare conforme o porte; considere potencial de PARCELAMENTO/loteamento, infraestrutura e restrições ambientais.
- Comercial (sala, loja, conjunto): preço por m² COMERCIAL na mesma vocação/região; considere ponto/fluxo, vaga e potencial de LOCAÇÃO (cap rate comercial).
- Galpão / INDÚSTRIA / logística: preço por m² de área CONSTRUÍDA do galpão (+ terreno quando relevante), considerando PÉ-DIREITO, docas, piso/carga, ZONEAMENTO industrial, acesso rodoviário e energia; comparáveis de galpões, JAMAIS residenciais.
- Rural (FAZENDA, sítio, chácara): avalie por HECTARE (terra nua) + BENFEITORIAS à parte, considerando aptidão do solo (lavoura/pasto), recursos hídricos, CAR/georreferenciamento, culturas e acesso; comparáveis RURAIS (por ha) da região.
- Vaga de garagem / box: por UNIDADE, com comparáveis de vagas/boxes da região.
- Atípico/especial (posto, hotel, imóvel de uso específico, terreno de marinha): mercado RASO. Busque o tipo específico; sem ao menos 3–4 amostras coerentes, diga EXPLICITAMENTE que a estimativa é apenas INDICATIVA, alargue a faixa (precoMinM2/precoMaxM2) e recomende laudo presencial. NUNCA force média residencial num imóvel atípico/rural.
Se o tipo exigir outra unidade que não o m² de construção (rural por hectare, terreno por m² de lote, vaga por unidade), use essa unidade em precoMedioM2, informe em "consolidado.unidadeValor" e explique a conta em "consolidado.baseCalculo".

REGRA OBRIGATÓRIA — NADA DE LEILÃO NA AMOSTRA: descarte QUALQUER anúncio de leilão, praça,
hasta pública, venda direta bancária/Caixa, alienação fiduciária, extrajudicial/judicial ou
imóvel retomado. Esses preços ficam 30–60% abaixo do mercado e CONTAMINAM a média e o mínimo
(R$/m²). Compare só com o MERCADO LIVRE de venda normal. Outlier muito abaixo dos demais, sem
justificativa, também deve ser descartado como provável leilão disfarçado.

OBJETIVO: reunir o MÁXIMO de amostras possível. Faça várias buscas em fontes diferentes.

═══ NÍVEL 1 — COMPARATIVOS DIRETOS (mesmo condomínio/endereço) ═══
Busque o máximo de anúncios de venda E locação DENTRO do mesmo condomínio/edifício ou
na mesma rua. Se NÃO encontrar ao menos 5 amostras, EXPANDA o raio para ~250m ao redor
do endereço para complementar (mantendo o mesmo tipo de imóvel). Meta: 8+ vendas e 5+ locações.

═══ NÍVEL 2 — VIZINHANÇA (bairro e adjacências, ~1km) ═══
Busque o máximo de anúncios (mesmo tipo) no bairro e adjacências (~1km). Meta: 15+ vendas e 8+ locações.

FONTES (grandes portais): ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Loft, 123i, Chaves na Mão, Net Imóveis. Cruze várias.

FONTES LOCAIS (OBRIGATÓRIO — frequentemente MAIS confiáveis): além dos grandes portais, busque também ANÚNCIOS DE IMOBILIÁRIAS DA PRÓPRIA CIDADE de ${cidade}/${estado}. Pesquise por "imobiliária ${cidade}", "imóveis à venda ${cidade}" (e o bairro, se houver) e abra os sites das imobiliárias locais — os anúncios delas costumam refletir MELHOR o preço praticado na praça e podem ser COMPLEMENTARES ou até DECISIVOS na composição do valor. Inclua essas amostras nos níveis 1/2 com "fonte" = nome da imobiliária local, e dê PESO ao menos igual ao dos grandes portais quando forem recentes e do mesmo tipo/microrregião.

DATA DO ANÚNCIO: para CADA amostra, capture a data no campo "data" (formato "AAAA-MM"; senão "recente").
RECÊNCIA (IMPORTANTE): priorize FORTEMENTE anúncios do ANO CORRENTE e dos últimos ~12 meses. EVITE anúncios com mais de ~18 meses, a menos que não haja recentes suficientes — o preço muda rápido. Na média, dê MENOS peso às amostras antigas. Se a maioria das amostras for antiga (ex.: de anos anteriores), diga isso EXPLICITAMENTE no "comentario" e trate a estimativa como menos precisa (alargue precoMinM2/precoMaxM2).

═══ REFERÊNCIA INDEPENDENTE — ÍNDICE FipeZAP ═══
Busque o Índice FipeZAP mais recente para ${cidade}/${estado}: preço médio de VENDA por m²
(residencial), e a VALORIZAÇÃO acumulada em 12 meses da cidade. É uma referência oficial
independente da média de anúncios — serve para VALIDAR se nossa média está coerente. Se não
achar a cidade, use a região metropolitana/capital mais próxima e sinalize em "fonte". Se não
houver dado confiável, marque "encontrado": false (não invente número).

═══ ZONEAMENTO URBANO (uso do solo) ═══
Consulte o ZONEAMENTO OFICIAL do endereço no órgão municipal (Plano Diretor / Lei de Uso e Ocupação do Solo; em capitais use o GIS oficial: GeoSampa/SP, Data.Rio, IPPUC/Curitiba, BHMap/PBH etc.). Informe a ZONA e o que ela permite (residencial/comercial/misto; e gabarito/coeficiente de aproveitamento se constar) SOMENTE se achar em FONTE OFICIAL — e cite a fonte. Se NÃO houver fonte oficial confiável, marque "encontrado": false e diga exatamente ONDE obter (Secretaria de Urbanismo/Planejamento da Prefeitura, pelo endereço ou inscrição imobiliária). NUNCA invente ou especule a zona.

VALOR ESTIMADO DO IMÓVEL (OBRIGATÓRIO — é o número que sustenta o relatório): em
"consolidado.valorEstimadoImovel" calcule o valor de mercado CONSERVADOR do imóvel pelo MÉTODO
DO TIPO acima (não apenas preço/m² × área quando o tipo não for por m² privativo). Preencha também
"unidadeValor", "areaConsiderada" (a medida que multiplicou: m² privativo/construído/terreno OU
hectares OU unidades) e "baseCalculo" (a conta em texto). Para imóvel com TERRENO EXCEDENTE, some
a construção + o terreno excedente e detalhe em "terrenoExcedente". Se a área da métrica não for
confiável (ex.: veio a área TOTAL no lugar da privativa), DIGA no "comentario" e seja conservador.

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0, "disponiveis": true },
  "nivel2": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0 },
  "consolidado": { "precoMedioM2": 0, "aluguelMedio": 0, "yieldBruto": 0, "yieldLiquido": 0, "valorEstimadoImovel": 0, "unidadeValor": "m2_privativo|m2_construido|m2_terreno|hectare|unidade", "areaConsiderada": 0, "baseCalculo": "(explique a conta: ex.: 'R$ 10.980/m² privativo × 30 m²' ou 'R$ 45.000/ha × 120 ha terra nua + R$ 200k benfeitorias' ou 'construção 90 m² × R$ 4.000 + terreno excedente 300 m² × R$ 800')", "terrenoExcedente": { "haExcedente": false, "areaExcedenteM2": 0, "valorTerrenoExcedente": 0 }, "descontoArremate": null },
  "referenciaFipeZap": { "encontrado": true, "precoMedioM2": 0, "valorizacao12m": 0, "mesReferencia": "AAAA-MM", "localidade": "", "fonte": "" },
  "zoneamento": { "encontrado": false, "zona": "", "resumoUso": "", "fonte": "", "ondeObter": "" },
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis, a tendência e a ADERÊNCIA da média dos anúncios ao FipeZAP (se divergirem >15%, explique por quê)."
}`;
}

// BASE DE CÁLCULO por tipo de imóvel (direciona a avaliação — ver docs/AVALIACAO_POR_TIPO.md).
// Só as bases por m² PRIVATIVO ('residencial'/'comercial') sofrem a guarda de coerência
// área-total×privativa; terreno/rural/indústria/unidade têm métrica própria (m² de terreno,
// hectare, unidade) e usam o valorEstimadoImovel type-correct da IA.
function baseAvaliacaoPorTipo(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (/vaga|garagem|\bbox\b/.test(t)) return 'unidade';
  if (/fazenda|s[íi]tio|ch[aá]cara|rural|agro|gleba/.test(t)) return 'rural';        // R$/hectare
  if (/terreno|lote|\b[aá]rea\b/.test(t)) return 'terreno';                          // R$/m² de terreno
  if (/gal[pn]|ind[uú]stri|log[íi]stic|barrac[aã]o|armaz[eé]m/.test(t)) return 'industrial'; // m² construído galpão
  if (/sala|loja|comercial|conjunto|escrit[óo]rio|laje/.test(t)) return 'comercial'; // m² privativo comercial
  return 'residencial'; // apto/casa: m² privativo/construído
}

// Bloco de débitos/encargos JÁ INFORMADOS que serão assumidos (entram como CUSTO
// na viabilidade). Se constam na documentação do lote → o parecer cita; se não
// constam → cita mesmo assim e aponta ONDE buscar/confirmar (referências).
function blocoDebitos(inp, docs, brlFn) {
  const itens = [];
  if (Number(inp.debitosAssumidos) > 0) itens.push(`Débitos assumidos (gerais): R$ ${brlFn(inp.debitosAssumidos)}`);
  if (Number(inp.iptuMensal) > 0) itens.push(`IPTU: R$ ${brlFn(inp.iptuMensal)}/mês`);
  if (Number(inp.condominioMensal) > 0) itens.push(`Condomínio: R$ ${brlFn(inp.condominioMensal)}/mês`);
  if (Number(inp.laudemio) > 0) itens.push(`Laudêmio: R$ ${brlFn(inp.laudemio)}`);
  if (Number(inp.foreiro) > 0) itens.push(`Foreiro/foro: R$ ${brlFn(inp.foreiro)}`);
  if (!itens.length) return '';
  const temDocs = !!(docs && (docs.edital || docs.matricula || (Array.isArray(docs.anexos) && docs.anexos.length)));
  return `
DÉBITOS/ENCARGOS A ASSUMIR (informados — JÁ ENTRAM como custo na viabilidade acima):
${itens.map(i => '- ' + i).join('\n')}
${temDocs
  ? 'A documentação do lote está disponível (edital/matrícula/anexos). Na seção de débitos, CONFIRME se cada débito acima consta na documentação; para os que constarem, cite a fonte; para os que NÃO estiverem discriminados, sinalize e indique onde obter (referências abaixo).'
  : 'A documentação detalhada do lote NÃO foi anexada. Na seção de débitos, liste-os e — como não há documento discriminando-os — oriente claramente ONDE buscar/confirmar cada um (referências abaixo).'}
REFERÊNCIAS para confirmar/obter os valores quando não constarem na documentação:
- IPTU e taxas municipais: certidão de débitos imobiliários na Prefeitura (Secretaria da Fazenda), pelo número de inscrição/IPTU.
- Condomínio: declaração de débitos condominiais com a administradora ou o síndico.
- Ônus, hipotecas e débitos propter rem: matrícula atualizada no Cartório de Registro de Imóveis competente.
- Responsabilidade por débitos após a arrematação (quem paga o quê): cláusulas do EDITAL do leilão.
- Laudêmio/foro (terreno de marinha): SPU — Secretaria de Patrimônio da União, ou o ente foreiro.`;
}

// Foco do parecer por PERFIL-BASE do investidor (triagem no cadastro). Direciona o
// que o agente prioriza — o mesmo imóvel se defende diferente para cada perfil.
const PERFIL_FOCO = {
  revenda: 'PERFIL DO COMPRADOR: REVENDA (flip). Priorize margem, velocidade de saída e liquidez de revenda; enfatize o teto de lance que preserva o lucro na revenda.',
  locacao: 'PERFIL DO COMPRADOR: LOCAÇÃO (renda). Priorize o yield (aluguel/preço), a renda mensal líquida e o payback pela locação; o cenário de revenda é secundário.',
  uso_proprio: 'PERFIL DO COMPRADOR: USO PRÓPRIO. Priorize a economia frente ao mercado e a adequação ao uso; o piso de 30% de lucro não se aplica.',
  incorporacao: 'PERFIL DO COMPRADOR: INCORPORAÇÃO. Priorize o POTENCIAL CONSTRUTIVO (terreno, aproveitamento e zoneamento) e a viabilidade de incorporar; avalie o valor pelo potencial, não só pelo imóvel atual.',
};

function promptParecer(inp, m, mercado, docs) {
  const usoProprio = inp.objetivoCompra === 'uso_proprio';
  const debitos = blocoDebitos(inp, docs, brl);
  const focoPerfil = PERFIL_FOCO[inp._perfil] || '';
  return `
Redija um PARECER EXECUTIVO MERCADOLÓGICO E DE VIABILIDADE FINANCEIRA como Gestor Sênior da BidPro Brasil.
${focoPerfil ? `\n${focoPerfil}\n` : ''}

ESCOPO ESTRITO: foque EXCLUSIVAMENTE em mercado × valor de aquisição e viabilidade
financeira. NÃO faça análise JURÍDICA (consulta de processo/CNJ, validade de penhora,
gravames, riscos de nulidade, diligências) — isso é dos relatórios DOCUMENTAL e
JURÍDICO. EXCEÇÃO: os DÉBITOS/ENCARGOS A ASSUMIR informados abaixo DEVEM constar,
pois são CUSTO da operação e impactam a viabilidade — apenas no aspecto financeiro
(valor e onde confirmar), sem entrar no mérito jurídico.

IMÓVEL: ${inp.tipo || inp.tipoImovel} — ${inp.endereco}, ${inp.cidade || ''}/${inp.estado || ''}
OBJETIVO: ${usoProprio ? 'USO PRÓPRIO' : 'INVESTIMENTO'}
${inp.nomeCondominio ? `CONDOMÍNIO: ${inp.nomeCondominio}` : ''}

MERCADO:
- Preço médio/m² (média dos anúncios): R$ ${brl(mercado?.precoMedioM2)}
- Aluguel médio: R$ ${brl(mercado?.aluguelMedio)} · Yield: ${(mercado?.yieldBruto || 0).toFixed(2)}% bruto / ${(mercado?.yieldLiquido || 0).toFixed(2)}% líquido
${mercado?.referenciaFipeZap?.encontrado ? `- Referência FipeZAP (${mercado.referenciaFipeZap.localidade || inp.cidade || ''}, ${mercado.referenciaFipeZap.mesReferencia || 'recente'}): R$ ${brl(mercado.referenciaFipeZap.precoMedioM2)}/m² · valorização 12m: ${(Number(mercado.referenciaFipeZap.valorizacao12m) || 0).toFixed(1)}%. Compare com a média dos anúncios acima: se divergirem muito, comente e use a mais conservadora na defesa.` : ''}
${mercado?.indiceBidPro && (Number(mercado.indiceBidPro.venda_m2) > 0 || Number(mercado.indiceBidPro.aluguel_m2) > 0) ? `- Índice BidPro (nossa base própria por microrregião, nível ${mercado.indiceBidPro.nivel})${Number(mercado.indiceBidPro.venda_m2) > 0 ? `: venda R$ ${brl(mercado.indiceBidPro.venda_m2)}/m²` : ''}${Number(mercado.indiceBidPro.aluguel_m2) > 0 ? ` · locação R$ ${brl(mercado.indiceBidPro.aluguel_m2)}/m²/mês` : ''}. Referência interna independente (venda e locação), consolidada das análises da plataforma — use como sanity-check adicional junto ao FipeZAP.` : ''}
${mercado?.valorizacao?.serie?.length >= 2 ? `- Valorização BidPro (${inp.cidade || ''}, venda R$/m² por ano, base própria): ${mercado.valorizacao.serie.map(p => `${p.ano}: R$ ${brl(p.m2)}`).join(' · ')}. Variação no período: ${Number(mercado.valorizacao.valorizacao_periodo_pct).toFixed(1)}% (${Number(mercado.valorizacao.valorizacao_aa_pct).toFixed(1)}% a.a.). Use como leitura de TENDÊNCIA da microrregião (amostras podem ser poucas nos anos iniciais).` : ''}
${(() => {
  const c = mercado?.classificacaoIntencao;
  if (!c || !c.algum) return '';
  const bons = [];
  if (c.revenda) bons.push(`REVENDA — ${c.motivos.revenda}`);
  if (c.locacao) bons.push(`LOCAÇÃO — ${c.motivos.locacao}`);
  if (c.temporada) bons.push(`TEMPORADA — ${c.motivos.temporada}`);
  return `ADEQUAÇÃO POR OBJETIVO (CLASSIFIQUE e DEFENDA no parecer para quais objetivos este imóvel é bom — pode ser um, dois ou os três): ${bons.join(' | ')}. Na seção de posicionamento/defesa, diga EXPLICITAMENTE se o imóvel é bom para REVENDA, LOCAÇÃO e/ou TEMPORADA, usando esses argumentos.${c.temporada ? ' Para TEMPORADA, sustente a ATRATIVIDADE TURÍSTICA da cidade (demanda de alta temporada, ocupação, perfil do público) como diferencial de renda frente à locação tradicional.' : ''}`;
})()}
${mercado?.comentario ? `- Leitura de mercado: ${mercado.comentario}` : ''}

AQUISIÇÃO E RETORNO:
- Lance SEM disputa (lance base): R$ ${brl(inp.valorArrematacao)}
- Lance MÁXIMO COM disputa (preserva o piso de lucro): R$ ${brl(inp._teto)}
- Capital total aportado: R$ ${brl(m.capitalMobilizado)}
- Lucro/Economia estimada: R$ ${brl(m.lucro)}
- Retorno (ROI/ROE): ${(m.roi || 0).toFixed(2)}%
OBSERVAÇÕES: ${inp.observacoes || 'Sem observações adicionais'}
${debitos}

REGRA DE VIABILIDADE:
${usoProprio
  ? '- Como é USO PRÓPRIO, o piso de 30% de lucro NÃO se aplica. O foco é a ECONOMIA frente ao valor de mercado (quanto o comprador economiza ao adquirir no leilão em vez de no mercado). Defenda a aquisição pela economia e adequação ao uso.'
  : '- A operação só é VIÁVEL com no mínimo 30% de lucro líquido. Avalie SEM DISPUTA (lance base) e COM DISPUTA (até o lance máximo que ainda preserva 30%).'}

Escreva em português formal, texto simples (sem markdown/asteriscos e SEM travessão "—"; use vírgula, ponto ou dois-pontos, pois o travessão dá cara de texto gerado por IA e reduz a confiança do cliente). Estruture com "§ SEÇÃO:":
§ SEÇÃO: POSICIONAMENTO ESTRATÉGICO (mercado × valor de aquisição; desconto real frente ao mercado)
${mercado?.classificacaoIntencao?.algum ? '§ SEÇÃO: ADEQUAÇÃO POR OBJETIVO (diga para QUAIS objetivos o imóvel é bom, entre Revenda, Locação e Temporada, podendo ser mais de um, com o porquê de cada; sendo cidade turística, DEFENDA a temporada como diferencial de renda)' : ''}
§ SEÇÃO: CENÁRIOS DE LANCE (sem disputa e com disputa; até onde dá para subir o lance mantendo ${usoProprio ? 'a economia' : 'o piso de 30%'})
§ SEÇÃO: PROJEÇÃO DE RENTABILIDADE (projeção de 12 MESES considerando o pagamento em parcelas até a revenda; deixe claro que VENDER ANTES dos 12 meses AUMENTA o lucro; cite ROI/ROE, yield de locação como alternativa e payback)${debitos ? '\n§ SEÇÃO: DÉBITOS E ENCARGOS ASSUMIDOS (liste os débitos informados que entram como custo; diga se constam na documentação do lote; para os que não constarem, aponte as referências de onde obter/confirmar)' : ''}
§ SEÇÃO: DEFESA DA OPERAÇÃO (argumentos objetivos de por que ${usoProprio ? 'a compra para uso compensa' : 'o investimento compensa'})
§ SEÇÃO: CONCLUSÃO E RECOMENDAÇÃO

IMPORTANTE — SE NÃO HOUVER VIABILIDADE${usoProprio ? ' (economia irrelevante frente ao mercado)' : ' (lucro abaixo de 30%)'}:
seja DIRETO e CURTO. Explique objetivamente O PORQUÊ (ex.: preço de aquisição próximo do
mercado, custos elevados, margem insuficiente) e recomende NÃO avançar. Não alongue o relatório.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  // REGERAÇÃO AUTOMÁTICA (regenerar-relatorios-cron): reprocessa relatório com vício,
  // com orçamento fresco. Autentica pelo CRON_SECRET (não passa por getUser nem cota).
  const isCron = !!process.env.CRON_SECRET && req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  let user;
  if (isCron) {
    if (!req.body?.paraUserId) { res.status(400).json({ error: 'paraUserId obrigatório no cron' }); return; }
    user = { id: String(req.body.paraUserId) };
  } else {
    user = await getUser(req);
    if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel, mercadoInputs, parecerInputs } = body;
  if (!imovelId || !mercadoInputs) { res.status(400).json({ error: 'imovelId e mercadoInputs obrigatórios' }); return; }

  // Geração EM NOME DE (admin/analista ao atribuir um arremate manual): grava sob o
  // CLIENTE (para o relatório pertencer a ele) e não cobra cota — atribuição
  // administrativa gratuita. Só admin/analista pode; senão ignora e usa o próprio.
  let ownerId = user.id, onBehalf = false;
  if (body.paraUserId && body.paraUserId !== user.id) {
    try {
      const [p] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (p && (p.role === 'admin' || p.role === 'analista')) { ownerId = String(body.paraUserId); onBehalf = true; }
    } catch { /* mantém o próprio */ }
  }

  // Data do leilão (para a regra de limpeza: 15 dias após o leilão sem arrematar).
  const rawData = imovel?.dataLeilao || parecerInputs?.d?.dataLeilao || null;
  const dataLeilao = rawData && !isNaN(Date.parse(rawData)) ? new Date(rawData).toISOString() : null;
  const base = { user_id: ownerId, imovel_id: String(imovelId), titulo: titulo || null, cidade: cidade || null, estado: estado || null, imovel: imovel || null, inputs: { mercadoInputs, parecerInputs }, data_leilao: dataLeilao };

  // ── Cota NO SERVIDOR (anti-abuso do custo de IA) ────────────────────────────
  // A cota é consumida aqui (onde o custo ocorre), não mais só no cliente — que
  // podia ser burlado chamando esta API direto. Cobra apenas em análise NOVA
  // deste imóvel para este usuário; re-gerar/atualizar o mesmo imóvel não recobra
  // (espelha o "isNovo" do cliente). Falha na checagem não trava quem tem direito.
  let cota = null;
  try {
    const jaConcluida = await (await sb(`analises_mercado?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=imovel_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaConcluida) && jaConcluida.length);
    if (isNovo && !onBehalf && !isCron) {
      const rc = await sb('rpc/consumir_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null);
      if (cota && cota.ok === false) {
        const msg = cota.erro === 'limite_mensal' ? 'Limite mensal de análises atingido para o seu plano.'
          : cota.erro === 'sem_credito' ? 'Você não tem créditos de análise disponíveis.'
          : 'Cota de análises indisponível.';
        res.status(402).json({ error: msg, cota });
        return;
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }

  // ORÇAMENTO DE TEMPO GLOBAL (< maxDuration 300s). Toda etapa cara (edital, busca de mercado,
  // parecer) é limitada ao tempo RESTANTE — nunca inicia uma chamada que não caberia antes do
  // corte da Vercel. Foi o que resolveu o timeout: antes, o anthropicFetch com retries:1 podia
  // rodar 2×200s por chamada (+ um retry por "sem amostras") e estourar o deadline de 270s;
  // agora cada busca é 1 tentativa (retries:0) com timeout = tempo restante e o retry só ocorre
  // se couber. O deadline vira BACKSTOP (não mais a 1ª linha de defesa).
  const T0 = Date.now();
  const HARD_MS = 285000; // < maxDuration 300s, deixa ~15s p/ gravar 'erro'/'concluida' e responder
  const restante = () => HARD_MS - (Date.now() - T0);

  // Confirmação sob demanda dos VALORES (avaliação + lance mínimo) consultando EDITAL/MATRÍCULA/
  // ANEXOS (não só a página do lote) — corrige avaliação zerada e valor sentinela; o que não
  // confirmar vira anomalia. Limitada a uma fração do orçamento p/ não roubar tempo do mercado.
  try { await garantirValores(String(imovelId), Date.now() + Math.min(30000, Math.max(0, restante() - 235000))); } catch { /* nunca bloqueia o relatório */ }

  await upsertAnalise({ ...base, status: 'gerando', erro: null, result: null });

  const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo_limite')), Math.max(20000, restante())));

  try {
    const { result, valorMercado, avalDb, vminImovel } = await Promise.race([prazo, (async () => {
    // 1) Mercado — reaproveita pesquisa recente do mesmo imóvel (se houver), senão busca.
    // INVALIDAÇÃO type-aware: uma pesquisa antiga (anterior à avaliação por tipo) NÃO traz
    // consolidado.valorEstimadoImovel/baseCalculo. Para bases por m² construído/privativo
    // (residencial/comercial/industrial) isso é ok — o cálculo cai no precoM2×área. Mas para
    // TERRENO/RURAL/UNIDADE não há esse fallback (a régua é m² de terreno/hectare/unidade),
    // então reaproveitar o cache antigo deixaria o valor VAZIO. Nesses tipos, se o cache não
    // for type-aware, IGNORAMOS e refazemos a busca (recalcula com o método do tipo).
    let mercado, reaproveitado = false;
    const recente = await mercadoRecente(String(imovelId));
    const baseReuso = baseAvaliacaoPorTipo(mercadoInputs.tipoImovel || imovel?.tipo);
    const cacheTypeAware = (c) => !!(c?.consolidado?.baseCalculo) || Number(c?.consolidado?.valorEstimadoImovel) > 0;
    const reusoValido = recente && (cacheTypeAware(recente.mercado) || ['residencial', 'comercial', 'industrial'].includes(baseReuso));
    if (reusoValido) {
      mercado = { ...recente.mercado, reaproveitado: true, pesquisaEm: recente.em };
      reaproveitado = true;
    } else {
      // A busca de mercado (web search, até 5 buscas) é a etapa lenta. UMA tentativa por
      // chamada (retries:0) com timeout = tempo RESTANTE reservando o parecer — assim duas
      // buscas NUNCA somam mais que o orçamento. Se a chamada abortar/falhar, devolve
      // { __falhou:true } (o chamador decide re-tentar ou marcar transitório p/ self-heal).
      const RESERVA_PARECER = 55000; // guarda p/ o parecer + a escrita final
      const buscarMercado = async (msBudget) => {
        try {
          const mData = await anthropic({
            model: MODEL, max_tokens: 8000,
            tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
            system: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${mercadoInputs.tipoImovel}). Retorne apenas JSON válido.`,
            messages: [{ role: 'user', content: promptMercado(mercadoInputs) }],
          }, true, { retries: 0, timeoutMs: Math.max(45000, msBudget), noFallback: true });
          const m = parseJSON(extractText(mData)) || {};
          m.precoMedioM2 = m.consolidado?.precoMedioM2 || m.nivel2?.precoMedioM2 || 0;
          m.aluguelMedio = m.consolidado?.aluguelMedio || 0;
          m.yieldBruto = m.consolidado?.yieldBruto || 0;
          m.yieldLiquido = m.consolidado?.yieldLiquido || 0;
          m.vendas = m.nivel2?.vendas || [];
          m.locacoes = m.nivel2?.locacoes || [];
          m.pesquisaEm = new Date().toISOString();
          return m;
        } catch { return { __falhou: true }; } // abort/timeout/erro → o chamador trata
      };
      const semAmostras = (m) => ((m.vendas?.length || 0) + (m.locacoes?.length || 0)) === 0 && !(m.precoMedioM2 > 0);
      // 1ª busca: guarda a reserva do parecer E ~80s p/ uma 2ª tentativa (uma busca que TRAVA
      // aborta antes e a re-tentativa costuma concluir — 2 ataques mais curtos > 1 longo).
      mercado = await buscarMercado(Math.min(135000, restante() - RESERVA_PARECER - 80000));
      // Re-tenta se (vazio OU falhou) E ainda há orçamento p/ outra busca + parecer.
      if ((semAmostras(mercado) || mercado.__falhou) && restante() > RESERVA_PARECER + 40000) {
        mercado = await buscarMercado(Math.min(110000, restante() - RESERVA_PARECER));
      }
      // A busca FALHOU (abort/timeout/erro), não é "mercado vazio de verdade": trata como
      // TRANSITÓRIO → grava 'erro' com tempo_limite e o self-heal (cron) re-tenta com orçamento
      // fresco. Um mercado genuinamente vazio (JSON válido sem amostras) SEGUE e vira relatório.
      if (mercado.__falhou) throw new Error('tempo_limite');
    }

    const precoM2 = Number(mercado.precoMedioM2) || 0;
    // A base do valor de mercado é a ÁREA PRIVATIVA (útil). Fonte de verdade da metragem é a
    // MATRÍCULA/EDITAL: quando o documental já leu e extraiu a privativa (ficha_juridica.
    // areaPrivativaM2), ela PREVALECE sobre a área do site (que às vezes é a total/terreno) e
    // sobre a área do cliente. Sem documental ainda, usa a área informada e a coerência abaixo
    // protege o número. Também lemos avaliação/fonte para a checagem de coerência.
    let areaM2 = Number(mercadoInputs.areaM2) || 0;
    let avalDb = 0, fonteDb = '', areaFonte = 'informada';
    let imDb = null; // reusado depois para semear/ler o Índice BidPro da microrregião
    try {
      [imDb] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=fonte,valor_avaliacao,valor_minimo,area_m2,ficha_juridica,cidade_norm,estado,bairro,latitude,longitude&limit=1`)).json();
      const n = Number(imDb?.valor_avaliacao) || 0;
      const vminDb = Number(imDb?.valor_minimo) || 0;
      const sentinela = [999999999, 99999999, 9999999999, 111111111, 123456789].includes(n);
      // TRAVA DE CREDIBILIDADE: avaliação que implica desconto >= 88% (aval > 8,3x o mínimo) é
      // quase sempre mis-read do edital ou valor "grudado" de outro lote pelo scraper. NÃO pode
      // virar um "95% OFF" falso no relatório do cliente → trata como ausente (mostra "a
      // confirmar" em vez de mentir). O card/busca é protegido pela limpeza de dados + monitor.
      const implausivel = n > 0 && vminDb > 0 && (1 - vminDb / n) >= 0.88;
      avalDb = (sentinela || implausivel) ? 0 : n;
      if (implausivel) { try { await registrarAnomalia('avaliacao_implausivel', imDb?.fonte || '', imovelId, 'valor_avaliacao',
        `Avaliação R$${Math.round(n)} vs mínimo R$${Math.round(vminDb)} = desconto ~${Math.round((1 - vminDb / n) * 100)}% — implausível/grudada; ignorada no relatório.`); } catch { /* log best-effort */ } }
      fonteDb = imDb?.fonte || '';
      const aDoc = Number(imDb?.ficha_juridica?.areaPrivativaM2) || 0;
      if (aDoc >= 5 && aDoc <= 100000) { areaM2 = aDoc; areaFonte = 'matricula'; } // autoritativa
    } catch { /* segue com a área informada */ }
    // VALOR type-correct: o avaliador (IA) calcula valorEstimadoImovel pelo MÉTODO DO TIPO
    // (m² privativo/construído, m² de terreno, hectare, terreno excedente à parte) — preferimos
    // esse número. Só caímos no m²×área quando a IA não o forneceu E a base é por m² construído/
    // privativo (residencial/comercial/industrial); terreno/rural sem estimativa ficam sem valor
    // (o front pede o dado) em vez de multiplicar a régua errada.
    const baseTipo = baseAvaliacaoPorTipo(mercadoInputs.tipoImovel || imovel?.tipo);
    const vEstIA = Number(mercado?.consolidado?.valorEstimadoImovel) || 0;
    let valorMercado = null;
    if (vEstIA > 0) valorMercado = Math.round(vEstIA);
    else if (precoM2 && areaM2 && ['residencial', 'comercial', 'industrial'].includes(baseTipo)) valorMercado = Math.round(precoM2 * areaM2 * 0.9);
    // COERÊNCIA (só bases por m² privativo/construído) — se o R$/m² dos comparáveis divergir
    // MUITO do R$/m² implícito na AVALIAÇÃO (área provável TOTAL/terreno, não privativa: 121 m²
    // × R$10.980 = R$1,3M vs avaliação R$329k gerava desconto/ROI irreais), ancoramos o mercado
    // na AVALIAÇÃO (conservador), sinalizamos o alerta p/ o front pedir a privativa e registramos
    // anomalia. Não se aplica quando a área veio da matrícula nem a terreno/rural/unidade.
    let areaAlerta = null;
    try {
      if (valorMercado && avalDb > 0 && areaM2 > 0 && precoM2 > 0 && areaFonte !== 'matricula' && (baseTipo === 'residencial' || baseTipo === 'comercial')) {
        const avalM2 = avalDb / areaM2;
        if (precoM2 > 3 * avalM2) {
          const areaPriv = Math.round(avalDb / precoM2);
          areaAlerta = { areaUsada: areaM2, compM2: Math.round(precoM2), avalM2: Math.round(avalM2), areaPrivativaImplicita: areaPriv, motivo: 'area_provavel_total_nao_privativa' };
          valorMercado = Math.round(avalDb); // âncora conservadora (avaliação), não o comps×área inflado
          await registrarAnomalia('mercado_area_incoerente', fonteDb, imovelId, 'area_m2',
            `Comparáveis R$${Math.round(precoM2)}/m² vs avaliação R$${Math.round(avalM2)}/m² (${(precoM2 / avalM2).toFixed(1)}x) — área ${areaM2} m² provável TOTAL, não privativa (~${areaPriv} m²). Mercado ancorado na avaliação.`);
        }
      }
    } catch { /* coerência é best-effort: nunca bloqueia o relatório */ }
    mercado.areaAlerta = areaAlerta; // null quando coerente (limpa alerta antigo em reaproveitamento)
    const valorLocacao = mercado.aluguelMedio ? Math.round(mercado.aluguelMedio) : null;

    // ÍNDICE BIDPRO (loop com os relatórios — fecha o ciclo de cidade_indicadores):
    // (1) SEMEIA a microrregião com venda R$/m² e aluguel R$/m² REAIS deste relatório;
    // (2) LÊ o índice consolidado (bairro > grid > cidade) para CONSTAR no relatório
    //     (venda e locação). Só residencial: o índice é por m² privativo — terreno/rural
    //     têm régua própria (m² de terreno/hectare) e contaminariam a base residencial.
    mercado.indiceBidPro = null;
    if (baseTipo === 'residencial') {
      const nAmostras = (Number(mercado.nivel1?.totalAmostras) || 0) + (Number(mercado.nivel2?.totalAmostras) || 0)
        || ((mercado.vendas?.length || 0) + (mercado.locacoes?.length || 0));
      const aluguelM2 = (Number(mercado.aluguelMedio) > 0 && areaM2 > 0) ? Number(mercado.aluguelMedio) / areaM2 : null;
      await semearIndiceBidPro(imDb, precoM2, aluguelM2, nAmostras);
      mercado.indiceBidPro = await lerIndiceBidPro(imDb);
      // Amostras datadas (valorização/recência) + curva de valorização por ano no relatório.
      await gravarAmostrasIndice(imDb, mercado, imovelId);
      mercado.valorizacao = await lerValorizacao(imDb);
    }

    // CLASSIFICAÇÃO DE INTENÇÃO (revenda/locação/temporada) — consta no relatório e vira defesa no
    // parecer. Desconto pela avaliação confirmada (avalDb) × lance mínimo; yield do mercado ou índice.
    const vminImovel = Number(imDb?.valor_minimo) || 0;
    const descontoImovel = (avalDb > 0 && vminImovel > 0 && avalDb >= vminImovel) ? (1 - vminImovel / avalDb) * 100 : 0;
    const yieldParaCls = Number(mercado.yieldBruto) > 0 ? Number(mercado.yieldBruto)
      : (Number(mercado.indiceBidPro?.aluguel_m2) > 0 && Number(mercado.indiceBidPro?.venda_m2) > 0
        ? Number(mercado.indiceBidPro.aluguel_m2) * 12 / Number(mercado.indiceBidPro.venda_m2) * 100 : 0);
    mercado.classificacaoIntencao = classificarIntencao({ baseTipo, desconto: descontoImovel, yieldBruto: yieldParaCls, cidadeNorm: imDb?.cidade_norm });

    // 2) Laudo (parecer). Carrega os docs do lote para o parecer poder dizer se os
    // débitos informados já constam na documentação (ou apontar onde buscar).
    let parecer = '';
    // Só gera o parecer se ainda houver orçamento (a pesquisa de mercado é a etapa cara e já
    // rodou). Sem tempo, ENTREGA o relatório de mercado SEM o parecer — melhor que estourar o
    // deadline e perder TUDO. O parecer curto (regen) pode vir depois.
    if (parecerInputs?.d && restante() > 25000) {
      try {
        let docs = null;
        try {
          const [dRow] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=link_edital,link_matricula,link_regras_venda,anexos&limit=1`)).json();
          if (dRow) docs = { edital: dRow.link_edital, matricula: dRow.link_matricula, regras: dRow.link_regras_venda, anexos: dRow.anexos };
        } catch { /* sem docs → o parecer orienta onde buscar */ }
        // Perfil-base do investidor (triagem) — direciona o foco do parecer.
        let perfilInvestidor = null;
        try {
          const [p] = await (await sb(`perfis?id=eq.${ownerId}&select=perfil_investidor&limit=1`)).json();
          perfilInvestidor = p?.perfil_investidor || null;
        } catch { /* sem perfil → parecer padrão pelo objetivoCompra */ }
        const pInp = { ...parecerInputs.d, valorMercado: valorMercado || parecerInputs.d.valorMercado, _cenario: parecerInputs.cenario, _teto: parecerInputs.teto, _perfil: perfilInvestidor };
        // APRENDIZADO: correções que analistas fizeram em avaliações anteriores
        // (via transcrição de reunião → mercado_aprendizado) voltam ao prompt. No-op
        // enquanto não houver lições; fica mais assertivo com o uso.
        let aprendizadoMercado = '';
        try {
          const licoes = await (await sb('mercado_aprendizado?select=campo,valor_ia,valor_real,observacao&order=criado_em.desc&limit=30')).json();
          if (Array.isArray(licoes)) {
            const linhas = licoes
              .filter(l => l && (l.valor_real || l.observacao))
              .map(l => `- ${l.campo ? l.campo + ': ' : ''}o sistema estimou "${String(l.valor_ia || '—').slice(0, 100)}", o analista corrigiu para "${String(l.valor_real || '—').slice(0, 100)}"${l.observacao ? ` — ${String(l.observacao).slice(0, 160)}` : ''}`);
            if (linhas.length) aprendizadoMercado = `\n\nAPRENDIZADOS COM ANALISTAS (correções reais de avaliações anteriores — aplique estas lições e evite repetir os mesmos erros):\n${linhas.join('\n')}`;
          }
        } catch { /* aprendizado é best-effort */ }
        // Calibração por ARREMATES REAIS (previsto×realizado, por modalidade).
        try { aprendizadoMercado += await resumoAprendizadoTexto(imovel?.modalidade || null); } catch { /* best-effort */ }
        // Corpus coletivo da MESMA região/tipo (aprendizado das emissões anteriores).
        try { aprendizadoMercado += await corpusDaRegiao(imovel?.estado || null, imovel?.tipo || null); } catch { /* best-effort */ }
        const pData = await anthropic({
          model: MODEL, max_tokens: 8000,
          system: 'Você é gestor sênior da BidPro Brasil. Redija um parecer MERCADOLÓGICO e de VIABILIDADE FINANCEIRA. Não faça análise jurídica (CNJ, gravames, diligências) — isso é de outros relatórios. EXCEÇÃO: os débitos/encargos informados que serão assumidos DEVEM constar (são custo da operação), com a indicação de onde confirmá-los. Preciso e persuasivo. Nunca use markdown nem asteriscos. Nunca use travessão (o caractere "—"); escreva com vírgula, ponto ou dois-pontos. Apenas texto simples.' + aprendizadoMercado,
          messages: [{ role: 'user', content: promptParecer(pInp, parecerInputs.metricas || {}, mercado, docs) }],
        }, false, { retries: 0, timeoutMs: Math.min(55000, restante() - 12000), noFallback: true });
        parecer = extractText(pData);
      } catch { /* laudo é complementar */ }
    }

    // Lembrete fixo (não-IA): a análise é apoio e não substitui a verificação
    // presencial. Recomenda visitar o imóvel ou ver um similar com corretor.
    const AVISO_MERCADO = '§ SEÇÃO: LEMBRETE E PRÓXIMO PASSO\nEsta análise mercadológica é gerada com apoio de inteligência artificial e tem caráter informativo — pode conter imprecisões e não substitui a verificação presencial. Antes de decidir, recomendamos VISITAR o imóvel pessoalmente ou AGENDAR com um corretor de confiança para conhecer um imóvel similar na região, confirmando estado de conservação, localização e o valor praticado no mercado.';
    if (parecer) parecer += `\n\n${AVISO_MERCADO}`;

      const result = { mercado, parecer, valorMercado, valorLocacao, reaproveitado, pesquisaEm: mercado.pesquisaEm };
      return { result, valorMercado, avalDb, vminImovel };
    })()]);

    await upsertAnalise({ ...base, status: 'concluida', erro: null, result });
    // Aprende NA EMISSÃO (durável, sem IA): corpus + qualidade → agente_aprendizado.
    // mercado/parecer vivem DENTRO do Promise.race acima; aqui usamos o result (que os
    // carrega) para não referenciar variável fora de escopo (bug "mercado is not defined").
    await aprenderNaEmissao(imovel, result.mercado, !!result.parecer, avalDb, vminImovel);

    // SEGURANÇA: NÃO realimentar o score do CARD do catálogo com valores desta análise.
    // roi (parecerInputs.metricas) e areaM2 (mercadoInputs) vêm do CLIENTE e são
    // por-cenário — assim um usuário conseguia ENVENENAR score_financeiro/analise_viavel/
    // valor_mercado que TODOS veem naquele imóvel. O score do catálogo é calculado pelo
    // processo confiável (api/calcular-score.js) a partir dos dados do PRÓPRIO imóvel,
    // nunca por input de usuário. A análise individual continua salva acima (upsertAnalise)
    // e visível só para quem a gerou.
    res.status(200).json({ ok: true, result, cota });
  } catch (e) {
    const timeout = String(e?.message) === 'tempo_limite';
    const msg = timeout
      ? 'A pesquisa de mercado demorou mais que o tempo limite do servidor. Costuma ser temporário: tente gerar novamente.'
      : String(e?.message || e);
    await upsertAnalise({ ...base, status: 'erro', erro: msg });
    // Estorna a cota consumida (não cobra por análise que falhou; evita cobrança
    // dupla na re-tentativa, já que 'erro' não conta como concluída em isNovo).
    if (cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
    }
    res.status(timeout ? 504 : 500).json({ error: timeout ? 'Tempo limite ao gerar a análise' : 'Falha ao gerar a análise', detalhe: msg });
  }
}
