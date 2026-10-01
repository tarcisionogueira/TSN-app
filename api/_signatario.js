// DADOS DO SIGNATÁRIO NOS DOCUMENTOS (01/10, achado do dono na procuração do Marcos).
//
// O termo de assessoria e a procuração nasciam só com o NOME: CPF e endereço ficavam como
// "[CPF/CNPJ DO SIGNATÁRIO]" / "[ENDEREÇO DO SIGNATÁRIO]" — e nada no fluxo os preenchia, nem na
// geração nem na assinatura. O cliente via um documento oficial com lacunas, embora o sistema já
// soubesse os dados: o perfil (CPF cifrado + endereço do checkout) e, no caso do Marcos, uma
// procuração que ele mesmo assinou digitando CPF, RG e endereço.
//
// Regra: só substitui o marcador quando HÁ o dado (e o CPF/CNPJ passa no dígito verificador).
// Sem dado, o marcador fica — lacuna visível é melhor que lacuna preenchida com qualquer coisa.
import { cpfDoRegistro, validarCPF, validarCNPJ } from './_cpf.js';

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
export function formatarDocumento(v) {
  const d = soDigitos(v);
  if (d.length === 11 && validarCPF(d)) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (d.length === 14 && validarCNPJ(d)) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return null;
}

export function enderecoDoPerfil(p) {
  if (!p) return null;
  const rua = [p.endereco_logradouro, p.endereco_numero].filter(Boolean).join(', ');
  const partes = [rua, p.endereco_complemento, p.endereco_bairro,
    p.endereco_cidade && `${p.endereco_cidade}${p.endereco_uf ? `/${p.endereco_uf}` : ''}`,
    p.endereco_cep && `CEP ${p.endereco_cep}`].filter(Boolean);
  // Endereço montado só com cidade não qualifica ninguém: aí vale o texto livre do perfil, se houver.
  if (rua) return partes.join(', ');
  const livre = String(p.endereco || '').trim();
  return enderecoQualifica(livre) ? livre : null;
}

// Endereço de QUALIFICAÇÃO precisa de rua ou número. `perfis.endereco` costuma guardar só
// "Cidade/UF" (medido 01/10 nos 3 assessorados) — "residente em Arujá/SP" não qualifica ninguém.
const RE_LOGRADOURO = /\b(rua|r\.|av\.?|avenida|travessa|tv\.?|alameda|estrada|rodovia|rod\.?|pra[cç]a|largo|condom[ií]nio|quadra|qd\.?|lote|lt\.?|s[ií]tio|fazenda|ch[aá]cara|vila|conjunto|loteamento)\b/i;
export function enderecoQualifica(e) {
  const t = String(e || '').trim();
  return t.length >= 10 && (/\d/.test(t) || RE_LOGRADOURO.test(t));
}

/** Substitui os marcadores do signatário pelo que se sabe. Puro (testável). */
export function preencherSignatario(texto, { nome, documento, endereco } = {}) {
  let t = String(texto || '');
  const doc = formatarDocumento(documento);
  if (nome && String(nome).trim()) t = t.replace(/\[NOME DO SIGNATÁRIO\]/gi, String(nome).trim());
  if (doc) t = t.replace(/\[CPF\/CNPJ DO SIGNATÁRIO\]/gi, doc).replace(/\[CPF DO SIGNATÁRIO\]/gi, doc);
  if (enderecoQualifica(endereco)) t = t.replace(/\[ENDEREÇO DO SIGNATÁRIO\]/gi, String(endereco).trim());
  return t;
}

export const temMarcadorSignatario = (t) => /\[(CPF\/CNPJ|CPF|ENDEREÇO|NOME) DO SIGNATÁRIO\]/i.test(String(t || ''));

/**
 * O que o sistema já sabe do cliente: perfil (CPF decifrado, endereço) e, para o que faltar, o que
 * ele próprio digitou no último documento que ASSINOU. `sb(path)` → Response (REST com service key).
 * Nunca lança: falha de leitura devolve o que conseguiu, com `falhas` dizendo o quê.
 */
