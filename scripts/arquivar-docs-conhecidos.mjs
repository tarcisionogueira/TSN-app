/**
 * ARQUIVAMENTO DE TODOS OS DOCUMENTOS CONHECIDOS — todos os leiloeiros (21/11).
 *
 * Dono: depois de a Zuk passar a guardar todos os documentos de todos os lotes, "faça o mesmo
 * para os outros leiloeiros". Os outros já têm o LINK de cada documento (o coletor grava em
 * `anexos`, `link_matricula`, edital/regras em PDF), mas a fila genérica (`captura-documentos`)
 * considera o lote resolvido quando UM documento chega ao Storage. Medido em 21/11: 9.329 lotes
 * ativos com link conhecido nunca guardado (~19 mil arquivos), que somem quando o leilão sai do ar.
 *
 * Este job baixa cada link conhecido DIRETO (fetch, sem navegador, sem Bright Data — custo zero),
 * guarda no bucket `documentos` e registra em `imovel_anexos` com `origem_url` (é por ela que o
 * job sabe o que já guardou). Cada lote visitado recebe `docs_arquivados_em` e só volta depois de
 * 30 dias, para pegar links novos. Link que não devolve PDF (página HTML, 403 de anti-bot) fica
 * para a fila genérica, que tem navegador e o Bright Data com teto.
 *
 * Dedup:
 *  - mesmo conteúdo (hash) já no Storage do lote → só carimba `origem_url` na linha existente;
 *  - tipo classificado (matrícula/edital/laudo/regras) que o lote já tem com tamanho parecido
 *    (±5%) → é o mesmo documento baixado de novo (PDF gerado na hora muda o hash): não duplica;
 *  - tipo classificado já presente, tamanho diferente → é OUTRO documento (edital do leilão +
 *    edital do lote, 2 matrículas) e entra como linha própria.
 *
 * Config: ARQ_LOTES (lotes por rodada, default 300), ARQ_MAX_MIN (orçamento de tempo, default 40),
 * ARQ_FONTE (opcional: só uma fonte), ARQ_SECO=1 (só conta, não grava).
 */
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';
import { createHash } from 'node:crypto';
import { limparNome, classificar, publicarFatosDoPdf } from './lib/doc-fatos.mjs';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTES = Number(process.env.ARQ_LOTES || 300);
const MAX_MS = Number(process.env.ARQ_MAX_MIN || 40) * 60_000;
const FONTE = (process.env.ARQ_FONTE || '').trim().toUpperCase();
const SECO = process.env.ARQ_SECO === '1';
const REVISITA_DIAS = 30;
const TIPO_UNICO = new Set(['edital', 'matricula', 'carta_arrematacao', 'matricula_registrada']);
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_LINKS_LOTE = 12;
// Pipelines próprios (login ou fila dedicada) — não passam por aqui.
const FORA = ['CEF', 'caixa', 'ZUK'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const inicio = Date.now();
const ehUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
const ehPdfUrl = (v) => /\.pdf(\?|#|$)/i.test(v || '');
const ehNossoStorage = (v) => /\/storage\/v1\/object\//.test(v || '');
const host = (u) => { try { return new URL(u).host; } catch { return ''; } };

function linksConhecidos(im) {
  const out = [];
  const vistos = new Set();
  const add = (url, nome) => {
    if (!ehUrl(url) || ehNossoStorage(url) || vistos.has(url)) return;
    vistos.add(url); out.push({ url, nome: nome || '' });
  };
  add(im.link_matricula, 'matricula');
  if (ehPdfUrl(im.link_edital)) add(im.link_edital, 'edital');
  if (ehPdfUrl(im.link_regras_venda)) add(im.link_regras_venda, 'regras venda');
  for (const a of (Array.isArray(im.anexos) ? im.anexos : [])) add(a?.url, a?.nome);
  return out.slice(0, MAX_LINKS_LOTE);
}

// Download direto. Devolve { buf } ou { motivo } — o motivo vai para o log e para a contagem por
// host (anti-bot que responde 403 a tudo não merece 12 tentativas por lote).
async function baixar(url, referer) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*', ...(ehUrl(referer) ? { Referer: referer } : {}) },
      redirect: 'follow', signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { motivo: `HTTP ${r.status}`, bloqueio: r.status === 403 || r.status === 429 };
    const len = Number(r.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return { motivo: `> 25 MB (${Math.round(len / 1048576)} MB)` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return { motivo: '> 25 MB' };
    if (buf.length < 1000 || buf.slice(0, 5).toString('latin1') !== '%PDF-') return { motivo: `não é PDF (${r.headers.get('content-type') || '?'}, ${buf.length}b)` };
    return { buf };
  } catch (e) {
    return { motivo: `rede: ${e?.name === 'TimeoutError' ? 'timeout' : (e?.message || e)}`.slice(0, 120) };
  }
}

async function fontesPermitidas() {
  const { data, error } = await supabase.from('leiloeiro_conhecimento').select('fonte, arquivar_docs, docs_status');
  if (error) throw new Error(`leiloeiro_conhecimento ilegível: ${error.message}`);
  return new Set((data || []).filter((l) => l.arquivar_docs && l.docs_status !== 'esperado').map((l) => l.fonte));
}

const COLS = 'id, fonte, link_matricula, link_edital, link_regras_venda, anexos, url_lote, valor_minimo, valor_avaliacao, docs_arquivados_em';
async function proximaFatia(jaVistos) {
  const base = () => {
    let q = supabase.from('imoveis_leilao').select(COLS).eq('ativo', true).not('fonte', 'in', `(${FORA.join(',')})`);
    if (FONTE) q = q.eq('fonte', FONTE);
    return q;
  };
  // 1º os nunca visitados (praça mais próxima primeiro), depois as revisitas vencidas.
  const nunca = await base().is('docs_arquivados_em', null).order('data_leilao', { ascending: true, nullsFirst: false }).limit(100);
  if (nunca.error) throw new Error(`leitura de lotes falhou: ${nunca.error.message}`);
  let lotes = (nunca.data || []).filter((l) => !jaVistos.has(l.id));
  if (lotes.length) return lotes;
  const corte = new Date(Date.now() - REVISITA_DIAS * 86400_000).toISOString();
  const velhos = await base().lt('docs_arquivados_em', corte).order('docs_arquivados_em', { ascending: true }).limit(100);
  if (velhos.error) throw new Error(`leitura de revisitas falhou: ${velhos.error.message}`);
  lotes = (velhos.data || []).filter((l) => !jaVistos.has(l.id));
  return lotes;
}

async function carimbar(id) {
  if (SECO) return;
  const { error } = await supabase.from('imoveis_leilao').update({ docs_arquivados_em: new Date().toISOString() }).eq('id', id).select('id');
  if (error) console.log(`  - ${id}: não carimbei docs_arquivados_em (${error.message})`);
}

async function arquivarLote(im, est, hostsBloqueados) {
  const links = linksConhecidos(im);
  if (!links.length) { est.semLink++; return; }
  const { data: existentes, error } = await supabase.from('imovel_anexos')
    .select('id, tipo, storage_path, origem_url, tamanho_kb').eq('imovel_id', im.id);
  if (error) throw new Error(`imovel_anexos ilegível: ${error.message}`);
  const lista = existentes || [];
  const jaOrigem = new Set(lista.map((a) => a.origem_url).filter(Boolean));
  const pendentes = links.filter((l) => !jaOrigem.has(l.url));
  if (!pendentes.length) { est.jaCompletos++; return; }
  const pagina = ehUrl(im.link_edital) && !ehPdfUrl(im.link_edital) ? im.link_edital : im.url_lote;

  for (const l of pendentes) {
    if (Date.now() - inicio > MAX_MS) return 'tempo';
    const h = host(l.url);
    if ((hostsBloqueados.get(h) || 0) >= 3) { est.puladosHost++; continue; }
    if (SECO) { est.novos++; continue; }
    const r = await baixar(l.url, pagina);
    if (!r.buf) {
      est.falhas++;
      if (r.bloqueio) hostsBloqueados.set(h, (hostsBloqueados.get(h) || 0) + 1);
      est.motivos[r.motivo.split(' (')[0]] = (est.motivos[r.motivo.split(' (')[0]] || 0) + 1;
      continue;
    }
    const buf = r.buf;
    const hash = createHash('md5').update(buf).digest('hex').slice(0, 16);
    const kb = Math.round(buf.length / 1024);
    let tipo = classificar(l.url, l.nome, im.fonte);
    const mesmoConteudo = lista.find((a) => a.storage_path && a.storage_path.endsWith(`_${hash}.pdf`));
    if (mesmoConteudo) {
      if (!mesmoConteudo.origem_url) {
        const { error: eU } = await supabase.from('imovel_anexos').update({ origem_url: l.url }).eq('id', mesmoConteudo.id).select('id');
        if (eU) console.log(`  - ${im.id}: origem_url não gravada (${eU.message})`);
        mesmoConteudo.origem_url = l.url;
      }
      est.jaTinha++; continue;
    }
    if (tipo !== 'outro') {
      const mesmoTipo = lista.filter((a) => a.tipo === tipo && a.storage_path);
      const parecido = mesmoTipo.find((a) => !a.origem_url && a.tamanho_kb && Math.abs(a.tamanho_kb - kb) <= Math.max(3, a.tamanho_kb * 0.05));
      if (parecido) {
        const { error: eU } = await supabase.from('imovel_anexos').update({ origem_url: l.url }).eq('id', parecido.id).select('id');
        if (eU) console.log(`  - ${im.id}: origem_url não gravada (${eU.message})`);
        parecido.origem_url = l.url;
        est.jaTinha++; continue;
      }
      // O banco aceita UM edital e UMA matrícula por lote (índice único
      // uniq_imovel_anexos_imovel_tipo_doc). Um segundo documento DIFERENTE desses tipos (edital
      // do leilão + edital do lote, 2 matrículas, a /loteanexo/ extra do BIASI) entra como 'outro'
      // — decidido ANTES do upload, senão o insert falha e o arquivo fica órfão (52 em 21/11).
      if (mesmoTipo.length && TIPO_UNICO.has(tipo)) tipo = 'outro';
    }
    const path = `casos/${im.id}/${tipo}_${hash}.pdf`;
    const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
    if (up.error) { est.falhas++; est.motivos['upload'] = (est.motivos['upload'] || 0) + 1; console.log(`  - ${im.id}: upload: ${up.error.message}`); continue; }
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signed.error) console.log(`  - ${im.id}: URL assinada falhou (${signed.error.message}) — linha fica só com storage_path`);
    const row = { imovel_id: im.id, tipo, nome: limparNome(l.nome) || `${tipo}.pdf`, url: signed.data?.signedUrl || null, storage_path: path, tamanho_kb: kb, role_criador: 'sistema', origem_url: l.url };
    const { data: ins, error: eIns } = await supabase.from('imovel_anexos').insert(row).select('id').single();
    if (eIns) {
      est.falhas++; est.motivos['registro'] = (est.motivos['registro'] || 0) + 1;
      console.log(`  - ${im.id}: registro: ${eIns.message}`);
      // O arquivo acabou de subir e ficaria sem linha que aponte para ele: tira o que este job criou.
      const rm = await supabase.storage.from(BUCKET).remove([path]);
      if (rm.error) console.log(`  - ${im.id}: órfão ${path} não removido (${rm.error.message})`);
      continue;
    }
    lista.push({ ...row, id: ins.id });
    await publicarFatosDoPdf(supabase, im.id, buf, tipo, { valorMinimo: im.valor_minimo, valorAvaliacao: im.valor_avaliacao });
    est.novos++; est.kb += kb;
    est.porFonte[im.fonte] = (est.porFonte[im.fonte] || 0) + 1;
    await new Promise((s) => setTimeout(s, 300)); // gentil com o leiloeiro
  }
}

async function main() {
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) { console.error('Supabase ausente'); process.exit(2); }
  const permitidas = await fontesPermitidas();
  const est = { lotes: 0, semLink: 0, jaCompletos: 0, novos: 0, jaTinha: 0, falhas: 0, puladosHost: 0, foraDaLista: 0, kb: 0, motivos: {}, porFonte: {} };
  const hostsBloqueados = new Map();
  const jaVistos = new Set();
  let parouPorTempo = false;
  console.log(`Arquivar documentos conhecidos — até ${LOTES} lote(s), ${MAX_MS / 60000} min${FONTE ? `, fonte ${FONTE}` : ''}${SECO ? ' [SECO]' : ''}.`);

  laco: while (est.lotes < LOTES) {
    const fatia = await proximaFatia(jaVistos);
    if (!fatia.length) break;
    for (const im of fatia) {
      if (est.lotes >= LOTES) break laco;
      if (Date.now() - inicio > MAX_MS) { parouPorTempo = true; break laco; }
      jaVistos.add(im.id);
      est.lotes++;
      if (!permitidas.has(im.fonte)) { est.foraDaLista++; await carimbar(im.id); continue; }
      try {
        const r = await arquivarLote(im, est, hostsBloqueados);
        if (r === 'tempo') { parouPorTempo = true; break laco; } // não carimba: volta na próxima
      } catch (e) {
        console.log(`  - ${im.id} (${im.fonte}): ${e.message} — volta na próxima rodada`);
        est.falhas++; continue;
      }
      await carimbar(im.id);
    }
  }

  const fontes = Object.entries(est.porFonte).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([f, n]) => `${f} ${n}`).join(' · ');
  const motivos = Object.entries(est.motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}: ${n}`).join(' · ');
  const bloqueados = [...hostsBloqueados].filter(([, n]) => n >= 3).map(([h]) => h).join(', ');
  console.log(`\nResultado: ${est.lotes} lote(s) · ${est.novos} documento(s) novo(s) (${Math.round(est.kb / 1024)} MB) · ${est.jaTinha} já estavam guardados · ${est.falhas} falha(s) · ${est.jaCompletos} lote(s) já completos · ${est.semLink} sem link · ${est.foraDaLista} fora da lista de arquivamento${parouPorTempo ? ' · PAROU POR TEMPO' : ''}.`);
  if (fontes) console.log(`Por fonte: ${fontes}`);
  if (motivos) console.log(`Falhas por motivo: ${motivos}`);
  if (bloqueados) console.log(`Hosts que bloquearam (pulados no resto da rodada): ${bloqueados}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
