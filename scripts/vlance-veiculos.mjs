/**
 * VEÍCULOS DA VLANCE (21/10) — converte o arquivo que `scraper_vlance.py` escreve com
 * VLANCE_VEIC_JSON (lotes ATIVOS de categoria Veículos, crus da API `get-lotes`) em linhas de
 * `veiculos_leilao`. A conversão é a mesma dos outros coletores (lib/veiculo-do-lote.mjs: só veículo
 * inteiro, pátio pelo classificador único, bem com o executado nunca gravado).
 *
 * GÊMEOS DA LJUD: a Vlance é o MESMO backend da LJUD e o `lote_id` é o mesmo nos dois (imóveis já
 * são reconciliados por `reconciliar_gemeos_vlance_ljud`). Veículo que já está ativo como
 * `ljud_veic_<lote_id>` não entra de novo — o mesmo carro duas vezes na busca.
 *
 * Uso: node scripts/vlance-veiculos.mjs <arquivo.json>   · VLANCE_VEIC_DRYRUN=1 só mostra.
 */
import './lib/env-runner.mjs';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { veiculoDoLote } from './lib/veiculo-do-lote.mjs';
import { patioPreservado } from './lib/patio-veiculo.mjs';
import { registrarSaude } from './_saude-fonte.mjs';
import { decodificarEntidades } from '../api/_texto-imovel.js';

