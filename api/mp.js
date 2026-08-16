/**
 * POST /api/mp
 * Gateway Mercado Pago — Checkout Pro, Assinaturas e Saques.
 *
 * Actions:
 *  criar_preferencia  — pagamento avulso (assessorado, matrícula, etc.)
 *  criar_assinatura   — assinatura recorrente (clube 5k/mês)
 *  verificar          — checa status de pagamento ou assinatura
 *  cancelar_assinatura
 *  status_assinatura
 */

export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { podeContratarAssessoria } from './_assessoria.js';
import { cpfDoRegistro } from './_cpf.js';

const MP_URL    = 'https://api.mercadopago.com';
const TOKEN     = (process.env.MP_ACCESS_TOKEN || '').trim();
const BASE_URL  = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const WEBHOOK   = `${BASE_URL}/api/mp-webhook`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function mpPost(path, body) {
  const res = await fetch(`${MP_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.message || data.cause?.[0]?.description || JSON.stringify(data.cause || data);
    throw new Error(msg);
  }
  return data;
}

async function mpGet(path) {
  const res = await fetch(`${MP_URL}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro MP');
  return data;
}

async function mpPut(path, body) {
  const res = await fetch(`${MP_URL}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro MP');
  return data;
}

// ─── Ativação inline (Edge) ─────────────────────────────────────────────────────
// O webhook do MP nem sempre dispara/chega a tempo (config do painel, latência).
// No fluxo transparente o cliente fica autenticado aqui, então ativamos o role na
// hora via PostgREST — mesma semântica de ativarPlanoDireto (_webhook-core.js), mas
// sem arrastar deps Node (_nfse) para o bundle Edge. O TIER mora em `role`; NÃO
// gravar em `plano` (check constraint gratuito|analista|gestor). Idempotente.
const SB_URL = (process.env.VITE_SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

// Escada anti-flip (espelho de roleAposPagamento em _webhook-core.js, sem arrastar
// deps Node p/ o bundle Edge): pagamento só SOBE o role — a renovação do Pro não
// pode rebaixar um assessorado/clube, e papéis de equipe nunca são sobrescritos.
const RANK_PLANO = { explorador: 0, top2: 1, top2_anual: 1, assessorado: 2, assessorado_anual: 2, clube: 3, clube_anual: 3 };

const escadaSobe = (roleAtual, planoPago) => {
  const a = RANK_PLANO[roleAtual], n = RANK_PLANO[planoPago];
  if (n == null) return roleAtual ?? planoPago;              // não mapeado → não mexe
  if (roleAtual != null && a == null) return roleAtual;      // papel de equipe → intocável
  return (a ?? -1) >= n ? roleAtual : planoPago;             // só sobe
};

async function ativarRoleInline(userId, planoKey, mpId) {
  if (!SB_URL || !SB_KEY || !userId || !planoKey) return { skipped: true };
  // Role sempre na BASE; o CICLO mora só em plano_ciclo (D5). Deriva o ciclo do sufixo.
  const planoBaseKey = String(planoKey).replace(/_anual$/, '');
  const ehAnual = /_anual$/.test(planoKey);
  let roleFinal = planoBaseKey;
  let jaAncorado = false;
  let temAncoraVenc = false;
  try {
    const at = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${userId}&select=role,role_anterior,inadimplente_desde,plano_pago_em,plano_vencimento`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const [perfil] = at.ok ? await at.json() : [];
    // Recuperação de inadimplência: restaura o role SUSPENSO (role_anterior pode ser
    // MAIOR que o plano pago — ex.: assessorado suspenso pagando a mensalidade do Pro),
    // igual ao ativarPlanoDireto do webhook. Fora dela, a escada só sobe (anti-flip).
    const candidato = (perfil?.role_anterior && perfil?.inadimplente_desde)
      ? escadaSobe(perfil.role_anterior, planoBaseKey)
      : planoBaseKey;
    roleFinal = escadaSobe(perfil?.role, candidato);
    const PAGANTES = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
    jaAncorado = !!perfil?.plano_pago_em || PAGANTES.includes(perfil?.role);
    temAncoraVenc = !!perfil?.plano_vencimento;
  } catch { /* sem leitura, segue com planoBaseKey (comportamento antigo) */ }
  // ANUAL: ancora a vigência de 12m na 1ª ativação (sem âncora ainda). Renovação real vem
  // pelo webhook (ativarPlanoDireto com cobrança). Ver P1.2 (não esticar sem pagamento).
  const vencAnual = (ehAnual && !temAncoraVenc)
    ? (() => { const d = new Date(); d.setMonth(d.getMonth() + 12); return d.toISOString(); })()
    : null;
  const res = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey:          SB_KEY,
      Authorization:   `Bearer ${SB_KEY}`,
      'Content-Type':  'application/json',
      Prefer:          'return=minimal',
    },
    // Grava o preapproval id em COLUNA DEDICADA (mp_preapproval_id) — NÃO em mp_id, que é o
    // customer id usado pelo webhook (buscarCliente) para achar o perfil. Sem essa separação,
    // processarConfirmado sobrescrevia o preapproval com o customer e o cancelamento quebrava
    // (bug bounty #4). A âncora dos 7 dias (plano_pago_em) só é gravada na 1ª ativação. O
    // plano_ciclo vem do sufixo do planoKey (NÃO cravar 'mensal' — quebraria um anual — P1.3).
    body: JSON.stringify({ role: roleFinal, inadimplente_desde: null, role_anterior: null,
      ...(mpId ? { mp_preapproval_id: String(mpId), plano_ciclo: ehAnual ? 'anual' : 'mensal',
        ...(vencAnual ? { plano_vencimento: vencAnual } : {}),
        ...(jaAncorado ? {} : { plano_pago_em: new Date().toISOString() }) } : {}) }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ativarRoleInline falhou (${res.status}): ${txt}`);
  }
  // Registra o preço contratado (para a renovação cobrar o valor vigente).
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/registrar_preco_contratado`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_plano_key: planoBaseKey }),
    });
  } catch (_) { /* preço é best-effort; não bloqueia a ativação */ }
  return { ok: true };
}

