/**
 * api/_dados-nf.js — dados do TOMADOR da nota fiscal (07/11, dono).
 *
 * A emissão ainda não é automática (api/_nfse.js está preparado e desligado), mas os dados são pedidos já na
 * cobrança: completos → o pagamento segue direto; faltando algo → a tela pede só o que falta. O mesmo registro
 * alimenta o `payer` do Mercado Pago e o `pagador` do Inter, então quem paga não digita duas vezes.
 * Sem dependência de Node: roda no Edge (cobranca-avulsa-info) e no Node (mp-checkout, inter).
 */

const so = (v) => String(v ?? '').replace(/\D/g, '');
const txt = (v, n) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n);

// Dígito verificador de CPF e CNPJ — a mesma regra de api/_cpf.js, sem import de Node.
export function docValido(doc) {
  const d = so(doc);
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const calc = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const calc = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * p[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

export function normalizar(d = {}) {
  const doc = so(d.doc);
  return {
    tipo: doc.length === 14 ? 'PJ' : 'PF',
    doc,
    nome: txt(d.nome, 120),
    email: txt(d.email, 120).toLowerCase(),
    cep: so(d.cep).slice(0, 8),
    logradouro: txt(d.logradouro, 120),
    numero: txt(d.numero, 20),
    complemento: txt(d.complemento, 60),
    bairro: txt(d.bairro, 80),
    cidade: txt(d.cidade, 80),
    uf: txt(d.uf, 2).toUpperCase(),
  };
}

// O que falta, por extenso (vazio = completo).
export function faltando(d = {}) {
  const f = [];
  if (!docValido(d.doc)) f.push('CPF ou CNPJ');
  if (String(d.nome || '').trim().length < 3) f.push(so(d.doc).length === 14 ? 'razão social' : 'nome');
  if (!/^\S+@\S+\.\S+$/.test(String(d.email || ''))) f.push('e-mail');
  if (so(d.cep).length !== 8) f.push('CEP');
  if (!String(d.logradouro || '').trim()) f.push('rua');
  if (!String(d.numero || '').trim()) f.push('número');
  if (!String(d.bairro || '').trim()) f.push('bairro');
  if (!String(d.cidade || '').trim()) f.push('cidade');
  if (!/^[A-Z]{2}$/.test(String(d.uf || ''))) f.push('UF');
  return f;
}
export const completo = (d) => !!d && faltando(d).length === 0;

// Ponto de partida quando ainda não há dados_nf: o que a pessoa já informou ao aceitar o termo.
// O endereço do aceite é texto livre — só o CEP é aproveitado; rua, número e bairro a tela confirma.
export function aPartirDoAceite(aceite) {
  if (!aceite) return null;
  const cep = (String(aceite.endereco || '').match(/(\d{5})-?(\d{3})(?!.*\d{5}-?\d{3})/) || []).slice(1).join('');
  return normalizar({ doc: aceite.cpf, nome: aceite.nome, email: aceite.email, cep });
}

const mascaraDoc = (doc) => {
  const d = so(doc);
  if (d.length === 11) return `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.•••/••••-${d.slice(12)}`;
  return '';
};

// O que a página pública recebe: endereço e nome (a própria pessoa preencheu), documento só mascarado.
export function visaoPublica(d) {
  if (!d) return { completo: false, faltando: faltando({}), tem_doc: false };
  const { doc, ...resto } = d;
  return { ...resto, doc: undefined, doc_mascarado: mascaraDoc(doc), tem_doc: docValido(doc), completo: completo(d), faltando: faltando(d) };
}

// Junta o que veio da tela com o que já existe: documento em branco na tela = manter o já informado
// (a tela nunca recebe o documento inteiro, então não tem como reenviá-lo).
export function mesclar(existente, novo) {
  const n = normalizar(novo);
  const base = existente ? normalizar(existente) : null;
  if (!n.doc && base?.doc) { n.doc = base.doc; n.tipo = base.tipo; }
  return n;
}

// Para o Mercado Pago (payer) e o Inter (pagador).
export function comoPagadorInter(d) {
  return { doc: d.doc, nome: d.nome, endereco: { cep: d.cep, logradouro: d.logradouro, numero: d.numero, complemento: d.complemento, bairro: d.bairro, cidade: d.cidade, uf: d.uf } };
}
