/**
 * Captura em LOTE das MATRÍCULAS do Portal Zuk (login-gated) — roda no GitHub Actions.
 * O edital do Zuk é público (já vem no scrape); a MATRÍCULA fica atrás de login.
 * Este script loga UMA vez (ZUK_EMAIL/ZUK_SENHA), pega a URL ASSINADA da matrícula de
 * cada lote ZUK ainda sem matrícula, BAIXA o PDF e sobe no Storage (bucket 'documentos')
 * + registra em `imovel_anexos` (tipo=matricula). Guardamos o ARQUIVO (não a URL, que
 * expira). O Vercel segue como fallback on-demand (api/_zuk-auth.js).
 *
 * Secrets necessários: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, ZUK_EMAIL, ZUK_SENHA.
 * Config opcional: ZUK_MATRICULA_LOTE (quantos lotes por rodada, default 50).
 */
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';
import { loginZuk, matriculaLoteLogado, jarHeader } from '../api/_zuk-auth.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTE = Number(process.env.ZUK_MATRICULA_LOTE || 50);
const COOLDOWN_DIAS = 14; // negative-cache: re-tenta um lote "sem matrícula" só após isso
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function jaTemMatricula(imovelId) {
  // Só conta anexo COM arquivo (storage_path não-nulo). Um anexo "limpo" pela retenção
  // (storage_path nulo) NÃO deve bloquear a recaptura — senão o imóvel ficaria com a
  // matrícula 404 para sempre depois que o cleanup apaga o PDF.
  const { data } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').not('storage_path', 'is', null).limit(1);
  return !!data?.length;
}

