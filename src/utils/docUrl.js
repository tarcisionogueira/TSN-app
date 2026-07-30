import { supabase } from './supabase';

// Chave CANÔNICA de documento (espelho browser-safe de api/_doc-scan.js): identifica
// o ARQUIVO ignorando querystring volátil (cache-buster ?v= do Grupo Lance, assinatura
// ?Expires/Signature da ZUK) — o mesmo edital chegava N vezes com URLs "diferentes" e a
// tela listava N linhas "Edital". Uso: dedup/comparação — nunca para abrir o link.
const RE_PARAM_VOLATIL = /^(v|ver|version|cb|cache|_|expires|signature|policy|key-pair-id|token|awsaccesskeyid|x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+)$/i;
export function chaveDocCanonica(url) {
  const s = String(url || '').replace(/&amp;/gi, '&').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (/\.(pdf|docx?|xlsx?|odt|rtf)$/i.test(u.pathname)) return (u.origin + u.pathname).toLowerCase();
    const params = [...u.searchParams.entries()].filter(([k]) => !RE_PARAM_VOLATIL.test(k));
    params.sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1])));
    const q = params.map(([k, v]) => `${k}=${v}`).join('&');
    return (u.origin + u.pathname).toLowerCase() + (q ? `?${q}` : '');
  } catch { return null; }
}

// Re-assina, EM LOTE, os anexos guardados no nosso bucket (imovel_anexos com
// storage_path). O `url` gravado é uma signed URL de 1h (gerar-documental) que
// EXPIRA — depois disso o link abria 404 mesmo com o arquivo intacto no bucket
// ("armazenamos mas não fica disponível"). Faz UMA chamada ao /api/doc-url
// (o endpoint respeita o RLS: matrícula/edital/regras p/ qualquer logado; laudo/
// outro só equipe/arrematante) e devolve os anexos com `url` fresco (1800s).
//
// Melhor esforço: sem sessão, sem ids ou em falha, devolve a lista intacta (cai no
// url guardado). Uma só chamada por tela = menos invocações edge (economia).
export async function assinarAnexos(anexos) {
  const lista = Array.isArray(anexos) ? anexos : [];
  const ids = lista.filter((a) => a && a.id).map((a) => a.id);
  if (!ids.length) return lista;
  try {
    const t = (await supabase.auth.getSession()).data.session?.access_token;
    if (!t) return lista;
    const r = await fetch('/api/doc-url', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ anexo_ids: ids }),
    });
    if (!r.ok) return lista;
    const { urls } = await r.json().catch(() => ({}));
    if (!urls) return lista;
    return lista.map((a) => (a?.id && urls[a.id] ? { ...a, url: urls[a.id] } : a));
  } catch {
    return lista;
  }
}
