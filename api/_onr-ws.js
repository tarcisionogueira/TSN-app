/**
 * api/_onr-ws.js — cliente do Web Service OFICIAL da ONR (WSSAEC / RI Digital), SOAP.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Convênio da NOGUEIRA EMPREENDIMENTOS ativado em 21/10/2026 (chamado CS0819152). Substitui, aos
 * poucos, a raspagem do portal em `_onr.js` (login com e-mail/senha), que depende de HTML.
 * Especificação: ridigital.org.br/downloads/Especificacao_wssaec_dev.pdf (rev. 9.50, 24/06/2026).
 *
 * ─── AUTENTICAÇÃO (spec p19–22) ──────────────────────────────────────────────────────
 *  1. `LoginClienteConvenio` (logincliente.asmx) com Email + CPF do usuário do convênio + IDParceiro
 *     → devolve 5 TOKENS de 6 letras. Cada token vale UMA chamada, por 8 h.
 *  2. Toda chamada de negócio leva `Hash = SHA1(UTF8(chave + token))`. A CHAVE NUNCA TRAFEGA.
 *  Os tokens moram em `onr_ws_tokens` (claim atômico via `onr_ws_token_pegar`): instâncias da
 *  Vercel não compartilham memória, e token reusado volta "Hash inválido" — parece chave errada.
 *  A spec não diz se o SHA-1 vai em hex maiúsculo ou minúsculo: `ONR_WS_HASH_CASE` (padrão
 *  'upper'); o teste do admin (api/onr-ws.js) experimenta as duas e diz qual a ONR aceita.
 *
 * ─── ERRO VEM DENTRO DE UM 200 (forma nº 1 do CLAUDE.md) ────────────────────────────
 *  Toda resposta tem RETORNO/CODIGOERRO/ERRODESCRICAO (alguns serviços em Pascal: Retorno…).
 *  `chamarOnr` LANÇA quando RETORNO é false — nunca devolve a resposta de erro como conteúdo.
 *
 * ENVS (nomes; repo público): ONR_WS_URL (padrão homologação hml3), ONR_WS_ID (IDParceiro),
 * ONR_WS_CHAVE, ONR_WS_EMAIL, ONR_WS_CPF (usuário do convênio), ONR_WS_HASH_CASE (opcional).
 */
import crypto from 'node:crypto';

const NS = 'http://tempuri.org/WSArisp';
export const URL_HOMOLOGACAO = 'https://hml3-ws.onr.org.br';
const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

export function configOnr(env = process.env) {
  return {
    base: String(env.ONR_WS_URL || URL_HOMOLOGACAO).replace(/\/+$/, ''),
    id: Number(env.ONR_WS_ID) || null,
    chave: env.ONR_WS_CHAVE || null,
    email: env.ONR_WS_EMAIL || null,
    cpf: env.ONR_WS_CPF ? String(env.ONR_WS_CPF).replace(/\D/g, '') : null,
    hashCase: env.ONR_WS_HASH_CASE === 'lower' ? 'lower' : 'upper',
  };
}

export function faltaOnr(cfg = configOnr()) {
  return [
    ['ONR_WS_ID', !!cfg.id], ['ONR_WS_CHAVE', !!cfg.chave],
    ['ONR_WS_EMAIL', !!cfg.email], ['ONR_WS_CPF', !!cfg.cpf],
  ].filter(([, ok]) => !ok).map(([n]) => n);
}

/** Hash = SHA1(UTF8(chave + token)) — spec p19. */
export function hashOnr(chave, token, caixa = 'upper') {
  const h = crypto.createHash('sha1').update(`${chave}${token}`, 'utf8').digest('hex');
  return caixa === 'lower' ? h : h.toUpperCase();
}

// ─── XML ─────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Objeto → XML na ORDEM das chaves (o .asmx valida a sequência do WSDL).
 * Lista: `{ $item: 'NomeDoElemento', itens: [...] }` vira <Campo><NomeDoElemento>…</NomeDoElemento>…</Campo>.
 * `undefined`/`null` são omitidos (minOccurs=0).
 */
export function paraXml(obj) {
  let out = '';
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    if (v && typeof v === 'object' && Array.isArray(v.itens)) {
      out += `<${k}>${v.itens.map((it) => `<${v.$item}>${typeof it === 'object' ? paraXml(it) : esc(it)}</${v.$item}>`).join('')}</${k}>`;
    } else if (v && typeof v === 'object') {
      out += `<${k}>${paraXml(v)}</${k}>`;
    } else {
      out += `<${k}>${esc(typeof v === 'boolean' ? (v ? 'true' : 'false') : v)}</${k}>`;
    }
  }
  return out;
}

export function envelope(metodo, campos) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
    + `<soap:Body><${metodo} xmlns="${NS}"><oRequest>${paraXml(campos)}</oRequest></${metodo}></soap:Body></soap:Envelope>`;
}

const desesc = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * XML (respostas .asmx: elementos sem atributos relevantes) → objeto. Elemento repetido vira array;
 * folha vira string; `xsi:nil` vira null. Sem dependência: o formato da ONR é simples e fixo.
 */
