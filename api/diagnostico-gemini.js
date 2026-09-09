// SONDA DO MOTOR DE BUSCA — responde "a chave do Gemini funciona AGORA?" em segundos.
//
// Por que existe (09/09): o motor de busca (Gemini + Google Search grounding) parou em 08/09 às
// 14:50 com HTTP 403 "Your project has been denied access", e TODO relatório passou a cair no
// fallback Claude, que aborta. Descobrir isso custou o dia: o motivo morria numa linha, e a única
// forma de testar era gerar um relatório inteiro — cinco minutos por tentativa, e quando ele
// concluía pelo Índice nem o motivo aparecia.
//
// Depois de trocar a chave (ou o projeto do Google), esta rota diz em UMA chamada se voltou, e
// devolve o motivo REAL quando não voltou (status HTTP + a mensagem do Google), em vez de "não
// funcionou". Zero custo relevante: um prompt de uma linha.
//
// NUNCA devolve o valor da chave — só se ela está configurada e quais os 4 últimos caracteres,
// o bastante para o dono conferir que o painel gravou a chave NOVA e não a antiga.
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { groundingGemini } from './_grounding.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  // `.ok` conferido antes de ler o corpo: falha de leitura do perfil não pode virar "não é
  // admin" — negar por erro e negar por identidade não são a mesma coisa.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${user.id}&select=role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) return res.status(502).json({ error: 'perfil_ilegivel' });
  const [perfil] = await r.json().catch(() => []);
  if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

  const chave = (process.env.GEMINI_API_KEY || '').trim();
  const identidade = {
    chave_configurada: !!chave,
    chave_final: chave ? `…${chave.slice(-4)}` : null,   // só o suficiente para distinguir a nova da antiga
    modelo: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
  };
  if (!chave) return res.status(200).json({ ok: false, motivo: 'GEMINI_API_KEY não está definida neste deploy', ...identidade });

  const t0 = Date.now();
  const g = await groundingGemini({
    prompt: 'Responda apenas com a palavra OK.',
    sistema: 'Você responde em uma palavra.',
    timeoutMs: 20000,
    maxOutputTokens: 32,
  });
  const ms = Date.now() - t0;

  if (g?.__falhou) {
    return res.status(200).json({ ok: false, ms, motivo: g.__erroApi || 'sem motivo devolvido', ...identidade });
  }
  return res.status(200).json({
    ok: true, ms, resposta: String(g?.texto || '').slice(0, 40), diag: g?.diag || null, ...identidade,
  });
}
