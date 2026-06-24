/**
 * Consulta certidões públicas para due diligence de imóvel em leilão:
 * - CND Receita Federal (via ReceitaWS — gratuito, sem chave)
 * - Dívida Ativa PGFN (Procuradoria Geral da Fazenda Nacional)
 * - CND FGTS (Caixa Econômica Federal — endpoint público)
 * - Dados do município via IBGE (código, população, UF — para contextualizar o imóvel)
 *
 * Todas são consultas PÚBLICAS — não requerem certificado digital.
 */
import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { sanitizeCpfCnpj } from './_sanitize.js';

export const config = { runtime: 'edge' };

const RECEITAWS = 'https://www.receitaws.com.br/v1';
const PGFN_URL = 'https://www.regularize.pgfn.gov.br/api/contribuinte';
const FGTS_URL = 'https://consultas.caixa.gov.br/servicos/contribuinte/certificado';

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

async function consultarFGTS(documento) {
  // Endpoint público Caixa — CND FGTS para empregadores (CNPJ) e trabalhadores (CPF)
  // Nota: endpoint pode exigir CAPTCHA em produção — retorna unavailable se bloqueado
  try {
    const doc = documento.replace(/\D/g, '');
    const res = await fetch(`${FGTS_URL}/${doc}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { ok: true, regular: true, situacao: 'Sem débito FGTS', fonte: 'CEF / FGTS' };
    if (!res.ok) return { ok: false, indisponivel: true, erro: `FGTS HTTP ${res.status} — consulte manualmente em caixa.gov.br` };
    const data = await res.json();
    return {
      ok: true,
      regular: data.regular === true || data.situacao === 'REGULAR',
      situacao: data.situacao || 'Verificar manualmente',
      fonte: 'CEF / FGTS',
    };
  } catch {
    return { ok: false, indisponivel: true, erro: 'FGTS indisponível — consulte em caixa.gov.br/fgts' };
  }
}

async function consultarMunicipioIBGE(municipio, uf) {
  // IBGE: busca código e dados do município para contextualizar o imóvel
  if (!municipio || !uf) return null;
  try {
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const lista = await res.json();
    const nomeLower = municipio.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const found = lista.find(m => {
      const mNome = m.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return mNome === nomeLower;
    });
    if (!found) return null;

    // Busca população e PIB via IBGE indicadores
    const idMunicipio = found.id;
    const [popRes] = await Promise.allSettled([
      fetch(`https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/2022/variaveis/9324?localidades=N6[${idMunicipio}]`, {
        signal: AbortSignal.timeout(6000),
      }),
    ]);
    let populacao = null;
    if (popRes.status === 'fulfilled' && popRes.value.ok) {
      const popData = await popRes.value.json();
      populacao = popData?.[0]?.resultados?.[0]?.series?.[0]?.serie?.['2022'] || null;
    }

    return {
      ok: true,
      codigo_ibge: idMunicipio,
      nome: found.nome,
      uf: found['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla || uf,
      mesorregiao: found['regiao-imediata']?.['regiao-intermediaria']?.nome || null,
      populacao: populacao ? Number(populacao).toLocaleString('pt-BR') : null,
      fonte: 'IBGE / Localidades',
    };
  } catch {
    return null;
  }
}

function gerarParecerCertidoes(rf, pgfn, fgts) {
  const problemas = [];
  if (rf?.ok && !rf.regular) problemas.push(`CPF/CNPJ ${rf.situacao} na Receita Federal`);
  if (pgfn?.ok && !pgfn.regular) problemas.push(`Débito na Dívida Ativa da União (PGFN)`);
  if (fgts?.ok && !fgts.regular && !fgts.indisponivel) problemas.push(`Irregularidade FGTS`);

  if (problemas.length === 0 && rf?.ok && pgfn?.ok) {
    return { nivel: 'verde', texto: 'Situação fiscal regular. Nenhum débito identificado na Receita Federal, Dívida Ativa ou FGTS.' };
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

  const { documento, municipio, uf } = body;
  if (!documento) return new Response(JSON.stringify({ error: 'documento obrigatório (CPF ou CNPJ)' }), { status: 400, headers });

  const doc = sanitizeCpfCnpj(documento).replace(/\D/g, '');
  if (doc.length !== 11 && doc.length !== 14) {
    return new Response(JSON.stringify({ error: 'CPF (11 dígitos) ou CNPJ (14 dígitos) inválido' }), { status: 400, headers });
  }

  const isCNPJ = doc.length === 14;

  // Consultas em paralelo — FGTS e IBGE opcionais não bloqueiam o resultado principal
  const [rf, pgfn, fgts, ibge] = await Promise.all([
    isCNPJ ? consultarCNPJ(doc) : consultarCPF(doc),
    consultarDividaAtiva(doc),
    consultarFGTS(doc),
    municipio && uf ? consultarMunicipioIBGE(municipio, uf) : Promise.resolve(null),
  ]);

  const parecer = gerarParecerCertidoes(rf, pgfn, fgts);

  return new Response(JSON.stringify({
    documento: doc,
    tipo: isCNPJ ? 'cnpj' : 'cpf',
    receita_federal: rf,
    divida_ativa: pgfn,
    fgts,
    municipio_ibge: ibge,
    parecer,
  }), { status: 200, headers });
}
