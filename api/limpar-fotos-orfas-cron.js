/**
 * /api/limpar-fotos-orfas-cron — higiene do bucket `imoveis-fotos`.
 *
 * POR QUÊ: fotos ficam órfãs por dois caminhos normais — o lote sai do acervo (a linha do
 * imóvel some) e o backfill de fotos re-hospeda com nome novo (a antiga fica para trás).
 * Medido em 02/08: 21.760 de 61.208 arquivos (1,15 GB) sem NENHUM imóvel apontando. São
 * inalcançáveis pelo app: a linha que as exibia não existe mais. Peso morto que só cresce.
 *
 * SEGURANÇA ANTES DE ECONOMIA (a ordem importa):
 *   • a seleção é feita no banco (`fotos_orfas_para_limpeza`), que exclui qualquer foto citada
 *     no SNAPSHOT de um relatório já emitido (mercado/documental/laudo) — apagar uma dessas
 *     quebraria o PDF de um cliente — e dá 7 dias de carência a arquivo recém-criado;
 *   • apaga em LOTES pequenos, pela API de Storage (a exclusão por SQL deixaria o arquivo no
 *     bucket e a conta continuaria correndo);
 *   • teto por execução: some devagar, todo dia, sem pico de I/O nem risco de engano em massa.
 *
 * Autorizado por CRON_SECRET. Best-effort: nunca derruba nada do app.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'imoveis-fotos';
// Teto por execução. Diário, some ~1.500/dia: os 21 mil atuais levam ~2 semanas para sair,
// sem nenhum pico. Preferir devagar a rápido: exclusão é irreversível.
const LOTE = Number(process.env.FOTOS_ORFAS_LOTE || 500);
const LOTES_POR_RUN = 3;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  let apagadas = 0, bytes = 0, rodadas = 0, descartadas = 0;

  try {
    for (let i = 0; i < LOTES_POR_RUN; i++) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fotos_orfas_para_limpeza`, {
        method: 'POST', headers: hdr, body: JSON.stringify({ p_limite: LOTE }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        console.error('[fotos-orfas] RPC falhou:', r.status, (await r.text().catch(() => '')).slice(0, 200));
        break;
      }
      const lista = await r.json().catch(() => []);
      if (!Array.isArray(lista) || !lista.length) break;

      // Defesa em profundidade: só sai daqui nome de objeto plausível. Se a RPC um dia
      // devolvesse lixo (null, caminho absoluto, path traversal), o lote inteiro é abortado
      // em vez de mandar DELETE em cima de coisa que não sabemos o que é.
      const nomes = lista.map((f) => f?.name).filter((n) => typeof n === 'string' && n.length > 3
        && !n.startsWith('/') && !n.includes('..'));
      descartadas += lista.length - nomes.length;
      if (nomes.length !== lista.length) { console.error('[fotos-orfas] lote com nome suspeito — abortado'); break; }

      const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE', headers: hdr,
        body: JSON.stringify({ prefixes: nomes }),
        signal: AbortSignal.timeout(20000),
      });
      if (!del.ok) {
        console.error('[fotos-orfas] falha ao apagar lote:', del.status, (await del.text().catch(() => '')).slice(0, 200));
        break;
      }
      // A API devolve os objetos realmente removidos — é esse número que vale, não o pedido.
      const removidos = await del.json().catch(() => null);
      const n = Array.isArray(removidos) ? removidos.length : nomes.length;
      apagadas += n;
      bytes += lista.reduce((s, f) => s + (Number(f.tamanho) || 0), 0);
      rodadas++;
      if (lista.length < LOTE) break; // acabou a fila
    }
  } catch (e) {
    console.error('[fotos-orfas]', e?.message || e);
  }

  console.log('[fotos-orfas]', JSON.stringify({ apagadas, mb: Math.round(bytes / 1048576), rodadas, descartadas }));
  return res.status(200).json({ ok: true, apagadas, mb_liberados: Math.round(bytes / 1048576), rodadas });
}
