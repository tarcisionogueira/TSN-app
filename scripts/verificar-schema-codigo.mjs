#!/usr/bin/env node
/**
 * VERIFICADOR DE DERIVA CÓDIGO × BANCO — a trava para a família de bugs de 12/08.
 *
 * POR QUE EXISTE. A varredura de 12/08 achou seis defeitos e **três eram a mesma causa**:
 * código CORRETO cujo banco nunca recebeu a migração.
 *
 *   · `solicitacoes.reuniao_em` / `reuniao_duracao_min` — nunca criadas. O `update` do Admin
 *     dava 400, o erro não era checado, NADA era gravado — e o sistema seguia em frente
 *     criando a sala e mandando ao cliente um e-mail dizendo que a reunião estava marcada.
 *   · `onr_protocolos` — a migração estava no repo desde 10/08 e nunca foi aplicada. A tela
 *     `/registro-imovel` inteira abria vazia, com cara de funcionando.
 *   · `proxy_uso` — nunca existiu. O limitador de custo mensal lia zero para sempre e
 *     respondia "pode gastar" — uma rede de proteção que não protegia.
 *
 * O QUE ESSA FAMÍLIA TEM DE ESPECIAL: ela é INVISÍVEL para revisão de código, para lint e
 * para teste de front. O código está certo. O que está errado é o mundo em volta dele. Só
 * comparando o que o código REFERENCIA com o que o banco TEM é que aparece — e isso é barato
 * de fazer a cada push. É a mesma ideia da "sexta forma" do CLAUDE.md, automatizada.
 *
 * O QUE VERIFICA
 *   1. toda tabela citada em `.from('x')` existe no schema public;
 *   2. toda coluna usada em filtro/ordenação (`.order/.eq/.gte/...('col')`) existe na tabela
 *      daquela cadeia — é aqui que mora o `criado_em` × `created_at`, que em 11/08 esvaziou a
 *      fila da equipe e zerou o painel de produtividade sem um único erro na tela.
 *
 * SILÊNCIO NÃO É APROVAÇÃO. Se faltar credencial ou o banco não responder, este script sai
 * com código 2 e diz que NÃO VERIFICOU. Tratar "não consegui checar" como "está tudo bem"
 * seria cometer, na própria trava, o defeito que ela existe para pegar.
 *
 * EXCEÇÃO DELIBERADA: `// schema-ok: <motivo>` na linha (ou na de cima). Motivo obrigatório.
 *
 * USO
 *   node scripts/verificar-schema-codigo.mjs
 *   Env: VITE_SUPABASE_URL (ou SUPABASE_URL) + SUPABASE_SERVICE_KEY
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIRS = ['api', 'src', 'scripts'];
const EXT = /\.(js|jsx|mjs)$/;
const IGNORAR = /node_modules|\/dist\/|\.min\./;

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Colunas que o código monta em tempo de execução (nome vindo de variável/template) não têm
// como ser verificadas estaticamente — e não são o alvo. O alvo é o literal.
const COLUNA_DATA = /(criado_em|created_at|atualizado_em|updated_at|executado_em|enviado_em|entregue_em|aberto_em|clicado_em|ran_at|_em|_at)$/;

/**
 * Remove comentários preservando strings. Sem isto o próprio scanner acusa a própria
 * documentação: na primeira versão ele leu `supabase.from('proxy_uso')` DENTRO do comentário
 * que explicava por que aquele código tinha sido removido.
 */
