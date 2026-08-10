#!/usr/bin/env node
/**
 * VERIFICADOR DE PADRÕES PERIGOSOS — a trava que impede a família de bugs de 10/08 de voltar.
 *
 * POR QUE EXISTE. A varredura de 10/08 (docs/VARREDURA_BUGS_2026-08-10.md) achou 28 bugs, e
 * seis deles eram O MESMO defeito com roupas diferentes: **resposta de erro entregue como
 * conteúdo válido**. O extrato carimbando `completo: true` sobre um 403; as proximidades
 * gravando "nenhum ponto de interesse" para meio acervo; a lixeira dizendo que apagou o que a
 * RLS não deixou apagar; o assinante rebaixado a explorador por um 500 transitório. Nenhum
 * deles apareceu em varredura de código anterior, porque todos são código que PARECE certo.
 *
 * O que eles têm em comum é ESTRUTURAL, não semântico — e por isso dá para verificar de graça,
 * sem IA, a cada push:
 *   1. `delete-sem-select`    — RLS que filtra linhas NÃO é erro. `.delete()` sem `.select()`
 *                               não tem como saber se apagou alguma coisa.
 *   2. `data-sem-error`       — o postgrest-js não lança em não-2xx: devolve `{data,error}`.
 *                               Desestruturar só `data` funde "vazio" com "falhou".
 *   3. `json-inline-sem-resposta` — `await (await f()).json()` não BINDA a resposta, então é
 *                               estruturalmente impossível checar `.ok` antes de usar o corpo.
 *
 * COMO NÃO VIRA RUÍDO. Não é um teto absoluto: é uma LINHA DE BASE por arquivo (mesma ideia do
 * BASELINE_FONTES e dos limites de `qa_invariantes`). O acervo atual de ocorrências é aceito
 * como está; o verificador só reprova quando um arquivo GANHA ocorrência nova. Assim ninguém
 * precisa parar tudo para refatorar 200 pontos históricos, e mesmo assim o padrão não cresce.
 *
 * EXCEÇÃO DELIBERADA. Muitas dessas construções são intencionais nesta base (leitura
 * best-effort que "nunca derruba o monitor"). Marque a linha — ou a de cima — com:
 *     // padrao-ok: <motivo>
 * e ela sai da contagem. O motivo é obrigatório: exceção sem justificativa é como não ter.
 *
 * USO
 *   node scripts/verificar-padroes-perigosos.mjs             → verifica (sai 1 se piorou)
 *   node scripts/verificar-padroes-perigosos.mjs --atualizar → regrava a linha de base
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE = join(RAIZ, 'scripts', 'padroes-perigosos.baseline.json');
const DIRS = ['api', 'src', 'scripts'];
const EXT = /\.(js|jsx|mjs)$/;
const IGNORAR = /node_modules|\/dist\/|\.min\./;

const REGRAS = [
  {
    id: 'delete-sem-select',
    titulo: 'DELETE sem .select() — não há como saber se a RLS deixou apagar',
    // `.delete(` seguido, na MESMA cadeia (até o fim do statement), sem `.select(`.
    testar: (linha) => /\.delete\(\s*\)/.test(linha) && !/\.select\(/.test(linha),
  },
  {
    id: 'data-sem-error',
    titulo: 'Desestrutura só `data` — falha de leitura vira "vazio"',
    testar: (linha) => /(const|let)\s*\{\s*data\s*(:\s*\w+\s*)?\}\s*=\s*await\s+(supabase|sb)\b/.test(linha),
  },
  {
    id: 'json-inline-sem-resposta',
    titulo: 'await (await f()).json() — impossível checar .ok antes de usar o corpo',
    testar: (linha) => /await\s*\(\s*await\s+[^)]*\)\s*\)?\s*\.json\(\)/.test(linha),
  },
];

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

function contar() {
  const porArquivo = {}; // arquivo → { regraId: [linhas] }
  for (const dir of DIRS) {
    for (const rel of arquivos(dir)) {
      const linhas = readFileSync(join(RAIZ, rel), 'utf8').split('\n');
      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        // Exceção deliberada: marcador na própria linha ou na linha imediatamente acima.
        const isento = /\/\/\s*padrao-ok:\s*\S/.test(linha) || /\/\/\s*padrao-ok:\s*\S/.test(linhas[i - 1] || '');
        if (isento) continue;
        for (const r of REGRAS) {
          if (!r.testar(linha)) continue;
          porArquivo[rel] ||= {};
          (porArquivo[rel][r.id] ||= []).push(i + 1);
        }
      }
    }
  }
  return porArquivo;
}

const atual = contar();
const atualizar = process.argv.includes('--atualizar');

// Baseline = contagem por arquivo/regra (não guardamos linhas: elas mudam a cada edição e
// virariam falso-positivo em qualquer refatoração inocente).
const contagens = {};
for (const [arq, regras] of Object.entries(atual)) {
  contagens[arq] = Object.fromEntries(Object.entries(regras).map(([id, ls]) => [id, ls.length]));
}

if (atualizar) {
  writeFileSync(BASELINE, JSON.stringify(contagens, null, 2) + '\n');
  const total = Object.values(contagens).reduce((s, r) => s + Object.values(r).reduce((a, b) => a + b, 0), 0);
  console.log(`Linha de base regravada: ${total} ocorrência(s) em ${Object.keys(contagens).length} arquivo(s).`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const pioras = [];
for (const [arq, regras] of Object.entries(atual)) {
  for (const [id, linhas] of Object.entries(regras)) {
    const antes = Number(base[arq]?.[id] || 0);
    if (linhas.length > antes) {
      pioras.push({ arq, id, antes, agora: linhas.length, linhas });
    }
  }
}

if (!pioras.length) {
  const total = Object.values(contagens).reduce((s, r) => s + Object.values(r).reduce((a, b) => a + b, 0), 0);
  console.log(`✓ Nenhum padrão perigoso NOVO. (${total} ocorrência(s) históricas, dentro da linha de base.)`);
  process.exit(0);
}

console.error('\n✗ PADRÃO PERIGOSO NOVO — esta é a família de bugs de 10/08 tentando voltar.\n');
for (const p of pioras) {
  const regra = REGRAS.find((r) => r.id === p.id);
  console.error(`  ${p.arq}`);
  console.error(`    ${regra.titulo}`);
  console.error(`    linha(s): ${p.linhas.join(', ')}   (base ${p.antes} → agora ${p.agora})\n`);
}
console.error('O que fazer, em ordem de preferência:');
console.error('  1. Corrigir: checar `.ok`/`error`, ou usar `.select()` para provar o que mudou.');
console.error('  2. Se a construção for DELIBERADA (leitura best-effort que nunca derruba nada),');
console.error('     marque a linha com  // padrao-ok: <motivo>  — o motivo é obrigatório.');
console.error('  3. Só em último caso, e conscientemente: node scripts/verificar-padroes-perigosos.mjs --atualizar\n');
process.exit(1);
