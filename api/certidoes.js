/**
 * Consulta certidões públicas para due diligence de imóvel em leilão:
 * - CND Receita Federal (via ReceitaWS — gratuito, sem chave)
 * - Dívida Ativa PGFN (Procuradoria Geral da Fazenda Nacional)
 * - Situação cadastral CPF/CNPJ
 *
 * Todas são consultas PÚBLICAS — não requerem certificado digital.
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { sanitizeCpfCnpj } from './_sanitize.js';

export const config = { runtime: 'edge' };

const RECEITAWS = 'https://www.receitaws.com.br/v1';
const PGFN_URL = 'https://www.regularize.pgfn.gov.br/api/contribuinte';

async function consultarCPF(cpf) {
  try {
    const res = await fetch(`${RECEITAWS}/cpf/${cpf}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, erro: `ReceitaWS CPF HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      tipo: 'cpf',
      documento: cpf,
      nome: data.nome || null,
      situacao: data.situacao || null,
      regular: data.situacao === 'Regular',
      data_nascimento: data.data_nascimento || null,
      fonte: 'ReceitaWS / Receita Federal',
    };
  } catch (e) {
    return { ok: false, erro: 'Timeout na consulta CPF' };
  }
}

async function consultarCNPJ(cnpj) {
  try {
    const res = await fetch(`${RECEITAWS}/cnpj/${cnpj}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, erro: `ReceitaWS CNPJ HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      tipo: 'cnpj',
      documento: cnpj,
      nome: data.nome || null,
      fantasia: data.fantasia || null,
      situacao: data.situacao || null,
      regular: data.situacao === 'ATIVA',
      abertura: data.abertura || null,
      atividade_principal: data.atividade_principal?.[0]?.text || null,
      municipio: data.municipio || null,
      uf: data.uf || null,
      fonte: 'ReceitaWS / Receita Federal',
    };
  } catch (e) {
    return { ok: false, erro: 'Timeout na consulta CNPJ' };
  }
}

async function consultarDividaAtiva(documento) {
  // PGFN disponibiliza endpoint público para consulta de regularidade
  try {
    const doc = documento.replace(/\D/g, '');
    const res = await fetch(`${PGFN_URL}/${doc}/regularidade`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return { ok: true, regular: true, situacao: 'Sem débitos na Dívida Ativa', fonte: 'PGFN' };
    if (!res.ok) return { ok: false, erro: `PGFN HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      regular: data.situacaoDevedorPgfn === 'REGULAR' || data.regular === true,
      situacao: data.situacaoDevedorPgfn || (data.regular ? 'Regular' : 'Irregular'),
      valor_divida: data.valorConsolidado || null,
      fonte: 'PGFN / Dívida Ativa da União',
    };
  } catch (e) {
    return { ok: false, erro: 'Timeout na consulta PGFN' };
  }
}

function gerarParecerCertidoes(rf, pgfn) {
  const problemas = [];
  if (rf?.ok && !rf.regular) problemas.push(`CPF/CNPJ ${rf.situacao} na Receita Federal`);
  if (pgfn?.ok && !pgfn.regular) problemas.push(`Débito na Dívida Ativa da União (PGFN)`);

  if (problemas.length === 0 && rf?.ok && pgfn?.ok) {
    return { nivel: 'verde', texto: 'Situação fiscal regular. Nenhum débito identificado na Receita Federal ou Dívida Ativa da União.' };
  }
  if (problemas.length > 0) {
    return { nivel: 'vermelho', texto: `Irregularidade fiscal detectada: ${problemas.join('; ')}. Débitos podem gerar ônus sobre o imóvel arrematado.` };
  }
  return { nivel: 'amarelo', texto: 'Consulta parcial — verifique manualmente as certidões negativas.' };
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = checkRateLimit(`certidoes:${ip}`, 15, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers });
  }

  const { documento } = body;
  if (!documento) return new Response(JSON.stringify({ error: 'documento obrigatório (CPF ou CNPJ)' }), { status: 400, headers });

  const doc = sanitizeCpfCnpj(documento).replace(/\D/g, '');
  if (doc.length !== 11 && doc.length !== 14) {
    return new Response(JSON.stringify({ error: 'CPF (11 dígitos) ou CNPJ (14 dígitos) inválido' }), { status: 400, headers });
  }

  const isCNPJ = doc.length === 14;

  // Consultas em paralelo
  const [rf, pgfn] = await Promise.all([
    isCNPJ ? consultarCNPJ(doc) : consultarCPF(doc),
    consultarDividaAtiva(doc),
  ]);

  const parecer = gerarParecerCertidoes(rf, pgfn);

  return new Response(JSON.stringify({
    documento: doc,
    tipo: isCNPJ ? 'cnpj' : 'cpf',
    receita_federal: rf,
    divida_ativa: pgfn,
    parecer,
  }), { status: 200, headers });
}
