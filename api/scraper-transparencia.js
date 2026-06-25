/**
 * scraper-transparencia.js
 *
 * Cron job (Node.js runtime) que consome a API do Portal da Transparência do
 * Governo Federal para enriquecer o score jurídico dos imóveis em leilão.
 *
 * Fontes utilizadas:
 *  - CEIS (Cadastro de Empresas Inidôneas e Suspensas)
 *  - CNEP (Cadastro Nacional de Empresas Punidas)
 *
 * Esses dados permitem identificar leiloeiros/credores com sanções federais
 * e influenciam o score_juridico dos imóveis associados.
 *
 * Agendamento sugerido (vercel.json):
 *   { "path": "/api/scraper-transparencia", "schedule": "0 4 * * *" }
 *
 * Headers necessários para o Portal da Transparência:
 *   chave-api-dados: <PORTAL_TRANSPARENCIA_API_KEY>
 *
 * Env vars:
 *   CRON_SECRET                   – obrigatório (proteção do endpoint)
 *   PORTAL_TRANSPARENCIA_API_KEY  – obrigatório para consumir a API pública
 *   VITE_SUPABASE_URL             – URL do projeto Supabase
 *   SUPABASE_SERVICE_KEY          – chave de serviço (bypassa RLS)
 *
 * Como adicionar novas fontes:
 *   1. Crie uma função fetchFonte() seguindo o padrão de fetchCeis/fetchCnep.
 *   2. Adicione ao array FONTES no handler principal.
 *   3. Mapeie os campos para o schema de sancoes_federais (ver upsertSancoes).
 */

export const maxDuration = 60;

const BASE_URL = 'https://api.portaldatransparencia.gov.br/api-de-dados';
const TAMANHO_PAGINA = 500;

// ── Helpers ────────────────────────────────────────────────────────────────────

function supabaseHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
}

/**
 * Faz GET na API do Portal da Transparência com retry único em caso de falha
 * temporária (5xx / timeout).
 *
 * @param {string} path   – caminho relativo, ex: '/ceis'
 * @param {Object} params – query params adicionais
 * @param {string} apiKey
 * @returns {{ data: Array|null, erro: string|null }}
 */
async function fetchTransparencia(path, params, apiKey) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('pagina', params.pagina ?? 1);
  url.searchParams.set('tamanhoPagina', params.tamanhoPagina ?? TAMANHO_PAGINA);
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'pagina' && k !== 'tamanhoPagina') url.searchParams.set(k, v);
  }

  const headers = {
    'chave-api-dados': apiKey,
    Accept: 'application/json',
    'User-Agent': 'TSN-App/1.0 (contato@tsnativos.com.br)',
  };

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(20000),
      });

      if (res.status === 429) {
        // Rate limit — aguarda 5s antes de tentar novamente
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      if (!res.ok) {
        const texto = await res.text().catch(() => '');
        return { data: null, erro: `HTTP ${res.status}: ${texto.slice(0, 200)}` };
      }

      const data = await res.json();
      return { data: Array.isArray(data) ? data : (data?.data ?? []), erro: null };
    } catch (e) {
      if (tentativa === 2) return { data: null, erro: `Rede/timeout: ${e.message}` };
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  return { data: null, erro: 'Falhou após 2 tentativas' };
}

/**
 * Busca todas as páginas de um endpoint paginado (máximo MAX_PAGINAS por segurança).
 */
async function fetchTodasPaginas(path, extraParams, apiKey, MAX_PAGINAS = 10) {
  const itens = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const { data, erro } = await fetchTransparencia(path, { ...extraParams, pagina, tamanhoPagina: TAMANHO_PAGINA }, apiKey);
    if (erro) return { itens, erro };
    if (!data || data.length === 0) break;
    itens.push(...data);
    if (data.length < TAMANHO_PAGINA) break; // última página
  }
  return { itens, erro: null };
}

// ── Transformadores ────────────────────────────────────────────────────────────

/**
 * Normaliza um registro do CEIS para o schema de sancoes_federais.
 */
function normalizarCeis(item) {
  return {
    fonte: 'ceis',
    fonte_id: `ceis_${item.id ?? item.codigoSancao ?? item.cpfCnpj ?? Math.random()}`,
    cpf_cnpj: item.cpfCnpj ?? item.numeroCpfCnpj ?? null,
    nome_sancionado: item.nomeSancionado ?? item.razaoSocialCadastro ?? null,
    tipo_sancao: item.tipoSancao?.descricaoResumida ?? item.tipoSancao ?? null,
    orgao_sancionador: item.orgaoSancionador?.nome ?? item.orgaoSancionador ?? null,
    data_inicio_sancao: parseDateBR(item.dataInicioSancao ?? item.dataPublicacao),
    data_fim_sancao: parseDateBR(item.dataFimSancao),
    fundamentacao_legal: item.fundamentacaoLegal ?? null,
    processo: item.numeroProcesso ?? null,
    ativo: true,
    atualizado_em: new Date().toISOString(),
  };
}

/**
 * Normaliza um registro do CNEP para o schema de sancoes_federais.
 */
