/**
 * calcular-score.js
 *
 * POST /api/calcular-score
 * Node.js runtime — requer autenticação como admin ou analista.
 *
 * Calcula o score_financeiro de um imóvel em leilão com base em:
 *   - desconto_percentual
 *   - modalidade (judicial / extrajudicial / outros)
 *   - tipo (apartamento, casa, terreno, etc.)
 *
 * Body aceito (um dos dois formatos):
 *
 *   1) Por ID — busca os dados do imóvel e grava o score calculado:
 *      { imovel_id: "uuid" }
 *
 *   2) Por atributos diretos — apenas calcula, não grava nada:
 *      { modalidade: "judicial", desconto_percentual: 30, tipo: "apartamento", estado: "SP" }
 *
 * Retorna:
 *   { score_financeiro: number, formula_detail: object }
 */

import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido — use POST' });
  }

  const ip = getIP(req);
  const rl = checkRateLimit(`calcular-score:${ip}`, 20, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  // ── 1. Autenticação ────────────────────────────────────────────────────────
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const role = await getUserRoleById(user.id);
  if (!['admin', 'analista'].includes(role)) {
    return res.status(403).json({ error: 'Apenas administradores e analistas podem calcular scores' });
  }

  // ── 2. Parse do body ───────────────────────────────────────────────────────
  const body = req.body ?? {};
  const { imovel_id } = body;

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Variáveis Supabase não configuradas' });
  }

  const hdr = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  let modalidade, desconto_percentual, tipo, estado;

  if (imovel_id) {
    // Modo 1: buscar dados do imóvel no banco
    if (typeof imovel_id !== 'string' || !imovel_id.match(/^[0-9a-f-]{36}$/i)) {
      return res.status(400).json({ error: 'imovel_id inválido — deve ser um UUID' });
    }

    const imRes = await fetch(
      `${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${imovel_id}&select=modalidade,desconto_percentual,tipo,estado`,
      { headers: hdr, signal: AbortSignal.timeout(8000) }
    );

    if (!imRes.ok) {
      const txt = await imRes.text();
      console.error(`[calcular-score] buscar imóvel falhou (${imRes.status}): ${txt}`);
      return res.status(500).json({ error: 'Erro ao buscar imóvel' });
    }

    const [imovel] = await imRes.json();
    if (!imovel) return res.status(404).json({ error: 'Imóvel não encontrado' });

    modalidade           = imovel.modalidade;
    desconto_percentual  = imovel.desconto_percentual;
    tipo                 = imovel.tipo;
    estado               = imovel.estado;
  } else {
    // Modo 2: atributos diretos no body
    modalidade          = body.modalidade;
    desconto_percentual = body.desconto_percentual;
    tipo                = body.tipo;
    estado              = body.estado;
  }

  // ── 3. Calcular score_financeiro ───────────────────────────────────────────
  const { score, detalhe } = calcularScoreFinanceiro({ modalidade, desconto_percentual, tipo, estado });

  // ── 4. Gravar no banco (apenas quando imovel_id informado) ────────────────
  if (imovel_id) {
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${imovel_id}`,
      {
        method: 'PATCH',
        headers: { ...hdr, Prefer: 'return=minimal' },
        body: JSON.stringify({
          score_financeiro:    score,
          score_calculado_em:  new Date().toISOString(),
        }),
      }
    );

    if (!patchRes.ok) {
      const txt = await patchRes.text();
      console.error(`[calcular-score] PATCH falhou (${patchRes.status}): ${txt}`);
      return res.status(500).json({ error: 'Score calculado mas não foi possível gravar no banco' });
    }
  }

  return res.status(200).json({
    ok: true,
    score_financeiro: score,
    formula_detail:   detalhe,
    ...(imovel_id ? { imovel_id, gravado: true } : { gravado: false }),
  });
}

// ── Algoritmo de score ─────────────────────────────────────────────────────────

/**
 * Calcula score_financeiro [0..100].
 *
 * Algoritmo:
 *   base = 50
 *   + desconto_percentual * 0.6   (max +60 para 100% de desconto)
 *   - 10 se modalidade === 'judicial'        (risco de incerteza processual)
 *   + 5  se modalidade === 'extrajudicial'   (título mais limpo)
 *   - 5  se tipo === 'terreno'               (menor demanda)
 *   + 5  se tipo in ['apartamento', 'casa']  (maior demanda)
 *   clamped a [0, 100]
 *
 * @param {{ modalidade, desconto_percentual, tipo, estado }} params
 * @returns {{ score: number, detalhe: object }}
 */
function calcularScoreFinanceiro({ modalidade, desconto_percentual, tipo, estado }) {
  const mod  = (modalidade ?? '').toLowerCase();
  const tip  = (tipo ?? '').toLowerCase();
  const desc = typeof desconto_percentual === 'number' ? desconto_percentual : parseFloat(desconto_percentual) || 0;

  const base = 50;
  const ajusteDesconto   = Math.min(desc * 0.6, 60);  // +0 a +60
  const ajusteModalidade = mod === 'judicial'
    ? -10
    : mod === 'extrajudicial'
      ? +5
      : 0;
  const ajusteTipo = tip === 'terreno'
    ? -5
    : ['apartamento', 'casa'].includes(tip)
      ? +5
      : 0;

  const raw   = base + ajusteDesconto + ajusteModalidade + ajusteTipo;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const detalhe = {
    base,
    ajuste_desconto:    +ajusteDesconto.toFixed(1),
    ajuste_modalidade:  ajusteModalidade,
    ajuste_tipo:        ajusteTipo,
    raw:                +raw.toFixed(1),
    score_final:        score,
    inputs: {
      modalidade:          modalidade ?? null,
      desconto_percentual: desc,
      tipo:                tipo ?? null,
      estado:              estado ?? null,
    },
  };

  return { score, detalhe };
}
