/**
 * api/_inter-cobranca.js — cobrança por PIX e BOLETO pelo Banco Inter (API Cobrança v3, boleto com QR Code Pix).
 *
 * Por que existe (07/11, dono): o cartão continua no Mercado Pago (e no Asaas como reserva), mas Pix e boleto vão
 * ao Inter — o dinheiro cai na conta da empresa na hora e a tarifa é uma fração da do MP. O Inter NÃO processa
 * cartão. Escopo `boleto-cobranca.read/write` já vem no token de api/_inter.js.
 *
 * Contratos que importam:
 *  - O VALOR e a cobrança de origem vêm do banco (cobrancas_avulsas), nunca do navegador.
 *  - A emissão é assíncrona no Inter: logo depois do POST a cobrança pode estar `EM_PROCESSAMENTO`, sem Pix nem
 *    linha digitável. Quem chama consulta de novo (`atualizar`) até os dados aparecerem.
 *  - BAIXA só com a API dizendo RECEBIDO/MARCADO_RECEBIDO numa reconsulta nossa. O aviso (webhook) do Inter é só o
 *    gatilho para reconsultar; o corpo dele nunca é prova (qualquer um pode chamar a URL).
 *  - A baixa é reivindicada antes de aplicar (`baixa_aplicada_em is null` → agora), então webhook, cron e a tela
 *    consultando ao mesmo tempo aplicam UMA vez.
 */
import { inter, interConfigurado } from './_inter.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
}
async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura HTTP ${r.status}: ${path.split('?')[0]}`);
  return r.json();
}

export const SITUACOES_PAGAS = ['RECEBIDO', 'MARCADO_RECEBIDO'];
export const SITUACOES_MORTAS = ['CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO'];
const so = (v) => String(v || '').replace(/\D/g, '');
const corta = (v, n) => String(v || '').trim().slice(0, n);

// Data (AAAA-MM-DD) em Brasília daqui a `dias`.
export function dataBr(dias = 0) {
  return new Date(Date.now() - 3 * 3600e3 + dias * 86400e3).toISOString().slice(0, 10);
}

// `seuNumero` do Inter tem no máximo 15 caracteres e precisa ser único por emissão.
export function seuNumeroDe(cobrancaId) {
  return `AV${String(cobrancaId).replace(/-/g, '').slice(0, 6)}${Date.now().toString(36).slice(-7)}`.slice(0, 15).toUpperCase();
}

export function validarPagador(p = {}) {
  const doc = so(p.doc);
  const end = p.endereco || {};
  const faltas = [];
  if (![11, 14].includes(doc.length)) faltas.push('CPF ou CNPJ');
  if (String(p.nome || '').trim().length < 3) faltas.push('nome');
  if (so(end.cep).length !== 8) faltas.push('CEP');
  if (!String(end.logradouro || '').trim()) faltas.push('rua');
  if (!String(end.numero || '').trim()) faltas.push('número');
  if (!String(end.bairro || '').trim()) faltas.push('bairro');
  if (!String(end.cidade || '').trim()) faltas.push('cidade');
  if (!/^[A-Za-z]{2}$/.test(String(end.uf || ''))) faltas.push('UF');
  return faltas;
}

export function corpoCobranca({ seuNumero, valor, vencimento, pagador, email, descricao }) {
  const doc = so(pagador.doc);
  const end = pagador.endereco || {};
  return {
    seuNumero,
    valorNominal: Math.round(Number(valor) * 100) / 100,
    dataVencimento: vencimento,
    numDiasAgenda: 30, // continua pagável até 30 dias depois do vencimento
    pagador: {
      cpfCnpj: doc,
      tipoPessoa: doc.length === 14 ? 'JURIDICA' : 'FISICA',
      nome: corta(pagador.nome, 100),
      endereco: corta(end.logradouro, 100),
      numero: corta(end.numero, 10),
      complemento: corta(end.complemento, 30) || undefined,
      bairro: corta(end.bairro, 60),
      cidade: corta(end.cidade, 60),
      uf: String(end.uf || '').toUpperCase(),
      cep: so(end.cep),
      email: corta(email, 50) || undefined,
    },
    mensagem: { linha1: corta(descricao || 'BidPro Brasil', 78) },
  };
}

// Lê a resposta do GET /cobrancas/{codigo} sem depender de um formato só (v3 aninha em cobranca/boleto/pix).
export function lerConsulta(d = {}) {
  const c = d.cobranca || d;
  return {
    situacao: String(c.situacao || '').toUpperCase() || null,
    valorRecebido: Number(c.valorTotalRecebido ?? c.valorRecebido ?? 0) || null,
    dataSituacao: c.dataSituacao || null,
    pix: d.pix?.pixCopiaECola || d.pixCopiaECola || null,
    linha: d.boleto?.linhaDigitavel || d.linhaDigitavel || null,
    nossoNumero: d.boleto?.nossoNumero || d.nossoNumero || null,
  };
}

// Saldo devido agora, sempre do banco.
export async function saldoDaCobranca(cobrancaId) {
  const [cob] = await ler(`cobrancas_avulsas?id=eq.${encodeURIComponent(cobrancaId)}&select=id,descricao,valor,valor_pago_pix,status,meio,termo_texto,termo_aceito_em,gateway_payment_id&limit=1`);
  if (!cob) return { erro: 'Cobrança não encontrada.', http: 404 };
  if (cob.status !== 'aberta') return { erro: 'Esta cobrança já foi paga ou cancelada.', http: 409, cob };
  if (cob.termo_texto && !cob.termo_aceito_em) return { erro: 'Leia e aceite o termo antes de pagar.', http: 409, cob };
  const saldo = Math.round(((Number(cob.valor) || 0) - (Number(cob.valor_pago_pix) || 0)) * 100) / 100;
  if (saldo <= 0) return { erro: 'Esta cobrança já foi coberta.', http: 409, cob };
  return { cob, saldo };
}

async function patchLinha(id, campos) {
  const r = await sb(`inter_cobrancas?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { ...campos, atualizado_em: new Date().toISOString() } });
  if (!r.ok) throw new Error(`inter_cobrancas PATCH HTTP ${r.status}`);
  const [linha] = await r.json();
  return linha || null;
}