// ─── Configurações de plano ───────────────────────────────────────────────────

// Valores ESPELHAM o planos_config do admin (fonte da verdade — mesma tabela lida
// pelo front e pelo asaas.js). ATENÇÃO à semântica por tipo de cobrança:
//  - recorrente=true  → `valor` é o MENSAL cobrado todo mês (top2 = preço; clube =
//    preço total 60.000 ÷ 12 = 5.000/mês). NÃO usar o preço total aqui.
//  - recorrente=false → `valor` é o TOTAL da cobrança avulsa/parcelada
//    (assessorado 6.000 em 12×; variantes _vista = preço à vista do admin).
// Por causa dessa diferença (mensal × total), NÃO dá para ler o planos_config de
// forma ingênua (o clube cobraria 60.000/mês). Manter sincronizado com o admin.
// frequency/frequency_type: cadência do preapproval MP (default 1/months). O ANUAL é
// recorrente de 12 meses (frequency:12) → renova sozinho (regra c), sem cron de cobrança.
const PLANOS_CONFIG = {
  assessorado:       { nome: 'Assessoria Pós-Arrematação',  valor: 6000.00,  recorrente: false }, // 12× de R$ 500
  assessorado_vista: { nome: 'Assessoria (À Vista)',         valor: 4800.00,  recorrente: false },
  clube:             { nome: 'Leilão Club — Mensal',         valor: 5000.00,  recorrente: true, frequency: 1,  frequency_type: 'months' }, // 60.000 ÷ 12
  clube_vista:       { nome: 'Leilão Club (À Vista)',        valor: 48000.00, recorrente: false },
  top2:              { nome: 'Investidor Pro',               valor: 49.90,    recorrente: true, frequency: 1,  frequency_type: 'months' },
  top2_anual:        { nome: 'Investidor Pro (Anual)',       valor: 449.90,   recorrente: true, frequency: 12, frequency_type: 'months' },
};

