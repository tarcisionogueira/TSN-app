/**
 * POST/GET /api/meta-capi-test  (SOMENTE admin)
 * Dispara UM evento Purchase de DIAGNÓSTICO pela Conversions API, para validar que o
 * servidor consegue falar com o Meta — sem precisar de uma venda real. Passe o
 * ?test_event_code=TESTxxxx (da aba "Testar eventos" do Events Manager) para o evento
 * aparecer lá em tempo real. NÃO altera nada no banco nem eleva plano — só envia ao Meta.
 *
 * Requer token do usuário no header Authorization (chame via apiCall/console logado como
 * admin — abrir a URL direto no navegador não manda o token e retorna 401).
 */
import { getUser, getUserRoleById } from './_auth.js';
import { enviarPurchaseCapi, enviarLeadCapi, capiAtivo } from './_meta-capi.js';

export default async function handler(req, res) {
  const user = await getUser(req).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  const role = await getUserRoleById(user.id).catch(() => null);
  if (role !== 'admin') return res.status(403).json({ error: 'Somente admin' });

  if (!capiAtivo()) {
    return res.status(200).json({
      capi: 'inativo',
      dica: 'META_CAPI_TOKEN (e um pixel id em META_PIXEL_ID/VITE_META_PIXEL_ID) ausentes nas envs, ou o deploy ainda não pegou. Confira no Vercel + Redeploy.',
    });
  }

  const testCode = String(req.query?.test_event_code || req.query?.code || '').trim() || undefined;

  // ?evento=lead — valida o Lead da inscricao na aula (28/08). Sem isto, a unica forma de
  // saber se o evento novo chega ao Meta seria fazer uma inscricao de verdade na campanha,
  // criando conta e mandando e-mail para conferir tracking. `Purchase` segue sendo o padrao
  // para nao mudar o que ja existia.
  if (String(req.query?.evento || '').toLowerCase() === 'lead') {
    const rl = await enviarLeadCapi({
      eventoSlug: String(req.query?.slug || 'diagnostico'),
      email: user.email,
      userId: user.id,
      // id UNICO: um diagnostico nunca pode deduplicar contra o Lead real de um inscrito —
      // o Meta uniria os dois e a inscricao de verdade sumiria da conta.
      eventId: `diag_lead_${user.id}_${Date.now()}`,
      sourceUrl: 'https://www.bidprobrasil.com.br/live/leilao-ao-vivo',
      testCode,
    });
    return res.status(rl?.ok ? 200 : 502).json({
      capi: 'ativo', evento: 'Lead', enviado: rl, test_event_code: testCode || null,
      dica: testCode
        ? 'Events Manager -> aba "Testar eventos": o Lead de diagnostico deve aparecer em segundos.'
        : 'Passe ?test_event_code=TESTxxxx (da aba Testar eventos) para ve-lo aparecer la.',
    });
  }

  const r = await enviarPurchaseCapi({
    userId: user.id,
    email: user.email,
    valor: 1,
    planoBase: 'diagnostico',
    gateway: 'diag',
    eventId: `diag_${user.id}_${Date.now()}`, // id único p/ NÃO deduplicar com Purchase real
    testCode,
  });

  return res.status(r?.ok ? 200 : 502).json({
    capi: 'ativo',
    enviado: r,
    test_event_code: testCode || null,
    dica: testCode
      ? 'Abra Events Manager → pixel Reimob → aba "Testar eventos" — o Purchase de diagnóstico deve aparecer em segundos.'
      : 'Passe ?test_event_code=TESTxxxx (da aba Testar eventos) para ver o evento aparecer lá.',
  });
}