export async function dadosConhecidosDoSignatario(sb, userId) {
  const out = { nome: null, documento: null, endereco: null, fonte: [], falhas: [] };
  if (!userId) return out;
  try {
    const r = await sb(`perfis?id=eq.${userId}&select=nome,cpf,cpf_enc,cnpj,endereco,endereco_logradouro,endereco_numero,endereco_complemento,endereco_bairro,endereco_cidade,endereco_uf,endereco_cep&limit=1`);
    if (!r.ok) out.falhas.push(`perfil HTTP ${r.status}`);
    else {
      const [p] = await r.json();
      if (p) {
        out.nome = p.nome || null;
        const cpf = await cpfDoRegistro(p);
        out.documento = formatarDocumento(cpf) || formatarDocumento(p.cnpj);
        out.endereco = enderecoDoPerfil(p);
        if (out.documento || out.endereco) out.fonte.push('perfil');
      }
    }
  } catch (e) { out.falhas.push(`perfil: ${String(e?.message || e).slice(0, 60)}`); }
  if (out.documento && out.endereco) return out;
  try {
    const r = await sb(`contratos_link?arremate_user_id=eq.${userId}&status=eq.assinado&dados_signatario=not.is.null&select=dados_signatario,assinado_em&order=assinado_em.desc&limit=5`);
    if (!r.ok) out.falhas.push(`documentos assinados HTTP ${r.status}`);
    else {
      for (const { dados_signatario: d } of await r.json()) {
        const doc = formatarDocumento(d?.cpf) || formatarDocumento(d?.cnpj);
        const end = typeof d?.endereco === 'string' ? d.endereco.trim() : null;
        if (!out.documento && doc) { out.documento = doc; out.fonte.push('documento assinado'); }
        if (!out.endereco && enderecoQualifica(end)) { out.endereco = end; if (!out.fonte.includes('documento assinado')) out.fonte.push('documento assinado'); }
        if (out.documento && out.endereco) break;
      }
    }
  } catch (e) { out.falhas.push(`documentos assinados: ${String(e?.message || e).slice(0, 60)}`); }
  return out;
}

/**
 * Rede de segurança: documentos AGUARDANDO assinatura que ainda têm marcador do signatário são
 * preenchidos com o que o sistema sabe. Idempotente (só toca o que ainda tem marcador e mudou).
 */
export async function preencherDocumentosPendentes(sb) {
  const res = { analisados: 0, preenchidos: 0, sem_dado: 0, falhas: [] };
  const r = await sb(`contratos_link?status=eq.aguardando_assinatura&arremate_user_id=not.is.null&conteudo=like.*DO%20SIGNAT*&select=id,arremate_user_id,conteudo&limit=200`);
  if (!r.ok) { res.falhas.push(`leitura HTTP ${r.status}`); return res; }
  const docs = (await r.json()).filter((d) => temMarcadorSignatario(d.conteudo));
  const cache = new Map();
  for (const d of docs) {
    res.analisados++;
    if (!cache.has(d.arremate_user_id)) cache.set(d.arremate_user_id, await dadosConhecidosDoSignatario(sb, d.arremate_user_id));
    const info = cache.get(d.arremate_user_id);
    const novo = preencherSignatario(d.conteudo, info);
    if (novo === d.conteudo) { res.sem_dado++; continue; }
    const u = await sb(`contratos_link?id=eq.${d.id}&status=eq.aguardando_assinatura`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ conteudo: novo }),
    });
    const linhas = u.ok ? await u.json().catch(() => []) : [];
    if (u.ok && linhas.length) res.preenchidos++;
    else res.falhas.push(`${d.id}: ${u.ok ? 'nenhuma linha alterada' : `HTTP ${u.status}`}`);
  }
  return res;
}