// Visão pública (o que a tela do pagador recebe): sem CPF.
export const visao = (l) => l && ({
  id: l.id, situacao: l.situacao, valor: Number(l.valor), vencimento: l.vencimento,
  pix: l.pix_copia_cola, linha: l.linha_digitavel, pago: !!l.baixa_aplicada_em,
});

/**
 * Emite (ou reaproveita) a cobrança do Inter para o saldo atual da cobrança avulsa.
 * Reaproveita a última emissão viva do MESMO valor ainda no prazo — clicar duas vezes não gera dois boletos.
 */
export async function emitir({ cobrancaId, pagador, email }) {
  if (!interConfigurado()) return { erro: 'Pix e boleto pelo Inter indisponíveis no momento.', http: 503, semInter: true };
  const s = await saldoDaCobranca(cobrancaId);
  if (s.erro) return s;
  const { cob, saldo } = s;

  const vivas = await ler(`inter_cobrancas?cobranca_avulsa_id=eq.${cob.id}&baixa_aplicada_em=is.null&situacao=not.in.(${SITUACOES_MORTAS.join(',')})&vencimento=gte.${dataBr(0)}&order=criado_em.desc&limit=1`);
  const viva = vivas[0];
  if (viva && Math.abs(Number(viva.valor) - saldo) < 0.01 && viva.codigo_solicitacao) {
    return { linha: (await atualizar(viva)).linha || viva };
  }

  const faltas = validarPagador(pagador);
  if (faltas.length) return { erro: `Preencha: ${faltas.join(', ')}.`, http: 400 };

  const seuNumero = seuNumeroDe(cob.id);
  const vencimento = dataBr(3);
  const rIns = await sb('inter_cobrancas', { method: 'POST', prefer: 'return=representation', body: {
    cobranca_avulsa_id: cob.id, seu_numero: seuNumero, valor: saldo, vencimento,
    pagador_doc: so(pagador.doc), pagador_nome: corta(pagador.nome, 100), pagador_email: corta(email, 120) || null,
  } });
  if (!rIns.ok) throw new Error(`inter_cobrancas INSERT HTTP ${rIns.status}`);
  const [linha] = await rIns.json();

  const r = await inter('POST', '/cobranca/v3/cobrancas', corpoCobranca({ seuNumero, valor: saldo, vencimento, pagador, email, descricao: cob.descricao }));
  const codigo = r.ok ? (r.data?.codigoSolicitacao || r.data?.codigo_solicitacao) : null;
  if (!codigo) {
    await patchLinha(linha.id, { situacao: 'FALHA_EMISSAO', ultimo_erro: corta(r.erro || 'sem codigoSolicitacao', 400) });
    console.error('[inter-cobranca] emissão falhou', cob.id, r.status, r.erro);
    return { erro: 'O banco não conseguiu gerar o Pix/boleto agora.', http: 502, falhaInter: true };
  }
  const comCodigo = await patchLinha(linha.id, { codigo_solicitacao: codigo, situacao: 'EM_PROCESSAMENTO' });
  return { linha: (await atualizar(comCodigo)).linha || comCodigo };
}