function semComentarios(src) {
  let out = '', i = 0, estado = 'codigo', aspas = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (estado === 'codigo') {
      if (c === '/' && d === '/') { estado = 'linha'; i += 2; continue; }
      if (c === '/' && d === '*') { estado = 'bloco'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { estado = 'string'; aspas = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (estado === 'string') {
      if (c === '\\') { out += c + (d || ''); i += 2; continue; }
      if (c === aspas) estado = 'codigo';
      out += c; i++; continue;
    }
    if (estado === 'linha') {
      if (c === '\n') { estado = 'codigo'; out += '\n'; }
      i++; continue;
    }
    if (estado === 'bloco') {
      if (c === '*' && d === '/') { estado = 'codigo'; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
  }
  return out;
}

function arquivos(dir, saida = []) {
  const abs = join(RAIZ, dir);
  if (!existsSync(abs)) return saida;
  for (const nome of readdirSync(abs)) {
    const p = join(abs, nome);
    const rel = relative(RAIZ, p);
    if (IGNORAR.test('/' + rel)) continue;
    if (statSync(p).isDirectory()) arquivos(rel, saida);
    else if (EXT.test(nome)) saida.push(rel);
  }
  return saida;
}

/** Referências a tabela/coluna encontradas no código. */
function coletarReferencias() {
  const refs = []; // { arquivo, linha, tabela, coluna|null }
  for (const dir of DIRS) {
    for (const rel of arquivos(dir)) {
      const bruto = readFileSync(join(RAIZ, rel), 'utf8');
      const src = semComentarios(bruto);
      const linhasBrutas = bruto.split('\n');

      for (const m of src.matchAll(/\.from\(\s*['"]([a-zA-Z0-9_]+)['"]\s*\)/g)) {
        // `supabase.storage.from('documentos')` é BUCKET, não tabela. Sem esta exclusão o
        // verificador acusaria os buckets como "tabela inexistente" em todo push.
        const antes = src.slice(Math.max(0, m.index - 80), m.index);
        if (/storage\s*$|storage\s*\.\s*$/.test(antes)) continue;

        const linha = src.slice(0, m.index).split('\n').length;
        const marcada = (t) => /\/\/\s*(schema|padrao)-ok:\s*\S/.test(t || '');
        if (marcada(linhasBrutas[linha - 1]) || marcada(linhasBrutas[linha - 2])) continue;

        refs.push({ arquivo: rel, linha, tabela: m[1], coluna: null });

        // Colunas da MESMA cadeia: da chamada até o próximo `.from(` ou 600 chars.
        let janela = src.slice(m.index + m[0].length, m.index + m[0].length + 600);
        const prox = janela.indexOf('.from(');
        if (prox > 0) janela = janela.slice(0, prox);
        const vistas = new Set();
        for (const c of janela.matchAll(/\.(?:order|eq|neq|gt|gte|lt|lte|is|in|filter)\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) {
          const col = c[1];
          if (!COLUNA_DATA.test(col) || vistas.has(col)) continue;
          vistas.add(col);
          refs.push({ arquivo: rel, linha, tabela: m[1], coluna: col });
        }
      }
    }
  }
  return refs;
}

async function inventario() {
  if (!SB_URL || !SB_KEY) {
    return { erro: 'faltam VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_KEY no ambiente' };
  }
  let r;
  try {
    r = await fetch(`${SB_URL}/rest/v1/rpc/schema_inventario`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { erro: `banco inacessível: ${String(e?.message || e).slice(0, 120)}` };
  }
  // `.ok` ANTES do corpo: um 401/404 aqui não é "o schema está vazio", é "não consegui ler".
  if (!r.ok) return { erro: `RPC schema_inventario devolveu HTTP ${r.status}` };
  const obj = await r.json().catch(() => null);

  // A RPC devolve UM jsonb {tabela: [colunas]}, e a forma importa. A primeira versão devolvia
  // uma linha por coluna — 2.136 linhas — e o PostgREST corta em 1.000 SEM ERRO: o verificador
  // recebia meio schema e acusou `imoveis_leilao` (66 colunas, existe desde sempre) como
  // inexistente. Um objeto de uma linha só é imune ao corte. Se algum dia voltar a chegar
  // ARRAY aqui, é sinal de que a RPC foi revertida para a forma truncável — e isso reprova,
  // em vez de virar um "schema pela metade" silencioso.
  if (Array.isArray(obj)) {
    return { erro: 'RPC devolveu ARRAY (forma truncável em 1.000 linhas pelo PostgREST) — esperado UM objeto jsonb' };
  }
  if (!obj || typeof obj !== 'object') return { erro: 'RPC devolveu corpo vazio/inesperado' };

  const tabelas = new Map(); // tabela → Set(colunas)
  for (const [tab, cols] of Object.entries(obj)) {
    if (Array.isArray(cols)) tabelas.set(tab, new Set(cols));
  }
  // Sanidade grosseira: este projeto tem ~175 tabelas. Um inventário minúsculo é bug de
  // leitura, não schema vazio — e reprovar aqui é melhor do que acusar meio código.
  if (tabelas.size < 50) return { erro: `inventário implausível: só ${tabelas.size} tabelas` };
  return { tabelas };
}

// `--listar` mostra o que o extrator VÊ, sem tocar no banco. Serve para depurar a própria
// trava (foi assim que o falso-positivo dos buckets de Storage apareceu) e para conferir a
// cobertura sem precisar de credencial.
if (process.argv.includes('--listar')) {
  const refs = coletarReferencias();
  const tabs = [...new Set(refs.map((r) => r.tabela))].sort();
  const pares = [...new Set(refs.filter((r) => r.coluna).map((r) => `${r.tabela}.${r.coluna}`))].sort();
  console.log(`${tabs.length} tabelas referenciadas:\n  ${tabs.join(', ')}\n`);
  console.log(`${pares.length} pares tabela.coluna-de-data:\n  ${pares.join('\n  ')}`);
  process.exit(0);
}

const inv = await inventario();
if (inv.erro) {
  console.error(`\n⚠️  NÃO VERIFICADO — ${inv.erro}`);
  console.error('   Isto NÃO é aprovação: é ausência de medição. A trava existe justamente');
  console.error('   para que "não consegui checar" nunca passe por "está tudo certo".\n');
  process.exit(2);
}

const refs = coletarReferencias();
const problemas = [];
for (const r of refs) {
  const cols = inv.tabelas.get(r.tabela);
  if (!cols) {
    if (!r.coluna) problemas.push({ ...r, tipo: 'TABELA/VIEW não existe no banco', sugestao: null });
    continue; // coluna de tabela inexistente: a tabela já foi reportada
  }
  if (r.coluna && !cols.has(r.coluna)) {
    const datas = [...cols].filter((c) => COLUNA_DATA.test(c)).sort();
    problemas.push({ ...r, tipo: 'COLUNA não existe nessa tabela', sugestao: datas.join(', ') || '(nenhuma coluna de data)' });
  }
}

const nTab = new Set(refs.map((r) => r.tabela)).size;
const nCol = refs.filter((r) => r.coluna).length;

if (!problemas.length) {
  console.log(`✓ Código e banco batem. (${nTab} tabelas e ${nCol} usos de coluna de data conferidos contra o schema real.)`);
  process.exit(0);
}

console.error('\n✗ DERIVA ENTRE CÓDIGO E BANCO — é a família de 12/08 tentando voltar.\n');
console.error('  Lembre do efeito real: não dá tela de erro. O PostgREST devolve 400, o');
console.error('  `{ data }` sem `error` vira lista vazia, e a tela mente com cara de certa.\n');
for (const p of problemas) {
  console.error(`  ${p.arquivo}:${p.linha}`);
  console.error(`    ${p.tipo} → ${p.tabela}${p.coluna ? '.' + p.coluna : ''}`);
  if (p.sugestao) console.error(`    colunas de data que existem nessa tabela: ${p.sugestao}`);
  console.error('');
}
console.error('O que fazer, em ordem:');
console.error('  1. Se falta MIGRAÇÃO: aplique-a. Escrever o .sql no repo não cria nada no banco');
console.error('     — foi exatamente assim que `onr_protocolos` ficou 2 dias no ar sem existir.');
console.error('  2. Se o nome está errado no código: corrija (confira a coluna de data no schema;');
console.error('     as tabelas antigas usam `criado_em`, as novas `created_at`).');
console.error('  3. Se a referência é intencional e não-verificável, marque com  // schema-ok: <motivo>\n');
process.exit(1);
