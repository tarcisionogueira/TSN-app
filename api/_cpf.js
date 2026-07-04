// Criptografia de CPF em repouso — chave no ambiente (CPF_ENC_KEY, base64 de 32
// bytes). Dois derivados por CPF:
//  • hashCpf  → HMAC-SHA256 DETERMINÍSTICO (mesmo CPF → mesmo hash) para
//    deduplicação/lookup sem guardar o CPF cru como chave de busca.
//  • encryptCpf/decryptCpf → AES-GCM (IV aleatório) para o valor recuperável,
//    decifrado só no backend quando é preciso (Asaas/MP/NFS-e/contrato/ONR).
// Sem a chave, as funções retornam null e o fluxo cai no comportamento antigo
// (não quebra durante a migração). Novas gravações já chamam este helper, então
// funcionalidades futuras entram parametrizadas.
const KEY_B64 = (process.env.CPF_ENC_KEY || '').trim();

export function cpfCriptoAtivo() { return !!KEY_B64; }

function keyBytes() {
  return Uint8Array.from(atob(KEY_B64), (c) => c.charCodeAt(0));
}
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

export async function hashCpf(cpf) {
  const d = soDigitos(cpf);
  if (!d || !KEY_B64) return null;
  const key = await crypto.subtle.importKey('raw', keyBytes(), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(d));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptCpf(cpf) {
  const d = soDigitos(cpf);
  if (!d || !KEY_B64) return null;
  const key = await crypto.subtle.importKey('raw', keyBytes(), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(d)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decryptCpf(enc) {
  if (!enc || !KEY_B64) return null;
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes(), { name: 'AES-GCM' }, false, ['decrypt']);
    const bytes = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
    const iv = bytes.slice(0, 12), ct = bytes.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

// Máscara para exibição (não revela o CPF cheio).
export function maskCpf(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11) return cpf ? '•••' : '';
  return `•••.•••.${d.slice(6, 9)}-••`;
}
