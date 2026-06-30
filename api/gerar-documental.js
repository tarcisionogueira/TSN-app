// Geração da ANÁLISE DOCUMENTAL + PROCESSO NO SERVIDOR (persistente).
// Lê edital, matrícula e demais anexos do lote (via Bright Data quando o host
// bloqueia o servidor), extrai ônus/gravames/débitos/ocupação e CONSULTA o CNJ.
// O cliente dispara e pode FECHAR a aba: a função Vercel continua e grava em
// `analises_documental`. Espelha a mecânica de gerar-analise.js (mercadológico).
//
// ESCOPO: documental/jurídico (leitura dos documentos + processo). A viabilidade
// financeira e o mercado ficam no relatório MERCADOLÓGICO (gerar-analise.js).
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { fetchViaBrightData } from './_brightdata.js';
import { buscarProcessosCNJ } from './_cnj.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertDoc(row) {
  await sb('analises_documental?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}
async function anthropic(payload) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
  return r.json();
}

// Lê um documento do lote: PDF → base64 (bloco document); HTML/texto → texto
// limpo. Tenta fetch direto e cai no Bright Data quando o host bloqueia o servidor.
async function lerDoc(url, deadline) {
  if (!url || !/^https?:\/\//.test(url) || Date.now() > deadline) return null;
  const h = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' };
  let resp = null;
  try { resp = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(12000) }); } catch { resp = null; }
  let buf = null, ct = '';
  if (resp && resp.ok) { ct = resp.headers.get('content-type') || ''; buf = Buffer.from(await resp.arrayBuffer().catch(() => new ArrayBuffer(0))); }
  if (!buf || !buf.length) {
    const bd = await fetchViaBrightData(url);
    if (bd && bd.ok) { ct = bd.headers.get('content-type') || ''; buf = Buffer.from(await bd.arrayBuffer().catch(() => new ArrayBuffer(0))); }
  }
  if (!buf || !buf.length) return null;
  const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
  if (ehPdf) {
    // PDFs muito grandes estouram o payload — limita a ~9 MB de base64.
    if (buf.length > 6_500_000) return null;
    return { kind: 'pdf', base64: buf.toString('base64'), url };
  }
  // HTML/texto: remove tags e compacta.
  const txt = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (txt.length < 80) return null;
  return { kind: 'text', text: txt.slice(0, 12000), url };
}