/** Reconsulta o Inter, guarda o estado e, se pago, aplica a baixa uma vez só. */
export async function atualizar(linha) {
  if (!linha?.codigo_solicitacao) return { linha };
  const r = await inter('GET', `/cobranca/v3/cobrancas/${encodeURIComponent(linha.codigo_solicitacao)}`);
  if (!r.ok) {
    await patchLinha(linha.id, { consultado_em: new Date().toISOString(), ultimo_erro: corta(`consulta: ${r.erro}`, 400) }).catch(() => null); // padrao-ok: anotar o erro da consulta é best-effort; o erro já volta ao chamador e ao log
    return { linha, erro: r.erro };
  }
  const c = lerConsulta(r.data || {});
  let nova = await patchLinha(linha.id, {
    situacao: c.situacao || linha.situacao, pix_copia_cola: c.pix || linha.pix_copia_cola,
    linha_digitavel: c.linha || linha.linha_digitavel, nosso_numero: c.nossoNumero || linha.nosso_numero,
    consultado_em: new Date().toISOString(), ultimo_erro: null,
    ...(SITUACOES_PAGAS.includes(c.situacao) ? { valor_recebido: c.valorRecebido || Number(linha.valor), pago_em: linha.pago_em || new Date().toISOString() } : {}),
  }) || linha;
  if (SITUACOES_PAGAS.includes(nova.situacao) && !nova.baixa_aplicada_em) {
    const b = await aplicarBaixa(nova);
    if (b.linha) nova = b.linha;
  }
  return { linha: nova };
}

/** Baixa na cobrança avulsa. Reivindica a linha primeiro: concorrentes não aplicam duas vezes. */
export async function aplicarBaixa(linha) {
  const agora = new Date().toISOString();
  const rClaim = await sb(`inter_cobrancas?id=eq.${linha.id}&baixa_aplicada_em=is.null`, { method: 'PATCH', prefer: 'return=representation', body: { baixa_aplicada_em: agora } });
  if (!rClaim.ok) throw new Error(`reivindicar baixa HTTP ${rClaim.status}`);
  const [minha] = await rClaim.json();
  if (!minha) return { jaAplicada: true };

  const desfazer = () => sb(`inter_cobrancas?id=eq.${linha.id}`, { method: 'PATCH', body: { baixa_aplicada_em: null } }).catch((e) => console.error('[inter-cobranca] desfazer reivindicação falhou', linha.id, e?.message)); // padrao-ok: a varredura reconsulta; o log fica
  try {
    const [cob] = await ler(`cobrancas_avulsas?id=eq.${linha.cobranca_avulsa_id}&select=id,valor,valor_pago_pix,status,gateway_payment_id&limit=1`);
    const recebido = Number(linha.valor_recebido || linha.valor) || 0;
    const ref = `inter:${linha.codigo_solicitacao}`;
    if (!cob || cob.status !== 'aberta') {
      // Dinheiro que entrou numa cobrança já quitada/cancelada: não some — vai para conferência.
      const { registrarPagamentoParaConferir } = await import('./_webhook-core.js');
      await registrarPagamentoParaConferir({ gateway: 'inter', gatewayPaymentId: linha.codigo_solicitacao, referencia: `cobranca:${linha.cobranca_avulsa_id}`, valor: recebido, esperado: 0, motivo: cob ? 'ja_quitado' : 'cobranca_inexistente' });
      return { linha: minha, conferencia: true };
    }
    const total = Number(cob.valor) || 0;
    const jaPago = Number(cob.valor_pago_pix) || 0;
    const esperado = Math.max(0, Math.round((total - jaPago) * 100) / 100);
    const completou = recebido >= esperado - Math.max(1, esperado * 0.01);
    const rCob = await sb(`cobrancas_avulsas?id=eq.${cob.id}&status=eq.aberta`, { method: 'PATCH', prefer: 'return=representation', body: completou
      ? { status: 'paga', pago_em: agora, gateway_payment_id: ref, valor_pago_pix: jaPago + recebido }
      : { valor_pago_pix: jaPago + recebido, gateway_payment_id: ref } });
    if (!rCob.ok) throw new Error(`cobrancas_avulsas PATCH HTTP ${rCob.status}`);
    const [aplicada] = await rCob.json();
    if (!aplicada) throw new Error('cobrança saiu de aberta durante a baixa');
    console.log('[inter-cobranca] baixa aplicada', cob.id, ref, recebido, completou ? 'quitada' : 'parcial');
    return { linha: minha, quitada: completou };
  } catch (e) {
    console.error('[inter-cobranca] baixa falhou — será refeita', linha.id, e.message);
    await desfazer();
    return { erro: e.message };
  }
}

/** PDF do boleto (base64). */
export async function pdf(linha) {
  if (!linha?.codigo_solicitacao) return null;
  const r = await inter('GET', `/cobranca/v3/cobrancas/${encodeURIComponent(linha.codigo_solicitacao)}/pdf`);
  return r.ok ? (r.data?.pdf || null) : null;
}
