/**
 * RECON DE DATAS (só leitura): abre cada URL de RECON_URLS e lista as datas dd/mm/aaaa com o trecho
 * ao redor. HTML vira texto; .doc (Word 97) é lido nas duas codificações em que ele guarda texto
 * (UTF-16LE e cp1252). Grava em recon_dump (origem 'recon_datas_pagina'). Uso: invariante
 * data_edital_recuou_prazo — decidir entre a data do acervo e a do edital olhando a fonte viva.
 */
const SB = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const URLS = String(process.env.RECON_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!SB || !KEY || !URLS.length) { console.error('defina VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY e RECON_URLS'); process.exit(1); }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s*(?:às|as|-|,)?\s*\d{1,2}[:h]\d{2})?/gi;

const datas = (t) => {
  const out = [];
  for (const m of t.matchAll(RE)) {
    out.push(t.slice(Math.max(0, m.index - 90), m.index + m[0].length + 30).replace(/\s+/g, ' '));
    if (out.length >= 25) break;
  }
  return out;
};

const resultado = [];
for (const url of URLS) {
  const item = { url };
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const buf = Buffer.from(await r.arrayBuffer());
    item.status = r.status; item.bytes = buf.length;
    if (/\.doc(\?|$)/i.test(url) || buf.subarray(0, 4).toString('hex') === 'd0cf11e0') {
      const u16 = buf.toString('utf16le').replace(/[^\x20-\x7EÀ-ÿ\n]+/g, ' ');
      const cp = buf.toString('latin1').replace(/[^\x20-\x7EÀ-ÿ\n]+/g, ' ');
      item.datas_utf16 = datas(u16);
      item.datas_cp1252 = datas(cp);
    } else {
      const t = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
      item.datas = datas(t);
    }
  } catch (e) { item.erro = String(e?.message || e).slice(0, 120); }
  console.log(JSON.stringify(item).slice(0, 3000));
  resultado.push(item);
}
const w = await fetch(`${SB}/rest/v1/recon_dump`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ origem: 'recon_datas_pagina', chave: new Date().toISOString(), conteudo: resultado }) });
console.log(w.ok ? '✅ gravado em recon_dump (recon_datas_pagina)' : `⚠️ recon_dump HTTP ${w.status}`);