async function salvarMatricula(imovelId, buffer) {
  const path = `casos/${imovelId}/matricula_zuk_auto.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  const row = { imovel_id: imovelId, tipo: 'matricula', nome: 'Matrícula do Imóvel', url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  if (existente?.length) await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id);
  else await supabase.from('imovel_anexos').insert(row);
  // Aponta o link do imóvel para o ARQUIVO guardado (não a URL assinada do Zuk, que expira).
  await supabase.from('imoveis_leilao').update({ link_matricula: url }).eq('id', imovelId);
}

async function main() {
  if (!process.env.ZUK_EMAIL || !process.env.ZUK_SENHA) { console.error('ZUK_EMAIL/ZUK_SENHA ausentes'); process.exit(1); }

  // Lotes ZUK ativos ainda SEM matrícula (usa link_edital como URL do lote no Zuk).
  // ORDER BY matricula_checada_em (NULLS FIRST) + negative-cache: os NUNCA checados vêm
  // primeiro e os já checados-sem-matrícula só voltam após o cooldown. Assim a rodada
  // ALCANÇA A CAUDA em vez de reprocessar sempre a cabeça (lotes login-gated sem matrícula).
  const cutoff = new Date(Date.now() - COOLDOWN_DIAS * 24 * 3600 * 1000).toISOString();
  const { data: lotes, error } = await supabase.from('imoveis_leilao')
    .select('id, link_edital')
    .eq('fonte', 'ZUK').eq('ativo', true)
    .is('link_matricula', null)
    .not('link_edital', 'is', null)
    .or(`matricula_checada_em.is.null,matricula_checada_em.lt.${cutoff}`)
    .order('matricula_checada_em', { nullsFirst: true, ascending: true })
    // 02/09: entre os NUNCA checados a ordem era a do id (aleatória na prática) e, com o
    // teto de 20 por rodada, o lote Z37106 (praça 16/09, cliente já com mercadológico)
    // ficava atrás de 80 outros. Praça mais próxima primeiro: é quem o cliente vai abrir.
    .order('data_leilao', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(LOTE);
  if (error) { console.error('Erro ao ler lotes:', error.message); process.exit(1); }
  if (!lotes?.length) console.log('Nenhum lote ZUK pendente de matrícula.');
  else console.log(`ZUK: ${lotes.length} lote(s) para tentar matrícula (cap ${LOTE}).`);

  // A fase 2 roda mesmo sem matrícula pendente — o login precisa de uma página de lote qualquer.
  let paginaLogin = lotes?.[0]?.link_edital;
  if (!paginaLogin) {
    const { data: um, error: eUm } = await supabase.from('imoveis_leilao').select('link_edital').eq('fonte', 'ZUK').eq('ativo', true).not('link_edital', 'is', null).limit(1);
    if (eUm) { console.error('Erro ao ler um lote ZUK para o login:', eUm.message); process.exit(1); }
    paginaLogin = um?.[0]?.link_edital;
  }
  if (!paginaLogin) { console.log('Nenhum lote ZUK ativo — nada a fazer.'); return; }
  const jar = await loginZuk(paginaLogin);
  if (!jar) { console.error('Falha no login do Zuk — abortando (confira ZUK_EMAIL/ZUK_SENHA).'); process.exit(1); }

  let ok = 0, semMat = 0, erro = 0;
  for (const lote of lotes || []) {
    try {
      if (await jaTemMatricula(lote.id)) continue;
      const r = await matriculaLoteLogado(lote.link_edital, jar);
      if (!r?.matricula) {
        semMat++;
        // negative-cache: marca que checamos e a fonte não tinha matrícula. Sai da fila
        // por COOLDOWN_DIAS (volta depois, caso a matrícula seja publicada mais tarde).
        await supabase.from('imoveis_leilao').update({ matricula_checada_em: new Date().toISOString() }).eq('id', lote.id);
        console.log(`- ${lote.id}: sem matrícula (cards=${r?.cards ?? '?'})`);
        continue;
      }
      // Baixa com sessão + Referer (a URL assinada do Zuk pode exigir os dois).
      let host = ''; try { host = new URL(r.matricula).host; } catch { /* */ }
      const resp = await fetch(r.matricula, {
        headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*', Referer: lote.link_edital, Origin: 'https://www.portalzuk.com.br', Cookie: jarHeader(jar) },
        redirect: 'follow', signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) { erro++; console.log(`- ${lote.id}: download HTTP ${resp.status} (host=${host}) url=${r.matricula.slice(0, 140)}`); continue; }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1000 || buf.slice(0, 5).toString('latin1') !== '%PDF-') { erro++; console.log(`- ${lote.id}: não é PDF (${buf.length}b)`); continue; }
      await salvarMatricula(lote.id, buf);
      ok++; console.log(`✓ ${lote.id}: matrícula salva (${Math.round(buf.length / 1024)}kb) ${/Signature=/i.test(r.matricula) ? '[assinada]' : ''}`);
      await new Promise(s => setTimeout(s, 800)); // gentil com o site
    } catch (e) { erro++; console.log(`- ${lote.id}: erro ${e.message}`); }
  }
  console.log(`\nZUK matrícula — resultado: ${ok} salvas · ${semMat} sem matrícula · ${erro} erro(s).`);
  await documentosCompletos(jar);
}

// ── FASE 2: TODOS os documentos da página logada (25/09) ─────────────────────────────────
// Dono: "há mais anexos no leiloeiro que não estão aparecendo no sistema" (Z37342). A fase 1
// só guarda a matrícula; laudo, certidões e cópias do processo dos cards ficavam no site. Guardar
// tudo de todos os ~660 lotes custaria storage à toa, então só entra lote que alguém está
// trabalhando (caso aberto ou análise gerada) + os pedidos à mão em ZUK_IDS. Um lote é visitado
// UMA vez (`zuk_docs_em`); para refazer, passe o id em ZUK_IDS.
const DOCS_LOTE = Number(process.env.ZUK_DOCS_LOTE || 15);
const slug = (t) => String(t || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'documento';

async function idsDeInteresse() {
  const pedidos = String(process.env.ZUK_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
  const ids = new Set(pedidos);
  for (const [tabela, col] of [['casos', 'imovel_id'], ['analises_documental', 'imovel_id'], ['analises_mercado', 'imovel_id']]) {
    const { data, error } = await supabase.from(tabela).select(col).not(col, 'is', null).order('created_at', { ascending: false }).limit(1000);
    if (error) { console.log(`  (fase 2) ${tabela} ilegível: ${error.message} — sigo com o resto`); continue; }
    for (const r of data || []) ids.add(String(r[col]));
  }
  return { pedidos, ids: [...ids] };
}

async function documentosCompletos(jar) {
  const { pedidos, ids } = await idsDeInteresse();
  if (!ids.length) { console.log('\nFase 2 (documentos completos): nenhum lote de interesse.'); return; }
  const lotes = [];
  for (let i = 0; i < ids.length && lotes.length < DOCS_LOTE; i += 200) {
    const fatia = ids.slice(i, i + 200).filter(x => /^[0-9a-f-]{36}$/i.test(x));
    if (!fatia.length) continue;
    const { data, error } = await supabase.from('imoveis_leilao').select('id, link_edital, anexos, zuk_docs_em')
      .eq('fonte', 'ZUK').eq('ativo', true).not('link_edital', 'is', null).in('id', fatia);
    if (error) { console.log(`  (fase 2) leitura de lotes falhou: ${error.message}`); return; }
    for (const l of data || []) if (!l.zuk_docs_em || pedidos.includes(l.id)) lotes.push(l);
  }
  console.log(`\nFase 2 (documentos completos): ${lotes.length} lote(s) ZUK de interesse (cap ${DOCS_LOTE}).`);
  let salvos = 0, erros = 0;
  for (const lote of lotes.slice(0, DOCS_LOTE)) {
    try {
      const r = await matriculaLoteLogado(lote.link_edital, jar);
      if (!r) { erros++; console.log(`- ${lote.id}: página logada ilegível`); continue; }
      const { data: jaTem, error: eJa } = await supabase.from('imovel_anexos').select('nome, tipo').eq('imovel_id', lote.id).not('storage_path', 'is', null);
      if (eJa) { erros++; console.log(`- ${lote.id}: imovel_anexos ilegível (${eJa.message})`); continue; }
      const nomes = new Set((jaTem || []).map(a => String(a.nome).toLowerCase()));
      const temEditalColeta = (lote.anexos || []).some(a => a?.tipo === 'edital');
      let novosLote = 0;
      for (const d of r.docs || []) {
        if (d.tipo === 'matricula') continue;                     // fase 1 cuida
        if (d.tipo === 'edital' && temEditalColeta) continue;     // o edital público já está no lote
        if (nomes.has(String(d.nome).toLowerCase())) continue;
        const resp = await fetch(d.url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*', Referer: lote.link_edital, Origin: 'https://www.portalzuk.com.br', Cookie: jarHeader(jar) }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
        if (!resp.ok) { erros++; console.log(`- ${lote.id}: "${d.nome}" HTTP ${resp.status}`); continue; }
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length < 1000 || buf.slice(0, 5).toString('latin1') !== '%PDF-') { erros++; console.log(`- ${lote.id}: "${d.nome}" não é PDF (${buf.length}b)`); continue; }
        if (buf.length > 25 * 1024 * 1024) { console.log(`- ${lote.id}: "${d.nome}" > 25 MB, fica só no site`); continue; }
        const path = `casos/${lote.id}/zuk_${slug(d.nome)}.pdf`;
        const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
        if (up.error) { erros++; console.log(`- ${lote.id}: upload "${d.nome}": ${up.error.message}`); continue; }
        const tipo = d.tipo === 'regras' ? 'regras_venda' : d.tipo;
        const { error: eIns } = await supabase.from('imovel_anexos').insert({ imovel_id: lote.id, tipo, nome: d.nome, storage_path: path, tamanho_kb: Math.round(buf.length / 1024), role_criador: 'sistema' });
        if (eIns) { erros++; console.log(`- ${lote.id}: registro "${d.nome}": ${eIns.message}`); continue; }
        nomes.add(String(d.nome).toLowerCase());
        novosLote++; salvos++;
        await new Promise(res => setTimeout(res, 800));
      }
      const { error: eMarca } = await supabase.from('imoveis_leilao').update({ zuk_docs_em: new Date().toISOString() }).eq('id', lote.id).select('id');
      if (eMarca) console.log(`- ${lote.id}: não marquei zuk_docs_em (${eMarca.message}) — volta na próxima rodada`);
      console.log(`✓ ${lote.id}: ${r.docs?.length || 0} card(s) na página · ${novosLote} documento(s) novo(s) guardado(s)`);
    } catch (e) { erros++; console.log(`- ${lote.id}: erro ${e.message}`); }
  }
  console.log(`Fase 2 — ${salvos} documento(s) guardado(s) · ${erros} erro(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
