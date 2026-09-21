/**
 * Mercado Pago — Checkout Transparente
 * Cria preferência de pagamento (cartão, PIX, boleto)
 * Dinheiro fica na conta MP da TSN; profissionais sacam sob demanda.
 *
 * Env vars:
 *   MP_ACCESS_TOKEN  — access_token da conta MP da plataforma (produção)
 *   MP_PUBLIC_KEY    — public_key (usada no frontend para tokenizar cartão)
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const MP_BASE = 'https://api.mercadopago.com';

// ─── Cartão salvo (produto_bonus) ───────────────────────────────────────────────
// Padrão documentado do MP para "cartão em arquivo": cria/acha o Customer, salva o
// cartão nele (consome o token único do formulário) e gera um TOKEN NOVO a partir do
// cartão salvo — é esse token novo que cobra agora, e o mesmo mecanismo
// (`POST /v1/card_tokens` com card_id+customer_id) que o cron de conversão usa um mês
// depois. Cobrar já pelo caminho "cartão salvo" na primeira compra prova o mecanismo
// de recobrança em produção, em vez de descobrir só na renovação que ele não funciona.
async function mpAcharOuCriarCustomer(accessToken, email) {
  const busca = await fetch(`${MP_BASE}/v1/customers/search?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (busca.ok) {
    const d = await busca.json().catch(() => null);
    const achado = d?.results?.[0]?.id;
    if (achado) return String(achado);
  }
  const cria = await fetch(`${MP_BASE}/v1/customers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const d = await cria.json().catch(() => null);
  if (!cria.ok || !d?.id) throw new Error(d?.message || `customer_falhou_${cria.status}`);
  return String(d.id);
}
async function mpSalvarCartao(accessToken, customerId, token) {
  const r = await fetch(`${MP_BASE}/v1/customers/${customerId}/cards`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.id) throw new Error(d?.message || `card_falhou_${r.status}`);
  return String(d.id);
}
async function mpTokenDoCartaoSalvo(accessToken, cardId, customerId) {
  const r = await fetch(`${MP_BASE}/v1/card_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_id: cardId, customer_id: customerId }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.id) throw new Error(d?.message || `card_token_falhou_${r.status}`);
  return String(d.id);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = await checkRateLimit(`mp-checkout:${ip}`, 10, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde.' });

  // honorario_exito é a ÚNICA cobrança que dispensa login (18/09, pedido do dono): o
  // arrematante pode repassar o link a outra pessoa pagar em seu nome (raro, mas acontece)
  // — mesma lógica de acesso do antigo link hospedado do MP. O `arrematacao_id` (uuid
  // imprevisível, conhecido só por quem recebeu o link) faz o papel de credencial; todo o
  // resto do endpoint (preço, dono da cobrança, ativação do plano) continua vindo do banco,
  // nunca do que o requisitante alega — ver o bloco HONORÁRIOS DE ÊXITO logo abaixo.
  const propositoBruto = String(req.body?.proposito || '');
  // cobranca_avulsa (17/09) segue o mesmo raciocínio do honorário: o link pode ser pago
  // por quem não tem conta no sistema (ex.: cliente de honorário de êxito quitando o saldo
  // no cartão) — o uuid imprevisível da cobrança já é a credencial.
  const honorarioSemLogin = propositoBruto === 'honorario_exito' || propositoBruto === 'cobranca_avulsa';

  const user = await getUser(req);
  if (!user && !honorarioSemLogin) return res.status(401).json({ error: 'Não autorizado' });

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) return res.status(500).json({ error: 'Pagamento não configurado' });

  let { valor, descricao, email, metodoPagamento, dadosCartao } = req.body;
  if (!valor || !descricao || !email) {
    return res.status(400).json({ error: 'valor, descricao e email são obrigatórios' });
  }
  // Propósito do pagamento avulso (allowlist). Marca a INTENÇÃO no metadata para que o
  // confirmador correto o aceite — sem isso, /api/creditos-recarga aceitava QUALQUER
  // pagamento 'servico' do usuário (assessoria, etc.) como recarga (bug bounty #1).
  // 'plano_anual' marca o PIX-anuidade do Investidor Pro (ativação verificada em
  // /api/ativar-pro-anual). O metadata.tipo continua 'servico' (o webhook NUNCA eleva
  // plano por pagamento único — a ativação é feita à parte, conferindo valor+dono+aprovação).
  // 'produto_bonus' (12/09): ebook/curso com `requer_cartao_bonus` — cartão salvo na compra
  // pra renovar sozinho quando o bônus (concede_plano) vencer. Ver bloco abaixo e
  // api/ativar-assinatura-bonus-cron.js.
  const PROPOSITOS = new Set(['servico', 'recarga', 'plano_anual', 'assessoria', 'produto_bonus', 'honorario_exito', 'cobranca_avulsa']);
  const proposito = PROPOSITOS.has(String(req.body?.proposito)) ? String(req.body.proposito) : 'servico';

  // PRODUTO_BONUS — ebook/curso com `requer_cartao_bonus`: preço promocional + concede_plano
  // temporário + cartão salvo para tentar virar assinatura real quando o bônus vencer (12/09,
  // ver supabase/migrations/produto_bonus_assinatura_com_cartao.sql). MESMO cuidado do bloco de
  // assessoria logo abaixo: preço/elegibilidade vêm SEMPRE do servidor
  // (`comprar_produto_iniciar`, a mesma RPC de criarPreferenciaProduto em api/mp.js), nunca do
  // body — sobrescreve `valor`/`descricao` ANTES do corte de valor mínimo logo adiante.
  let produtoBonusCtx = null;
  if (proposito === 'produto_bonus') {
    const { produto_tipo, produto_id, ref } = req.body || {};
    if (!['ebook', 'curso'].includes(produto_tipo) || !produto_id) {
      return res.status(400).json({ error: 'produto_tipo e produto_id são obrigatórios' });
    }
    const SB_URL = process.env.VITE_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
    try {
      const r = await fetch(`${SB_URL}/rest/v1/rpc/comprar_produto_iniciar`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: user.id, p_produto_tipo: produto_tipo, p_produto_id: produto_id, p_ref: ref || null, p_extras: [] }),
        signal: AbortSignal.timeout(10000),
      });
      const ini = r.ok ? await r.json() : null;
      if (!ini?.ok) {
        const motivo = ini?.erro || 'nao_iniciado';
        return res.status(409).json({
          error: motivo === 'plano_ja_superior'
            ? 'Esta oferta não está disponível para quem já é Investidor Pro ou Leilão Club.'
            : motivo === 'gratuito' ? 'Este produto é gratuito para você.'
            : 'Não foi possível iniciar a compra.',
          motivo,
        });
      }
      if (ini.ja_tem) return res.status(200).json({ ok: true, jaTem: true });
      produtoBonusCtx = { compraId: ini.compra_id, produtoTipo: produto_tipo, produtoId: produto_id };
      // Preço/título SEMPRE do servidor a partir daqui — nunca do que o body mandou.
      valor = ini.valor;
      descricao = String(ini.titulo || descricao).slice(0, 250);
    } catch (e) {
      console.error('[mp-checkout] produto_bonus: iniciar falhou', e?.message || e);
      return res.status(503).json({ error: 'Não consegui validar a compra agora. Tente em instantes.' });
    }
  }

  // HONORÁRIOS DE ÊXITO (16/09, sem login desde 18/09) — checkout Transparente com a cara
  // do BidPro (src/pages/PagarHonorario.jsx), não um link hospedado do MP. Preço SEMPRE do
  // servidor (arrematacoes.honorarios_valor), nunca do body — mesmo cuidado do produto_bonus
  // acima. A identidade de quem PAGA não importa (pode ser o arrematante ou alguém a quem ele
  // repassou o link) — o que a IDOR precisa proteger é o DONO da cobrança, que vem sempre do
  // banco (arr.arrematante_id), nunca do requisitante. Só bloqueia por dono divergente quando
  // HÁ sessão logada e ela não bate (ex.: outro cliente logado tentando pagar por engano/má-fé
  // a arrematação de terceiro) — requisição sem sessão nenhuma segue, pois a posse do link
  // (uuid imprevisível) já é a credencial neste fluxo.
  let honorarioCtx = null;
  if (proposito === 'honorario_exito') {
    const { arrematacao_id } = req.body || {};
    if (!arrematacao_id) return res.status(400).json({ error: 'arrematacao_id obrigatório' });
    const SB_URL = process.env.VITE_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
    try {
      const r = await fetch(`${SB_URL}/rest/v1/arrematacoes?id=eq.${encodeURIComponent(arrematacao_id)}&select=id,arrematante_id,honorarios_valor,honorarios_status`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(10000),
      });
      const [arr] = r.ok ? await r.json().catch(() => []) : [];
      if (!arr) return res.status(404).json({ error: 'Arrematação não encontrada.' });
      if (user && arr.arrematante_id !== user.id) return res.status(403).json({ error: 'Esta cobrança não pertence a este usuário.' });
      if (['pago', 'distribuido'].includes(arr.honorarios_status)) return res.status(409).json({ error: 'Os honorários desta arrematação já foram pagos.' });
      const total = Number(arr.honorarios_valor) || 0;
      if (total <= 0) return res.status(400).json({ error: 'Honorários ainda não calculados para esta arrematação.' });
      // SALDO RESTANTE, não o valor cheio (17/09): o honorário pode já ter partes
      // confirmadas por fora (Pix externo, cheque — ver api/honorario-recebimento.js).
      // O link sempre cobra só o que falta; a soma de todas as partes é quem decide
      // 'pago' (trigger honorarios_recebimentos_fecha_se_completo no banco).
      const recR = await fetch(`${SB_URL}/rest/v1/honorarios_recebimentos?arrematacao_id=eq.${encodeURIComponent(arrematacao_id)}&status=eq.confirmado&select=valor`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(10000),
      });
      const confirmados = recR.ok ? await recR.json().catch(() => []) : [];
      const jaRecebido = confirmados.reduce((s, x) => s + Number(x.valor || 0), 0);
      const saldo = Math.round((total - jaRecebido) * 100) / 100;
      if (saldo <= 0) return res.status(409).json({ error: 'Os honorários desta arrematação já foram cobertos por outros recebimentos.' });
      // PIX + CARTÃO COMBINADO (17/09): quem abre o link pode escolher pagar só uma PARTE
      // agora via Pix (`valor_pix_parcial`, só aceito com metodoPagamento='pix') — a
      // diferença cobrada depois pelo cartão é sempre recalculada NA HORA (o card volta a
      // pedir o saldo cheio de novo), então o valor aqui é o único ponto de confiança:
      // limitado ao saldo devido e com piso mínimo pra não virar spam de Pix de centavos.
      const pixParcial = metodoPagamento === 'pix' ? Number(req.body?.valor_pix_parcial) : null;
      if (Number.isFinite(pixParcial) && pixParcial > 0) {
        const PISO_PIX_PARCIAL = 5;
        if (pixParcial < PISO_PIX_PARCIAL) return res.status(400).json({ error: `Valor mínimo para Pix parcial: R$ ${PISO_PIX_PARCIAL},00.` });
        if (pixParcial > saldo + 0.01) return res.status(400).json({ error: 'O valor do Pix não pode ser maior que o saldo devido.' });
        valor = Math.round(pixParcial * 100) / 100;
      } else {
        valor = saldo;
      }
      descricao = jaRecebido > 0 || (Number.isFinite(pixParcial) && pixParcial > 0 && pixParcial < saldo)
        ? 'Honorários de êxito (saldo restante) — BidPro Brasil' : 'Honorários de êxito — BidPro Brasil';
      honorarioCtx = { arrematacaoId: arr.id, arrematanteId: arr.arrematante_id };
    } catch (e) {
      console.error('[mp-checkout] honorario_exito: gate falhou', e?.message || e);
      return res.status(503).json({ error: 'Não consegui validar esta cobrança agora. Tente em instantes.' });
    }
  }

  // COBRANÇA AVULSA (17/09) — link genérico pra motivo/valor fora do catálogo fixo acima.
  // Preço e descrição SEMPRE do servidor (cobrancas_avulsas), nunca do body — mesmo cuidado
  // de honorario_exito/produto_bonus. Criada só por admin em api/cobranca-avulsa-criar.js.
  let cobrancaCtx = null;
  if (proposito === 'cobranca_avulsa') {
    const { cobranca_id } = req.body || {};
    if (!cobranca_id) return res.status(400).json({ error: 'cobranca_id obrigatório' });
    const SB_URL = process.env.VITE_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
    try {
      const r = await fetch(`${SB_URL}/rest/v1/cobrancas_avulsas?id=eq.${encodeURIComponent(cobranca_id)}&select=id,descricao,valor,valor_pago_pix,status`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(10000),
      });
      const [cob] = r.ok ? await r.json().catch(() => []) : [];
      if (!cob) return res.status(404).json({ error: 'Cobrança não encontrada.' });
      if (cob.status !== 'aberta') return res.status(409).json({ error: 'Esta cobrança já foi paga ou cancelada.' });
      const total = Number(cob.valor) || 0;
      if (total <= 0) return res.status(400).json({ error: 'Cobrança sem valor válido.' });
      const jaPagoPix = Number(cob.valor_pago_pix) || 0;
      const saldo = Math.round((total - jaPagoPix) * 100) / 100;
      if (saldo <= 0) return res.status(409).json({ error: 'Esta cobrança já foi coberta.' });
      // PIX + CARTÃO COMBINADO — mesmo mecanismo do honorário de êxito (ver comentário lá).
      const pixParcial = metodoPagamento === 'pix' ? Number(req.body?.valor_pix_parcial) : null;
      if (Number.isFinite(pixParcial) && pixParcial > 0) {
        const PISO_PIX_PARCIAL = 5;
        if (pixParcial < PISO_PIX_PARCIAL) return res.status(400).json({ error: `Valor mínimo para Pix parcial: R$ ${PISO_PIX_PARCIAL},00.` });
        if (pixParcial > saldo + 0.01) return res.status(400).json({ error: 'O valor do Pix não pode ser maior que o saldo devido.' });
        valor = Math.round(pixParcial * 100) / 100;
      } else {
        valor = saldo;
      }
      descricao = String(cob.descricao || 'Cobrança avulsa — BidPro Brasil').slice(0, 250);
      cobrancaCtx = { cobrancaId: cob.id };
    } catch (e) {
      console.error('[mp-checkout] cobranca_avulsa: gate falhou', e?.message || e);
      return res.status(503).json({ error: 'Não consegui validar esta cobrança agora. Tente em instantes.' });
    }
  }

  const valorCentavos = Math.round(Number(valor) * 100);
  if (valorCentavos < 100) return res.status(400).json({ error: 'Valor mínimo R$ 1,00' });

  // Trava contra PIX duplicado (21/09) — achada investigando por que uma venda não fechou:
  // duas cobranças PIX reais (payment_id diferentes) do MESMO valor saíram com 1,6s de
  // diferença (duplo clique ou remount da tela de Pix — `criouRef` em PagamentoServico.jsx
  // só protege re-disparo DENTRO do mesmo mount) e as duas expiraram sem ninguém pagar.
  // Só trava PIX: cartão já tem proteção natural (token de uso único).
  if (metodoPagamento === 'pix') {
    const anchorDup = user?.id || honorarioCtx?.arrematanteId || (cobrancaCtx ? `cobranca-${cobrancaCtx.cobrancaId}` : ip);
    const rlDup = await checkRateLimit(`mp-pix-dup:${anchorDup}:${valorCentavos}`, 1, 8000);
    if (!rlDup.ok) {
      return res.status(429).json({ error: 'Já geramos um Pix para este valor há poucos segundos. Aguarde a tela carregar antes de gerar outro.' });
    }
  }

  // ASSESSORIA — o gate "1 assessoria por contrato" e o PREÇO precisam valer AQUI (10/08).
  // Este endpoint é o que efetivamente COBRA a assessoria (Checkout.jsx → PagamentoServico →
  // /api/mp-checkout), e era o único caminho de assessoria sem gate: ele existia em /api/mp,
  // /api/asaas e /api/auto-contrato — nenhum dos três no caminho do dinheiro. Resultado
  // possível: cliente com assessoria em andamento paga R$ 4.800–6.000, vê "Pagamento
  // aprovado" e não recebe contrato, porque o auto-contrato (fail-closed, correto) recusa
  // DEPOIS. Cobrar e não entregar é o pior desfecho possível — o gate vem antes da cobrança.
  if (proposito === 'assessoria') {
    const SB_URL = process.env.VITE_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
    const sbGet = (p) => fetch(`${SB_URL}/rest/v1/${p}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(10000),
    });
    try {
      const [pr] = await (await sbGet(`perfis?id=eq.${encodeURIComponent(user.id)}&select=role`)).json();
      const { podeContratarAssessoria } = await import('./_assessoria.js');
      const gate = await podeContratarAssessoria({ userId: user.id, email: user.email, role: pr?.role || null });
      if (!gate.podeContratar) {
        return res.status(409).json({ error: 'Não é possível contratar a assessoria agora.', motivo: gate.motivo });
      }
      // PREÇO DO SERVIDOR. `transaction_amount` vinha do body do cliente, sem nenhum confronto
      // com `planos_config` — o mesmo cuidado que /api/mp já tem para a assinatura.
      // NÃO é igualdade: de 4x em diante o cliente assume os juros (PagamentoServico
      // `calcParcelaMaisJuros`), então o total legítimo passa do preço de tabela. O que precisa
      // ser barrado é pagar MENOS que o preço vigente e receber o serviço. Piso = o menor preço
      // vigente (à vista, quando existe); teto de 2× como sanidade contra valor absurdo — a
      // maior taxa é 3,49% a.a. em 12x, muito abaixo disso.
      const [cfg] = await (await sbGet(`planos_config?plano_key=eq.assessorado&select=preco,preco_vista&limit=1`)).json();
      const vigentes = [cfg?.preco, cfg?.preco_vista].map(Number).filter((n) => n > 0);
      // FAIL-CLOSED: se o preço vigente não veio (linha ausente/renomeada em planos_config),
      // não dá para provar que `valor` bate com o preço de tabela — mesma lógica do catch
      // abaixo, sem preço para conferir contra não é "sem risco", é "não sei".
      if (!vigentes.length) {
        console.error('[mp-checkout] planos_config sem preço vigente para assessorado');
        return res.status(503).json({ error: 'Não consegui validar o preço agora. Tente em instantes.' });
      }
      const piso = Math.min(...vigentes), teto = Math.max(...vigentes) * 2;
      const v = Number(valor);
      if (v < piso - 0.01 || v > teto) {
        return res.status(400).json({ error: 'Valor da assessoria não confere com o preço vigente.' });
      }
    } catch (e) {
      // FAIL-CLOSED: sem conseguir conferir o gate ou o preço, NÃO cobra. Um erro de leitura
      // não pode virar autorização para debitar milhares de reais.
      console.error('[mp-checkout] gate assessoria falhou', e?.message || e);
      return res.status(503).json({ error: 'Não consegui validar a contratação agora. Tente em instantes.' });
    }
  }

  // produto_bonus + cartão: salva o cartão ANTES de cobrar (troca o token único do form por
  // um token novo gerado a partir do cartão salvo). Falhou qualquer etapa → cobra do jeito
  // de sempre com o token original (a compra não pode depender do cartão salvar certo); só
  // não vai converter sozinha depois — fica sem mp_customer_id/mp_card_id.
  // `manterAssinatura` (12/09, achado do dono): a pessoa pode recusar a renovação automática
  // e levar só o produto — default true (o caminho que o bônus foi desenhado para incentivar,
  // mesmo default do checkbox em ProdutoPublico.jsx), só pula o salvamento se vier `false`
  // explícito. Sem o cartão salvo, a cortesia concedida (concede_plano/concede_meses) segue
  // idêntica — só não há o que o cron de conversão (ativar-assinatura-bonus-cron.js) encontre
  // depois, e a cortesia expira sozinha pelo mecanismo que já existe (reconciliar-assinaturas).
  const manterAssinatura = req.body?.manterAssinatura !== false;
  let mpCustomerId = null, mpCardId = null;
  if (produtoBonusCtx && manterAssinatura && metodoPagamento === 'credit_card' && dadosCartao?.token) {
    try {
      mpCustomerId = await mpAcharOuCriarCustomer(ACCESS_TOKEN, String(email));
      mpCardId = await mpSalvarCartao(ACCESS_TOKEN, mpCustomerId, dadosCartao.token);
      const chargeToken = await mpTokenDoCartaoSalvo(ACCESS_TOKEN, mpCardId, mpCustomerId);
      dadosCartao = { ...dadosCartao, token: chargeToken };
    } catch (e) {
      console.error('[mp-checkout] não consegui salvar o cartão (cobrando sem salvar):', e?.message || e);
      mpCustomerId = null; mpCardId = null;
    }
  }

  try {
    const payload = {
      transaction_amount: Number(valor),
      description: String(descricao).slice(0, 256),
      payment_method_id: metodoPagamento || 'pix',
      payer: mpCustomerId ? { type: 'customer', id: mpCustomerId, email: String(email) } : { email: String(email) },
      // SEGURANÇA: este endpoint é SEMPRE pagamento avulso de serviço (tipo='servico').
      // Nunca eleva plano/role — senão um cliente pagaria 1x um valor qualquer e o
      // webhook mapearia valor→plano, virando plano vitalício de graça (pagamento único
      // não gera preapproval, então nada revoga). Assinaturas de plano vão por /api/mp
      // (preapproval), onde o preço vem do servidor (planos_config) e é recorrente.
      // produto_bonus é a exceção deliberada: tipo='produto' + external_reference=compra_id
      // (uuid), pro webhook tratar como confirmação de PRODUTO (ehProdutoMp), igual ao
      // Checkout Pro de criarPreferenciaProduto em api/mp.js — reaproveita o confirmador que
      // já existe em vez de duplicar a lógica de concede_plano aqui.
      // honorario_exito: metadata.tipo é o que api/mp-webhook.js (ehHonorarioMp) usa para
      // marcar honorarios_status='pago' — mesmo branch que já atende o Checkout Pro
      // hospedado, agora também alimentado por um pagamento Transparente.
      metadata: produtoBonusCtx
        ? { user_id: user.id, origem: 'tsn-app', tipo: 'produto', proposito, compra_id: produtoBonusCtx.compraId }
        : honorarioCtx
          // dono da cobrança vem do banco (honorarioCtx.arrematanteId), não de `user` — pode
          // não haver sessão nenhuma neste fluxo (ver comentário acima).
          ? { user_id: honorarioCtx.arrematanteId, origem: 'tsn-app', tipo: 'honorario_exito', arrematacao_id: honorarioCtx.arrematacaoId, arrematante_id: honorarioCtx.arrematanteId }
          : cobrancaCtx
            // idem: quem paga pode não ter sessão (link repassado a terceiro).
            ? { user_id: user?.id || null, origem: 'tsn-app', tipo: 'cobranca_avulsa', cobranca_id: cobrancaCtx.cobrancaId }
            : { user_id: user.id, origem: 'tsn-app', tipo: 'servico', proposito },
      // external_reference sempre presente (score de qualidade da integração MP pede
      // referência externa em toda cobrança). Só o formato do produto (uuid puro) é lido
      // de volta pelo webhook (ehProdutoMp/UUID_RE); os demais levam prefixo — que o
      // próprio UUID_RE rejeita por ser ancorado — porque esses fluxos já discriminam por
      // metadata.tipo, não por external_reference (ver comentário em mp-webhook.js).
      external_reference: produtoBonusCtx
        ? produtoBonusCtx.compraId
        : honorarioCtx
          ? `honorario:${honorarioCtx.arrematacaoId}`
          : cobrancaCtx
            ? `cobranca:${cobrancaCtx.cobrancaId}`
            : `servico:${user.id}:${proposito}`,
      notification_url: `${process.env.APP_BASE_URL || 'https://bidprobrasil.com.br'}/api/mp-webhook`,
      statement_descriptor: 'BIDPRO BRASIL',
    };

    // Cartão de crédito: requer token gerado pelo SDK MP no frontend
    if (metodoPagamento === 'credit_card' && dadosCartao?.token) {
      payload.token = dadosCartao.token;
      payload.installments = dadosCartao.parcelas || 1;
      payload.payment_method_id = dadosCartao.metodoPagamentoId;
    }

    // Chave idempotente.
    // - Cartão: o token é single-use → a chave determinística já impede duplicar a
    //   cobrança num retry do MESMO token (double-submit).
    // - PIX: sem nonce, uma NOVA tentativa do mesmo valor recai no pagamento anterior
    //   (que pode ter expirado/sido cancelado), quebrando o fluxo do cliente. Por isso
    //   a chave leva um componente único por tentativa (idempotencyKey do front, se
    //   enviado, ou timestamp). PIX não gera cobrança automática — cada QR é pago à parte.
    const payerAnchor = user?.id || honorarioCtx?.arrematanteId || (cobrancaCtx ? `cobranca-${cobrancaCtx.cobrancaId}` : 'anon');
    const idemBase = `tsn-${payerAnchor}-${payload.token || 'pix'}-${payload.transaction_amount || 0}`;
    const idemKey = payload.token
      ? idemBase
      : `${idemBase}-${String(req.body?.idempotencyKey || Date.now()).slice(0, 40)}`;
    // deviceId (21/09): fingerprint gerado pelo SDK do MP no navegador (window.MP_DEVICE_
    // SESSION_ID, já carregado nesta tela pra tokenizar o cartão) — repassado no header que
    // o motor antifraude do MP espera. Opcional: se o front não mandar (SDK bloqueado por
    // adblock, por ex.), a cobrança segue sem o fingerprint, só com aprovação potencialmente
    // mais conservadora — nunca bloqueia o pagamento por isso.
    const deviceId = req.body?.deviceId ? String(req.body.deviceId).slice(0, 200) : null;
    const mpRes = await fetch(`${MP_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idemKey,
        ...(deviceId ? { 'X-meli-session-id': deviceId } : {}),
      },
      body: JSON.stringify(payload),
    });

    const data = await mpRes.json();

    if (!mpRes.ok) {
      console.error('[mp-checkout] erro MP:', data);
      // "Pagamento recusado" sozinho é beco sem saída pro cliente (achado 17/09: 3 tentativas
      // seguidas do mesmo usuário, mesmo erro, sem indicação do que fazer). As outras respostas
      // de pagamento recusado no app (não-aprovado, PIX indisponível) já orientam o próximo
      // passo — esta ficava para trás.
      return res.status(422).json({ error: 'Pagamento recusado. Verifique os dados do cartão ou tente outro cartão.', codigo: data?.cause?.[0]?.code || 'unknown' });
    }

    // user_id da auditoria é uuid de USUÁRIO — payerAnchor pode ser um prefixo sintético
    // ('cobranca-<uuid>') pra idempotência, que não é isso; nesse caso fica null e o
    // cobranca_id vai em `detalhes`, onde já é livre (jsonb).
    await auditLog({
      acao: 'mp_checkout_criado',
      user_id: user?.id || honorarioCtx?.arrematanteId || null,
      ip,
      detalhes: { payment_id: data.id, valor, metodo: metodoPagamento, ...(cobrancaCtx ? { cobranca_id: cobrancaCtx.cobrancaId } : {}) },
      sucesso: true,
    });

    // Grava o cartão salvo na compra (best-effort — ver comentário no bloco que gerou
    // mpCustomerId/mpCardId acima). A confirmação da compra em si (status='ativo',
    // concede_plano) é feita pelo webhook, não aqui.
    if (produtoBonusCtx && mpCustomerId && mpCardId && data.status === 'approved') {
      try {
        const SB_URL = process.env.VITE_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
        const patch = await fetch(`${SB_URL}/rest/v1/compras_produtos?id=eq.${produtoBonusCtx.compraId}`, {
          method: 'PATCH',
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ mp_customer_id: mpCustomerId, mp_card_id: mpCardId }),
        });
        if (!patch.ok) console.error('[mp-checkout] produto_bonus: gravar cartão salvo devolveu', patch.status);
      } catch (e) { console.error('[mp-checkout] produto_bonus: gravar cartão salvo falhou:', e?.message || e); }
    }

    return res.status(200).json({
      ok: true,
      paymentId: data.id,
      status: data.status,
      statusDetalhe: data.status_detail,
      // PIX: QR code
      qrCode: data.point_of_interaction?.transaction_data?.qr_code || null,
      qrCodeBase64: data.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      // Boleto
      boletoUrl: data.transaction_details?.external_resource_url || null,
    });
  } catch (e) {
    console.error('[mp-checkout]', e.message);
    return res.status(500).json({ error: 'Erro interno no pagamento' });
  }
}
