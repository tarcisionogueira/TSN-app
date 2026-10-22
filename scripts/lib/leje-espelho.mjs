/**
 * CÓPIA DOS DOCUMENTOS DO LEJE PARA O NOSSO BUCKET (22/10, #284).
 *
 * O LEJE bloqueia IP de datacenter (403 desde 24/09): o espelho da Vercel (espelhar-docs-cron) e os
 * relatórios não conseguem baixar `docs.php?doc=<n>`. Quem consegue é o runner residencial, que já
 * coleta o LEJE. Então, logo depois da coleta, copiamos aqui: baixa o PDF, sobe no bucket `documentos`
 * (mesma convenção do espelho: espelho/<FONTE>/<imovel>/…) e registra em `imovel_anexos` com
 * storage_path — é de lá que a tela e o documental leem.
 *
 * Só o que ainda não foi copiado (por origem_url), leilões mais próximos primeiro, teto por rodada.
 * Três falhas seguidas de download = este IP está barrado (ex.: rodando no GitHub) → para sem insistir.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const BUCKET = 'documentos';
const MAX_BYTES = 25 * 1024 * 1024;
const RE_DOC = /^https?:\/\/(www\.)?leje\.com\.br\/docs\.php\?doc=(\d+)$/i;

export async function espelharDocsLeje(supabase, { max = 80 } = {}) {
  const { data: lotes, error } = await supabase.from('imoveis_leilao').select('id,anexos,data_leilao')
    .eq('fonte', 'LEJE').eq('ativo', true).order('data_leilao', { ascending: true, nullsFirst: false });
  if (error) return `cópia de documentos pulada (lotes ilegíveis: ${error.message})`;
  const ids = (lotes || []).map(l => l.id);
  if (!ids.length) return 'cópia de documentos: nenhum lote ativo';
  const ja = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: e } = await supabase.from('imovel_anexos').select('origem_url').in('imovel_id', ids.slice(i, i + 200)).not('storage_path', 'is', null);
    if (e) return `cópia de documentos pulada (anexos ilegíveis: ${e.message})`;
    for (const r of data || []) if (r.origem_url) ja.add(r.origem_url);
  }
  const fila = [];
  for (const l of lotes) for (const a of (Array.isArray(l.anexos) ? l.anexos : [])) {
    if (RE_DOC.test(a?.url || '') && !ja.has(a.url)) fila.push({ imovel_id: l.id, ...a });
  }
  let copiados = 0, falhasSeguidas = 0, ignorados = 0;
  for (const d of fila.slice(0, max)) {
    let buf;
    try {
      const r = await fetch(d.url, { headers: { 'User-Agent': UA, Referer: 'https://leje.com.br/' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
      falhasSeguidas = 0;
    } catch (e) {
      falhasSeguidas++;
      console.log(`  [leje-docs] ${d.url}: ${String(e?.message || e).slice(0, 60)}`);
      if (falhasSeguidas >= 3) { console.log('  [leje-docs] 3 falhas seguidas — IP barrado? parando a cópia'); break; }
      continue;
    }
    // Página de erro/login no lugar do arquivo não vira "documento".
    if (buf.length > MAX_BYTES || buf.subarray(0, 5).toString('latin1') !== '%PDF-') { ignorados++; continue; }
    const doc = d.url.match(RE_DOC)[2];
    const path = `espelho/LEJE/${d.imovel_id}/${d.tipo || 'outro'}-${doc}.pdf`;
    const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
    if (up.error) { console.log(`  [leje-docs] upload ${path}: ${up.error.message}`); continue; }
    const { error: eIns } = await supabase.from('imovel_anexos').insert({
      imovel_id: d.imovel_id, tipo: d.tipo || 'outro', nome: String(d.nome || 'Documento').slice(0, 120),
      storage_path: path, origem_url: d.url, tamanho_kb: Math.round(buf.length / 1024), role_criador: 'sistema',
    });
    if (eIns) { console.log(`  [leje-docs] registro ${path}: ${eIns.message}`); continue; }
    copiados++;
  }
  return `cópia de documentos: ${copiados} copiado(s) · ${ignorados} não-PDF · ${Math.max(0, fila.length - max)} para a próxima rodada (fila ${fila.length})`;
}