function normalizarCnep(item) {
  return {
    fonte: 'cnep',
    fonte_id: `cnep_${item.id ?? item.codigoSancao ?? item.cpfCnpj ?? Math.random()}`,
    cpf_cnpj: item.cpfCnpj ?? item.numeroCpfCnpj ?? null,
    nome_sancionado: item.nomeSancionado ?? item.razaoSocialCadastro ?? null,
    tipo_sancao: item.tipoSancao?.descricaoResumida ?? item.tipoSancao ?? null,
    orgao_sancionador: item.orgaoSancionador?.nome ?? item.orgaoSancionador ?? null,
    data_inicio_sancao: parseDateBR(item.dataInicioSancao ?? item.dataPublicacao),
    data_fim_sancao: parseDateBR(item.dataFimSancao),
    fundamentacao_legal: item.fundamentacaoLegal ?? null,
    processo: item.numeroProcesso ?? null,
    ativo: true,
    atualizado_em: new Date().toISOString(),
  };
}

/**
 * Converte data no formato DD/MM/YYYY (Portal da Transparência) para ISO.
 * Retorna null se inválida.
 */
function parseDateBR(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

// ── Upsert no Supabase ─────────────────────────────────────────────────────────

async function upsertSancoes(rows, supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/sancoes_federais?on_conflict=fonte,fonte_id`,
    {
      method: 'POST',
      headers: supabaseHeaders(serviceKey),
      body: JSON.stringify(rows),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upsert sancoes_federais falhou (${res.status}): ${text.slice(0, 300)}`);
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // ── 1. Autenticação por CRON_SECRET ────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[scraper-transparencia] CRON_SECRET não configurado — acesso bloqueado');
    return res.status(500).json({ error: 'Endpoint não configurado (CRON_SECRET ausente)' });
  }

  const enviado = req.headers['x-cron-secret'] ?? '';
  if (enviado !== cronSecret) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  // ── 2. Verificar chave do Portal da Transparência ──────────────────────────
  const apiKey = process.env.PORTAL_TRANSPARENCIA_API_KEY;
  if (!apiKey) {
    console.warn('[scraper-transparencia] PORTAL_TRANSPARENCIA_API_KEY não configurada — pulando');
    return res.status(200).json({
      ok: true,
      skipped: true,
      motivo: 'PORTAL_TRANSPARENCIA_API_KEY não configurada',
    });
  }

  // ── 3. Verificar Supabase ──────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Variáveis Supabase não configuradas' });
  }

  // ── 4. Buscar dados do Portal da Transparência ─────────────────────────────
  let totalProcessados = 0;
  let totalErros = 0;
  const detalhes = [];

  // Definição das fontes a buscar
  const FONTES = [
    {
      nome: 'CEIS',
      path: '/ceis',
      params: {},
      normalizar: normalizarCeis,
    },
    {
      nome: 'CNEP',
      path: '/cnep',
      params: {},
      normalizar: normalizarCnep,
    },
  ];

  for (const fonte of FONTES) {
    console.log(`[scraper-transparencia] Buscando ${fonte.nome}...`);

    let itens, erro;
    try {
      ({ itens, erro } = await fetchTodasPaginas(fonte.path, fonte.params, apiKey));
    } catch (e) {
      erro = e.message;
      itens = [];
    }

    if (erro && (!itens || itens.length === 0)) {
      console.warn(`[scraper-transparencia] ${fonte.nome} indisponível: ${erro}`);
      detalhes.push({ fonte: fonte.nome, status: 'indisponivel', erro });
      // API indisponível — não aborta o cron, apenas registra
      continue;
    }

    if (!itens || itens.length === 0) {
      detalhes.push({ fonte: fonte.nome, status: 'vazio', processados: 0 });
      continue;
    }

    // Transforma e faz upsert em lotes de 200
    const rows = itens.map(fonte.normalizar).filter(r => r.fonte_id);
    const LOTE = 200;
    let erroUpsert = null;

    for (let i = 0; i < rows.length; i += LOTE) {
      try {
        await upsertSancoes(rows.slice(i, i + LOTE), supabaseUrl, serviceKey);
      } catch (e) {
        erroUpsert = e.message;
        console.error(`[scraper-transparencia] Upsert ${fonte.nome} lote ${i / LOTE + 1}: ${e.message}`);
        totalErros += Math.min(LOTE, rows.length - i);
      }
    }

    const processados = rows.length - (erroUpsert ? 0 : 0); // erros já contados acima
    totalProcessados += rows.length;
    detalhes.push({
      fonte: fonte.nome,
      status: erroUpsert ? 'parcial' : 'ok',
      processados: rows.length,
      ...(erroUpsert ? { ultimo_erro: erroUpsert } : {}),
    });

    console.log(`[scraper-transparencia] ${fonte.nome}: ${rows.length} registros processados`);
  }

  return res.status(200).json({
    ok: true,
    processados: totalProcessados,
    erros: totalErros,
    detalhes,
    executado_em: new Date().toISOString(),
  });
}
