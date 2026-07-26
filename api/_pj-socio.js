/**
 * _pj-socio.js — verificação ANTI-INTERPOSIÇÃO: o CPF do parceiro consta no quadro
 * societário (QSA) do CNPJ informado?
 *
 * Usa o DADO ABERTO da Receita (grátis) via BrasilAPI (fallback minhareceita.org).
 * O QSA público mascara o CPF do sócio como "***DDDDDD**" (os 6 dígitos do meio).
 * Cruzamos esses 6 dígitos com os 6 do meio do CPF do parceiro E exigimos sobreposição
 * de NOME — só então consideramos "sócio confirmado" (fail-closed: qualquer dúvida →
 * NÃO valida automaticamente, cai para a conferência manual).
 */

export const so_digitos = (s) => String(s || '').replace(/\D+/g, '');

// Normaliza nome: sem acento, maiúsculo, tokens significativos (ignora conectivos e ≤2 letras).
const CONECTIVOS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
function tokensNome(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/).filter((t) => t.length >= 3 && !CONECTIVOS.has(t));
}
// Sobreposição de nome: compartilham ao menos 2 tokens (ou 1 se um dos nomes tem só 1 token).
function nomesBatem(a, b) {
  const ta = tokensNome(a), tb = new Set(tokensNome(b));
  if (!ta.length || !tb.size) return false;
  const comuns = ta.filter((t) => tb.has(t)).length;
  return comuns >= Math.min(2, ta.length);
}

// Os 6 dígitos do meio do CPF (posições 4..9), que é o que o QSA público revela.
function cpfMeio6(cpf) {
  const d = so_digitos(cpf);
  return d.length === 11 ? d.slice(3, 9) : '';
}

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// Busca o QSA do CNPJ em fontes abertas gratuitas. Normaliza para [{nome, cpf_masc}].
async function buscarQSA(cnpj14) {
  // 1) BrasilAPI
  let d = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj14}`);
  if (d && Array.isArray(d.qsa)) {
    return {
      fonte: 'brasilapi',
      razao_social: d.razao_social || d.nome_empresarial || null,
      situacao: d.descricao_situacao_cadastral || d.situacao_cadastral || null,
      socios: d.qsa.map((s) => ({ nome: s.nome_socio || s.nome || '', cpf_masc: s.cnpj_cpf_do_socio || s.cpf_cnpj_socio || '' })),
    };
  }
  // 2) minhareceita.org (mesmo dado aberto, outra hospedagem)
  d = await fetchJson(`https://minhareceita.org/${cnpj14}`);
  if (d && Array.isArray(d.qsa)) {
    return {
      fonte: 'minhareceita',
      razao_social: d.razao_social || null,
      situacao: d.descricao_situacao_cadastral || null,
      socios: d.qsa.map((s) => ({ nome: s.nome_socio || '', cpf_masc: s.cnpj_cpf_do_socio || '' })),
    };
  }
  return null;
}

/**
 * @returns {ok, matched, motivo, fonte, socios, snapshot}
 *  - matched=true  → CPF confere no QSA + nome bate → pode validar automaticamente.
 *  - matched=false → cair para conferência MANUAL (nunca auto-aprova na dúvida).
 */
export async function verificarSocioQSA({ cnpj, cpf, nome }) {
  const cnpj14 = so_digitos(cnpj);
  const meio6 = cpfMeio6(cpf);
  if (cnpj14.length !== 14) return { ok: false, matched: false, motivo: 'CNPJ inválido' };
  if (!meio6) return { ok: false, matched: false, motivo: 'CPF do parceiro ausente/inválido (necessário p/ o cruzamento automático)' };

  const qsa = await buscarQSA(cnpj14);
  if (!qsa) return { ok: false, matched: false, motivo: 'Não foi possível consultar a Receita agora — enviado para conferência manual.' };

  const alvo = (qsa.socios || []).find((s) => {
    const raw = String(s.cpf_masc || '');
    const socioMeio = so_digitos(raw); // do "***DDDDDD**" sobram exatamente os 6 dígitos do meio
    const ehCpfMascarado = raw.includes('*') && socioMeio.length === 6; // ignora sócio PJ (CNPJ) e formatos estranhos
    return ehCpfMascarado && socioMeio === meio6 && nomesBatem(nome, s.nome);
  });

  const snapshot = {
    verificado_em: new Date().toISOString(),
    fonte: qsa.fonte, cnpj: cnpj14, razao_social: qsa.razao_social, situacao: qsa.situacao,
    cpf_meio6: meio6, socios: qsa.socios, resultado: alvo ? 'match' : 'sem_match',
  };
  return {
    ok: true, matched: !!alvo, fonte: qsa.fonte,
    motivo: alvo ? 'CPF do parceiro consta no quadro societário' : 'CPF/nome do parceiro NÃO confere no quadro societário — conferência manual necessária',
    socios: qsa.socios, snapshot,
  };
}
