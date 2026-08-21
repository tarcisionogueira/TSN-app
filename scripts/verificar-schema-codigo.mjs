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
 *   3. toda coluna PEDIDA em `.select('a, b, c')` existe na tabela daquela cadeia (15/08).
 *      Acrescentado porque `/alavancagem` subiu para produção pedindo `perfis.whatsapp`, coluna
 *      que nunca existiu: 400 no PostgREST, o cliente logado aparecia sem telefone nenhum e o
 *      lead chegava à equipe sem número — com a tela prometendo que alguém entraria em contato.
 *      Os itens 1 e 2 não pegavam: a tabela existe e `whatsapp` não é coluna de data.
 *   4. toda RPC chamada no código (`rpc/NOME`, `.rpc('NOME')`) existe como função no banco —
 *      forma #7 do CLAUDE.md, agora para FUNÇÕES (o item 1 só cobria TABELAS). Acrescentado em
 *      21/08 (gap #4) depois de achar `registrar-compra-produto.js` chamando
 *      `vincular_indicacao_compra`, função que NUNCA existiu: PGRST202 engolido no `catch`, a
 *      indicação de toda compra de produto perdida em silêncio.
 *   5. toda FUNÇÃO do banco tem um `create function` em supabase/migrations/ — forma #7b: função
 *      criada no SQL Editor e nunca backportada some se o banco for recriado do repo (foi assim
 *      que `admin_metricas_negocio` divergiu e imprimiu "0% venda"). Entra COM linha de base
 *      (scripts/funcoes-sem-migracao.baseline.json): a dívida atual é aceita, só CRESCER reprova.
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
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIRS = ['api', 'src', 'scripts'];
const EXT = /\.(js|jsx|mjs)$/;
const IGNORAR = /node_modules|\/dist\/|\.min\./;

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Linha de base da forma #7b: funções que HOJE existem no banco sem um `create function`
// correspondente nas migrações (criadas no SQL Editor e nunca backportadas). São dívida
// ACEITA — a trava não obriga a escrever 59 migrações de uma vez; só impede que a lista
// CRESÇA (função nova no banco sem migração reprova). `--atualizar-funcoes` regrava.
const BASELINE_FUNCS = join(RAIZ, 'scripts', 'funcoes-sem-migracao.baseline.json');

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

        // Colunas PEDIDAS no `.select(...)` — ver item 3 do cabeçalho.
        //
        // CONSERVADOR DE PROPÓSITO. O `select` do PostgREST não é uma lista de colunas: aceita
        // embed (`perfis(nome)`), alias (`x:col`), cast (`col::text`), json path (`meta->>'a'`),
        // agregação (`count`), negação de embed (`!inner`) e `*`. Interpretar tudo isso daria
        // falso-positivo, e uma trava que grita errado é desligada pela equipe em uma semana.
        // Então: se o literal inteiro contiver QUALQUER coisa fora de identificadores simples
        // separados por vírgula, o select é ignorado por inteiro. Pega o caso comum — que é o
        // que mordeu — e nunca acusa o que não sabe ler.
        for (const s of janela.matchAll(/\.select\(\s*(['"])([^'"`]*)\1/g)) {
          const lista = s[2].trim();
          if (!lista || !/^[a-zA-Z0-9_]+(\s*,\s*[a-zA-Z0-9_]+)*$/.test(lista)) continue;
          for (const col of lista.split(',').map((x) => x.trim())) {
            if (vistas.has(col)) continue;
            vistas.add(col);
            refs.push({ arquivo: rel, linha, tabela: m[1], coluna: col, deSelect: true });
          }
        }
      }
    }
  }
  return refs;
}

// RPCs chamadas no código: forma de path do PostgREST (sb de rpc barra nome) e a do client
// supabase-js (ponto-rpc de nome). LINHA A LINHA, pulando linhas de comentário — pelo MESMO
// motivo que envsSuspeitas: semComentarios se perde nos regexes cheios de aspas DESTE arquivo
// (a 1ª versão leu o `rpc/NAME` do próprio comentário aqui e acusou uma função "name"
// inexistente). Uma linha que começa por //, * ou /* é comentário; isso basta e não desincroniza.
function coletarRpcs() {
  const refs = [];
  const vistos = new Set();
  const marcada = (t) => /\/\/\s*(schema|padrao)-ok:\s*\S/.test(t || '');
  const re = /rpc\/([a-zA-Z0-9_]+)|\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g;
  for (const dir of DIRS) {
    for (const rel of arquivos(dir)) {
      const linhas = readFileSync(join(RAIZ, rel), 'utf8').split('\n');
      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        if (/^\s*(\/\/|\*|\/\*)/.test(linha)) continue; // comentário
        if (marcada(linha) || marcada(linhas[i - 1])) continue;
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(linha))) {
          const nome = (m[1] || m[2]).toLowerCase();
          const chave = `${rel}::${nome}`;
          if (vistos.has(chave)) continue; // uma ocorrência por (arquivo,nome) basta
          vistos.add(chave);
          refs.push({ arquivo: rel, linha: i + 1, nome });
        }
      }
    }
  }
  return refs;
}