// Espelha os preços do admin (planos_config) respeitando mensal×total: clube.preco é
// o TOTAL anual → mensal = ÷12; preco_vista = à vista; assessorado/top2 diretos;
// top2_anual = preco_anual. Fallback = PLANOS_CONFIG hardcoded (nunca quebra pagamento).
let _precoCache = { at: 0, cfg: null };
async function carregarPrecos() {
  if (_precoCache.cfg && Date.now() - _precoCache.at < 60000) return _precoCache.cfg;
  const cfg = JSON.parse(JSON.stringify(PLANOS_CONFIG)); // fallback conhecido-bom
  try {
    if (SB_URL && SB_KEY) {
      const r = await fetch(`${SB_URL}/rest/v1/planos_config?select=plano_key,nome,preco,preco_vista,preco_anual`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const by = {}; for (const x of await r.json()) by[x.plano_key] = x;
        const num = v => (v == null || v === '' ? null : Number(v));
        const P = by.assessorado, C = by.clube, T = by.top2;
        if (num(P?.preco) != null)       { cfg.assessorado.valor = num(P.preco); if (P.nome) cfg.assessorado.nome = P.nome; }
        if (num(P?.preco_vista) != null)   cfg.assessorado_vista.valor = num(P.preco_vista);
        if (num(C?.preco) != null)       { cfg.clube.valor = num(C.preco) / 12; if (C.nome) cfg.clube.nome = C.nome + ' — Mensal'; } // total anual ÷ 12
        if (num(C?.preco_vista) != null)   cfg.clube_vista.valor = num(C.preco_vista);
        if (num(T?.preco) != null)       { cfg.top2.valor = num(T.preco); if (T.nome) cfg.top2.nome = T.nome; }
        if (num(T?.preco_anual) != null)   cfg.top2_anual.valor = num(T.preco_anual);
      }
    }
  } catch { /* mantém o fallback hardcoded */ }
  _precoCache = { at: Date.now(), cfg };
  return cfg;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * Cria preferência de pagamento (Checkout Pro).
 * Suporta pagamento misto (usuário divide PIX + cartão diretamente no MP).
 * Para split (ex: 2k PIX + 3k cartão), cria 2 preferências vinculadas.
 */
async function criarPreferencia({ plano: planoKey, email, nome, cpf, userId, parcelas = null, split = null }) {
  const cfg = (await carregarPrecos())[planoKey];
  if (!cfg) throw new Error(`Plano inválido: ${planoKey}`);

  // Split de pagamento: [{ metodo, valor }]
  if (split && split.length > 1) {
    const prefs = await Promise.all(split.map((parte, i) =>
      criarPreferenciaSimples({
        titulo:  `${cfg.nome} — Parte ${i + 1}/${split.length}`,
        valor:   parte.valor,
        email, nome, cpf, userId,
        planoKey,
        splitIndex: i + 1,
        splitTotal: split.length,
        splitMetodo: parte.metodo,
        parcelas,
      })
    ));
    return { split: true, partes: prefs };
  }

  return criarPreferenciaSimples({ titulo: cfg.nome, valor: cfg.valor, email, nome, cpf, userId, planoKey, parcelas });
}

async function criarPreferenciaSimples({ titulo, valor, email, nome, cpf, userId, planoKey, splitIndex, splitTotal, splitMetodo, parcelas }) {
  const excludedMethods = [];
  if (splitMetodo === 'pix')     excludedMethods.push('credit_card', 'debit_card', 'ticket');
  if (splitMetodo === 'cartao')  excludedMethods.push('bank_transfer', 'ticket');
  if (splitMetodo === 'debito')  excludedMethods.push('credit_card', 'bank_transfer', 'ticket');

  const installments = parcelas ? Number(parcelas) : 12;

  const body = {
    items: [{
      id:           planoKey,
      title:        titulo,
      quantity:     1,
      currency_id:  'BRL',
      unit_price:   Number(valor),
    }],
    payer: { name: nome, email, identification: cpf ? { type: 'CPF', number: cpf.replace(/\D/g, '') } : undefined },
    back_urls: {
      success: `${BASE_URL}/#/checkout?plano=${planoKey}&status=approved`,
      failure: `${BASE_URL}/#/checkout?plano=${planoKey}&status=rejected`,
      pending: `${BASE_URL}/#/checkout?plano=${planoKey}&status=pending`,
    },
    auto_return:        'approved',
    notification_url:   WEBHOOK,
    statement_descriptor: 'BIDPRO BRASIL',
    external_reference: `${userId}|${planoKey}${splitIndex ? `|split${splitIndex}of${splitTotal}` : ''}`,
    expires:            false,
    payment_methods: {
      excluded_payment_methods: excludedMethods.map(id => ({ id })),
      excluded_payment_types:   [],
      installments:             installments,
    },
    metadata: { userId, planoKey, splitIndex, splitTotal },
  };

  const pref = await mpPost('/checkout/preferences', body);
  return {
    preferenceId: pref.id,
    initPoint:    pref.init_point,        // produção
    sandboxPoint: pref.sandbox_init_point, // sandbox
    valor,
  };
}

/**
 * Compra AVULSA de produto (ebook/curso) via Checkout Pro (redirect hospedado).
 * Inicia a compra (RPC), marca a preferência com external_reference = compra_id
 * (uuid) → o webhook casa como PRODUTO e ativa + credita a comissão do parceiro.
 * Preço SEMPRE do servidor (RPC lê o cadastro), nunca do cliente.
 */
async function criarPreferenciaProduto({ produto_tipo, produto_id, ref, email, nome, cpf, userId }) {
  if (!['ebook', 'curso'].includes(produto_tipo) || !produto_id) throw new Error('Produto inválido');
  const iniRes = await fetch(`${SB_URL}/rest/v1/rpc/comprar_produto_iniciar`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user_id: userId, p_produto_tipo: produto_tipo, p_produto_id: produto_id, p_ref: ref || null }),
  });
  const ini = iniRes.ok ? await iniRes.json() : null;
  if (!ini?.ok) throw new Error(ini?.erro || 'nao_iniciado');
  if (ini.ja_tem) return { ja_tem: true };

  const back = `${BASE_URL}/#/p/${produto_tipo}/${produto_id}`;
  const pref = await mpPost('/checkout/preferences', {
    items: [{ id: String(produto_id), title: String(ini.titulo || 'Produto BidPro').slice(0, 250), quantity: 1, currency_id: 'BRL', unit_price: Number(ini.valor) }],
    payer: { name: nome, email, identification: cpf ? { type: 'CPF', number: cpf.replace(/\D/g, '') } : undefined },
    back_urls: { success: `${back}?pago=1`, pending: `${back}?pago=pending`, failure: `${back}?pago=fail` },
    auto_return: 'approved',
    notification_url: WEBHOOK,
    statement_descriptor: 'BIDPRO BRASIL',
    external_reference: ini.compra_id,               // uuid → webhook trata como PRODUTO
    expires: false,
    metadata: { tipo: 'produto', compra_id: ini.compra_id, user_id: userId },
  });
  return { preferenceId: pref.id, initPoint: pref.init_point, sandboxPoint: pref.sandbox_init_point, compra_id: ini.compra_id, valor: ini.valor };
}

