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
 *
 * DESDE 16/10 (dono): nota em TODO saque, no valor BRUTO EXATO do saque (`saque.exige_nf_sempre`).
 * A BidPro repassa o bruto; tributos sobre a parte do parceiro são dele.
 *   - Uma nota ATIVA por pessoa (revisao_manual, ou aprovada ainda não usada) — índice único no
 *     banco. O parceiro não apaga nem troca: para substituir, a equipe libera (status
 *     'substituida'; a nota antiga fica guardada, é documento contábil).
 *   - GET  (admin) → fila de notas com link assinado do arquivo.
 *   - PATCH (admin) → aprovar · reprovar · liberar_substituicao.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { anthropicFetch } from './_claude.js';
import { carregarPDFParse } from './_pdf-safe.js';
import { blocosDoArquivo } from './_doc-blocos.js';
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
  const porTexto = !!(texto && texto.trim().length > 40);
  const conteudo = porTexto
    ? [{ type: 'text', text: `${PROMPT}\n\n--- CONTEÚDO DA NOTA ---\n${texto}` }]
    : [
        { type: 'text', text: PROMPT },
        // 02/10: formato pelos bytes (foto/HEIC/PDF/Word/texto) — antes todo não-PDF ia como imagem
        // com o tipo declarado, e uma nota em .txt/.docx dava erro na IA.
        ...(await blocosDoArquivo(bytes, { nome: 'nota-fiscal', contentType: mime })).blocos,
      ];
  if (!porTexto && conteudo.length < 2) return null; // arquivo que nenhum leitor abriu: nada a mandar

  const res = await anthropicFetch({
    method: 'POST',
    // CLAUDE_KEY é o nome configurado na Vercel (docs/ENVS_VERCEL.md); só ANTHROPIC_API_KEY
    // mandava `x-api-key: undefined` → 401 → leitura da nota sempre vazia (achado 24/09).
    headers: { 'x-api-key': process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
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
  // 18/10 (bug bounty): o link vem do PDF, que o parceiro controla — qualquer página pública que citasse o
  // número aprovava a nota sozinha. Só um verificador em domínio de GOVERNO conta como prova; o resto vai
  // para a equipe (revisão manual não reprova ninguém, só tira a aprovação automática).
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* host vazio = não é governo */ }
  if (!/(^|\.)gov\.br$/.test(host)) {
    return { status: 'inconclusiva', detalhe: `O link de verificação não é de um domínio de governo (${host || 'link inválido'}).` };
  }
  try {
    const r = await fetchExternoSeguro(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BidProBot/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { status: 'inconclusiva', detalhe: `O verificador respondeu ${r.status}.` };
    const corpo = (await r.text().catch(() => '')).slice(0, 200000);
    const alvo = so(numero);
    // Número inteiro, com fronteira (não "26" dentro de "2026"), e de pelo menos 3 dígitos.
    const citaNumero = alvo.length >= 3 && new RegExp(`(^|\\D)0*${alvo.replace(/^0+/, '')}(\\D|$)`).test(corpo);
    if (citaNumero) {
      return { status: 'confirmada', detalhe: 'O verificador da prefeitura respondeu e cita o número da nota.' };
    }
    return { status: 'inconclusiva', detalhe: 'O verificador respondeu, mas não encontrei o número da nota na página.' };
  } catch (e) {
    return { status: 'inconclusiva', detalhe: `Não consegui abrir o verificador (${e?.message || 'erro'}).` };
  }
}

async function linkAssinado(path) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 900 }),
    signal: AbortSignal.timeout(10000),
  }).catch((e) => { console.error('[saque-nf] link', e?.message); return null; });
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
}