/**
 * Nomes de função declarados por `create [or replace] function [if not exists] [schema.]NOME(`
 * nas migrações. Whole-file e multi-linha DE PROPÓSITO: a assinatura costuma quebrar a linha
 * logo após o nome, e um parser por-linha perdia CREATEs válidos — fazendo função COM migração
 * aparecer como deriva (falso positivo). É o mesmo cuidado do resto da base: não acusar o que
 * não sabe ler.
 */
function funcsDeMigracoes() {
  const dir = join(RAIZ, 'supabase', 'migrations');
  const nomes = new Set();
  if (!existsSync(dir)) return nomes;
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:if\s+not\s+exists\s+)?(?:"?[a-zA-Z0-9_]+"?\s*\.\s*)?"?([a-zA-Z0-9_]+)"?\s*\(/gis;
  for (const nome of readdirSync(dir)) {
    if (!nome.endsWith('.sql')) continue;
    const t = readFileSync(join(dir, nome), 'utf8');
    let m;
    while ((m = re.exec(t))) nomes.add(m[1].toLowerCase());
  }
  return nomes;
}

async function chamarRpc(nome) {
  let r;
  try {
    r = await fetch(`${SB_URL}/rest/v1/rpc/${nome}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return { erro: `banco inacessível: ${String(e?.message || e).slice(0, 120)}` };
  }
  // `.ok` ANTES do corpo: um 401/404 aqui não é "vazio", é "não consegui ler".
  if (!r.ok) return { erro: `RPC ${nome} devolveu HTTP ${r.status}` };
  return { corpo: await r.json().catch(() => null) };
}

async function inventario() {
  if (!SB_URL || !SB_KEY) {
    return { erro: 'faltam VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_KEY no ambiente' };
  }
  const inv = await chamarRpc('schema_inventario');
  if (inv.erro) return { erro: inv.erro };
  const obj = inv.corpo;

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

  // Inventário de FUNÇÕES (schema_funcoes) — array jsonb de nomes. Mesma honestidade: se a RPC
  // não existe/não responde, é "não consegui checar", não "não há funções". Exit 2, não passa.
  const fx = await chamarRpc('schema_funcoes');
  if (fx.erro) return { erro: `${fx.erro} (schema_funcoes — aplique supabase/migrations/schema_funcoes_inventario.sql)` };
  if (!Array.isArray(fx.corpo)) return { erro: 'schema_funcoes devolveu forma inesperada (esperado ARRAY jsonb de nomes)' };
  if (fx.corpo.length < 50) return { erro: `inventário de funções implausível: só ${fx.corpo.length}` };
  const funcoes = new Set(fx.corpo.map((s) => String(s).toLowerCase()));
  return { tabelas, funcoes };
}

// `--listar` mostra o que o extrator VÊ, sem tocar no banco. Serve para depurar a própria
// trava (foi assim que o falso-positivo dos buckets de Storage apareceu) e para conferir a
// cobertura sem precisar de credencial.
if (process.argv.includes('--listar')) {
  const refs = coletarReferencias();
  const tabs = [...new Set(refs.map((r) => r.tabela))].sort();
  const par = (f) => [...new Set(refs.filter(f).map((r) => `${r.tabela}.${r.coluna}`))].sort();
  const datas = par((r) => r.coluna && !r.deSelect);
  const sels = par((r) => r.deSelect);
  console.log(`${tabs.length} tabelas referenciadas:\n  ${tabs.join(', ')}\n`);
  console.log(`${datas.length} pares tabela.coluna-de-data:\n  ${datas.join('\n  ')}\n`);
  console.log(`${sels.length} pares tabela.coluna pedidos em .select():\n  ${sels.join('\n  ')}`);
  process.exit(0);
}

const inv = await inventario();
if (inv.erro) {
  console.error(`\n⚠️  NÃO VERIFICADO — ${inv.erro}`);
  console.error('   Isto NÃO é aprovação: é ausência de medição. A trava existe justamente');
  console.error('   para que "não consegui checar" nunca passe por "está tudo certo".\n');
  process.exit(2);
}

// --- FORMA #7b: função no banco sem migração. Deriva = banco − migrações. ---
const migFuncs = funcsDeMigracoes();
const driftFuncs = [...inv.funcoes].filter((f) => !migFuncs.has(f)).sort();

if (process.argv.includes('--atualizar-funcoes')) {
  writeFileSync(BASELINE_FUNCS, JSON.stringify(driftFuncs, null, 2) + '\n');
  console.log(`Linha de base de funções regravada: ${driftFuncs.length} função(ões) no banco sem migração.`);
  process.exit(0);
}

const baseFuncs = existsSync(BASELINE_FUNCS) ? JSON.parse(readFileSync(BASELINE_FUNCS, 'utf8')) : [];
const baseSet = new Set(baseFuncs);
const funcsNovasSemMigracao = driftFuncs.filter((f) => !baseSet.has(f)); // deriva NOVA

const refs = coletarReferencias();
const problemas = [];
for (const r of refs) {
  const cols = inv.tabelas.get(r.tabela);
  if (!cols) {
    if (!r.coluna) problemas.push({ ...r, tipo: 'TABELA/VIEW não existe no banco', sugestao: null });
    continue; // coluna de tabela inexistente: a tabela já foi reportada
  }
  if (r.coluna && !cols.has(r.coluna)) {
    // Para coluna de data, o útil é ver as datas que a tabela TEM (é `criado_em` × `created_at`
    // que se procura). Para coluna de `.select()`, o útil é o vizinho parecido — foi
    // `whatsapp` onde havia `telefone`.
    const sugestao = r.deSelect
      ? ([...cols].filter((c) => c.includes(r.coluna) || r.coluna.includes(c) || c.slice(0, 4) === r.coluna.slice(0, 4)).sort().join(', ')
         || `${cols.size} colunas nessa tabela — confira o nome no schema`)
      : ([...cols].filter((c) => COLUNA_DATA.test(c)).sort().join(', ') || '(nenhuma coluna de data)');
    problemas.push({ ...r, tipo: 'COLUNA não existe nessa tabela', sugestao });
  }
}

// --- FORMA #7: RPC chamada no código que não existe no banco. ---
const rpcs = coletarRpcs();
for (const r of rpcs) {
  if (inv.funcoes.has(r.nome)) continue;
  // Vizinhos parecidos ajudam a flagrar typo/renome (foi `vincular_indicacao_compra` onde havia
  // `vincular_indicacao`/`comprar_produto_iniciar`).
  const sug = [...inv.funcoes].filter((f) => f.includes(r.nome) || r.nome.includes(f) || f.slice(0, 5) === r.nome.slice(0, 5)).sort().slice(0, 5).join(', ');
  problemas.push({ arquivo: r.arquivo, linha: r.linha, tipo: 'FUNÇÃO/RPC não existe no banco', tabela: r.nome, coluna: null, sugestao: sug || null, ehRpc: true });
}

const nTab = new Set(refs.map((r) => r.tabela)).size;
const nCol = refs.filter((r) => r.coluna && !r.deSelect).length;
const nSel = refs.filter((r) => r.deSelect).length;

if (!problemas.length && !funcsNovasSemMigracao.length) {
  console.log(`✓ Código e banco batem. (${nTab} tabelas, ${nCol} usos de coluna de data, ${nSel} colunas de .select(), ${rpcs.length} RPCs e ${inv.funcoes.size} funções conferidas contra o banco real; ${driftFuncs.length} funções sem migração na linha de base.)`);
  process.exit(0);
}

// Deriva #7b nova (função no banco sem migração e fora da base) reprova por si só.
if (funcsNovasSemMigracao.length) {
  console.error('\n✗ FUNÇÃO NO BANCO SEM MIGRAÇÃO (forma #7b) — recriar o banco a partir do repo a perderia.\n');
  console.error('  Alguém criou/alterou uma função direto no SQL Editor e o `create function` não');
  console.error('  entrou em supabase/migrations/. `admin_metricas_negocio` já divergiu assim (a chave');
  console.error('  `pct_dom_venda` só existia em produção) e imprimiu "0% venda" com cara de resposta.\n');
  for (const f of funcsNovasSemMigracao) console.error(`    ${f}()  — sem create function em nenhuma migração`);
  console.error('\n  Escreva o `.sql` da função em supabase/migrations/ (no MESMO commit da mudança).');
  console.error('  Se for deliberadamente aceita como dívida: node scripts/verificar-schema-codigo.mjs --atualizar-funcoes\n');
  if (!problemas.length) process.exit(1);
}

if (!problemas.length) process.exit(0);

console.error('\n✗ DERIVA ENTRE CÓDIGO E BANCO — é a família de 12/08 tentando voltar.\n');
console.error('  Lembre do efeito real: não dá tela de erro. O PostgREST devolve 400, o');
console.error('  `{ data }` sem `error` vira lista vazia, e a tela mente com cara de certa.\n');
for (const p of problemas) {
  console.error(`  ${p.arquivo}:${p.linha}`);
  console.error(`    ${p.tipo} → ${p.tabela}${p.coluna ? '.' + p.coluna : ''}${p.ehRpc ? '()' : ''}${p.deSelect ? '   (pedida no .select)' : ''}`);
  if (p.sugestao) {
    const rotulo = p.ehRpc ? 'funções parecidas que existem' : p.deSelect ? 'nomes parecidos que existem' : 'colunas de data que existem nessa tabela';
    console.error(`    ${rotulo}: ${p.sugestao}`);
  }
  console.error('');
}
console.error('O que fazer, em ordem:');
console.error('  1. Se falta MIGRAÇÃO: aplique-a. Escrever o .sql no repo não cria nada no banco');
console.error('     — foi exatamente assim que `onr_protocolos` ficou 2 dias no ar sem existir.');
console.error('  2. Se o nome está errado no código: corrija (confira a coluna de data no schema;');
console.error('     as tabelas antigas usam `criado_em`, as novas `created_at`).');
console.error('  3. Se a referência é intencional e não-verificável, marque com  // schema-ok: <motivo>\n');
process.exit(1);
