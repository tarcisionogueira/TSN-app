/**
 * POST /api/promo-capturar
 * Captura de LEAD do link promocional (função SDR unificada com a promoção).
 * O visitante do tráfego responde as perguntas do link e informa contato; aqui:
 *   1. valida o código do link (ativo e dentro da validade)
 *   2. sorteia um consultor ativo (mesma pipeline do SDR → "carteira" do consultor)
 *   3. grava o lead em sdr_leads (com as respostas) para o consultor trabalhar
 * Depois o cliente segue para o checkout com o desconto (feito no front).
 *
 * Não cria conta aqui: o checkout/login já cuida disso. Assim o lead é salvo para
 * o consultor mesmo que a pessoa não conclua a compra na hora.
 * Segurança: rate limit por IP; nunca confia no cliente sobre o desconto.
 */
export const config = { runtime: 'nodejs' };

import { checkRateLimit } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  const origin = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(`promo-capturar:${ip}`, 6, 60_000).ok) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde um instante e tente de novo.' });
  }

  const b = req.body || {};
  const codigo    = String(b.codigo || '').trim().toUpperCase();
  const nome      = String(b.nome || '').trim();
  const email     = String(b.email || '').trim().toLowerCase();
  const whatsapp  = String(b.whatsapp || '').replace(/\D/g, '');
  // respostas: [{ pergunta, resposta }] — já denormalizado para o consultor ler direto.
  const respostasArr = Array.isArray(b.respostas) ? b.respostas : [];

  if (!codigo) return res.status(400).json({ error: 'Código do link ausente.' });
  if (!nome || !whatsapp) return res.status(400).json({ error: 'Preencha nome e WhatsApp.' });
  if (whatsapp.length < 10) return res.status(400).json({ error: 'WhatsApp inválido.' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });

  // 1) Valida o link (ativo + dentro da validade). Nunca confia no cliente.
  const linkRows = await sb(`links_promo?codigo=eq.${encodeURIComponent(codigo)}&ativo=eq.true&select=id,produto,validade_ate`).then(r => r.json()).catch(() => []);
  const link = Array.isArray(linkRows) ? linkRows[0] : null;
  if (!link) return res.status(404).json({ error: 'Link promocional não encontrado ou inativo.' });
  if (link.validade_ate && new Date(link.validade_ate) < new Date()) {
    return res.status(410).json({ error: 'Este link promocional expirou.' });
  }

  // 2) Sorteio do consultor ativo (mesma regra do SDR). Sem consultores → pool.
  let consultorId = null;
  try {
    const cons = await sb('perfis?role=eq.consultor&select=id,ativo').then(r => r.json()).catch(() => []);
    const ativos = (Array.isArray(cons) ? cons : []).filter(c => c.ativo !== false);
    if (ativos.length) consultorId = ativos[Math.floor(Math.random() * ativos.length)].id;
  } catch { /* pool */ }

  // Respostas guardadas como objeto { "pergunta": "resposta" } — a tela do consultor
  // (Admin > SDR) já renderiza esse formato no fallback, sem precisar do produto SDR.
  const respostas = {};
  for (const r of respostasArr) {
    const q = String(r?.pergunta || '').trim();
    if (q) respostas[q.slice(0, 200)] = String(r?.resposta ?? '').slice(0, 500);
  }

  // 3) Lead para o consultor.
  try {
    const ins = await sb('sdr_leads', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        promo_id: link.id, produto_id: null,
        nome, whatsapp, email: email || null,
        respostas, consultor_id: consultorId,
        origem: `Promoção ${codigo}`, status: 'novo',
      }),
    });
    if (!ins.ok) {
      const txt = await ins.text().catch(() => '');
      return res.status(500).json({ error: 'Falha ao registrar o lead.', detalhe: txt.slice(0, 200) });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao registrar o lead.', detalhe: String(e?.message || e) });
  }

  return res.status(200).json({ ok: true, produto: link.produto });
}
