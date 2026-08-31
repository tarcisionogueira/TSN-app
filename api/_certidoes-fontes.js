/**
 * _certidoes-fontes.js — consultas fiscais PÚBLICAS (sem certificado digital) do
 * CPF/CNPJ do executado/proprietário, para compor o laudo jurídico automático.
 * Reusado pelo endpoint /api/certidoes (manual) e pelo laudo (gerar-documental).
 *
 * Fontes: Receita Federal (via ReceitaWS), PGFN (Dívida Ativa da União), FGTS (Caixa).
 * Todas best-effort: erro/timeout vira { ok:false } e NÃO derruba o laudo.
 */
import { fetchViaBrightData } from './_brightdata.js';

const RECEITAWS = 'https://www.receitaws.com.br/v1';
const PGFN_URL   = 'https://www.regularize.pgfn.gov.br/api/contribuinte';
const FGTS_URL   = 'https://consultas.caixa.gov.br/servicos/contribuinte/certificado';

// Fetch direto e, se falhar/estourar (o IP do servidor é barrado ou a fonte é lenta),
// cai no Bright Data (IP residencial). Devolve um Response ou null.
async function fetchDiretoOuBD(url, { headers, timeout = 10000 } = {}) {
  let r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) }).catch(() => null);
  if (r) return r; // inclui 404 (tratado como "sem débito" pelos chamadores)
  const bd = await fetchViaBrightData(url, { proposito: 'certidao', headers });
  return bd || null;
}

