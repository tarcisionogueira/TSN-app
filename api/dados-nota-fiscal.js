/**
 * POST /api/dados-nota-fiscal  { cobranca_id, dados:{ doc?, nome, email, cep, logradouro, numero, complemento, bairro, cidade, uf } }
 *
 * Grava os dados do tomador da nota fiscal na cobrança avulsa (cobrancas_avulsas.dados_nf). Público como a página
 * /cobranca/:id (o uuid da cobrança é a credencial do link). `doc` em branco mantém o documento já informado —
 * a tela só vê o documento mascarado. Ver api/_dados-nf.js.
 */
export const config = { runtime: 'edge' };
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { mesclar, faltando, visaoPublica, aPartirDoAceite } from './_dados-nf.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const rl = await checkRateLimit(`dados-nf:${getIP(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);
  let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = String(b?.cobranca_id || '');
  if (!UUID_RE.test(id)) return json({ error: 'cobranca_id inválido' }, 400);

  try {
    const r = await fetch(`${SB}/rest/v1/cobrancas_avulsas?id=eq.${id}&select=id,status,termo_texto,termo_aceito_em,termo_aceite,dados_nf&limit=1`, { headers: H, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`leitura HTTP ${r.status}`);
    const [cob] = await r.json();
    if (!cob) return json({ error: 'Cobrança não encontrada.' }, 404);
    if (cob.status !== 'aberta') return json({ error: 'Esta cobrança já foi paga ou cancelada.' }, 409);
    if (cob.termo_texto && !cob.termo_aceito_em) return json({ error: 'Leia e aceite o termo antes.' }, 409);

    const dados = mesclar(cob.dados_nf || aPartirDoAceite(cob.termo_aceite), b?.dados || {});
    const f = faltando(dados);
    if (f.length) return json({ error: `Para a nota fiscal, falta: ${f.join(', ')}.`, faltando: f }, 400);

    const w = await fetch(`${SB}/rest/v1/cobrancas_avulsas?id=eq.${id}&status=eq.aberta&select=id`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ dados_nf: { ...dados, gravado_em: new Date().toISOString() } }),
    });
    if (!w.ok) throw new Error(`gravação HTTP ${w.status}`);
    if (!(await w.json()).length) return json({ error: 'Esta cobrança já foi paga ou cancelada.' }, 409);
    return json({ ok: true, nf: visaoPublica(dados) });
  } catch (e) {
    console.error('[dados-nota-fiscal]', e?.message || e);
    return json({ error: 'Não consegui salvar agora. Tente de novo em instantes.' }, 502);
  }
}
