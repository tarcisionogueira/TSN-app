/**
 * POST /api/convidar-live — o ADMIN convida a BASE DE CLIENTES para a próxima aula ao vivo.
 *
 * POR QUE EXISTE (28/08): não havia caminho nenhum para isto. `/api/anunciar-produto` só sabe
 * anunciar curso e eBook; `live-lembrete-cron` só fala com quem JÁ se inscreveu. Ou seja, a
 * única peça que realmente enche uma aula — o convite para quem já conhece a marca — era
 * trabalho manual. Com R$ 40 de verba paga rendendo 4 a 6 inscrições, os 72 clientes da base
 * são o canal principal, não o complemento.
 *
 * As três exclusões, o dedup e o template vivem em `_convite-live.js`, compartilhados com o
 * disparo agendado (`convidar-live-cron`). Aqui ficam só a autenticação e os três modos:
 *   teste → manda para o próprio admin, sem claim e sem tocar na base
 *   seco  → conta quem receberia, sem enviar nem gravar
 *   real  → dispara
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getAuthUser, unauthorized, forbidden, getUserRoleById } from './_auth.js';
import { enviarEmail } from './_email.js';
import { carregarEdicao, dispararConvite, montarConvite, TIPO_EMAIL } from './_convite-live.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN },
});

// SOMENTE export nomeado (POST): no runtime Node da Vercel, `export default` é tratado
// como assinatura Express (req,res) e o `Response` retornado é IGNORADO → 504.
export const POST = handler;
async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SVC) return json({ error: 'Configuração ausente' }, 500);

  const user = await getAuthUser(req);
  if (!user?.id) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();

  let body = {};
  try { body = await req.json(); } catch { /* corpo vazio = padrões */ }
  const slug = String(body?.slug || 'leilao-ao-vivo').trim();

  try {
    const ed = await carregarEdicao(slug);
    if (!ed) return json({ error: 'Aula não encontrada ou inativa' }, 404);
    const { aula, edicao, assunto } = ed;

    // MODO TESTE — só para o próprio admin. Existe porque o admin está PROPOSITALMENTE fora da
    // lista de destino: sem esta saída, a única forma de ver o e-mail como o cliente vê seria
    // disparar para os 72 e torcer. Não grava claim, então não consome a vaga de ninguém.
    if (body?.teste === true) {
      const destino = String(user.email || '').trim();
      if (!destino) return json({ error: 'Sua conta não tem e-mail para o teste' }, 400);
      const html = montarConvite({
        aula, edicao, slug, userId: user.id,
        nome: user.user_metadata?.nome || user.user_metadata?.full_name || '',
        conteudo: 'convite-teste',
      });
      const env = await enviarEmail({
        from: FROM, to: destino, subject: `[TESTE] ${assunto}`.slice(0, 120), html,
        meta: { tipo: TIPO_EMAIL, userId: user.id },
      });
      if (!env?.ok) return json({ error: `Teste não saiu: ${env?.error || 'falha no envio'}` }, 502);
      return json({ ok: true, teste: true, enviado_para: destino, edicao, assunto });
    }

    const saida = await dispararConvite({ aula, edicao, assunto, slug, seco: body?.seco === true });
    if (!saida.seco) console.log('[convidar-live]', JSON.stringify(saida));
    return json({ ok: true, ...saida });
  } catch (e) {
    // Falha de LEITURA não pode virar "convidei zero pessoas com sucesso".
    console.error('[convidar-live]', e?.message || e);
    return json({ error: String(e?.message || e) }, 502);
  }
}