export function deXml(xml) {
  const re = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  const raiz = { filhos: {} };
  const pilha = [{ nome: '#', no: raiz, texto: '' }];
  let m;
  while ((m = re.exec(xml))) {
    const [, fecha, nomeCru, attrs, auto, texto] = m;
    if (texto !== undefined) { pilha[pilha.length - 1].texto += texto; continue; }
    if (nomeCru.startsWith('?') || nomeCru.startsWith('!')) continue;
    const nome = nomeCru.includes(':') ? nomeCru.split(':')[1] : nomeCru;
    if (fecha) {
      const fr = pilha.pop();
      const valor = Object.keys(fr.no.filhos).length ? fr.no.filhos : (fr.nil ? null : desesc(fr.texto.trim()));
      const pai = pilha[pilha.length - 1].no.filhos;
      if (nome in pai) { if (!Array.isArray(pai[nome]) || !pai[`__arr_${nome}`]) { pai[nome] = [pai[nome]]; pai[`__arr_${nome}`] = true; } pai[nome].push(valor); }
      else pai[nome] = valor;
      continue;
    }
    const nil = /nil="true"/.test(attrs || '');
    if (auto) {
      const pai = pilha[pilha.length - 1].no.filhos;
      const valor = nil ? null : '';
      if (nome in pai) { if (!pai[`__arr_${nome}`]) { pai[nome] = [pai[nome]]; pai[`__arr_${nome}`] = true; } pai[nome].push(valor); }
      else pai[nome] = valor;
      continue;
    }
    pilha.push({ nome, no: { filhos: {} }, texto: '', nil });
  }
  const limpar = (o) => {
    if (Array.isArray(o)) return o.map(limpar);
    if (o && typeof o === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(o)) if (!k.startsWith('__arr_')) r[k] = limpar(v);
      return r;
    }
    return o;
  };
  return limpar(raiz.filhos);
}

/** Lista que o .asmx embrulha (<Tokens><string>a</string>…</Tokens>) → array sempre. */
export function lista(v, item) {
  if (v === null || v === undefined || v === '') return [];
  const dentro = item && typeof v === 'object' && !Array.isArray(v) ? v[item] : v;
  if (dentro === undefined || dentro === null || dentro === '') return [];
  return Array.isArray(dentro) ? dentro : [dentro];
}

/** Lê RETORNO/CODIGOERRO/ERRODESCRICAO nas duas grafias (spec usa as duas). */
export function statusOnr(r) {
  const pega = (a, b) => (r?.[a] !== undefined ? r[a] : r?.[b]);
  const ret = String(pega('RETORNO', 'Retorno') ?? '').toLowerCase() === 'true';
  return { ok: ret, codigo: Number(pega('CODIGOERRO', 'Codigoerro') ?? pega('CodigoErro', 'Codigoerro')) || 0, descricao: pega('ERRODESCRICAO', 'Errodescricao') ?? pega('ErroDescricao', 'Errodescricao') ?? '' };
}

export class ErroOnr extends Error {
  constructor(msg, { codigo = 0, metodo = '', http = 200 } = {}) { super(msg); this.codigo = codigo; this.metodo = metodo; this.http = http; }
}

// ─── Transporte ──────────────────────────────────────────────────────────────────────
async function postSoap(cfg, servico, metodo, campos, fetchImpl = fetch) {
  const r = await fetchImpl(`${cfg.base}/${servico}.asmx`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${NS}/${metodo}"` },
    body: envelope(metodo, campos),
    signal: AbortSignal.timeout(30000),
  });
  const xml = await r.text();
  if (!r.ok) {
    const falha = /<faultstring>([\s\S]*?)<\/faultstring>/i.exec(xml)?.[1];
    throw new ErroOnr(`ONR ${servico}.${metodo} HTTP ${r.status}${falha ? `: ${desesc(falha).slice(0, 200)}` : ''}`, { metodo, http: r.status });
  }
  const corpo = deXml(xml)?.Envelope?.Body;
  const res = corpo?.[`${metodo}Response`]?.[`${metodo}Result`];
  if (!res || typeof res !== 'object') throw new ErroOnr(`ONR ${metodo}: resposta sem ${metodo}Result`, { metodo });
  return res;
}

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Login do convênio → grava os tokens no banco. Devolve quantos vieram. */
export async function loginOnr(cfg = configOnr(), fetchImpl = fetch) {
  const falta = faltaOnr(cfg);
  if (falta.length) throw new ErroOnr(`ONR não configurado (faltam: ${falta.join(', ')})`, { metodo: 'LoginClienteConvenio' });
  const r = await postSoap(cfg, 'logincliente', 'LoginClienteConvenio', { Email: cfg.email, CPF: cfg.cpf, IDParceiro: cfg.id }, fetchImpl);
  const st = statusOnr(r);
  if (!st.ok) throw new ErroOnr(`ONR login recusado (${st.codigo}): ${st.descricao}`, { codigo: st.codigo, metodo: 'LoginClienteConvenio' });
  const tokens = lista(r.Tokens, 'string').map(String).filter((t) => /^[A-Za-z0-9]{4,12}$/.test(t));
  if (!tokens.length) throw new ErroOnr('ONR login sem tokens na resposta', { metodo: 'LoginClienteConvenio' });
  await sb('POST', 'onr_ws_tokens?on_conflict=token', tokens.map((token) => ({ token, ambiente: cfg.base })), 'resolution=ignore-duplicates,return=minimal');
  return { tokens: tokens.length, idCliente: Number(r.IDCliente) || null, ativo: String(r.Ativo).toLowerCase() === 'true' };
}

