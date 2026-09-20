// TEMPORÁRIO — testa se a API pública do DataJud aceita agregação (terms agg em
// partes.nome) numa busca por classe "Busca e Apreensão" / assunto "Alienação
// Fiduciária", sem filtro de banco. Objetivo: ranking de credores sem baixar cada
// processo (size:0 + aggs), pro ranking automático pedido pelo dono. Remove depois.
export const config = { runtime: 'nodejs', maxDuration: 30 };
import { isCronAuthorized } from './_auth.js';

const CNJ_KEY = process.env.CNJ_DATAJUD_KEY;
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!CNJ_KEY) { res.status(500).json({ error: 'CNJ_DATAJUD_KEY ausente' }); return; }
  const tribunal = String(req.query?.tribunal || 'tjsp');
  const query = {
    bool: { should: [
      { match: { 'assuntos.nome': 'Alienação Fiduciária' } },
      { match: { 'classe.nome': 'Busca e Apreensão' } },
    ], minimum_should_match: 1 },
  };
  const body = {
    size: 0,
    query,
    aggs: {
      credores: {
        nested: { path: 'partes' },
        aggs: { por_nome: { terms: { field: 'partes.nome.keyword', size: 20 } } },
      },
    },
  };
  const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
  let respostaNested = null, erroNested = null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `APIKey ${CNJ_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const txt = await r.text();
    respostaNested = { status: r.status, corpo: txt.slice(0, 2000) };
  } catch (e) { erroNested = String(e?.message || e).slice(0, 200); }

  // Segunda tentativa: sem `nested` (mapping público, igual ao resto do arquivo, não marca
  // `partes` como nested) — terms direto em partes.nome.keyword.
  const bodyFlat = {
    size: 0,
    query,
    aggs: { credores: { terms: { field: 'partes.nome.keyword', size: 20 } } },
  };
  let respostaFlat = null, erroFlat = null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `APIKey ${CNJ_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyFlat), signal: AbortSignal.timeout(15000) });
    const txt = await r.text();
    respostaFlat = { status: r.status, corpo: txt.slice(0, 2000) };
  } catch (e) { erroFlat = String(e?.message || e).slice(0, 200); }

  res.status(200).json({ ok: true, tribunal, respostaNested, erroNested, respostaFlat, erroFlat });
}
