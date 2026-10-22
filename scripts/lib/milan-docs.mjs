/**
 * MATRÍCULA DO MILAN (22/10, #286) — sem custo.
 *
 * A página do lote só tem `<button>Matricula</button>`: o link sai da API `/api/public/leiloes/<cod>/
 * lotes/<lote>` (campo `arquivos[].nomeArquivo`, ex. "001_Matricula.pdf"), atrás do Cloudflare. O
 * botão abre `URL_REPOSITORIO_IMG/Fotos/<localFotos>/Arquivos/<nomeArquivo>` (chunk 3736 do site),
 * e o repositório é o MESMO servidor das fotos que o card do evento já traz:
 *   foto      https://adm.milanleiloes.com.br/Fotos/20261027_15626/001_a.jpg
 *   matrícula https://adm.milanleiloes.com.br/Fotos/20261027_15626/Arquivos/001_Matricula.pdf
 *
 * Medido em 22/10 (pg_net, IP de datacenter): esse servidor NÃO tem challenge — PDF com 200, arquivo
 * inexistente com 404 limpo. Mas responde 400 "Invalid Header" a User-Agent de navegador (Mozilla/…),
 * que é o que o espelhar-docs-cron e o gerar-documental mandam. Então o coletor confirma a matrícula
 * (200 + %PDF-, nunca link chutado sem prova) e já COPIA para o bucket (`espelho/MILAN/<imovel>/…` +
 * `imovel_anexos.storage_path`) — é de lá que a tela e o documental leem, sem depender do UA.
 */
const UA = 'BidPro-docs/1.0 (+https://bidpro.com.br)'; // NÃO usar "Mozilla/…": o servidor dá 400
const BUCKET = 'documentos';
const MAX_BYTES = 25 * 1024 * 1024;

/** Foto do card + número do lote → URL da matrícula (ou null se a foto não for do repositório). */
export function urlMatriculaMilan(foto, lote) {
  const m = String(foto || '').match(/^(https:\/\/adm\.milanleiloes\.com\.br\/Fotos\/[^/?#]+)\//i);
  return m && lote ? `${m[1]}/Arquivos/${lote}_Matricula.pdf` : null;
}

const loteDe = (fonteId) => (String(fonteId || '').match(/_([^_]+)$/) || [])[1] || null;

/**
 * Confere a matrícula de cada row e, quando existe, preenche link_matricula + anexo.
 * Devolve Map fonte_id → { url, buf } (para a cópia depois do upsert) e o placar.
 */
export async function confirmarMatriculas(rows, { fetchImpl = fetch, supabase = null } = {}) {
  const achados = new Map();
  const falhou = [];
  let sem = 0, falhas = 0;
  for (const row of rows) {
    const url = urlMatriculaMilan(row.link_foto, loteDe(row.fonte_id));
    if (!url) { sem++; continue; }
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) { sem++; continue; } // o lote não publicou matrícula: resposta, não falha
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`não é PDF (${buf.length} bytes)`);
      row.link_matricula = url;
      row.anexos = [...(Array.isArray(row.anexos) ? row.anexos : []), { tipo: 'matricula', nome: 'Matrícula', url }];
      achados.set(row.fonte_id, { url, buf });
    } catch (e) {
      falhas++; falhou.push(row);
      console.log(`    [matrícula] ${url}: ${String(e?.message || e).slice(0, 80)}`);
    }
  }
  // Leitura que FALHOU não é "o lote não tem matrícula": devolve ao row o que o banco já tinha, senão o
  // upsert gravaria link_matricula nulo e anexos sem ela por cima da rodada anterior.
  if (supabase && falhou.length) {
    const { data, error } = await supabase.from('imoveis_leilao').select('fonte_id,link_matricula,anexos')
      .in('fonte_id', falhou.map((r) => r.fonte_id)).not('link_matricula', 'is', null);
    if (error) console.log(`    [matrícula] não consegui preservar as já gravadas (${error.message})`);
    for (const ant of data || []) {
      const row = falhou.find((r) => r.fonte_id === ant.fonte_id);
      row.link_matricula = ant.link_matricula;
      const m = (Array.isArray(ant.anexos) ? ant.anexos : []).find((x) => x?.tipo === 'matricula');
      if (m) row.anexos = [...(Array.isArray(row.anexos) ? row.anexos : []), m];
    }
  }
  return { achados, placar: `matrícula: ${achados.size} confirmada(s) · ${sem} sem · ${falhas} falha(s) de leitura` };
}

/** Copia para o bucket as matrículas confirmadas que ainda não têm cópia (por origem_url). */
export async function copiarMatriculas(supabase, gravados, achados) {
  const idPor = new Map((gravados || []).map((g) => [g.fonte_id, g.id]));
  const alvo = [...achados].filter(([fid]) => idPor.has(fid));
  if (!alvo.length) return 'cópia de matrícula: nada a copiar';
  const { data: ja, error } = await supabase.from('imovel_anexos').select('origem_url')
    .in('imovel_id', alvo.map(([fid]) => idPor.get(fid))).not('storage_path', 'is', null);
  if (error) return `cópia de matrícula pulada (anexos ilegíveis: ${error.message})`;
  const copiadas = new Set((ja || []).map((r) => r.origem_url));
  let n = 0, falhas = 0;
  for (const [fid, { url, buf }] of alvo) {
    if (copiadas.has(url)) continue;
    const imovelId = idPor.get(fid);
    const path = `espelho/MILAN/${imovelId}/matricula-${loteDe(fid)}.pdf`;
    const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
    if (up.error) { falhas++; console.log(`    [matrícula] upload ${path}: ${up.error.message}`); continue; }
    const { error: eIns } = await supabase.from('imovel_anexos').insert({
      imovel_id: imovelId, tipo: 'matricula', nome: 'Matrícula', storage_path: path, origem_url: url,
      tamanho_kb: Math.round(buf.length / 1024), role_criador: 'sistema',
    });
    if (eIns) { falhas++; console.log(`    [matrícula] registro ${path}: ${eIns.message}`); continue; }
    n++;
  }
  return `cópia de matrícula: ${n} copiada(s) · ${alvo.length - n - falhas} já tinham cópia · ${falhas} falha(s)`;
}