const FONTE = 'VLANCE';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const ehMain = import.meta.url === `file://${process.argv[1]}`;
if (ehMain && (!SB_URL || !SB_KEY)) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = ehMain ? createClient(SB_URL, SB_KEY) : null;
const DRYRUN = process.env.VLANCE_VEIC_DRYRUN === '1';
const arquivo = process.argv[2];

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Mesmo `slug` do scraper_vlance.py (é ele que forma o fonte_id dos imóveis do mesmo tenant).
const slugDom = (dom) => { const b = norm(dom).split('.')[0]; return b.replace(/leiloes?$/, '').replace(/^-+|-+$/g, '') || b; };
const texto = (h) => decodificarEntidades(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Mesma semântica de valores_lote() do Python (09/10, #161): vl_lanceminimo = avaliação,
// vl_lanceinicial = lance da 1ª praça.
function valores(l) {
  let vm, va;
  if (l.vl_lanceinicial != null) {
    vm = num(l.vl_lanceinicial) || num(l.vl_ordenacao) || num(l.vl_lanceminimo);
    va = num(l.vl_avaliacao) || (num(l.vl_lanceminimo) >= vm ? num(l.vl_lanceminimo) : 0);
  } else {
    vm = num(l.vl_lanceminimo) || num(l.vl_ordenacao);
    va = num(l.vl_avaliacao) || num(l.vl_venda);
  }
  if (va && vm && vm > va) va = 0;
  // O lance da 1ª praça, casado com a data `dt_fechamento` (a 2ª praça não tem data própria no item).
  return { va, vm };
}

const fotos = (l) => [...new Set((Array.isArray(l.fotos) ? l.fotos : []).slice(0, 30)
  .map((f) => (typeof f === 'string' ? f : f?.nm_path_completo ? String(f.nm_path_completo).replace('/196x146/', '/640x480/') : null))
  .filter(Boolean))];

const dataDe = (l) => {
  for (const c of [l.dt_fechamento, l._pai?.leilao_data]) {
    const iso = String(c || '').match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
    if (iso) return iso[2] ? `${iso[1]}T${iso[2]}:00-03:00` : iso[1];
    const br = String(c || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  }
  return null;
};

export function imovelDoLote(l) {
  const { va, vm } = valores(l);
  const jud = norm(l._pai?.leilao_judicial) || norm(l.tp_judicial_extrajudicial);
  const fs_ = fotos(l);
  return {
    titulo: l.nm_titulo_lote || '', descricao: texto(l.nm_descricao) || l.nm_titulo_lote || '',
    cidade: l.nm_cidade || null, estado: String(l.nm_estado || '').slice(0, 2).toUpperCase() || null,
    valor_avaliacao: va, valor_minimo: vm,
    url_lote: l.leilao_id && l.lote_id ? new URL(`/leilao/index/leilao_id/${l.leilao_id}/lote/${l.lote_id}`, l._base).href : l._base,
    leiloeiro: l.nm_leiloeiro || l._pai?.leilao_leiloeiro || null,
    data_leilao: dataDe(l), modalidade: jud.includes('jud') && !jud.includes('extra') ? 'judicial' : 'extrajudicial',
    fotos: fs_, link_foto: fs_[0] || null,
  };
}

async function lerExistentes(coluna, ids, fonte) {
  const m = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('veiculos_leilao').select('fonte_id,ativo,status_patio,status_patio_motivo')
      .eq('fonte', fonte).in(coluna, ids.slice(i, i + 200));
    if (error) throw new Error(`leitura ${fonte}: ${error.message}`);
    for (const r of data || []) m.set(r.fonte_id, r);
  }
  return m;
}

async function main() {
  if (!arquivo || !fs.existsSync(arquivo)) { console.log(`sem arquivo de veículos (${arquivo || '—'}) — VLANCE não rodou nesta janela`); return; }
  const lotes = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  console.log(`VLANCE veículos ${DRYRUN ? '(SECO)' : '(GRAVANDO)'} · ${lotes.length} lote(s) no arquivo`);

  const gemeos = await lerExistentes('fonte_id', [...new Set(lotes.map((l) => `ljud_veic_${l.lote_id}`))], 'LJUD');
  const motivos = new Map(); const rows = []; let gemeo = 0;
  for (const l of lotes) {
    if (gemeos.get(`ljud_veic_${l.lote_id}`)?.ativo) { gemeo++; continue; }
    const { row, motivo } = veiculoDoLote(imovelDoLote(l), { id: `${slugDom(l._dominio)}_${l.lote_id}`, fonte: FONTE });
    if (!row || motivo) { motivos.set(motivo, (motivos.get(motivo) || 0) + 1); continue; }
    row._dominio = l._dominio;
    rows.push(row);
  }
  const ant = await lerExistentes('fonte_id', rows.map((r) => r.fonte_id), FONTE);
  for (const r of rows) {
    const a = ant.get(r.fonte_id);
    if (patioPreservado(r, a)) { r.status_patio = a.status_patio; r.status_patio_motivo = a.status_patio_motivo; }
  }
  console.log(`  prontos ${rows.length} · gêmeos LJUD ${gemeo}${[...motivos].map(([m, n]) => ` · ${m}: ${n}`).join('')}`);
  for (const r of rows.slice(0, 5)) console.log(`  ${r.marca || '?'} ${r.modelo || ''} ${r.ano_modelo || ''} · R$ ${r.valor_minimo} · ${r.cidade || '?'}/${r.estado || '?'} · pátio ${r.status_patio}`);
  if (DRYRUN) return;

  const porDominio = new Map();
  for (const r of rows) { (porDominio.get(r._dominio) || porDominio.set(r._dominio, []).get(r._dominio)).push(r.fonte_id); delete r._dominio; }
  const grupos = new Map();
  for (const r of rows) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  let n = 0;
  for (const g of grupos.values()) {
    const { data, error } = await supabase.from('veiculos_leilao').upsert(g, { onConflict: 'fonte,fonte_id' }).select('id');
    if (error) throw new Error(`upsert veiculos: ${error.message}`);
    n += data?.length || 0;
  }
  console.log(`✅ ${n} veículos VLANCE gravados/atualizados.`);

  // SUMIDOS por tenant — só tenant que veio no arquivo (o que não abriu nesta rodada não é "tudo sumiu").
  for (const [dom, ids] of porDominio) {
    const pre = `vlance_veic_${slugDom(dom)}_`;
    const { data: ativos, error } = await supabase.from('veiculos_leilao').select('id,fonte_id').eq('fonte', FONTE).eq('ativo', true).like('fonte_id', `${pre}%`);
    if (error) { console.warn(`  ${dom}: sumidos não conferidos (${error.message})`); continue; }
    const vistos = new Set(ids);
    const sumidos = (ativos || []).filter((a) => !vistos.has(a.fonte_id)).map((a) => a.id);
    if (!sumidos.length) continue;
    if (sumidos.length > Math.max(10, ativos.length / 2)) { console.warn(`  ${dom}: ${sumidos.length} de ${ativos.length} sumindo — NÃO desligados (conferir)`); continue; }
    const { data: off, error: e2 } = await supabase.from('veiculos_leilao').update({ ativo: false }).in('id', sumidos).select('id');
    if (e2) console.warn(`  ${dom}: desligamento falhou (${e2.message})`); else console.log(`  ${dom}: ${off.length} veículo(s) que saíram do site desligados`);
  }
  await registrarSaude(supabase, `${FONTE}_VEICULOS`, rows, 'vlance-api', {
    ok: true, enumerados: lotes.length,
    motivo: lotes.length && !rows.length ? `${lotes.length} no arquivo e nenhum gravado (gêmeos LJUD: ${gemeo})` : '',
  });
}

if (ehMain) main().catch((e) => { console.error(e); process.exit(1); });
