/**
 * /api/saque-nf — NOTA FISCAL do saque acima do teto, conferida pela IA.
 *
 * REGRA (dono, 08/08): o parceiro grátis ganha comissão em todos os fluxos e saca
 * direto até o teto do mês (`regra_negocio.saque.teto_sem_nf`, hoje R$ 2.500).
 * Ao ultrapassar isso no mês, o saque passa a exigir plano pago E nota fiscal —
 * "a IA confrontando para ver se a nota de fato foi emitida".
 *
 * O QUE DÁ E O QUE NÃO DÁ PARA PROVAR — importa não confundir os dois:
 *   - LER a nota e conferir os dados (emitente, tomador, valor, data) é barato e
 *     pega o erro honesto e a maior parte da fraude preguiçosa. Mas NÃO prova
 *     emissão: um PDF bem feito passa por qualquer leitura.
 *   - A ÚNICA prova real de emissão é o link/QR de verificação que a própria
 *     prefeitura imprime na NFS-e. Quando a nota traz esse link, o servidor ABRE
 *     e confere se a página responde e cita o número da nota. Aí sim é prova.
 *   - Nota sem link de verificação NÃO é reprovada (muitos municípios não põem):
 *     vai para revisão humana, com o motivo escrito. Reprovar o parceiro por uma
 *     limitação da prefeitura dele seria injusto; aprovar sozinho seria mentira.
 *
 * Por isso o veredito tem TRÊS estados, nunca dois: aprovada · reprovada ·
 * revisao_manual. Só `aprovada` destrava o saque (o gate vive em `saque_avaliar`,
 * no banco — esta rota não libera nada sozinha, ela só carimba a NF).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { anthropicFetch } from './_claude.js';
import { carregarPDFParse } from './_pdf-safe.js';
import { fetchExternoSeguro } from './_allowed-hosts.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// CNPJ da BidPro — o TOMADOR do serviço. Sem ele não dá para afirmar que a nota foi
// emitida contra nós, então a conferência cai para revisão manual dizendo isso.
const EMPRESA_CNPJ = String(process.env.EMPRESA_CNPJ || '').replace(/\D/g, '');

const so = (v) => String(v || '').replace(/\D/g, '');

async function db(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}
async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { ok: r.ok, data: d };
}

// Só aceita o formato que o NOSSO uploader grava, e só na pasta do próprio usuário.
// Sem isto, um path arbitrário no corpo do pedido leria arquivo de outro parceiro.
function pathDaNf(v, userId) {
  const s = String(v || '');
  return new RegExp(`^nf/${userId}/[A-Za-z0-9._-]+$`).test(s) ? s : null;
}

async function baixarDoBucket(path) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 300 }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j?.signedURL) return null;
  const arq = await fetch(`${SUPABASE_URL}/storage/v1${j.signedURL}`, { signal: AbortSignal.timeout(20000) });
  if (!arq.ok) return null;
  return {
    bytes: Buffer.from(await arq.arrayBuffer()),
    mime: (arq.headers.get('content-type') || '').split(';')[0].trim(),
  };
}

// Texto do documento. PDF pelo pdf-parse (custo zero); imagem vai direto ao Vision.
async function textoDoDocumento({ bytes, mime }) {
  if (mime === 'application/pdf' || bytes.slice(0, 4).toString() === '%PDF') {
    try {
      const PDFParse = await carregarPDFParse();
      const p = new PDFParse({ data: new Uint8Array(bytes) });
      const r = await p.getText();
      return String(r?.text || '').slice(0, 20000);
    } catch { return ''; }
  }
  return '';
}

const PROMPT = `Você recebe o conteúdo de uma NOTA FISCAL DE SERVIÇO brasileira (NFS-e).
Extraia SOMENTE o que estiver escrito. Não invente, não complete, não deduza.
Responda APENAS com JSON, sem cercas de código, neste formato:
{"numero":"","emitente_cnpj":"","emitente_nome":"","tomador_cnpj":"","tomador_nome":"","valor":0,"emitida_em":"AAAA-MM-DD","verificacao_url":"","codigo_verificacao":""}
Regras: CNPJ só dígitos. valor = valor TOTAL dos serviços, número puro (ex.: 3200.50).
Campo que você não encontrar no documento: string vazia (ou 0 para valor).
verificacao_url = a URL de conferência/autenticidade impressa na nota, se houver.`;

async function lerComIA({ texto, bytes, mime }) {
  const conteudo = texto && texto.trim().length > 40
    ? [{ type: 'text', text: `${PROMPT}\n\n--- CONTEÚDO DA NOTA ---\n${texto}` }]
    : [
        { type: 'text', text: PROMPT },
        mime === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }
          : { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: bytes.toString('base64') } },
      ];

  const res = await anthropicFetch({
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 900,
      messages: [{ role: 'user', content: conteudo }],
    }),
  });
  // `.ok` CHECADO: `.json()` direto num 4xx devolve objeto sem `content` e a leitura
  // sai vazia — o padrão "erro de API silenciado" que já custou relatório em branco.
  if (!res.ok) {
    console.error('[saque-nf] IA', res.status, (await res.text().catch(() => '')).slice(0, 300));
    return null;
  }
  const j = await res.json().catch(() => null);
  const txt = j?.content?.map?.((c) => c.text).join('') || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// A prova de emissão: abre o link da prefeitura e confere se a página cita o número
// da nota. Best-effort — prefeitura fora do ar não reprova ninguém, vira revisão.
async function conferirNoEmissor(url, numero) {
  if (!url) return { status: 'sem_link', detalhe: 'A nota não traz link de verificação.' };
  try {
    const r = await fetchExternoSeguro(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BidProBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { status: 'inconclusiva', detalhe: `O verificador respondeu ${r.status}.` };
    const corpo = (await r.text().catch(() => '')).slice(0, 200000);
    const alvo = so(numero);
    if (alvo && (corpo.includes(String(numero)) || (alvo.length > 3 && corpo.replace(/\D/g, '').includes(alvo)))) {
      return { status: 'confirmada', detalhe: 'O verificador da prefeitura respondeu e cita o número da nota.' };
    }
    return { status: 'inconclusiva', detalhe: 'O verificador respondeu, mas não encontrei o número da nota na página.' };
  } catch (e) {
    return { status: 'inconclusiva', detalhe: `Não consegui abrir o verificador (${e?.message || 'erro'}).` };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }

  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }
  const rl = await checkRateLimit(`saquenf:${user.id}`, 10, 10 * 60_000);
  if (!rl.ok) { res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos.' }); return; }

  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { /* vazio */ }

  const valor = Math.round(Number(body.valor) * 100) / 100;
  const path = pathDaNf(body.storage_path, user.id);
  if (!path) { res.status(400).json({ error: 'Arquivo inválido.' }); return; }
  if (!(valor > 0)) { res.status(400).json({ error: 'Informe o valor do saque pretendido.' }); return; }

  const perfil = (await db(`perfis?id=eq.${user.id}&select=cnpj,razao_social,nome`)).data?.[0] || {};

  const arq = await baixarDoBucket(path);
  if (!arq) { res.status(422).json({ error: 'Não consegui abrir o arquivo enviado. Reenvie o PDF da nota.' }); return; }

  const texto = await textoDoDocumento(arq);
  const lida = await lerComIA({ texto, bytes: arq.bytes, mime: arq.mime });

  const registrar = async (extra) => {
    const linha = {
      user_id: user.id, storage_path: path, valor_pedido: valor,
      numero: lida?.numero || null,
      emitente_cnpj: so(lida?.emitente_cnpj) || null,
      tomador_cnpj: so(lida?.tomador_cnpj) || null,
      valor_nf: Number(lida?.valor) > 0 ? Number(lida.valor) : null,
      emitida_em: /^\d{4}-\d{2}-\d{2}$/.test(lida?.emitida_em || '') ? lida.emitida_em : null,
      ia_veredito: lida || null,
      ...extra,
    };
    await db('saque_nf', { method: 'POST', body: JSON.stringify(linha) });
    return linha;
  };

  if (!lida) {
    await registrar({ status: 'revisao_manual', verificacao_status: 'nao_checada', motivo: 'Não consegui ler a nota automaticamente.' });
    res.status(200).json({ ok: true, status: 'revisao_manual', motivo: 'Não consegui ler a nota automaticamente. Nossa equipe vai conferir manualmente.' });
    return;
  }

  // ── Conferências determinísticas (a IA lê; quem julga é regra escrita) ──
  const problemas = [];
  const ressalvas = [];

  const cnpjParceiro = so(perfil.cnpj);
  const emitente = so(lida.emitente_cnpj);
  if (!emitente) problemas.push('não identifiquei o CNPJ do emitente na nota');
  else if (cnpjParceiro && emitente !== cnpjParceiro) problemas.push('a nota foi emitida por um CNPJ diferente do cadastrado no seu perfil');
  else if (!cnpjParceiro) ressalvas.push('seu perfil ainda não tem CNPJ cadastrado para comparar com o emitente');

  const tomador = so(lida.tomador_cnpj);
  if (!EMPRESA_CNPJ) ressalvas.push('o CNPJ da BidPro não está configurado no servidor (EMPRESA_CNPJ), então não dá para confirmar que a nota foi emitida contra nós');
  else if (!tomador) problemas.push('não identifiquei o CNPJ do tomador na nota');
  else if (tomador !== EMPRESA_CNPJ) problemas.push('o tomador da nota não é a BidPro');

  const valorNf = Number(lida.valor) || 0;
  if (!(valorNf > 0)) problemas.push('não identifiquei o valor na nota');
  else if (valorNf + 0.01 < valor) problemas.push(`o valor da nota (R$ ${valorNf.toFixed(2)}) é menor que o saque pedido (R$ ${valor.toFixed(2)})`);

  if (/^\d{4}-\d{2}-\d{2}$/.test(lida.emitida_em || '')) {
    const dias = (Date.now() - new Date(`${lida.emitida_em}T12:00:00Z`).getTime()) / 86400000;
    if (dias > 120) ressalvas.push('a nota tem mais de 120 dias');
    if (dias < -1) problemas.push('a data de emissão da nota está no futuro');
  } else {
    ressalvas.push('não identifiquei a data de emissão');
  }

  const verif = await conferirNoEmissor(lida.verificacao_url, lida.numero);

  // O veredito. Aprovação automática exige DUAS coisas: nenhuma divergência nos dados
  // E a confirmação no verificador da prefeitura. Sem o link, o melhor que a máquina
  // honestamente pode dizer é "parece certo" — e isso é trabalho de gente.
  let status = 'revisao_manual';
  let motivo;
  if (problemas.length) {
    status = 'reprovada';
    motivo = `Nota recusada: ${problemas.join('; ')}.`;
  } else if (verif.status === 'confirmada' && !ressalvas.length) {
    status = 'aprovada';
    motivo = 'Dados conferem e a emissão foi confirmada no verificador da prefeitura.';
  } else {
    motivo = `Enviada para conferência da equipe: ${[verif.detalhe, ...ressalvas].filter(Boolean).join(' ')}`;
  }

  await registrar({ status, motivo, verificacao_url: lida.verificacao_url || null, verificacao_status: verif.status });

  res.status(200).json({
    ok: true, status, motivo,
    verificacao: verif.status,
    lida: { numero: lida.numero || null, emitente_cnpj: emitente || null, valor: valorNf || null, emitida_em: lida.emitida_em || null },
  });
}
