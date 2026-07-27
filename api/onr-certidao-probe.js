/**
 * GET/POST /api/onr-certidao-probe   (diagnóstico — rodar em PRODUÇÃO)
 *
 * Confirma, com a credencial VIVA da conta ONR, se conseguimos:
 *   (a) emitir a CERTIDÃO DIGITAL de matrícula (leitura para análise)
 *   (b) fazer o REGISTRO/abertura de matrícula pós-arrematação (Registro Online)
 *
 * Faz login (getSession) e um GET AUTENTICADO das páginas de cada serviço,
 * reportando se a nossa conta TEM ACESSO (form presente) ou é barrada.
 * É a forma honesta de "ver no cartório digital se conseguimos" — não dá pra
 * testar sem a credencial, que é segredo Vercel.
 *
 * OBS: a MESMA verificação roda sozinha no monitor semanal (api/onr-health.js),
 * que grava o veredito em system_health (servico='onr_capacidade'). Esta rota é
 * o disparo sob demanda; ambas usam verificarCapacidadeOnr().
 *
 * Gate: header x-cron-secret == CRON_SECRET (mesmo padrão dos crons).
 */

import { getSession, invalidateSession } from './_onr.js';
import { verificarCapacidadeOnr } from './_onr-certidao.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const secret = req.headers.get('x-cron-secret') || '';
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'proibido' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let cookie;
  try {
    cookie = await getSession();
  } catch (e) {
    return new Response(JSON.stringify({ login_onr: 'FALHOU', detalhe: e.message }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const resultados = await verificarCapacidadeOnr(cookie);

  // Se todas caíram no login, a sessão pode ter expirado — invalida o cache.
  const todasLogin = Object.values(resultados).every(r => r.veredito === 'SESSAO_INVALIDA_OU_SEM_ACESSO');
  if (todasLogin) invalidateSession();

  return new Response(JSON.stringify({
    login_onr: 'OK',
    conclusao: {
      certidao_leitura: resultados.certidao_matricula_leitura?.veredito,
      registro_pos_arrematacao: resultados.registro_pos_arrematacao?.veredito,
    },
    resultados,
    proximo_passo: 'Se certidao_leitura=ACESSIVEL: implementar pull real em _onr-certidao.js (tentarCertidaoAuto) e ligar ONR_CERTIDAO_AUTO=1. Senão: manter fluxo guiado.',
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
