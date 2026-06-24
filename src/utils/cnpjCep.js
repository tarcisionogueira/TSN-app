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
