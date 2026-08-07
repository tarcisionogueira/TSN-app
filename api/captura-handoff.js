/**
 * /api/captura-handoff — a ponte "continuar no celular" (QR code).
 *
 * POR QUE EXISTE (pedido do dono, 07/08): a verificação de identidade do parceiro — e as demais
 * telas que pedem FOTO — abrem no computador, onde quase nunca há câmera decente. O cliente
 * travava exatamente ali. O QR passa só AQUELE PASSO para o celular, sem exigir login novo no
 * telefone (pedir login no celular é justamente onde a maioria desiste).
 *
 * MODELO DE SEGURANÇA — o telefone NUNCA recebe sessão:
 *  • O código é criado pelo DESKTOP JÁ AUTENTICADO e vale só para aquele usuário e aquele fluxo.
 *  • Guardamos apenas o HASH (sha-256) do código. Vazar a tabela não abre nada.
 *  • TTL de 15 minutos, teto de envios e invalidação ao concluir.
 *  • O telefone só ESCREVE (envia foto, em /api/captura-handoff-envio). Nenhuma rota devolve
 *    documento do usuário — o código é uma permissão de ENTREGA, não de leitura.
 *  • O GET público devolve o PRIMEIRO NOME só para o cliente confirmar que está na conta certa.
 *
 * Rotas:
 *   POST   (logado)  { fluxo }            → { codigo, url, expira_em }
 *   GET    ?codigo=  (público)            → { fluxo, nome, expirado, concluido, itens }
 *   DELETE ?codigo=  (logado, dono)       → cancela o código
 */
export const config = { runtime: 'nodejs', maxDuration: 15 };

import { createHash, randomBytes } from 'node:crypto';
import { getUser } from './_auth.js';
import { checkRateLimit, getIP } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const TTL_MIN = 15;

// Fluxos aceitos = os que o CHECK da tabela aceita. `passos` é o que o celular PEDE (e o que
// define "concluído"); `aceita` é o que ele PODE mandar (o verso do RG é opcional em todos).
export const FLUXOS = {
  kyc:       { titulo: 'Verificação de identidade', passos: ['documento', 'selfie'], aceita: ['documento', 'documento_verso', 'selfie'] },
  documento: { titulo: 'Enviar documento',          passos: ['documento'],           aceita: ['documento', 'documento_verso'] },
  selfie:    { titulo: 'Enviar selfie',             passos: ['selfie'],              aceita: ['selfie'] },
};

export const hashCodigo = (c) => createHash('sha256').update(String(c)).digest('hex');

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
}

/** Busca o handoff pelo código cru e já aplica as travas de validade. Uso compartilhado com o envio. */
export async function carregarHandoff(codigo) {
  if (!codigo || !/^[a-f0-9]{32}$/i.test(String(codigo))) return { erro: 'codigo_invalido' };
  const r = await sb(`captura_handoff?codigo_hash=eq.${hashCodigo(codigo)}&select=*&limit=1`);
  if (!r.ok) return { erro: 'indisponivel' };
  const [h] = await r.json().catch(() => []);
  if (!h) return { erro: 'codigo_invalido' };
  if (h.cancelado_em) return { erro: 'cancelado', handoff: h };
  if (new Date(h.expira_em).getTime() < Date.now()) return { erro: 'expirado', handoff: h };
  return { handoff: h };
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  const url = new URL(req.url, 'http://localhost');
  const codigo = (url.searchParams.get('codigo') || '').trim();

  // ── GET público: o celular abre o link do QR e pergunta o que deve enviar ────────────
  // Só o mínimo para a tela do telefone. Rate limit por IP porque a rota é anônima.
  if (req.method === 'GET') {
    const ip = getIP(req);
    const rl = await checkRateLimit(`handoff-get:${ip}`, 60, 60_000);
    if (!rl.ok) { res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' }); return; }

    const { erro, handoff } = await carregarHandoff(codigo);
    if (erro && erro !== 'expirado' && erro !== 'cancelado') { res.status(404).json({ error: 'Código inválido ou já usado.', motivo: erro }); return; }

    let nome = '';
    try {
      const p = await (await sb(`perfis?id=eq.${handoff.user_id}&select=nome&limit=1`)).json();
      nome = String(p?.[0]?.nome || '').trim().split(/\s+/)[0] || '';
    } catch { /* nome é só conforto visual */ }

    res.status(200).json({
      ok: !erro,
      motivo: erro || null,
      fluxo: handoff.fluxo,
      titulo: FLUXOS[handoff.fluxo]?.titulo || 'Enviar foto',
      passos: FLUXOS[handoff.fluxo]?.passos || ['documento'],
      nome,
      expira_em: handoff.expira_em,
      concluido: !!handoff.concluido_em,
      itens: Array.isArray(handoff.itens) ? handoff.itens.map(i => i?.tipo).filter(Boolean) : [],
    });
    return;
  }

  // ── Daqui para baixo exige o DONO logado (é o desktop que comanda) ───────────────────
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }

  if (req.method === 'POST') {
    // Teto por usuário: um código novo a cada clique é normal (o cliente troca de ideia),
    // mas não a ponto de virar geração em massa.
    const rl = await checkRateLimit(`handoff-novo:${user.id}`, 20, 10 * 60_000);
    if (!rl.ok) { res.status(429).json({ error: 'Muitos códigos gerados. Aguarde alguns minutos.' }); return; }

    let body = {};
    try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { body = {}; }
    const fluxo = String(body.fluxo || 'kyc');
    if (!FLUXOS[fluxo]) { res.status(400).json({ error: 'Fluxo desconhecido' }); return; }

    // 128 bits de aleatoriedade. O código cru só existe nesta resposta e no QR — o banco
    // guarda o hash, então nem com acesso ao banco dá para abrir a ponte de alguém.
    const cru = randomBytes(16).toString('hex');
    const expira = new Date(Date.now() + TTL_MIN * 60_000).toISOString();
    const ins = await sb('captura_handoff', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ codigo_hash: hashCodigo(cru), user_id: user.id, fluxo, expira_em: expira, ip_origem: getIP(req) }),
    });
    if (!ins.ok) {
      const det = await ins.text().catch(() => '');
      console.error('[captura-handoff] falha ao criar', ins.status, det.slice(0, 200));
      res.status(500).json({ error: 'Não foi possível gerar o código agora.' });
      return;
    }
    res.status(200).json({ ok: true, codigo: cru, url: `${BASE}/#/continuar/${cru}`, expira_em: expira, ttl_min: TTL_MIN });
    return;
  }

  if (req.method === 'DELETE') {
    const { handoff } = await carregarHandoff(codigo);
    // Cancelar é do DONO: sem esta checagem, quem tivesse um código derrubaria a ponte alheia.
    if (!handoff || handoff.user_id !== user.id) { res.status(404).json({ error: 'Código não encontrado' }); return; }
    await sb(`captura_handoff?codigo_hash=eq.${hashCodigo(codigo)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ cancelado_em: new Date().toISOString() }),
    }).catch(() => {});
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Método não permitido' });
}
