/**
 * POST /api/boas-vindas
 * Envia o e-mail de boas-vindas + aviso anti-"squatting" UMA vez por conta, em QUALQUER
 * caminho de criação de conta (checkout grátis, checkout pago, cadastro normal, Google,
 * convites). Chamado pelo AuthContext no 1º SIGNED_IN. Idempotente: só envia se
 * perfis.boas_vindas_em ainda estiver nulo (marca ANTES de enviar p/ evitar duplo-envio
 * em chamadas concorrentes). Best-effort — nunca é caminho crítico.
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';
import { enviarBoasVindas } from './_email.js';

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const user = await getUser(req);
  if (!user?.id) return res.status(401).json({ error: 'Não autenticado' });
  if (!user.email) return res.status(200).json({ ok: true, enviado: false, motivo: 'sem_email' });

  // Só envia se ainda não foi enviado (idempotente).
  // 19/08: sem `.ok`, o corpo de ERRO do PostgREST é um OBJETO — `const [perfil] = {...}`
  // lançava TypeError fora do try (500 no primeiro login). E se a leitura falhar, NÃO dá
  // para saber se já foi enviado: não envia (o próximo login tenta de novo).
  const perfilRes = await sb(`perfis?id=eq.${encodeURIComponent(user.id)}&select=nome,boas_vindas_em`);
  if (!perfilRes.ok) return res.status(200).json({ ok: false, enviado: false, motivo: 'leitura_falhou' });
  const linhas = await perfilRes.json().catch(() => null);
  const perfil = Array.isArray(linhas) ? linhas[0] : null;
  if (perfil?.boas_vindas_em) return res.status(200).json({ ok: true, enviado: false, motivo: 'ja_enviado' });

  // Marca ATOMICAMENTE (14/09: o guard acima — ler, depois decidir, depois marcar — ainda
  // deixa a corrida passar. Medido em produção: mesmo usuário recebeu boas_vindas 2-3x em
  // menos de 400ms, porque duas chamadas concorrentes ao SIGNED_IN liam boas_vindas_em nulo
  // AS DUAS antes de qualquer PATCH voltar. O filtro `boas_vindas_em=is.null` no PRÓPRIO
  // PATCH resolve: o Postgres só aplica a atualização, e só devolve a linha, para quem
  // encontra a condição ainda válida NO INSTANTE do UPDATE — a 2ª chamada concorrente já
  // não encontra a linha (outra já marcou) e volta vazia. Mesmo padrão já usado pro
  // orçamento de Bright Data e de e-mail: reserva atômica, não leitura-depois-escrita.
  // 19/08: a marca era best-effort — se o PATCH falhasse, o e-mail sairia de novo a CADA
  // login (a idempotência prometida no cabeçalho deixava de existir). Sem marca, sem envio.
  const marca = await sb(`perfis?id=eq.${encodeURIComponent(user.id)}&boas_vindas_em=is.null`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ boas_vindas_em: new Date().toISOString() }),
  }).catch(() => null);
  if (!marca?.ok) return res.status(200).json({ ok: false, enviado: false, motivo: 'marca_falhou' });
  const marcadas = await marca.json().catch(() => []);
  if (!Array.isArray(marcadas) || marcadas.length === 0) {
    return res.status(200).json({ ok: true, enviado: false, motivo: 'ja_enviado' });
  }

  const r = await enviarBoasVindas({ to: user.email, nome: perfil?.nome, origin, userId: user.id }).catch(() => ({ ok: false }));
  return res.status(200).json({ ok: true, enviado: !!r?.ok });
}
