export async function buscarCnpj(cnpj) {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return null;
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
    if (!r.ok) return null;
    const j = await r.json();
    return {
      razao_social: j.razao_social || '',
      nome_fantasia: j.nome_fantasia || '',
      email: j.email || '',
      telefone: j.ddd_telefone_1 ? j.ddd_telefone_1.trim() : '',
      cep: (j.cep || '').replace(/\D/g, ''),
      logradouro: j.logradouro || '',
      numero: j.numero || '',
      complemento: j.complemento || '',
      bairro: j.bairro || '',
      municipio: j.municipio || '',
      uf: j.uf || '',
      situacao: j.descricao_situacao_cadastral || '',
    };
  } catch { return null; }
}

export async function buscarCep(cep) {
  const d = cep.replace(/\D/g, '');
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (j.erro) return null;
    return { logradouro: j.logradouro || '', bairro: j.bairro || '', municipio: j.localidade || '', uf: j.uf || '' };
  } catch { return null; }
}

export function formatCnpj(v) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, '$1.$2')
          .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
          .replace(/\.(\d{3})(\d)/, '.$1/$2')
          .replace(/(\d{4})(\d)/, '$1-$2');
}

export function formatCpf(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function formatCep(v) {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function formatTel(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d)/, '($1) $2-$3');
  return d.replace(/(\d{2})(\d{5})(\d)/, '($1) $2-$3');
}

// ── VALIDAÇÃO (dígito verificador) — evita CPF/CNPJ/e-mail inválido virar assinatura ruim ──
export function validarCpf(v) {
  const c = String(v || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0; if (d1 !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0; return d2 === +c[10];
}
export function validarCnpj(v) {
  const c = String(v || '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base) => { const len = base.length; let pos = len - 7, sum = 0; for (let i = 0; i < len; i++) { sum += +base[i] * pos--; if (pos < 2) pos = 9; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
  if (calc(c.slice(0, 12)) !== +c[12]) return false;
  return calc(c.slice(0, 13)) === +c[13];
}
export function validarEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()); }

// ── MASCARAMENTO (LGPD/exposição no segmento de leilões) — o dado COMPLETO fica no registro
// (auditável em juízo/pelas partes); a EXIBIÇÃO no documento/relatório é reduzida. ──
export function mascararDoc(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;  // CPF: oculta início e fim
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`; // CNPJ
  return v ? '•••' : '';
}
export function mascararEmail(v) {
  const s = String(v || '').trim(); const at = s.indexOf('@');
  if (at < 1) return s ? '•••' : '';
  const u = s.slice(0, at), dom = s.slice(at + 1);
  const uu = u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***';
  return `${uu}@${dom}`;
}
export function mascararTel(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 4) return d ? '••••' : '';
  return `(${d.slice(0, 2)}) ****-${d.slice(-4)}`;
}
