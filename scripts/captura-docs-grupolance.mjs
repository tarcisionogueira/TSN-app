/**
 * Captura COMPLETA de documentos do Grupo Lance (com login Yii) — corrige os lotes
 * que ficaram com 0 anexos. Loga uma vez e, por lote, lê a página (server-rendered,
 * fetch simples) e baixa TUDO: Edital/Processo (público) + Matrícula/Auto de avaliação/
 * Análise processual (gated via /lote/baixar-documento/{id}/file_xxx).
 *
 * Grava:
 *  - imoveis_leilao.anexos (jsonb) = lista completa [{nome,url,tipo}] → conserta o "0 anexos"
 *  - imoveis_leilao.link_matricula = matrícula (URL do Storage)
 *  - a MATRÍCULA vai também para o Storage (bucket 'documentos') + imovel_anexos (paridade
 *    com o fluxo existente); os demais docs entram em anexos apontando para o CDN público.
 *
 * Roda no GitHub Actions. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, GL_EMAIL/GL_SENHA
 * (fallback ZUK_EMAIL/ZUK_SENHA). Config: GL_DOCS_LOTE (default 60), GL_DOCS_IDS (csv opcional).
 */
import { createClient } from '@supabase/supabase-js';
import { loginGrupoLance, coletarDocsGrupoLance, baixarDoc } from '../api/_grupolance-auth.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTE = Number(process.env.GL_DOCS_LOTE || 60);
const IDS = (process.env.GL_DOCS_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

const nomePorTipo = { matricula: 'Matrícula do Imóvel', laudo: 'Auto de Avaliação', edital: 'Edital', regras: 'Regras da Venda', anexo: 'Documento' };
function nomeDoc(d) {
  if (d.rotulo && d.rotulo.length > 2) return d.rotulo;
  return nomePorTipo[d.tipo] || 'Documento';
}

async function jaTemMatricula(imovelId) {
  const { data } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  return !!data?.length;
}

async function subirMatricula(imovelId, buffer) {
  const path = `casos/${imovelId}/matricula_grupolance_auto.pdf`;
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  const row = { imovel_id: imovelId, tipo: 'matricula', nome: 'Matrícula do Imóvel', url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', 'matricula').limit(1);
  if (existente?.length) await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id);
  else await supabase.from('imovel_anexos').insert(row);
  return url;
}

async function alvos() {
  if (IDS.length) {
    const { data } = await supabase.from('imoveis_leilao').select('id, url_lote, anexos, link_matricula')
      .in('fonte_id', IDS.map(i => (i.startsWith('gl_') ? i : `gl_${i}`)));
    return data || [];
  }
  // Foco: lotes SEM anexos (o "0 anexos" que o usuário apontou). Drena limpo: uma vez
  // preenchido o anexos, o lote deixa de casar com o filtro.
  const { data, error } = await supabase.from('imoveis_leilao')
    .select('id, url_lote, anexos, link_matricula')
    .eq('fonte', 'GRUPOLANCE').eq('ativo', true)
    .or('anexos.is.null,anexos.eq.[]')
    .not('url_lote', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(LOTE);
  if (error) { console.error('Erro ao ler lotes:', error.message); process.exit(1); }
  return data || [];
}

async function main() {
  console.log(`\n📄 Captura de documentos Grupo Lance (login) — ${new Date().toISOString()}`);
  const jar = await loginGrupoLance();
  if (!jar) { console.error('Login falhou — verifique GL_EMAIL/GL_SENHA (ou ZUK_*).'); process.exit(1); }
  console.log('Login OK.');

  const lotes = await alvos();
  if (!lotes.length) { console.log('Nenhum lote Grupo Lance pendente (sem anexos).'); return; }
  console.log(`${lotes.length} lote(s) para capturar (cap ${LOTE}).\n`);

  let okLotes = 0, comMat = 0, docsTotal = 0, semDoc = 0, erros = 0;
  for (const l of lotes) {
    try {
      const docs = await coletarDocsGrupoLance(l.url_lote, jar);
      if (!docs.length) { semDoc++; console.log(`- ${l.id}: nenhum documento na página`); continue; }
      const anexos = [];
      let matriculaUrl = null;
      for (const d of docs) {
        try {
          const r = await baixarDoc(d.url, jar, l.url_lote);
          if (!r.ehPdf) { console.log(`    ${l.id} ${d.tipo}: não é PDF (status ${r.status})`); continue; }
          let urlFinal = r.finalUrl; // CDN público por padrão
          // A MATRÍCULA vai para o Storage (link estável + paridade c/ o fluxo existente).
          if (d.tipo === 'matricula') {
            try {
              if (!(await jaTemMatricula(l.id))) urlFinal = await subirMatricula(l.id, r.buffer) || r.finalUrl;
              else urlFinal = r.finalUrl;
            } catch (e) { console.log(`    ${l.id} matrícula upload falhou: ${e.message}`); urlFinal = r.finalUrl; }
            matriculaUrl = urlFinal;
            comMat++;
          }
          anexos.push({ nome: nomeDoc(d), url: urlFinal, tipo: d.tipo });
          docsTotal++;
          await new Promise(s => setTimeout(s, 150));
        } catch (e) { console.log(`    ${l.id} ${d.tipo}: erro ${e.message}`); }
      }
      if (!anexos.length) { semDoc++; console.log(`- ${l.id}: docs achados mas nenhum baixou`); continue; }
      // Ordena: matrícula, edital, laudo, regras, anexo.
      const ordem = { matricula: 0, edital: 1, laudo: 2, regras: 3, anexo: 4 };
      anexos.sort((a, b) => (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9));
      const upd = { anexos };
      if (matriculaUrl) upd.link_matricula = matriculaUrl;
      const { error: e2 } = await supabase.from('imoveis_leilao').update(upd).eq('id', l.id);
      if (e2) { erros++; console.log(`- ${l.id}: erro ao gravar anexos: ${e2.message}`); continue; }
      okLotes++;
      console.log(`✓ ${l.id}: ${anexos.length} doc(s) [${anexos.map(a => a.tipo).join(', ')}]${matriculaUrl ? ' +matrícula' : ''}`);
      await new Promise(s => setTimeout(s, 250));
    } catch (e) { erros++; console.log(`- ${l.id}: erro ${e.message}`); }
  }
  console.log(`\nResultado: ${okLotes} lote(s) enriquecido(s) · ${comMat} com matrícula · ${docsTotal} doc(s) · ${semDoc} sem doc · ${erros} erro(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
