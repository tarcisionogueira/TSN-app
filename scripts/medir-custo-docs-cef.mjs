#!/usr/bin/env node
/**
 * MEDE o custo de storage do backfill documental da CEF — por AMOSTRA REAL, não por extrapolação.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE: a estimativa possível pelo banco vinha de **13 documentos CEF** já capturados
 * (mediana 769 KB) contra a média de **todas as fontes** no espelho (2,4 MB) — um intervalo de
 * 17 a 55 GB. Decidir gasto de infra num fator de 3x é decidir no escuro, e a medição custa
 * um minuto: as 23.484 matrículas são PDF direto em `venda-imoveis.caixa.gov.br`, e o tamanho
 * vem no cabeçalho, sem baixar o arquivo.
 *
 * Roda da máquina RESIDENCIAL: o egresso desta sessão de desenvolvimento é barrado por política
 * para `venda-imoveis.caixa.gov.br` (403 no CONNECT), e a CI é IP de datacenter.
 *
 * USO:  node scripts/medir-custo-docs-cef.mjs
 * Env:  CEF_AMOSTRA (padrão 60) · CEF_CONCORRENCIA (padrão 6)
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(2); }
const N = Number(process.env.CEF_AMOSTRA || 60);
const CONC = Number(process.env.CEF_CONCORRENCIA || 6);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sb = createClient(URL_BASE, KEY);

// Amostra ALEATÓRIA e proporcional por modalidade: matrícula de venda direta e de leilão podem
// ter tamanhos diferentes, e uma amostra só do primeiro bloco do acervo mediria a ordem de
// inserção, não o acervo.
// schema-ok: `amostra_matriculas_cef` é ATALHO OPCIONAL que nunca foi criado — a amostragem
// aleatória sai igual pelo fallback logo abaixo (consulta direta + embaralhamento). O `.then`
// de rejeição existe justamente para isso, então a ausência da RPC é caminho previsto e não
// deriva de migração esquecida. Se um dia ela for criada, o atalho passa a valer sozinho.
const { data: lotes, error } = await sb.rpc('amostra_matriculas_cef', { p_n: N })
  .then((r) => r, () => ({ data: null, error: { message: 'rpc ausente' } }));
let alvos = lotes;
if (error || !alvos?.length) {
  const { data, error: e2 } = await sb.from('imoveis_leilao')
    .select('link_matricula,modalidade').eq('ativo', true).in('fonte', ['CEF', 'caixa'])
    .not('link_matricula', 'is', null).limit(4000);
  if (e2) { console.error('nao li o acervo:', e2.message); process.exit(1); }
  // embaralha e corta — sem isto a amostra seria só o começo da tabela
  alvos = (data || []).sort(() => Math.random() - 0.5).slice(0, N);
}
console.log(`amostrando ${alvos.length} matrículas CEF (HEAD, sem baixar)…\n`);

/** HEAD com fallback para GET-Range: alguns servidores não respondem HEAD com Content-Length. */
async function tamanho(url) {
  const h = { 'User-Agent': UA, Accept: 'application/pdf,*/*' };
  try {
    let r = await fetch(url, { method: 'HEAD', headers: h, signal: AbortSignal.timeout(25000) });
    let n = Number(r.headers.get('content-length') || 0);
    if (r.ok && n > 0) return { ok: true, bytes: n, via: 'HEAD' };
    // Range de 1 byte: devolve `content-range: bytes 0-0/<total>` sem trazer o arquivo.
    r = await fetch(url, { headers: { ...h, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(25000) });
    const cr = r.headers.get('content-range') || '';
    n = Number((cr.split('/')[1] || '').trim()) || 0;
    if (n > 0) return { ok: true, bytes: n, via: 'RANGE' };
    return { ok: false, motivo: `sem tamanho (HTTP ${r.status})` };
  } catch (e) { return { ok: false, motivo: String(e?.message || e).slice(0, 60) }; }
}

const res = [];
for (let i = 0; i < alvos.length; i += CONC) {
  const fatia = alvos.slice(i, i + CONC);
  res.push(...await Promise.all(fatia.map(async (l) => ({ ...await tamanho(l.link_matricula), modalidade: l.modalidade }))));
  process.stdout.write(`\r  ${Math.min(i + CONC, alvos.length)}/${alvos.length}`);
}
console.log('\n');

const ok = res.filter((r) => r.ok);
if (!ok.length) { console.error('nenhuma leitura — o site recusou tudo:', res[0]?.motivo); process.exit(1); }
const bytes = ok.map((r) => r.bytes).sort((a, b) => a - b);
const soma = bytes.reduce((a, b) => a + b, 0);
const p = (q) => bytes[Math.min(bytes.length - 1, Math.floor(bytes.length * q))];
const MB = (n) => (n / 1024 / 1024).toFixed(2);

console.log(`amostra válida: ${ok.length}/${res.length}` + (ok.length < res.length ? ` (${res.length - ok.length} sem leitura)` : ''));
console.log(`  média ${MB(soma / ok.length)} MB · mediana ${MB(p(0.5))} MB · p90 ${MB(p(0.9))} MB · máx ${MB(bytes[bytes.length - 1])} MB`);

// A PROJEÇÃO usa a MÉDIA, não a mediana: o total é uma SOMA, e a soma é n × média por
// definição. Projetar por mediana subestima sempre que a cauda é longa — e aqui ela é
// (matrícula digitalizada de imóvel antigo passa de 10 MB).
const TOTAL = 23484;
const gb = (soma / ok.length) * TOTAL / 1024 / 1024 / 1024;
console.log(`\nPROJEÇÃO para ${TOTAL} matrículas: ${gb.toFixed(1)} GB`);
console.log(`  + 19 editais distintos (os 7.655 links apontam para 19 arquivos): ~0,02 GB`);
console.log(`  storage hoje: 62,3 GB → depois: ${(62.3 + gb).toFixed(1)} GB`);
console.log(gb + 62.3 > 100
  ? `  ⚠️ PASSA de 100 GB (o incluído no plano Pro) — o excedente é cobrado por GB/mês.`
  : `  ✅ cabe nos 100 GB do plano Pro, com ${(100 - 62.3 - gb).toFixed(1)} GB de folga.`);
