/**
 * VALIDAÇÃO EM SECO do "documento primeiro" (29/08) — NÃO GRAVA NADA.
 *
 * Roda `enriquecerPeloDocumento` sobre uma amostra REAL de lotes ativos sem data que já têm
 * edital/matrícula no nosso bucket, e imprime o que seria preenchido. Existe porque a mudança
 * troca a fonte de verdade de um cron que escreve no acervo inteiro: aprovar isso porque o
 * código "parece certo" é exatamente como esta base já colheu relatório vazio e data errada.
 *
 * Mede três coisas SEPARADAS, e a separação é o ponto:
 *   lidos     — o PDF tinha camada de texto (escaneado não conta como "sem data")
 *   com_data  — a leitura achou praça/prazo
 *   poupadas  — requisições Bright Data que este run teria evitado
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: VALIDAR_N (30), VALIDAR_FONTE.
 */
import { createClient } from '@supabase/supabase-js';
import { enriquecerPeloDocumento } from '../api/_doc-datas.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const N = Number(process.env.VALIDAR_N || 30);
const FONTE = (process.env.VALIDAR_FONTE || '').trim();

let q = supabase.from('imoveis_leilao')
    // `cidade` e `estado` NO SELECT (29/08): sem eles a guarda 3 do endereço recebia `undefined`
  // e recusava 31 de 31 por "sem_cidade_no_acervo" — o extrator nunca chegou a ser testado. O
  // instrumento reprovava a coisa medida por uma falta do próprio instrumento: forma nº 10.
  .select('id,fonte,titulo,cidade,estado,endereco,bairro,nomecondominio,descricao,data_leilao,data_leilao_2')
  .eq('ativo', true).is('data_leilao', null).not('fonte', 'in', '("CEF","caixa")')
  .limit(N * 4);
if (FONTE) q = q.eq('fonte', FONTE);

// `error` checado: sem isso "não consegui ler o acervo" viraria "nenhum candidato", e a
// validação diria "tudo certo" sem ter olhado nada — o defeito que ela existe para pegar.
const { data: candidatos, error } = await q;
if (error) { console.error('Leitura do acervo falhou:', error.message); process.exit(1); }
if (!candidatos?.length) { console.error('Nenhum candidato — nada a validar.'); process.exit(1); }

const stats = { testados: 0, sem_anexo: 0, sem_texto: 0, lidos: 0, com_data: 0, com_endereco: 0, com_descricao: 0 };
// ENDEREÇO ANCORADO (item 9): medido separado, e o que importa NÃO é quantos vieram — é
// quantos vieram REPETIDOS. Na 1ª tentativa o extrator "acertou" 22 de 23 e seis lotes
// distintos receberam o mesmo "Avenida Fagundes Filho". Cobertura alta com repetição é o
// sintoma de estar lendo o cabeçalho do documento, não o bem.
const enderecos = [];
const motivosEndereco = {};
// ⚠️ MOTIVOS SEPARADOS. A 1ª rodada jogou tudo em `sem_texto` e o resultado — 23 de 23 sem
// texto — parecia "os PDFs são escaneados", quando era um bug meu (a classe PDFParse chamada
// sem `new`). Um balde só de falhas descreve o sintoma e esconde a causa.
const motivos = {};
const exemplos = [];

for (const im of candidatos) {
  if (stats.testados >= N) break;
  const r = await enriquecerPeloDocumento(im.id, im);
  if (r.motivo === 'sem_anexo') { stats.sem_anexo++; continue; }
  stats.testados++;
  if (!r.lido) { stats.sem_texto++; motivos[r.motivo || '?'] = (motivos[r.motivo || '?'] || 0) + 1; continue; }
  stats.lidos++;
  if (r.patch.data_leilao || r.patch.data_leilao_2) stats.com_data++;
  if (r.patch.endereco || r.patch.bairro || r.patch.nomecondominio) stats.com_endereco++;
  if (r.patch.descricao) stats.com_descricao++;
  if (r.enderecoBem?.logradouro) enderecos.push({ log: r.enderecoBem.logradouro, cidade: im.cidade, fonte: im.fonte });
  else if (r.enderecoBem?.motivo) motivosEndereco[r.enderecoBem.motivo] = (motivosEndereco[r.enderecoBem.motivo] || 0) + 1;
  if (exemplos.length < 8 && r.achou) {
    exemplos.push({
      fonte: im.fonte, doc: r.tipo, titulo: String(im.titulo || '').slice(0, 46),
      data: r.patch.data_leilao || null, prazo: r.patch.data_leilao_2 || null,
      endereco: r.patch.endereco || null, bairro: r.patch.bairro || null,
    });
  }
}

console.log('\n=== VALIDACAO EM SECO — nada foi gravado ===');
console.log(JSON.stringify(stats, null, 1));
console.log('Motivos de nao ter lido:', JSON.stringify(motivos, null, 1));

// ── ENDEREÇO ANCORADO: cobertura E repetição ────────────────────────────────────────────
const porLog = {};
for (const e of enderecos) porLog[e.log] = (porLog[e.log] || 0) + 1;
const repetidos = Object.entries(porLog).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
console.log(`\nENDERECO ANCORADO: ${enderecos.length} de ${stats.lidos} lidos (${stats.lidos ? Math.round(100 * enderecos.length / stats.lidos) : 0}%)`);
console.log(`  logradouros DISTINTOS: ${Object.keys(porLog).length}`);
console.log(`  REPETIDOS (sinal de estar lendo o cabecalho): ${repetidos.length ? repetidos.map(([l, n]) => `${n}x ${l}`).join(' | ') : 'nenhum'}`);
console.log(`  RECUSAS por guarda: ${JSON.stringify(motivosEndereco)}`);
for (const e of enderecos.slice(0, 10)) console.log(`   ${e.fonte} · ${e.cidade || '(sem cidade)'} → ${e.log}`);
console.log('\nAmostra do que seria preenchido:');
for (const e of exemplos) console.log(' ', JSON.stringify(e));
// Só conta como economia o lote que o documento RESOLVEU ou descartou com leitura — não o
// que falhou na leitura, que ainda vai precisar do caminho pago. Dizer "23 de 23 evitadas"
// com zero lidos foi o meu próprio número mentindo, na mesma rodada.
console.log(`\nRequisicoes Bright Data que este run teria evitado: ${stats.lidos} de ${stats.testados} testados`);