const promptDocumental = (im, temProc) => `Você é advogado especialista em leilões de imóveis. Analise os DOCUMENTOS anexados (edital, matrícula e demais anexos do lote)${temProc ? ' e os PROCESSOS consultados no CNJ' : ''} e produza uma ANÁLISE DOCUMENTAL E JURÍDICA do imóvel:
- Tipo: ${im.tipo || 'imóvel'} — ${im.endereco || ''}, ${im.cidade || ''}/${im.estado || ''}
- Modalidade: ${im.modalidade || 'não informada'}

ESCOPO: leitura dos documentos e situação processual. NÃO faça análise de mercado/preço/viabilidade financeira (isso é do relatório MERCADOLÓGICO).

Avalie e descreva: ônus reais, gravames, hipotecas, penhoras, arrestos, indisponibilidades, usufruto, alienação fiduciária; ocupação (ocupado/desocupado/posseiro/locado) e quem responde pela desocupação; débitos discriminados (IPTU, condomínio, taxas) e DE QUEM é a responsabilidade após a arrematação (conforme o edital); condições do edital (forma de pagamento, prazos, comissão, AJG); restrições registrárias; e a situação do(s) processo(s).

REGRA IMPORTANTE: se algum dado (ex.: débitos, ônus, ocupação) NÃO estiver discriminado nos documentos disponíveis, NÃO invente — sinalize como "não consta na documentação analisada" e indique ONDE confirmar (certidão de débitos na Prefeitura; declaração de débitos com a administradora/síndico; matrícula atualizada no Cartório de Registro de Imóveis; cláusulas do edital; SPU para laudêmio/foro).

Retorne APENAS este JSON (sem markdown):
{
  "extracao": { "numeroMatricula": "", "numeroEdital": "", "numeroProcesso": "", "origem": "judicial|extrajudicial", "ocupacao": "", "responsavelDesocupacao": "", "debitosDiscriminados": [{"tipo":"","valor":0,"responsavel":"","constaNaDoc":true}], "responsabilidadeDebitos": "", "formaPagamento": "", "comissaoLeiloeiro": "" },
  "riscos": [{"categoria":"","descricao":"","severidade":"bloqueante|alerta|informativo","constaNaDoc":true}],
  "lacunas": ["dados que NÃO constam na documentação e onde confirmar"],
  "nivelRisco": "verde|amarelo|vermelho",
  "parecer": "Parecer documental/jurídico em português formal, texto simples (sem markdown/asteriscos), estruturado com '§ SEÇÃO:' — § SEÇÃO: SITUAÇÃO REGISTRÁRIA (matrícula/ônus/gravames); § SEÇÃO: OCUPAÇÃO E POSSE; § SEÇÃO: DÉBITOS E RESPONSABILIDADES (o que consta e o que precisa ser confirmado, com as referências); § SEÇÃO: CONDIÇÕES DO EDITAL; § SEÇÃO: SITUAÇÃO PROCESSUAL${temProc ? ' (com base no CNJ)' : ''}; § SEÇÃO: CONCLUSÃO E DILIGÊNCIAS RECOMENDADAS."
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel } = body;
  if (!imovelId) { res.status(400).json({ error: 'imovelId obrigatório' }); return; }

  // Carrega os documentos do lote do banco (fonte da verdade).
  let row = null;
  try {
    const [r] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=tipo,endereco,cidade,estado,modalidade,link_edital,link_matricula,link_regras_venda,anexos,numero_processo&limit=1`)).json();
    row = r || null;
  } catch { /* segue com o que veio no body */ }

  const im = {
    tipo: imovel?.tipo || row?.tipo, endereco: imovel?.endereco || row?.endereco,
    cidade: cidade || imovel?.cidade || row?.cidade, estado: estado || imovel?.estado || row?.estado,
    modalidade: imovel?.modalidade || row?.modalidade,
  };
  const dataLeilao = (() => {
    const raw = imovel?.dataLeilao || null;
    return raw && !isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  })();

  const base = { user_id: user.id, imovel_id: String(imovelId), titulo: titulo || im.endereco || null, cidade: im.cidade || null, estado: im.estado || null, imovel: imovel || null, inputs: body.inputs || null, data_leilao: dataLeilao };
  await upsertDoc({ ...base, status: 'gerando', erro: null, result: null });

  const deadline = Date.now() + 250000;
  try {
    // 1) Reúne os documentos: edital, matrícula e até 2 anexos relevantes.
    const anexos = Array.isArray(row?.anexos) ? row.anexos : [];
    const urls = [];
    const add = (u, rotulo) => { if (u && /^https?:\/\//.test(u) && !urls.find(x => x.url === u)) urls.push({ url: u, rotulo }); };
    add(row?.link_matricula, 'Matrícula');
    add(row?.link_edital || body?.urlEdital, 'Edital');
    add(row?.link_regras_venda, 'Regras de venda');
    for (const a of anexos) { if (urls.length >= 5) break; add(a.url, a.nome || 'Anexo'); }
    // Também os anexos enviados pela EQUIPE (tabela imovel_anexos) — senão uma
    // matrícula/edital subida manualmente fica invisível para a IA documental.
    try {
      const manuais = await (await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(String(imovelId))}&select=tipo,nome,url&limit=10`)).json();
      for (const a of (Array.isArray(manuais) ? manuais : [])) {
        if (urls.length >= 7) break;
        add(a.url, a.nome || (a.tipo ? a.tipo[0].toUpperCase() + a.tipo.slice(1) : 'Anexo'));
      }
    } catch { /* sem anexos manuais → segue com os do lote */ }

    const blocos = [];
    const lidos = [];
    for (const u of urls) {
      if (blocos.length >= 4 || Date.now() > deadline) break; // limita custo/payload
      const doc = await lerDoc(u.url, deadline);
      if (!doc) continue;
      lidos.push({ rotulo: u.rotulo, url: u.url, kind: doc.kind });
      if (doc.kind === 'pdf') blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 }, title: u.rotulo });
      else blocos.push({ type: 'text', text: `=== ${u.rotulo} (${u.url}) ===\n${doc.text}` });
    }
    // Texto colado manualmente (inclusão manual / fallback).
    if (body?.textoEdital) blocos.push({ type: 'text', text: `=== EDITAL (texto informado) ===\n${String(body.textoEdital).slice(0, 12000)}` });
    if (body?.textoMatricula) blocos.push({ type: 'text', text: `=== MATRÍCULA (texto informado) ===\n${String(body.textoMatricula).slice(0, 12000)}` });

    // 2) Consulta o CNJ (quando há processo e UF). Modalidade judicial prioriza.
    const procNum = body?.processoNumero || row?.numero_processo || null;
    const procNome = body?.processoNome || null;
    let cnj = null;
    if ((procNum || procNome) && im.estado && Date.now() < deadline) {
      try { cnj = await buscarProcessosCNJ({ numero_processo: procNum || undefined, nome_parte: procNome || undefined, uf: im.estado }); }
      catch { /* CNJ pode estar indisponível */ }
    }

    // 3) Monta a mensagem para o Claude (documentos + resumo do CNJ).
    const temProc = !!(cnj && cnj.total);
    const content = [...blocos];
    if (temProc) {
      const resumoProc = cnj.processos.slice(0, 8).map(p => `- ${p.numero} (${p.tribunal || ''}) classe ${p.classe || '-'} | riscos: ${(p.riscos || []).map(r => r.categoria).join(', ') || 'nenhum'}`).join('\n');
      content.push({ type: 'text', text: `=== PROCESSOS CNJ (${cnj.total}) ===\nParecer automático: ${cnj.parecer?.texto || ''}\n${resumoProc}` });
    }
    if (!content.length) content.push({ type: 'text', text: 'Nenhum documento pôde ser lido automaticamente. Produza a análise possível e detalhe em "lacunas" o que precisa ser obtido e onde.' });
    content.push({ type: 'text', text: promptDocumental(im, temProc) });

    const data = await anthropic({
      model: MODEL, max_tokens: 6000,
      system: 'Você é advogado especialista em leilões de imóveis. Análise documental e processual — sem análise de mercado/preço. Não invente dados ausentes: sinalize lacunas e onde confirmar. Retorne apenas JSON válido.',
      messages: [{ role: 'user', content }],
    });
    const parsed = parseJSON(extractText(data)) || {};

    const result = {
      extracao: parsed.extracao || null,
      riscos: parsed.riscos || [],
      lacunas: parsed.lacunas || [],
      nivelRisco: parsed.nivelRisco || (temProc ? cnj.parecer?.nivel : null) || 'amarelo',
      parecer: parsed.parecer || '',
      cnj: cnj ? { total: cnj.total, parecer: cnj.parecer, processos: cnj.processos?.slice(0, 12) || [], tribunais: cnj.tribunais_consultados } : null,
      documentosLidos: lidos,
      geradoEm: new Date().toISOString(),
    };
    await upsertDoc({ ...base, status: 'concluida', erro: null, result });
    res.status(200).json({ ok: true, result });
  } catch (e) {
    await upsertDoc({ ...base, status: 'erro', erro: String(e?.message || e) });
    res.status(500).json({ error: 'Falha ao gerar a análise documental', detalhe: String(e?.message || e) });
  }
}
