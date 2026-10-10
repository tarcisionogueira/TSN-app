/**
 * GET /api/honorario-procuracao?id=<arrematacao_id> — a PROCURAÇÃO PARTICULAR (outorgada à Nogueira
 * Empreendimentos e a quem ela delegar) vai junto com o pagamento do honorário de êxito
 * (10/10, pedido do dono: "acelera as coisas do que ficar pedindo depois para assinar").
 *
 * Público como a própria página de pagamento (/api/honorario-info): o id da arrematação é o
 * link que o cliente recebe. Garante que o documento exista (gerarProcuracao é idempotente por
 * caso) e devolve o token + o texto para a tela mostrar. A ASSINATURA não é feita aqui: a página
 * chama /api/assinar-contrato com o token — o mesmo caminho de todo documento (IP do servidor,
 * carimbo de tempo, hash do texto, baixa do contrato pendente).
 */
export const config = { runtime: 'edge' };

import { gerarProcuracao } from './_termo-assessoria.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN   = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const UUID = /^[0-9a-f-]{36}$/i;

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: {
  apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Método não permitido' }, 405);
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!UUID.test(id)) return json({ error: 'id inválido' }, 400);
  try {
    const rA = await sb(`arrematacoes?id=eq.${id}&select=id,caso_id,honorarios_status&limit=1`);
    if (!rA.ok) throw new Error(`arrematação HTTP ${rA.status}`);
    const [a] = await rA.json();
    if (!a) return json({ error: 'Arrematação não encontrada' }, 404);
    // Sem caso não há como dizer QUAL arrematação a procuração cobre — a página segue sem ela.
    if (!a.caso_id) return json({ ok: true, procuracao: null, motivo: 'sem_caso' });

    const rAdm = await sb('perfis?role=eq.admin&ativo=eq.true&select=id&order=created_at.asc&limit=1');
    const [adm] = rAdm.ok ? await rAdm.json() : [];
    const g = await gerarProcuracao(sb, { arrematacaoId: id, criadoPor: adm?.id || null });
    if (!g.ok) {
      console.error('[honorario-procuracao] gerar:', g.motivo);
      return json({ ok: true, procuracao: null, motivo: 'nao_gerada' });
    }
    const token = String(g.url || '').split('#/c/')[1] || null;
    if (!token) return json({ ok: true, procuracao: null, motivo: 'sem_token' });
    const rL = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}&select=titulo,conteudo,status,assinado_em&limit=1`);
    if (!rL.ok) throw new Error(`documento HTTP ${rL.status}`);
    const [doc] = await rL.json();
    if (!doc) return json({ ok: true, procuracao: null, motivo: 'documento_sumiu' });
    return json({ ok: true, procuracao: { token, titulo: doc.titulo, conteudo: doc.conteudo, status: doc.status, assinado_em: doc.assinado_em || null } });
  } catch (e) {
    console.error('[honorario-procuracao]', e?.message);
    return json({ error: 'Não foi possível carregar a procuração agora.' }, 500);
  }
}