/**
 * Cria assinatura recorrente (Preapproval) para planos mensais.
 * MP cobra automaticamente todo mês no cartão salvo.
 */
async function criarAssinatura({ plano: planoKey, email, nome, cpf, userId }) {
  const cfg = (await carregarPrecos())[planoKey];
  if (!cfg || !cfg.recorrente) throw new Error(`Plano ${planoKey} não é recorrente`);

  const body = {
    reason:            cfg.nome,
    auto_recurring: {
      frequency:       cfg.frequency ?? 1,
      frequency_type:  cfg.frequency_type ?? 'months',
      transaction_amount: cfg.valor,
      currency_id:     'BRL',
    },
    payer_email:       email,
    back_url:          `${BASE_URL}/#/checkout?plano=${planoKey}&status=assinatura`,
    notification_url:  WEBHOOK,
    external_reference: `${userId}|${planoKey}`,
    status:            'pending',
    metadata:          { userId, planoKey, cpf },
    // Assinaturas: somente cartão de crédito
    payment_methods_allowed: [
      { payment_type: 'credit_card' },
    ],
  };

  const sub = await mpPost('/preapproval', body);
  return {
    assinaturaId: sub.id,
    initPoint:    sub.init_point,
    status:       sub.status,
  };
}

/**
 * Cria assinatura recorrente TRANSPARENTE (sem redirect): recebe o card_token_id
 * tokenizado no browser (SDK do MP) e cria o preapproval já autorizado. O cliente
 * nunca sai do BidPro. Preço SEMPRE do servidor (PLANOS_CONFIG), nunca do cliente.
 */