async function pegarToken(cfg) {
  let t = await sb('POST', 'rpc/onr_ws_token_pegar', { p_ambiente: cfg.base });
  if (!t) { await loginOnr(cfg); t = await sb('POST', 'rpc/onr_ws_token_pegar', { p_ambiente: cfg.base }); }
  if (!t) throw new ErroOnr('ONR: login feito mas nenhum token disponível');
  return t;
}

/**
 * Chamada autenticada. Lança ErroOnr se RETORNO=false (com o código da ONR). Registra em
 * `onr_ws_chamadas` (ok ou não). `opcoes.hashCase` sobrepõe a env (usado pelo teste).
 */
export async function chamarOnr(servico, metodo, campos = {}, opcoes = {}) {
  const cfg = { ...configOnr(), ...(opcoes.hashCase ? { hashCase: opcoes.hashCase } : {}) };
  const falta = faltaOnr(cfg);
  if (falta.length) throw new ErroOnr(`ONR não configurado (faltam: ${falta.join(', ')})`, { metodo });
  const inicio = Date.now();
  let res = null; let erro = null;
  try {
    const token = await pegarToken(cfg);
    res = await postSoap(cfg, servico, metodo, { Hash: hashOnr(cfg.chave, token, cfg.hashCase), ...campos });
    const st = statusOnr(res);
    if (!st.ok) throw new ErroOnr(`ONR ${metodo} (${st.codigo}): ${st.descricao}`, { codigo: st.codigo, metodo });
    return res;
  } catch (e) {
    erro = e;
    throw e;
  } finally {
    const linha = {
      ambiente: cfg.base, servico, metodo, ok: !erro, ms: Date.now() - inicio,
      codigo_erro: erro?.codigo ?? null, erro: erro ? String(erro.message).slice(0, 400) : null,
      protocolo: res?.Protocolo || null, valor_total: Number(String(res?.ValorTotal ?? res?.VlTotal ?? '').replace(',', '.')) || null,
      user_id: opcoes.userId || null,
    };
    await sb('POST', 'onr_ws_chamadas', linha, 'return=minimal').catch((e) => console.warn('[onr-ws] rastro não gravou:', e?.message || e));
  }
}

// ─── Serviços (os mais usados primeiro; os demais seguem o mesmo molde) ─────────────
export const TIPO_SERVICO = { certidao: 1, matricula_online: 2, consulta_eletronica: 3, monitor: 4, eprotocolo: 5 };

export async function listarCartorios({ tipoServico = 2, idEstado = 0, idCidade = 0 } = {}, opcoes) {
  const r = await chamarOnr('cartorios', 'CartoriosListar', { TipoServico: tipoServico, IDEstado: idEstado, IDCidade: idCidade }, opcoes);
  return lista(r.Cartorios, 'Cartorio_WSResp');
}

export async function listarEstados({ tipoServico = 2 } = {}, opcoes) {
  const r = await chamarOnr('estados', 'EstadosListar', { TipoServico: tipoServico }, opcoes);
  return lista(r.Estados, Object.keys(r.Estados || {})[0]);
}

/** Visualização de matrícula (imediata, vale 24 h após a 1ª visualização). Cobra. */
export async function visualizarMatricula({ idCartorio, matricula, requerente }, opcoes) {
  return chamarOnr('matriculaonline', 'VisualizarMatricula_v2', {
    IDCartorio: Number(idCartorio) || 0, Matricula: String(matricula),
    NomeRequerente: requerente?.nome, EmailRequerente: requerente?.email, CPFRequerente: requerente?.cpf,
  }, opcoes);
}

export async function reabrirMatricula(idPedidoArisp, opcoes) {
  return chamarOnr('matriculaonline', 'VisualizarMatriculaPedido', { IDPedidoArisp: Number(idPedidoArisp) }, opcoes);
}

/** Acompanhamento do e-Protocolo: status, prenotação, notas de exigência (AnexosExigencia). */
export async function pedidoEprotocolo(idPedido, opcoes) {
  return chamarOnr('eprotocolo', 'GetPedidoAC_v4', { IDPedido: Number(idPedido) }, opcoes);
}

export async function saldoCreditos(opcoes) {
  const r = await chamarOnr('Creditos', 'ObterSaldo', {}, opcoes);
  return r.Saldo ?? null;
}
