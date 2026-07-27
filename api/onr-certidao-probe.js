/**
 * GET/POST /api/onr-certidao-probe   (diagnóstico — rodar em PRODUÇÃO)
 *
 * Confirma, com a credencial VIVA da conta ONR, se conseguimos:
 *   (a) emitir a CERTIDÃO DIGITAL de matrícula (leitura para análise)
 *   (b) fazer o REGISTRO/abertura de matrícula pós-arrematação (Registro Online)
 *
 * Como: faz login (getSession) e um GET AUTENTICADO das páginas de cada serviço,
 * reportando se a nossa conta TEM ACESSO (form presente) ou é barrada
 * (redirect pro login / "acesso negado"). É a forma honesta de "ver no cartório
 * digital se conseguimos" — não dá pra testar sem a credencial, que é segredo Vercel.
 *
 * Gate: header x-cron-secret == CRON_SECRET (mesmo padrão dos crons). Não expõe
 * nada sensível; só o veredito de capacidade por serviço.
 *
 * Depois de confirmar (a), implementar o pull real em _onr-certidao.js
 * (tentarCertidaoAuto) e ligar ONR_CERTIDAO_AUTO=1.
 */

import { getSession, invalidateSession } from './_onr.js';

export const config = { runtime: 'edge' };

const ONR = 'https://registradores.onr.org.br';
const ALVOS = [
  { chave: 'certidao_matricula_leitura', url: `${ONR}/CertidaoDigital/`, servico: '(a) Certidão Digital de matrícula' },
  { chave: 'registro_pos_arrematacao',   url: `${ONR}/Servicos/reqaberturamatricula.aspx`, servico: '(b) Abertura/registro de matrícula' },
  { chave: 'saec',                       url: `${ONR}/PO/DefaultPO.aspx`, servico: 'SAEC (atendimento eletrônico)' },
];

function analisar(status, location, html) {
  const loc = (location || '').toLowerCase();
  const body = (html || '').toLowerCase();
  const redirecionouLogin = /facesso|login|autentic/.test(loc);
  const acessoNegado = /acesso negado|não autorizado|nao autorizado|sem permiss|não possui|nao possui/.test(body);
  // Heurística de "form do serviço acessível": presença de seletor de UF/estado
  // ou menção a matrícula/certidão no corpo autenticado.
  const temSeletorLocal = /<select[^>]*(uf|estado|cidade|munic)/i.test(html || '') || /selecione.*(estado|uf|cidade)/i.test(body);
  const mencionaServico = /(matr[íi]cula|certid[ãa]o|registro)/i.test(body);
  const formAcessivel = (status === 200) && !redirecionouLogin && !acessoNegado && (temSeletorLocal || mencionaServico);

  let veredito;
  if (redirecionouLogin) veredito = 'SESSAO_INVALIDA_OU_SEM_ACESSO';
  else if (acessoNegado)  veredito = 'ACESSO_NEGADO';
  else if (formAcessivel) veredito = 'ACESSIVEL';
  else if (status === 200) veredito = 'RESPONDEU_200_VERIFICAR_MANUAL';
  else veredito = `HTTP_${status}`;

  return { veredito, http: status, redirecionou_para: location || null, acesso_negado: acessoNegado, form_acessivel: formAcessivel };
}

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

  const resultados = {};
  for (const alvo of ALVOS) {
    try {
      const res = await fetch(alvo.url, {
        headers: {
          Cookie: cookie,
          'User-Agent': 'Mozilla/5.0 (compatible; BidProBrasil/1.0)',
          Referer: `${ONR}/`,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      const status = res.status;
      const location = res.headers.get('location');
      // Só lê o corpo em 200 (redirect não tem form útil).
      const html = status === 200 ? await res.text() : '';
      resultados[alvo.chave] = { servico: alvo.servico, url: alvo.url, ...analisar(status, location, html) };
    } catch (e) {
      resultados[alvo.chave] = { servico: alvo.servico, url: alvo.url, veredito: 'ERRO_REDE', detalhe: e.message };
    }
  }

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
