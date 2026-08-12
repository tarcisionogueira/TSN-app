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
    id: 'proporcao-em-elemento-substituido',
    titulo: 'aspectRatio no próprio <img>/<video> — o Safari usa a proporção do ARQUIVO',
    // Em elemento SUBSTITUÍDO (img, video, iframe com conteúdo próprio) com `height` automático,
    // o WebKit resolve a altura pela proporção NATURAL do arquivo e ignora a declarada. A caixa
    // fica com a altura certa e a mídia preenche só uma faixa — o resto vira fundo. Aconteceu
    // em 11/08 com a capa do curso (o dono viu no iPhone: "a imagem da capa está cortada") e a
    // mesma construção estava na foto de DOCUMENTO do KYC, que a equipe confere para liberar
    // saque. O certo é a proporção no CONTAINER e a mídia em width/height 100% + object-fit —
    // padrão que esta base já usava em EbookCapa.
    // O SINAL É `aspectRatio` E `objectFit` NO MESMO style. `object-fit` só tem efeito em
    // elemento substituído; um container <div> nunca o usa. Então os dois juntos significam,
    // necessariamente, que a proporção foi declarada NA MÍDIA — que é o defeito. No padrão
    // correto eles ficam separados: `aspectRatio` no container, `objectFit` na mídia.
    // (Regra de linha basta: os dois estão sempre no mesmo objeto de estilo.)
    testar: (linha) => /aspectRatio\s*:/.test(linha) && /objectFit\s*:/.test(linha),
  },
  {
    id: 'json-inline-sem-resposta',
    titulo: 'await (await f()).json() — impossível checar .ok antes de usar o corpo',
    testar: (linha) => /await\s*\(\s*await\s+[^)]*\)\s*\)?\s*\.json\(\)/.test(linha),
  },
  {
    id: 'mutacao-sem-binding',
    titulo: 'update/insert/upsert cujo resultado é DESCARTADO — falha vira sucesso silencioso',
    // Irmã do `data-sem-error`, mas pior: ali pelo menos `data` é lido. Aqui o statement começa
    // em `await supabase.from(...)` e não vincula NADA, então é estruturalmente impossível
    // saber se a escrita passou.
    //
    // O caso de 12/08 mostra por que isto é grave e não estético. Em `Admin.jsx`, o
    // `salvarENotificar` fazia `await supabase.from('solicitacoes').update({...})` sem binding.
    // As colunas `reuniao_em`/`reuniao_duracao_min` não existiam: 400, nada gravado — nem
    // checklist, nem notas, nem link, nem status. E o código SEGUIA, criava a sala no Daily.co
    // e mandava ao cliente um e-mail dizendo que a reunião estava marcada. O sistema afirmou
    // ao cliente, por escrito, algo que não era verdade.
    //
    // A regra é de LINHA porque a cadeia começa sempre na mesma: `await supabase.from(`.
    // Leitura best-effort que deliberadamente ignora o resultado → marque com // padrao-ok:.
    testar: (linha) => /^\s*await\s+(supabase|sb)\s*\.\s*from\s*\(/.test(linha)
      && /\.\s*(update|insert|upsert)\s*\(/.test(linha),
  },
];

// Regras de WORKFLOW (.github/workflows/*.yml): o defeito mora no YAML, não no JS.
const REGRAS_WORKFLOW = [
  {
    id: 'notify-sem-cancelled',
    titulo: 'Passo de notificação com `if: failure()` sem `cancelled()` — timeout não avisa',
    // `timeout-minutes` estourado NÃO é `failure()` para o GitHub: o job termina `cancelled`,
    // e todo passo condicionado a `failure()` fica SKIPPED. Medido em 12/08: o scraper
    // Puppeteer diário vinha sendo cortado aos 90 min havia TRÊS DIAS, levando junto as fontes
    // do fim da lista (SUPORTE, GRUPOLANCE, WEBLEILOES ficaram sem coletar desde 09/08) — e
    // ninguém foi avisado, porque o único passo de alerta do workflow nunca chegava a rodar.
    // Dos 56 workflows, os 3 que tinham notificação tinham os 3 o mesmo defeito.
    testar: (texto) => /if:\s*failure\(\)\s*$/m.test(texto) && /notify|Notify/.test(texto),
  },
];

// Regras de ARQUIVO: o defeito não está numa linha, está na AUSÊNCIA de algo no arquivo inteiro.
const REGRAS_ARQUIVO = [
  {
    id: 'signup-sem-guard-duplicado',
    titulo: 'signUp() sem o guard de e-mail já cadastrado (identities: [])',
    // Com "Confirm email" ligado, o Supabase protege contra enumeração: e-mail JÁ cadastrado
    // devolve 200, um usuário fantasma com `identities: []` e `confirmation_sent_at` preenchido
    // — e NÃO manda e-mail. Quem checa só o `signUpError` conclui "conta criada" e manda a
    // pessoa esperar um e-mail que nunca chega, com uma senha que não abre nada. Três fluxos
    // desta base tinham o guard e um não tinha (ConviteEquipe, 10/08); a Promo tinha o mesmo
    // defeito por outro caminho. É a ausência que se detecta, não uma linha.
    testar: (texto) => /\.auth\.signUp\s*\(/.test(texto) && !/identities/.test(texto),
  },
  {
    id: 'coletor-sem-registrar-saude',
    titulo: 'Coletor que grava no acervo sem chamar registrarSaude — nasce cego ao monitor',
    // A fonte que não escreve em `fonte_saude` não ganha piso aprendido, logo o alerta de
    // regressão NUNCA dispara para ela: se quebrar, o acervo encolhe em silêncio. Medido em
    // 11/08: RJLEILOES era a ÚNICA fonte com lote ativo e zero histórico de saúde — porque
    // `registrarSaude` só era chamado no caminho de sucesso e a coleta nunca teve sucesso.
    testar: (texto, rel) => /^scripts\/scraper-/.test(rel)
      && /from\s*\(\s*['"]imoveis_leilao['"]\s*\)|\.from\(['"]imoveis_leilao['"]\)/.test(texto)
      && !/registrarSaude/.test(texto),
  },
  {
    id: 'brightdata-null-em-coletor',
    titulo: 'Coletor usando fetchViaBrightData (devolve null) em vez de buscarViaBrightData (lança)',
    // `null` do fetchViaBrightData significa QUATRO coisas: não configurado, teto semanal,
    // sub-cota e erro de rede. Num laço de páginas isso vira "fim das páginas" e a coleta sai
    // com exit 0 dizendo que a fonte está vazia. Foi o que congelou o RJ por 12 dias com o
    // teto do Bright Data saturado — e nada, em lugar nenhum, ficou vermelho. Em COLETA use
    // `buscarViaBrightData`, que lança com o motivo; `null` é aceitável só em fallback
    // (tento o pago, não deu, sigo pelo grátis) — e aí marque com // padrao-ok:.
    // Só o IMPORT conta — citar o nome num comentário (como o histórico logo acima) não é uso.
    testar: (texto, rel) => /^scripts\/scraper-/.test(rel)
      && /^\s*import[\s\S]{0,200}?\bfetchViaBrightData\b[\s\S]{0,200}?from\s*['"]/m.test(texto),
  },
  {
    id: 'mesma-janela-em-tabelas-diferentes',
    titulo: 'O MESMO .limit() aplicado a tabelas diferentes no mesmo Promise.all',
    // Repetir a MESMA janela em várias tabelas significa que elas são, para quem escreveu, UM
    // conjunto só — e é aí que truncar cada uma por conta própria quebra: os cortes caem em
    // datas diferentes e o cruzamento sai pela metade, sem erro nenhum.
    //
    // Foi o defeito de 12/08. `AnalisesContext` lia analises_mercado/documental/laudo com
    // `.limit(MAX)` cada uma, ordenadas pelo próprio `updated_at`. Com 51 mercadológicos e 19
    // documentais, um imóvel com documental recente e mercadológico antigo aparecia na lista
    // do cliente SEM o relatório de mercado — que estava no banco o tempo todo. E abrir a
    // análise mostrava "não gerado", com um clique em Gerar reprocessando IA à toa.
    //
    // Não confundir com duas listas independentes que só por acaso viajam juntas (extrato +
    // concessões em Creditos.jsx, disponibilidades + slots no Admin): ali cada `.limit()` tem
    // seu próprio valor, e é por isso que a regra exige o MESMO literal repetido. Quando a
    // repetição for intencional (cache de menu, por exemplo), marque com // padrao-ok: <motivo>.
    testar: (texto) => {
      const bloco = (t, i) => {
        let d = 0;
        for (let k = i; k < t.length && k < i + 6000; k++) {
          if (t[k] === '[') d++;
          else if (t[k] === ']' && --d === 0) return t.slice(i, k + 1);
        }
        return t.slice(i, i + 2000);
      };
      const re = /Promise\.all\s*\(\s*\[/g;
      let m;
      while ((m = re.exec(texto))) {
        const jan = bloco(texto, texto.indexOf('[', m.index));
        const tabelas = new Set([...jan.matchAll(/\.from\s*\(\s*['"]([a-z_]+)['"]/g)].map((x) => x[1]));
        const limites = [...jan.matchAll(/\.limit\s*\(\s*([A-Za-z0-9_]+)\s*\)/g)].map((x) => x[1]);
        const repetido = limites.some((v, i) => limites.indexOf(v) !== i);
        if (tabelas.size >= 2 && repetido) return true;
      }
      return false;
    },
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

  // Workflows primeiro: são YAML, não passam pelas regras de JS.
  const dirWf = join(RAIZ, '.github', 'workflows');
  if (existsSync(dirWf)) {
    for (const nome of readdirSync(dirWf)) {
      if (!/\.ya?ml$/.test(nome)) continue;
      const rel = `.github/workflows/${nome}`;
      const texto = readFileSync(join(dirWf, nome), 'utf8');
      if (/#\s*padrao-ok:\s*\S/.test(texto)) continue; // exceção declarada (comentário YAML)
      for (const r of REGRAS_WORKFLOW) {
        if (!r.testar(texto, rel)) continue;
        porArquivo[rel] ||= {};
        (porArquivo[rel][r.id] ||= []).push(0);
      }
    }
  }

  for (const dir of DIRS) {
    for (const rel of arquivos(dir)) {
      const texto = readFileSync(join(RAIZ, rel), 'utf8');
      for (const r of REGRAS_ARQUIVO) {
        // O caminho relativo entra na regra: algumas só fazem sentido para uma família de
        // arquivos (um coletor precisa de registrarSaude; uma tela React, não).
        if (!r.testar(texto, rel.replace(/\\/g, '/'))) continue;
        if (/\/\/\s*padrao-ok:\s*\S/.test(texto)) continue; // exceção declarada em qualquer ponto do arquivo
        porArquivo[rel] ||= {};
        (porArquivo[rel][r.id] ||= []).push(0); // regra de arquivo: linha 0 = "o arquivo inteiro"
      }
      const linhas = texto.split('\n');
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
  const regra = REGRAS.find((r) => r.id === p.id) || REGRAS_ARQUIVO.find((r) => r.id === p.id)
    || REGRAS_WORKFLOW.find((r) => r.id === p.id);
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
