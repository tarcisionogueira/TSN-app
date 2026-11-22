/**
 * ENVIO DE WHATSAPP — uma porta só, dois canais por trás (22/11, pedido do dono).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * O dono vai usar um número via EVOLUTION API (conexão por QR code, NÃO oficial) enquanto a
 * portabilidade/Verificação da Meta não sai, e depois "apenas efetivar" na Cloud API oficial.
 * Por isso quem envia não sabe qual canal está ligado: chama `enviarTextoWhatsapp()` e recebe o
 * id da mensagem. Trocar de canal = trocar `WA_CANAL`, sem mexer em IA, fila ou histórico.
 *
 * CANAL (`WA_CANAL`):
 *   'evolution' — POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCIA} com header `apikey`.
 *   'oficial'   — Cloud API da Meta (WA_TOKEN + WA_PHONE_NUMBER_ID).
 *   vazio       — 'evolution' se EVOLUTION_URL existir, senão 'oficial'.
 *
 * DIFERENÇAS QUE IMPORTAM PARA QUEM CHAMA (`regrasDoCanal()`):
 *   - janela de 24 h: só existe na oficial (fora dela a Meta só aceita modelo aprovado);
 *   - mensagem ATIVA em texto livre: só na Evolution. Na oficial, primeira mensagem = template.
 *
 * ENVS (nomes, nunca valores — o repositório é público):
 *   WA_CANAL, EVOLUTION_URL (ex.: https://evo.seudominio.com.br, sem barra no fim),
 *   EVOLUTION_APIKEY (chave global ou token da instância), EVOLUTION_INSTANCIA (nome da instância).
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export function canalWhatsapp(env = process.env) {
  const c = String(env.WA_CANAL || '').trim().toLowerCase();
  if (c === 'evolution' || c === 'oficial') return c;
  return env.EVOLUTION_URL ? 'evolution' : 'oficial';
}

export function regrasDoCanal(canal = canalWhatsapp()) {
  return canal === 'evolution'
    ? { canal, janela24h: false, ativaTextoLivre: true }
    : { canal, janela24h: true, ativaTextoLivre: false };
}

/** Nomes das envs que faltam para ENVIAR pelo canal ativo (vazio = pronto). */
export function faltaParaEnviar(canal = canalWhatsapp(), env = process.env) {
  const req = canal === 'evolution' ? ['EVOLUTION_URL', 'EVOLUTION_APIKEY', 'EVOLUTION_INSTANCIA'] : ['WA_TOKEN', 'WA_PHONE_NUMBER_ID'];
  return req.filter((n) => !env[n]);
}

/**
 * Destino aceito pela Evolution: só dígitos (telefone com DDI) ou o JID inteiro quando a conversa
 * veio por identificador oculto do WhatsApp (`...@lid`) — aí não há telefone para reconstruir.
 */
export function destinoEvolution(para) {
  const s = String(para || '').trim();
  if (/@(lid|s\.whatsapp\.net)$/.test(s)) return s;
  return s.replace(/\D/g, '');
}

/** "Digitando…" proporcional ao tamanho (1,2 s a 4 s): resposta instantânea e longa denuncia robô. */
export function atrasoDigitando(texto) {
  const n = String(texto || '').length;
  return Math.max(1200, Math.min(4000, 600 + n * 25));
}

export async function enviarTextoEvolution(para, texto, {
  url = process.env.EVOLUTION_URL, apikey = process.env.EVOLUTION_APIKEY, instancia = process.env.EVOLUTION_INSTANCIA,
  fetchImpl = fetch, digitando = true,
} = {}) {
  const corpo = { number: destinoEvolution(para), text: String(texto).slice(0, 4000), linkPreview: true };
  if (digitando) corpo.delay = atrasoDigitando(texto);
  const r = await fetchImpl(`${String(url).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(instancia)}`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => null);
  // Mesmo critério da oficial: sem o id da mensagem não há prova de que saiu.
  const id = j?.key?.id;
  if (!r.ok || !id) {
    const motivo = j?.response?.message || j?.message || j?.error || 'sem id da mensagem';
    throw new Error(`Evolution ${r.status}: ${typeof motivo === 'string' ? motivo : JSON.stringify(motivo)}`.slice(0, 200));
  }
  return id;
}

export async function enviarTextoOficial(para, texto, { token = process.env.WA_TOKEN, phoneId = process.env.WA_PHONE_NUMBER_ID, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: true } }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => null);
  // `.ok` não basta sozinho: sem `messages[0].id` não há prova de que a Meta aceitou (forma nº 1).
  const wamid = j?.messages?.[0]?.id;
  if (!r.ok || !wamid) throw new Error(`Meta ${r.status}: ${j?.error?.message || 'sem id da mensagem'}`.slice(0, 200));
  return wamid;
}

/** Envia pelo canal ativo. Devolve o id da mensagem ou lança com o motivo do provedor. */
export async function enviarTextoWhatsapp(para, texto, opts = {}) {
  const canal = opts.canal || canalWhatsapp();
  return canal === 'evolution' ? enviarTextoEvolution(para, texto, opts) : enviarTextoOficial(para, texto, opts);
}

/** Estado da conexão da instância na Evolution: 'open' | 'close' | 'connecting' | null (ilegível). */
export async function estadoConexaoEvolution({
  url = process.env.EVOLUTION_URL, apikey = process.env.EVOLUTION_APIKEY, instancia = process.env.EVOLUTION_INSTANCIA, fetchImpl = fetch,
} = {}) {
  const r = await fetchImpl(`${String(url).replace(/\/+$/, '')}/instance/connectionState/${encodeURIComponent(instancia)}`, {
    headers: { apikey }, signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) return null;
  return j?.instance?.state || j?.state || null;
}
