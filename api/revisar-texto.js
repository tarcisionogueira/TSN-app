/**
 * POST /api/revisar-texto   (equipe) — { texto } → { ok, corrigido, mudancas: [{de, para}] }
 *
 * CORREÇÃO ORTOGRÁFICA SUGERIDA para os e-mails que saem da plataforma (pedido do dono, 30/09:
 * "ter correção ortográfica sugerida para manter um bom padrão de resposta"). É SUGESTÃO: a tela
 * mostra o que mudaria e quem escreve decide aplicar ou não — nada é trocado sozinho.
 *
 * Só ortografia, acentuação, concordância, pontuação e maiúsculas. Não reescreve estilo.
 * TRAVA NA SAÍDA (a garantia não é o prompt): todo número, e-mail e link do original tem de
 * continuar no texto corrigido, e o tamanho não pode mudar mais que 25% — reprovou, devolve
 * `corrigido: null` com o motivo (nunca uma "correção" que alterou valor de proposta).
 * Custo: Gemini primário, Haiku de reserva (iaTexto) — centavos por revisão.
 */
import { getAuthUser, unauthorized } from './_auth.js';
import { iaTexto } from './_claude.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const ROLES_EQUIPE = ['admin', 'analista', 'advogado', 'suporte'];
const MAX_TEXTO = 6000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
}

// Puro (testável): o que NÃO pode mudar numa revisão ortográfica.
export function intocaveis(texto) {
  const s = String(texto || '');
  return [
    ...(s.match(/https?:\/\/\S+/g) || []),
    ...(s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []),
    ...(s.match(/\d+(?:[.,]\d+)*/g) || []),
  ];
}
export function revisaoSegura(original, corrigido) {
  const o = String(original || ''), c = String(corrigido || '');
  if (!c.trim()) return 'revisão veio vazia';
  const razao = c.length / Math.max(1, o.length);
  if (razao < 0.75 || razao > 1.25) return 'a revisão mudou o tamanho do texto demais — descartada';
  const faltou = intocaveis(o).find((t) => !c.includes(t.replace(/[.,;:)]+$/, '')));
  if (faltou) return `a revisão alterou "${faltou.slice(0, 40)}" — descartada (números, e-mails e links não podem mudar)`;
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const rPerfil = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${user.id}&select=role`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!rPerfil.ok) return json({ error: 'Não foi possível verificar seu acesso agora. Tente novamente.' }, 500);
  const [perfil] = await rPerfil.json();
  if (!ROLES_EQUIPE.includes(perfil?.role)) return json({ error: 'Este recurso está disponível apenas para a equipe.' }, 403);

  const rl = await checkRateLimit(`revisar-texto:${user.id}`, 60, 3_600_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const texto = String(body?.texto || '').slice(0, MAX_TEXTO);
  if (texto.trim().length < 3) return json({ ok: true, corrigido: texto, mudancas: [] });

  const system = 'Você é revisor de português do Brasil. Corrija APENAS ortografia, acentuação, concordância, pontuação e uso de maiúsculas (ex.: início de frase, fechamento como "Atenciosamente,"). NÃO reescreva, NÃO mude o tom, NÃO acrescente nem remova frases, NÃO altere números, valores, datas, nomes próprios, e-mails ou links. Se não houver nada a corrigir, devolva o texto idêntico.';
  const prompt = `Revise o texto entre <texto> e responda SOMENTE com JSON válido, sem comentários: {"corrigido": "<texto inteiro corrigido, preservando as quebras de linha>", "mudancas": [{"de": "<trecho original>", "para": "<trecho corrigido>"}]}\n\n<texto>\n${texto}\n</texto>`;

  const r = await iaTexto({ prompt, system, maxTokens: 4000, timeoutMs: 20000 });
  if (!r?.texto) return json({ error: 'A revisão não está disponível agora. Tente de novo em instantes.' }, 502);
  let out;
  try { out = JSON.parse(r.texto.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, '$1')); } catch { out = null; }
  if (!out || typeof out.corrigido !== 'string') return json({ error: 'A revisão voltou num formato inesperado. Tente de novo.' }, 502);

  const reprovada = revisaoSegura(texto, out.corrigido);
  if (reprovada) return json({ ok: true, corrigido: null, mudancas: [], motivo: reprovada });
  const mudancas = (Array.isArray(out.mudancas) ? out.mudancas : [])
    .filter((m) => m && typeof m.de === 'string' && typeof m.para === 'string' && m.de !== m.para)
    .slice(0, 40);
  const iguais = out.corrigido === texto;
  return json({ ok: true, corrigido: iguais ? texto : out.corrigido, mudancas: iguais ? [] : mudancas });
}
