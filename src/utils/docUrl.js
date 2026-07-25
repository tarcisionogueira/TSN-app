import { supabase } from './supabase';

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
