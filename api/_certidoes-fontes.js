/**
 * _certidoes-fontes.js — consultas fiscais PÚBLICAS (sem certificado digital) do
 * CPF/CNPJ do executado/proprietário, para compor o laudo jurídico automático.
 * Reusado pelo endpoint /api/certidoes (manual) e pelo laudo (gerar-documental).
 *
 * Fontes: Receita Federal (via ReceitaWS), PGFN (Dívida Ativa da União), FGTS (Caixa).
 * Todas best-effort: erro/timeout vira { ok:false } e NÃO derruba o laudo.
 */
const RECEITAWS = 'https://www.receitaws.com.br/v1';
const PGFN_URL   = 'https://www.regularize.pgfn.gov.br/api/contribuinte';
const FGTS_URL   = 'https://consultas.caixa.gov.br/servicos/contribuinte/certificado';

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
    const res = await fetch(`${PGFN_URL}/${doc}/regularidade`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
    });
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
    const res = await fetch(`${FGTS_URL}/${doc}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000),
    });
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
  return {
    documento: doc,
    resumo: alertas.length ? `⚠️ ${alertas.join('; ')}` : 'Certidões fiscais sem apontamentos (Receita/PGFN/FGTS)',
    receita, pgfn, fgts, alertas,
  };
}