async function criarAssinaturaTransparente({ plano: planoKey, email, cardTokenId, userId }) {
  const cfg = (await carregarPrecos())[planoKey];
  if (!cfg || !cfg.recorrente) throw new Error(`Plano ${planoKey} não é recorrente`);
  if (!cardTokenId) throw new Error('Token do cartão ausente');
  if (!email) throw new Error('E-mail do pagador ausente');

  const body = {
    reason:             cfg.nome,
    external_reference: `${userId}|${planoKey}`,
    payer_email:        email,
    card_token_id:      cardTokenId,
    // 'authorized' + card_token_id = MANDATO aceito pelo cartão tokenizado (fluxo
    // transparente, sem init_point/redirect). NÃO quer dizer que a cobrança saiu —
    // ver o bloco de ativação abaixo.
    status:             'authorized',
    back_url:           `${BASE_URL}/#/checkout?plano=${planoKey}&status=assinatura`,
    notification_url:   WEBHOOK,
    auto_recurring: {
      frequency:          cfg.frequency ?? 1,
      frequency_type:     cfg.frequency_type ?? 'months',
      transaction_amount: Number(cfg.valor), // servidor manda no preço
      currency_id:        'BRL',
    },
  };

  const sub = await mpPost('/preapproval', body);

  // ATIVAÇÃO SÓ COM DINHEIRO NA CONTA (decisão do dono, 16/08).
  //
  // Este bloco ativava o plano quando `sub.status === 'authorized'`, com o comentário
  // "MP autorizou/cobrou já" — e essas são DUAS COISAS, não uma. `authorized` é o
  // mandato: o MP validou o cartão (transação de R$ 0,00, `card_validation`) e ganhou
  // permissão de cobrar. A primeira cobrança é assíncrona. No 1º assinante Pro ela veio
  // 22 minutos depois e foi RECUSADA por antifraude (`cc_rejected_high_risk`), zero real
  // recebido — mas o mandato estava `authorized` desde o primeiro segundo.
  //
  // Ativar aqui dava acesso pago a quem podia nunca pagar (e, com o e-mail de
  // boas-vindas que saía junto no fluxo do visitante, ainda avisava que estava tudo
  // certo). Quem ativa agora é `ativarPlanoDireto` no webhook, e só quando a ativação
  // carrega cobrança RECEBIDA (`gatewayPaymentId` + valor > 0). A recuperação por
  // reconciliação continua valendo — ela também exige cobrança real.
  //
  // `ativado: false` é o retorno honesto: o mandato existe, o acesso ainda não.
  return { assinaturaId: sub.id, status: sub.status, ativado: false, acesso: 'aguardando_pagamento' };
}