export async function consultarReceita(documento) {
  const doc = String(documento || '').replace(/\D/g, '');
  if (doc.length !== 11 && doc.length !== 14) return { ok: false, erro: 'doc inválido' };
  const cnpj = doc.length === 14;
  try {
    const res = await fetch(`${RECEITAWS}/${cnpj ? 'cnpj' : 'cpf'}/${doc}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, erro: `ReceitaWS HTTP ${res.status}` };
    const d = await res.json();
    return {
      ok: true, tipo: cnpj ? 'cnpj' : 'cpf', documento: doc, nome: d.nome || null,
      situacao: d.situacao || null, regular: cnpj ? d.situacao === 'ATIVA' : d.situacao === 'Regular',
      uf: d.uf || null, fonte: 'Receita Federal',
    };
  } catch { return { ok: false, indisponivel: true, erro: 'Timeout Receita' }; }
}

export async function consultarDividaAtiva(documento) {
  const doc = String(documento || '').replace(/\D/g, '');
  if (!doc) return { ok: false, erro: 'doc vazio' };
  try {
    const res = await fetchDiretoOuBD(`${PGFN_URL}/${doc}/regularidade`, { headers: { Accept: 'application/json' }, timeout: 10000 });
    if (!res) return { ok: false, indisponivel: true, erro: 'Timeout PGFN' };
    if (res.status === 404) return { ok: true, regular: true, situacao: 'Sem débitos na Dívida Ativa', fonte: 'PGFN' };
    if (!res.ok) return { ok: false, indisponivel: true, erro: `PGFN HTTP ${res.status}` };
    const d = await res.json();
    const regular = d.situacaoDevedorPgfn === 'REGULAR' || d.regular === true;
    return {
      ok: true, regular, situacao: d.situacaoDevedorPgfn || (regular ? 'Regular' : 'Irregular'),
      valor_divida: d.valorConsolidado || null, fonte: 'PGFN / Dívida Ativa da União',
    };
  } catch { return { ok: false, indisponivel: true, erro: 'Timeout PGFN' }; }
}

export async function consultarFGTS(documento) {
  const doc = String(documento || '').replace(/\D/g, '');
  if (!doc) return { ok: false, erro: 'doc vazio' };
  try {
    const res = await fetchDiretoOuBD(`${FGTS_URL}/${doc}`, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
    if (!res) return { ok: false, indisponivel: true, erro: 'Timeout FGTS' };
    if (res.status === 404) return { ok: true, regular: true, situacao: 'Sem débito FGTS', fonte: 'CEF / FGTS' };
    if (!res.ok) return { ok: false, indisponivel: true, erro: `FGTS HTTP ${res.status} — consultar manualmente` };
    const d = await res.json();
    return { ok: true, regular: d.regular === true || d.situacao === 'REGULAR', situacao: d.situacao || 'Verificar', fonte: 'CEF / FGTS' };
  } catch { return { ok: false, indisponivel: true, erro: 'Timeout FGTS' }; }
}

/** Consulta as 3 certidões fiscais do documento em paralelo. Retorna resumo p/ o laudo. */
export async function consultarCertidoesFiscais(documento) {
  const doc = String(documento || '').replace(/\D/g, '');
  if (doc.length !== 11 && doc.length !== 14) return null;
  const [receita, pgfn, fgts] = await Promise.all([
    consultarReceita(doc).catch(() => ({ ok: false })),
    consultarDividaAtiva(doc).catch(() => ({ ok: false })),
    consultarFGTS(doc).catch(() => ({ ok: false })),
  ]);
  const alertas = [];
  if (pgfn?.ok && pgfn.regular === false) alertas.push('Dívida Ativa da União (PGFN) IRREGULAR');
  if (fgts?.ok && fgts.regular === false) alertas.push('FGTS irregular');
  if (receita?.ok && receita.regular === false) alertas.push(`Situação ${receita.tipo?.toUpperCase()} na Receita: ${receita.situacao}`);

  // "NÃO CONSEGUI CONSULTAR" NÃO É "ESTÁ LIMPO" (31/08) — forma #1 do CLAUDE.md, e das piores,
  // porque o destino é um parecer JURÍDICO que o cliente lê antes de dar lance.
  //
  // `alertas` só enche quando a fonte respondeu E disse irregular (`X.ok && X.regular === false`).
  // Cada consulta aqui devolve `{ ok: false, indisponivel: true }` em timeout ou HTTP de erro —
  // então **as três fontes fora do ar produziam `alertas` vazio**, e o resumo saía
  // "Certidões fiscais sem apontamentos (Receita/PGFN/FGTS)". Silêncio de rede entregue como
  // certidão negativa, com o nome das três fontes junto para dar credibilidade.
  //
  // O consumidor é `NotaMetodologica.jsx:89`, que imprime a frase como "Certidões fiscais
  // consultadas automaticamente (…): {resumo}" — ou seja, afirmava consulta que não houve.
  //
  // Agora o resumo distingue os três desfechos, e `conclusivo`/`indisponiveis` ficam
  // estruturados para quem quiser decidir em cima disso sem parsear texto.
  const fontes = [{ nome: 'Receita', r: receita }, { nome: 'PGFN', r: pgfn }, { nome: 'FGTS', r: fgts }];
  const mudas = fontes.filter((f) => !f.r?.ok).map((f) => f.nome);
  const responderam = fontes.filter((f) => f.r?.ok).map((f) => f.nome);
  const ressalva = mudas.length ? ` · NÃO consultadas: ${mudas.join(', ')} (fonte indisponível — consultar manualmente)` : '';
  let resumo;
  if (alertas.length) {
    resumo = `⚠️ ${alertas.join('; ')}${ressalva}`;
  } else if (!responderam.length) {
    resumo = '⚠️ NENHUMA das 3 certidões fiscais pôde ser consultada (Receita/PGFN/FGTS estão indisponíveis). '
      + 'Isto NÃO significa ausência de apontamentos — significa ausência de informação. Consultar manualmente antes de decidir.';
  } else if (mudas.length) {
    resumo = `Sem apontamentos em ${responderam.join('/')}${ressalva}`;
  } else {
    resumo = 'Certidões fiscais sem apontamentos (Receita/PGFN/FGTS)';
  }

  return {
    documento: doc,
    resumo,
    conclusivo: mudas.length === 0,   // as 3 responderam
    indisponiveis: mudas,
    receita, pgfn, fgts, alertas,
  };
}
