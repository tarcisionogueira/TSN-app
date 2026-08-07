/**
 * /api/documental-retry-cron — retenta laudos documentais PRELIMINARES.
 *
 * Quando o Claude não conclui a leitura dos documentos no tempo, o laudo sai
 * marcado como `preliminar: true`. Este cron roda de HORA EM HORA e, para cada
 * laudo preliminar criado nas últimas 48h, dispara um NOVO ciclo de geração
 * (/api/gerar-documental) com orçamento fresco — muitas vezes o Claude conclui
 * numa próxima tentativa (menos carga). Assim que a leitura conclui, o laudo
 * deixa de ser `preliminar` e para de ser retentado. Sem risco de rebaixar: só
 * mexe em laudos que ainda NÃO têm parecer real.
 *
 * Cada geração roda numa INVOCAÇÃO independente (fire-and-forget): a cron só
 * garante o disparo (aborta a própria conexão em ~9s) e não espera os ~200s.
 *
 * Roda de hora em hora (vercel.json). Autorizado por CRON_SECRET (Bearer).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
// Domínio canônico (www): o apex redireciona 308 — igual ao webhook do MP.
const BASE = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace('://bidprobrasil.com.br', '://www.bidprobrasil.com.br');
const LOTE = 4; // poucos por hora: cada um abre 1 chamada Claude longa
// TETO DE RETENTATIVAS (07/08). A janela de 48h sozinha não bastava: a cada 6h dentro dela
// são até 8 regerações do MESMO laudo, e o documental é a chamada mais cara do sistema
// (lê os PDFs por VISÃO). Pior, existe um caso que NUNCA converge por repetição:
// `gerar-documental` marca `preliminar = ... || matriculaFaltaCaixa`, e isso é determinístico
// enquanto a matrícula da Caixa não tiver sido capturada — o edital já foi lido, então o gate
// de "nada legível" não corta, e a geração inteira roda de novo para dar o mesmo resultado.
// Usa a coluna `regen_tentativas` que a tabela JÁ tem, compartilhada com o
// regenerar-relatorios-cron: o teto passa a valer para o gasto TOTAL de IA reprocessando
// aquele laudo, venha de qual mecanismo vier — que é o que interessa proteger.
const MAX_TENT = 3;

async function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) { res.status(500).json({ error: 'env ausente' }); return; }

  // Preliminares dentro das últimas 48h (mais antigos primeiro — dão a vez às que
  // esperam há mais tempo). Passadas 48h, paramos de retentar (não fica eterno).
  // A janela é medida em `created_at`, NÃO em `updated_at`: a própria retentativa reescreve
  // o updated_at, então o teto de 48h nunca chegava a valer — um documental que ficasse
  // preliminar era regerado a cada 6h para sempre, queimando IA e leitura de documento sem
  // nenhuma chance de sair do lugar. `created_at` é preservado pelo upsert.
  const desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const q = `analises_documental?status=eq.concluida&result->>preliminar=eq.true&created_at=gt.${encodeURIComponent(desde)}`
    + `&regen_tentativas=lt.${MAX_TENT}`
    + `&order=created_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado,regen_tentativas`;
  let rows = [];
  try { rows = await (await sb(q)).json(); } catch { rows = []; }
  if (!Array.isArray(rows) || !rows.length) { res.status(200).json({ ok: true, retentados: 0 }); return; }

  // GATE DE PRÉ-CONDIÇÃO: enquanto a captura da matrícula da Caixa ainda está na fila, o
  // insumo que falta NÃO existe — regerar agora paga a chamada cara para chegar ao mesmo
  // laudo preliminar. Espera a fila resolver (ou falhar em definitivo) e só então retenta.
  // Best-effort: se a consulta à fila falhar, seguimos com o comportamento antigo (melhor
  // retentar à toa do que travar o resgate de um laudo que já poderia concluir).
  let bloqueados = new Set();
  try {
    const fila = await (await sb('cef_matricula_fila?status=in.(pendente,processando)&select=imovel_id')).json();
    if (Array.isArray(fila)) bloqueados = new Set(fila.map((f) => String(f.imovel_id)));
  } catch { /* segue sem o gate */ }
  const alvos = rows.filter((r) => !bloqueados.has(String(r.imovel_id)));
  const adiados = rows.length - alvos.length;
  if (!alvos.length) { res.status(200).json({ ok: true, retentados: 0, adiados }); return; }

  // Conta a tentativa ANTES de disparar. Se contássemos depois, uma geração que derruba a
  // função (o modo de falha que criou o preliminar) nunca incrementaria — e o teto acima
  // seria decorativo, justo no caso que ele existe para conter.
  await Promise.allSettled(alvos.map((r) =>
    sb(`analises_documental?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
    }).catch(() => {})
  ));

  // Dispara em paralelo; aborta a própria conexão em ~9s (a geração continua no
  // destino, invocação independente, até concluir). allSettled p/ não travar a cron.
  await Promise.allSettled(alvos.map((r) =>
    fetch(`${BASE}/api/gerar-documental`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
      body: JSON.stringify({ imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado }),
      signal: AbortSignal.timeout(9000),
    }).catch(() => {})
  ));

  res.status(200).json({ ok: true, retentados: alvos.length, adiados, teto: MAX_TENT });
}