async function verificar({ paymentId, assinaturaId, userId }) {
  // SEGURANÇA: só o DONO consulta, e devolvemos SÓ o status — nunca o objeto MP cru.
  // Antes, qualquer logado passava um paymentId (numérico/enumerável) e recebia o
  // pagamento MP completo de OUTRO cliente (e-mail, CPF, dígitos do cartão) — IDOR/PII.
  // Amarra pelo external_reference (`userId|plano`) ou metadata.user_id.
  if (assinaturaId) {
    const s = await mpGet(`/preapproval/${assinaturaId}`);
    const dono = String(s?.external_reference || '').split('|')[0];
    if (!dono || dono !== String(userId)) return { tipo: 'assinatura', status: 'nao_autorizado' };
    return { tipo: 'assinatura', status: s.status };
  }
  const p = await mpGet(`/v1/payments/${paymentId}`);
  const dono = String(p?.external_reference || '').split('|')[0]
    || String(p?.metadata?.user_id ?? p?.metadata?.userId ?? '');
  if (!dono || dono !== String(userId)) return { tipo: 'pagamento', status: 'nao_autorizado' };
  return { tipo: 'pagamento', status: p.status, statusDetalhe: p.status_detail };
}

async function cancelarAssinatura({ assinaturaId, email, userId }) {
  // Cancela a renovação automática. Se não vier o id da assinatura, busca os
  // preapprovals ativos do pagador por e-mail — mas SEMPRE filtrando pelo
  // external_reference `${userId}|plano` do usuário AUTENTICADO. Sem esse filtro,
  // o `email` (vindo do body) permitiria cancelar a assinatura de um terceiro (IDOR).
  let ids = [];
  if (assinaturaId) {
    ids = [assinaturaId];
  } else if (email && userId) {
    try {
      const r = await mpGet(`/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized`);
      ids = (r?.results || [])
        .filter(x => String(x.external_reference || '').split('|')[0] === userId)
        .map(x => x.id).filter(Boolean);
    } catch (_) { ids = []; }
  }
  if (!ids.length) return { ok: true, cancelados: 0, nenhuma: true };
  let cancelados = 0;
  for (const id of ids) {
    try { await mpPut(`/preapproval/${id}`, { status: 'cancelled' }); cancelados++; } catch (_) {}
  }
  return { ok: true, cancelados };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  if (!TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN não configurado' }), { status: 500 });

  let user;
  try { user = await getAuthUser(req); } catch { /* getAuthUser retorna null em falha */ }
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 });
  }

  const { action, ...params } = body;
  // Segurança: o usuário do checkout é SEMPRE o autenticado (evita IDOR)
  params.userId = user.id;
  // CPF + role SEMPRE do perfil autenticado (decifra o cpf_enc; não confia no body).
  let roleAtual = null;
  try {
    const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const r = await fetch(`${SB}/rest/v1/perfis?id=eq.${user.id}&select=role,cpf,cpf_enc`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (r.ok) { const [row] = await r.json(); roleAtual = row?.role || null; const dec = await cpfDoRegistro(row); if (dec) params.cpf = dec; }
  } catch { /* mantém params.cpf do body como fallback */ }

  // GATE "1 assessoria por vez" no SERVIDOR (a regra não pode viver só na tela): bloqueia
  // criar uma 2ª cobrança de assessoria enquanto a atual não teve arremate sinalizado.
  if (/^assessorado/.test(String(params.plano || '')) && ['criar_preferencia', 'criar_assinatura', 'criar_assinatura_transparente'].includes(action)) {
    const gate = await podeContratarAssessoria({ userId: user.id, email: user.email, role: roleAtual });
    if (!gate.podeContratar) return new Response(JSON.stringify({ error: 'assessoria_bloqueada', motivo: gate.motivo }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    let result;
    switch (action) {
      case 'criar_preferencia':  result = await criarPreferencia(params);   break;
      case 'criar_preferencia_produto': result = await criarPreferenciaProduto(params); break;
      case 'criar_assinatura':   result = await criarAssinatura(params);    break;
      case 'criar_assinatura_transparente': result = await criarAssinaturaTransparente(params); break;
      case 'verificar':          result = await verificar(params);           break;
      case 'cancelar_assinatura': result = await cancelarAssinatura(params); break;
      default:
        return new Response(JSON.stringify({ error: `Action desconhecida: ${action}` }), { status: 400 });
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(`[mp] action=${action}`, err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