// ── Equipe: fila de notas e decisões ────────────────────────────────────────
// Só ADMIN decide sobre nota fiscal (é o dono quem responde por ela perante o fisco).
async function rotaAdmin(req, res, user) {
  const quem = (await db(`perfis?id=eq.${user.id}&select=role`));
  if (!quem.ok) { res.status(503).json({ error: 'Não consegui conferir seu acesso agora.' }); return; }
  if (quem.data?.[0]?.role !== 'admin') { res.status(403).json({ error: 'Apenas administrador.' }); return; }

  if (req.method === 'GET') {
    const r = await db('saque_nf?select=id,user_id,lancamento_id,storage_path,valor_pedido,numero,emitente_cnpj,tomador_cnpj,valor_nf,emitida_em,verificacao_url,verificacao_status,ia_veredito,status,motivo,revisado_por,revisado_em,criado_em&order=criado_em.desc&limit=200');
    if (!r.ok || !Array.isArray(r.data)) { res.status(503).json({ error: 'Não consegui ler as notas agora.' }); return; }
    const ids = [...new Set(r.data.map((n) => n.user_id))];
    const pf = ids.length ? await db(`perfis?id=in.(${ids.join(',')})&select=id,nome,razao_social,cnpj`) : { ok: true, data: [] };
    const porId = Object.fromEntries((Array.isArray(pf.data) ? pf.data : []).map((p) => [p.id, p]));
    const notas = await Promise.all(r.data.map(async (n) => ({
      ...n, parceiro: porId[n.user_id] || null, arquivo_url: await linkAssinado(n.storage_path),
    })));
    res.status(200).json({ notas, perfis_ok: pf.ok });
    return;
  }

  // PATCH — decisão da equipe. Toda decisão grava quem, quando e por quê.
  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { /* vazio */ }
  const id = String(body.id || '');
  const acao = String(body.acao || '');
  const motivo = String(body.motivo || '').trim().slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: 'Nota inválida.' }); return; }
  const DESTINO = { aprovar: 'aprovada', reprovar: 'reprovada', liberar_substituicao: 'substituida' };
  if (!DESTINO[acao]) { res.status(400).json({ error: 'Ação inválida.' }); return; }
  if (acao !== 'aprovar' && !motivo) { res.status(400).json({ error: 'Escreva o motivo — ele aparece para o parceiro.' }); return; }

  // Nota já usada num saque não muda mais: ela documenta um repasse que aconteceu.
  // O filtro vai NA PRÓPRIA escrita (lancamento_id=is.null) e o `.select` da resposta prova que
  // algo mudou — update que não alcança nada volta 200 vazio (forma 3 do CLAUDE.md).
  const corpo = {
    status: DESTINO[acao],
    motivo: motivo || 'Aprovada na conferência da equipe.',
    revisado_por: user.id, revisado_em: new Date().toISOString(),
  };
  const up = await db(`saque_nf?id=eq.${id}&lancamento_id=is.null&status=in.(revisao_manual,aprovada,reprovada)`, {
    method: 'PATCH', body: JSON.stringify(corpo),
  });
  if (!up.ok) {
    // 23505 = já existe outra nota ativa da mesma pessoa (índice único) — só pode haver uma.
    const dup = /23505|saque_nf_uma_ativa/.test(JSON.stringify(up.data || ''));
    res.status(dup ? 409 : 500).json({ error: dup ? 'O parceiro já tem outra nota ativa. Libere a substituição dela antes.' : 'Não consegui gravar a decisão.' });
    return;
  }
  if (!Array.isArray(up.data) || !up.data.length) {
    res.status(409).json({ error: 'Esta nota já foi usada num saque ou não está mais pendente — não pode ser alterada.' });
    return;
  }
  res.status(200).json({ ok: true, nota: up.data[0] });
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (req.method === 'GET' || req.method === 'PATCH') { await rotaAdmin(req, res, user); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }
  const rl = await checkRateLimit(`saquenf:${user.id}`, 10, 10 * 60_000);
  if (!rl.ok) { res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos.' }); return; }

  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { /* vazio */ }

  const valor = Math.round(Number(body.valor) * 100) / 100;
  const path = pathDaNf(body.storage_path, user.id);
  if (!path) { res.status(400).json({ error: 'Arquivo inválido.' }); return; }
  if (!(valor > 0)) { res.status(400).json({ error: 'Informe o valor do saque pretendido.' }); return; }

  // UMA NOTA ATIVA POR VEZ (16/10). Anexada, ela não sai pelas mãos do parceiro: em conferência
  // ou aprovada-e-não-usada, a troca é decisão da equipe. Checado aqui para responder ANTES de
  // gastar a leitura da IA; o índice único no banco é quem garante de verdade.
  const ativa = await db(`saque_nf?user_id=eq.${user.id}&lancamento_id=is.null&status=in.(revisao_manual,aprovada)&select=id,status,valor_nf&limit=1`);
  if (!ativa.ok) { res.status(503).json({ error: 'Não consegui conferir suas notas agora. Tente de novo.' }); return; }
  if (ativa.data?.[0]) {
    const a = ativa.data[0];
    res.status(409).json({
      error: a.status === 'aprovada'
        ? `Você já tem uma nota aprovada${a.valor_nf ? ` de R$ ${Number(a.valor_nf).toFixed(2)}` : ''} aguardando o saque. Para trocá-la, peça à equipe que libere a substituição.`
        : 'Você já tem uma nota em conferência pela equipe. Para trocá-la, peça que a equipe libere a substituição.',
    });
    return;
  }

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
    const ins = await db('saque_nf', { method: 'POST', body: JSON.stringify(linha) });
    // Sem isto a tela dizia "nota recebida" para uma nota que o banco recusou (ex.: corrida entre
    // dois envios esbarrando no índice de uma-nota-ativa).
    if (!ins.ok) {
      const e = new Error(/23505|saque_nf_uma_ativa/.test(JSON.stringify(ins.data || '')) ? 'duplicada' : `gravação HTTP ${ins.status}`);
      e.duplicada = e.message === 'duplicada';
      throw e;
    }
    return linha;
  };
  const responderFalhaGravacao = (e) => {
    console.error('[saque-nf] gravar', e?.message);
    res.status(e?.duplicada ? 409 : 500).json({ error: e?.duplicada
      ? 'Você já tem uma nota ativa. Para trocá-la, peça à equipe que libere a substituição.'
      : 'A nota foi lida, mas não consegui registrá-la. Tente de novo.' });
  };

  if (!lida) {
    try { await registrar({ status: 'revisao_manual', verificacao_status: 'nao_checada', motivo: 'Não consegui ler a nota automaticamente.' }); }
    catch (e) { responderFalhaGravacao(e); return; }
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
  // Valor EXATO (16/10): o repasse é pelo BRUTO da nota. Nota maior que o saque documentaria um
  // pagamento que não aconteceu; menor, um pagamento sem documento.
  else if (Math.abs(valorNf - valor) > 0.01) problemas.push(`o valor da nota (R$ ${valorNf.toFixed(2)}) é diferente do saque pedido (R$ ${valor.toFixed(2)}) — a nota deve ser do valor bruto exato do saque`);

  // A MESMA NOTA NÃO DOCUMENTA DOIS SAQUES (18/10, bug bounty): depois de consumida ela sai do índice de
  // "uma ativa por pessoa", e reenviar o mesmo PDF passaria de novo. O índice único no banco garante.
  if (emitente && lida.numero) {
    const dup = await db(`saque_nf?emitente_cnpj=eq.${emitente}&numero=eq.${encodeURIComponent(String(lida.numero))}&status=in.(revisao_manual,aprovada)&select=id&limit=1`);
    if (!dup.ok) { res.status(503).json({ error: 'Não consegui conferir se esta nota já foi usada. Tente de novo.' }); return; }
    if (dup.data?.[0]) problemas.push('esta nota fiscal já foi apresentada em outro saque');
  }

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

  try { await registrar({ status, motivo, verificacao_url: lida.verificacao_url || null, verificacao_status: verif.status }); }
  catch (e) { responderFalhaGravacao(e); return; }

  res.status(200).json({
    ok: true, status, motivo,
    verificacao: verif.status,
    lida: { numero: lida.numero || null, emitente_cnpj: emitente || null, valor: valorNf || null, emitida_em: lida.emitida_em || null },
  });
}
