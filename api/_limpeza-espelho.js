/**
 * LIMPEZA DO ESPELHO DE DOCUMENTOS (24/09) — usada pelo script de faxina (scripts/limpar-espelho.mjs)
 * e, todo dia, pelo limpar-documentos-cron. Os candidatos e o MOTIVO vêm do banco
 * (`espelho_limpeza_candidatos`, migração espelho_limpeza.sql):
 *   · 'expirado' — cópia de documento de imóvel que saiu do acervo, sem cliente ligado;
 *   · 'dup'      — conteúdo idêntico a outro arquivo que FICA (`canonico`).
 *
 * ORDEM, e por quê: num 'dup' as linhas (imovel_anexos, documento_espelho) são REAPONTADAS para o
 * canônico ANTES de apagar, e só se apaga o que foi reapontado sem erro — apagar primeiro deixaria
 * lote apontando para arquivo inexistente, e esse erro não aparece em lugar nenhum (forma nº 3).
 * O Storage devolve a lista do que REALMENTE apagou; é ela que marca o espelho como 'purgado'.
 * Nunca lança: devolve contagens e o último erro para quem chama registrar.
 */
const BUCKET = 'documentos';

export async function limparEspelho({ url, key, aplicar = false, prazoMs = 240000, lote = 1000, log = () => {} }) {
  const t0 = Date.now();
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rest = (p, o = {}) => fetch(`${url}/rest/v1/${p}`, { ...o, headers: { ...h, ...(o.headers || {}) }, signal: AbortSignal.timeout(130000) });
  const lista = (paths) => paths.map((p) => `"${String(p).replace(/"/g, '')}"`).join(',');
  const r = { rodadas: 0, expirados: 0, dups: 0, bytes: 0, reapontados: 0, falhas: 0, erro: null, amostra: [] };

  async function apagar(paths) {
    if (!paths.length) return [];
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: paths }) });
    if (!res.ok) { r.erro = `storage DELETE ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`; return []; }
    const corpo = await res.json().catch(() => []);
    return Array.isArray(corpo) ? corpo.map((o) => o.name).filter(Boolean) : [];
  }

  while (Date.now() - t0 < prazoMs) {
    const rc = await rest('rpc/espelho_limpeza_candidatos', { method: 'POST', body: JSON.stringify({ p_limite: lote }) });
    if (!rc.ok) { r.erro = `candidatos ${rc.status}: ${(await rc.text().catch(() => '')).slice(0, 120)}`; break; }
    const cands = await rc.json().catch(() => null);
    if (!Array.isArray(cands)) { r.erro = 'candidatos: corpo inválido'; break; }
    if (!cands.length) break;
    r.rodadas++;
    if (!aplicar) {
      r.expirados = cands.filter((c) => c.motivo === 'expirado').length;
      r.dups = cands.filter((c) => c.motivo === 'dup').length;
      r.bytes = cands.reduce((s, c) => s + Number(c.bytes || 0), 0);
      r.amostra = cands.slice(0, 5).concat(cands.filter((c) => c.motivo === 'dup').slice(0, 5));
      break; // em seco a fila não anda — uma página basta para mostrar
    }

    const tam = new Map(cands.map((c) => [c.path, Number(c.bytes || 0)]));
    const expirados = cands.filter((c) => c.motivo === 'expirado').map((c) => c.path);

    // DUP: reaponta as duas tabelas; só entra na lista de apagar se as duas responderam ok.
    const dups = cands.filter((c) => c.motivo === 'dup' && c.canonico && c.canonico !== c.path);
    const prontos = [];
    for (let i = 0; i < dups.length; i += 8) {
      await Promise.all(dups.slice(i, i + 8).map(async (c) => {
        const corpo = (campo) => JSON.stringify({ [campo]: c.canonico });
        const a = await rest(`imovel_anexos?storage_path=eq.${encodeURIComponent(c.path)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: corpo('storage_path') }).catch(() => null);
        const e = await rest(`documento_espelho?storage_path=eq.${encodeURIComponent(c.path)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: corpo('storage_path') }).catch(() => null);
        if (a?.ok && e?.ok) {
          const na = (await a.json().catch(() => [])).length || 0;
          const ne = (await e.json().catch(() => [])).length || 0;
          r.reapontados += na + ne;
          prontos.push(c.path);
        } else {
          r.falhas++;
          log(`reapontar falhou ${c.path}: anexos ${a?.status} espelho ${e?.status}`);
        }
      }));
    }

    let apagadosNaRodada = 0;
    for (const grupo of [expirados, prontos]) {
      for (let i = 0; i < grupo.length; i += 1000) {
        const feitos = await apagar(grupo.slice(i, i + 1000));
        apagadosNaRodada += feitos.length;
        if (grupo === expirados) {
          r.expirados += feitos.length;
          for (let j = 0; j < feitos.length; j += 200) {
            const fatia = feitos.slice(j, j + 200);
            const m = await rest(`documento_espelho?storage_path=in.(${lista(fatia)})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'purgado', motivo: 'imovel fora do acervo sem cliente (retencao do espelho)' }) }).catch(() => null);
            if (!m?.ok) { r.falhas++; log(`marcar purgado falhou (${m?.status})`); }
          }
        } else r.dups += feitos.length;
        for (const p of feitos) r.bytes += tam.get(p) || 0;
      }
    }
    log(`rodada ${r.rodadas}: ${cands.length} candidatos, ${apagadosNaRodada} apagados`);
    // Sem progresso = algo travou (Storage recusando, reaponte falhando): parar em vez de girar.
    if (!apagadosNaRodada) { r.erro = r.erro || 'rodada sem progresso'; break; }
  }
  // Fecha as pontas no banco (25/09): o que ficou apontando para arquivo apagado — por falha de
  // marcação acima ou por qualquer caminho antigo — é corrigido em SQL, sem depender de URL.
  if (aplicar) {
    const rr = await rest('rpc/espelho_reconciliar_ausentes', { method: 'POST', body: '{}' }).catch(() => null);
    r.reconciliacao = rr?.ok ? await rr.json().catch(() => null) : { erro: `HTTP ${rr?.status}` };
  }
  r.segundos = Math.round((Date.now() - t0) / 1000);
  return r;
}
