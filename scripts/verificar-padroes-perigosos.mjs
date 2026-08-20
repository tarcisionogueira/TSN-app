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
    id: 'medida-ausente-virando-zero',
    titulo: 'fmt(x || 0) num número exibido — "não medi" vira "vale zero" na tela do cliente',
    // ACHADO DO DONO EM 15/08, no relatório de Morada dos Pinheiros: o resumo mostrava
    // "Aluguel médio R$ 0,00/mês" e "Rentabilidade 0,00% a.a." e, duas seções abaixo, o
    // Índice BidPro da MESMA cidade exibia R$ 37,25/m²/mês com 20 amostras. Dois quadros do
    // mesmo relatório dizendo coisas opostas.
    //
    // A construção é sempre esta: a busca não achou locação, `aluguelMedio` chega `0`/`null`
    // — que significa "não medi" — e o `|| 0` o transforma num NÚMERO que a tela imprime
    // como resultado. Em rentabilidade vira conclusão de investimento ("este imóvel não
    // rende"), a pior classe de erro que um relatório pode cometer. Use `moedaOuTraco` /
    // `pctOuTraco` de utils/calculos: devolvem `—` quando não há medida.
    //
    // Só acusa em arquivo de TELA/PDF (o defeito é de apresentação) e só quando o valor
    // formatado é DIRETAMENTE `algumaCoisa || 0`. Duas formas que NÃO são o defeito e
    // seriam falso-positivo — a segunda estava no próprio arquivo quando a regra nasceu:
    //   `x > 0 ? fmt(x) : '—'`                      → já trata a ausência, é o jeito certo;
    //   `fmtPct((1 - (a||0)/b) * 100)`              → o `||0` é neutro DENTRO de uma conta,
    //                                                 e a guarda está no `b > 0` externo.
    // `fmt(?:Pct)?\(` e NÃO `fmtPct?\(`: neste o `?` vale só para o `t`, então o padrão
    // casava "fmtPc(" e "fmtPct(" — e deixava passar justamente `fmt(`, que é a metade mais
    // comum dos casos. Peguei isso testando a regra contra as duas formas antes de subir.
    // ESCOPO: o que o CLIENTE recebe como laudo — a tela de análise, a página do imóvel e os
    // PDFs. Fora ficam painéis de gestão (Admin, financeiro): ali "R$ 0,00 recebido" e
    // "saldo R$ 0,00" são medidas de verdade, e cobrar traço deles seria ruído — a regra
    // acusaria 7 linhas legítimas do Admin logo na estreia.
    testar: (linha, rel) => /^src\/(pages\/(Analise|ImovelDetalhe)\.jsx|components\/\w*PDF\.jsx)$/.test(rel || '')
      && /fmt(?:Pct)?\(\s*[A-Za-z_$][\w$.?[\]'"]*\s*\|\|\s*0\s*[,)]/.test(linha),
  },
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
    id: 'cota-por-user-id-cru',
    titulo: 'Cota de relatórios lida por user.id cru — no modo suporte mostra a cota do ADMIN',
    // A cota TEM de ser a de QUEM se está vendo (`effectiveUserId`), não a do admin logado.
    // Bug de 20/08 (Analise.jsx + ImovelDetalhe.jsx): ao ver a conta de um cliente pelo modo
    // suporte, `lerCota*(supabase, user.id)` / `minhas_cotas({p_user_id: user.id})` devolvia a
    // cota do ADMIN → contador "0/0" e o botão de gerar/atualizar TRAVADO (bloqueado(0/0)=true).
    // O certo é `effectiveUserId` (impersonado no suporte, senão o próprio usuário — fallback
    // user.id). Marque `// padrao-ok:` só se comprovadamente NÃO houver caminho de suporte.
    testar: (linha, rel) => /^src\/.*\.jsx$/.test(rel || '')
      && (/(lerCotas|lerCotaMercado)\s*\(\s*supabase\s*,\s*user\??\.id\b/.test(linha)
        || /minhas_cotas['"]\s*,\s*\{\s*p_user_id\s*:\s*user\??\.id\b/.test(linha)),
  },
  {
    id: 'user-id-cru-em-dado-de-cliente',
    titulo: 'user.id cru em acesso a dado de cliente (tela) — sob modo suporte grava/lê como ADMIN',
    // Classe #27 da auditoria de 20/08 (a de MAIOR risco: dinheiro + identidade). No modo
    // suporte o admin VÊ a conta de um cliente; ler/gravar dado do cliente por `user.id` cru
    // pega o ADMIN. Foi o bug do contador 0/0 (cota) e a raiz de arremate/procuração/rateio
    // nascendo atribuídos ao admin. O certo é `effectiveUserId` (impersonado no suporte, senão
    // o próprio usuário — fallback user.id). Linha de base aceita os legados (dívida
    // conhecida); ocorrência NOVA tem de DECIDIR. Marque `// padrao-ok:` só quando for
    // comprovadamente ação do PRÓPRIO usuário logado que deve ser do admin mesmo no suporte
    // (auth/sessão, aceite de termo, mensagem de suporte assinada por quem responde).
    testar: (linha, rel) => /^src\/(pages|components)\/.*\.jsx$/.test(rel || '')
      && (/(user_id|cliente_id|indicado_por|p_user_id)\s*:\s*user\??\.id\b/.test(linha)
        || /\.eq\(\s*['"](user_id|cliente_id|indicado_por)['"]\s*,\s*user\??\.id\b/.test(linha)),
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
    id: 'json-2linhas-sem-ok',
    titulo: 'await X.json() com X de fetch/sb sem checar X.ok — erro do fornecedor vira conteúdo (relatório vazio)',
    // GAP #3 (classe 3): a forma de DUAS LINHAS do `json-inline-sem-resposta`. Ali a resposta nem
    // era vinculada; aqui ELA É (`const r = await sb(...)`), mas ninguém checa `r.ok`/`r.status`
    // antes de consumir o corpo. E o corpo do ERRO não é vazio: o PostgREST devolve `{code,message}`
    // (400 de coluna/tabela errada, timeout, 5xx), o Overpass devolve `remark` num 200, o Anthropic
    // devolve `{type:'error'}`. `r.json()` funde "falhou" com "resposta" — foi a causa-raiz do
    // "relatório vazio" que o Marcelo viu, e a forma que a trava inline não pegava.
    //
    // DETECÇÃO por ocorrência: `await X.json(` cujo X foi ligado por `const/let X = await
    // fetch|sb|sbGet|sbFetch|anthropicFetch|iaGeminiPrimary|geminiFetch(` até 40 linhas acima, SEM
    // `X.ok`/`.status`/`.statusText` em nenhum ponto da janela [ligação .. json+10].
    //
    // O IDIOMA CERTO NÃO É ACUSADO: ler o corpo e logo em seguida `if (!X.ok) throw` (para extrair a
    // mensagem de erro do JSON antes de lançar) põe o `.ok` DENTRO da janela para frente — mp.js,
    // _gcal.js, asaas.js, Arrematados saíram todos por isso. Sem esse recorte a trava acusaria 46
    // leituras corretas. Leitura DELIBERADAMENTE best-effort (CEP/geocode que o usuário refaz):
    // marque `// padrao-ok: <motivo>` na linha do `.json()` ou logo acima.
    testar: (linha, rel, _texto, i, linhas) => {
      if (!Array.isArray(linhas)) return false; // só roda no laço por-linha (que passa o contexto)
      if (!/^(api|src|scripts)\/.*\.(js|jsx|mjs)$/.test(rel || '')) return false;
      const mj = linha.match(/\bawait\s+(\w+)\s*\.\s*json\s*\(/);
      if (!mj) return false;
      const v = mj[1];
      if (v === 'req' || v === 'request') return false; // o corpo da REQUISIÇÃO, não uma resposta de fetch
      const bind = new RegExp(`\\b(?:const|let)\\s+${v}\\s*=\\s*await\\s+(?:fetch|sb|sbGet|sbFetch|anthropicFetch|iaGeminiPrimary|geminiFetch)\\s*\\(`);
      const okRe = new RegExp(`\\b${v}\\s*\\??\\.\\s*(?:ok|status|statusText)\\b`); // aceita X?.ok
      let b = -1;
      for (let k = i; k >= Math.max(0, i - 40); k--) { if (bind.test(linhas[k])) { b = k; break; } }
      if (b < 0) return false; // sem ligação fetchish → não é uma resposta HTTP (ex.: cache.json())
      for (let k = b; k <= Math.min(linhas.length - 1, i + 10); k++) { if (okRe.test(linhas[k])) return false; }
      return true;
    },
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
    id: 'flash-de-vazio-no-carregamento',
    titulo: 'Lista nasce [] e já anuncia "nenhum" — a tela afirma o vazio antes de saber',
    // A MESMA família do resto deste arquivo, mas no TEMPO em vez de no dado: `useState([])`
    // diz "vazio CONFIRMADO", quando a verdade na primeira pintura é "ainda não sei". A tela
    // afirma "Nenhuma movimentação", "Sem mensagens", e um instante depois se corrige sozinha.
    // Foi o "pisca" que o dono relatou em 13/08 ("carregamentos rápidos que mostram uma coisa
    // e num instante muda"). `null` é o estado honesto de "não sei ainda"; `[]` é uma resposta.
    //
    // NÃO acusa (medido: sem estas exceções a regra dava 17 falsos positivos para 4 reais):
    //  - tela com early return de carregamento (`if (loading) return …`), que cobre tudo;
    //  - mensagem de vazio já dentro de uma cadeia guardada por carregando/loading.
    testar: (texto, rel) => {
      if (!/^src\/.*\.jsx$/.test(rel)) return false;
      if (/if\s*\(\s*!?\s*(carregando|loading)\w*\b[^)]*\)\s*return/i.test(texto)) return false;
      const vars = [...texto.matchAll(/const\s*\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*(?:React\.)?useState\(\[\]\)/g)].map(m => m[1]);
      for (const v of vars) {
        const re = new RegExp(`${v}\\.length\\s*===\\s*0\\s*(\\?|&&)([\\s\\S]{0,260})`, 'g');
        let m;
        while ((m = re.exec(texto))) {
          if (!/Nenhum|nenhuma|Sem |não encontrad|vazi/i.test(m[2])) continue;
          const antes = texto.slice(Math.max(0, m.index - 900), m.index);
          if (/carregando|loading|buscando|carregad/i.test(antes + m[2])) continue;
          return true;
        }
      }
      return false;
    },
  },
  {
    id: 'flex-rotulo-fixo-sem-quebra',
    titulo: 'Linha flex com rótulo de largura fixa e SEM flexWrap — estoura no celular',
    // Rótulo com `minWidth` de 80 a 190 px ao lado de um valor, numa linha que não quebra.
    // Num telefone sobram ~330 px úteis: rótulo de 190 mais um valor longo não cabem, e o
    // excesso empurra a PÁGINA inteira para a rolagem horizontal. Foi por isso que o dono
    // precisou dar zoom out na tela de imóvel (13/08). LINHA DE BASE ZERO: as 5 ocorrências
    // que existiam foram corrigidas, então qualquer nova reprova.
    testar: (texto, rel) => {
      if (!/^src\/.*\.jsx$/.test(rel)) return false;
      const re = /display:\s*'flex'((?:(?!\}\}).){0,220})\}\}>\s*[\r\n]+\s*<[a-zA-Z][^>]{0,200}?minWidth:\s*(\d+)/gs;
      let m;
      while ((m = re.exec(texto))) {
        if (/flexWrap/.test(m[1])) continue;
        if (Number(m[2]) >= 80) return true;
      }
      return false;
    },
  },
  {
    id: 'flex-2col-sem-minwidth0',
    titulo: 'Flex de 2 colunas sem minWidth:0 no filho — conteúdo longo vaza pela lateral',
    // Num flex o padrão é `min-width: auto`: a coluna se RECUSA a encolher abaixo da largura
    // do próprio conteúdo. Com um e-mail longo ela empurra a coluna vizinha para fora do card
    // — foi assim que os selos "Investidor Pro"/"Explorador" saíram da tela na lista do
    // Cliente 360 (13/08). Entra COM linha de base (33 arquivos históricos), porque a maioria
    // tem conteúdo curto e nunca vaza; o que a trava impede é a construção NOVA.
    testar: (texto, rel) => {
      if (!/^src\/.*\.jsx$/.test(rel)) return false;
      const re = /display:\s*'flex'((?:(?!\}\}).){0,200}?)justifyContent:\s*'space-between'((?:(?!\}\}).){0,200})\}\}>\s*[\r\n]+\s*<div(\s+style=\{\{((?:(?!\}\}).){0,200})\}\})?\s*>/gs;
      let m;
      while ((m = re.exec(texto))) {
        const filho = m[4] || '';
        if (/minWidth/.test(filho) || /flex:/.test(filho)) continue;
        return true;
      }
      return false;
    },
  },
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
    id: 'cobranca-sem-estorno',
    titulo: 'Endpoint cobra cota ADIANTADA (consumir_*_por) sem NENHUM caminho de estorno — a falha cobra o cliente',
    // GAP #2 (20/08). A cobrança ADIANTADA de cota — `consumir_analise_por`/`consumir_documental_por`,
    // chamada ANTES de saber se o relatório vai sair — obriga a devolver a cota em TODO caminho de
    // falha: mercado vazio, parecer vazio, timeout, faltam documentos. Cada nova rota que cobra
    // assim é uma chance de esquecer o estorno em UM desses caminhos, e o cliente fica sem o
    // relatório E sem a cota. Foi a raiz dos consertos de 19/08 (gerar-analise: estorno em
    // `mercadoVazio || semParecer`; gerar-documental: 4 caminhos de falha). A regra exige que TODO
    // arquivo que cobra adiantado tenha PELO MENOS uma referência a `estornar_*_por` — sem ela é
    // estruturalmente impossível a cota voltar quando a geração falha.
    //
    // O ÍNDICE está FORA de propósito: `consumir_indice_por` roda só DEPOIS de o resultado existir
    // (cobra-no-sucesso), então não tem o que estornar — é o padrão À PROVA de vazamento, e por
    // isso é filtrado aqui em vez de precisar de `// padrao-ok:`. PREFIRA esse padrão ao criar
    // cobrança nova: cobrar só no sucesso elimina a classe inteira, em vez de depender de lembrar
    // do estorno em cada saída de erro. `debitar_credito` também não entra: nesta base ele é
    // sempre cobrado no sucesso (gerar-analise/indice-mercado), não adiantado.
    // Base ZERO: os quatro arquivos que cobram hoje passam (os dois adiantados têm estorno; os
    // dois de índice cobram no sucesso). Ocorrência nova reprova.
    testar: (texto, rel) => {
      if (!/^api\/.*\.js$/.test(rel)) return false;
      const adiantadas = [...texto.matchAll(/\bconsumir_(\w+)_por\b/g)]
        .map((m) => m[1]).filter((tipo) => tipo !== 'indice');
      if (!adiantadas.length) return false;
      return !/\bestornar_\w+_por\b/.test(texto);
    },
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
    id: 'sweep-apoiado-no-coletado',
    titulo: 'Sweep que desativa acervo apoiado no COLETADO em vez do GRAVADO',
    // Desativar "tudo que não foi tocado nesta rodada" só é verdade se a rodada REALMENTE
    // gravou. Com o gate no número de linhas BAIXADAS, uma rodada que baixa 500 e falha em
    // todos os upserts ainda entra no sweep — e aposenta o acervo inteiro da fonte, porque
    // nada tem `atualizado_em` novo. É a confusão entre lido e gravado que deixou o CEF/RJ 12
    // dias parado, aqui com uma ação DESTRUTIVA pendurada.
    //
    // Achado em 18/08 em DOIS lugares: `api/scraper-leiloeiros.js` (sold, superbid, mega, mgl,
    // ccj, biasi, destak, ljud) e `scripts/scraper-puppeteer.mjs`, que ainda tinha o bloco do
    // MEGA reimplementando a função inteira — e por isso ficou para trás do conserto anterior.
    //
    // A regra: no arquivo que faz UPDATE ativo=false + filtro por `atualizado_em`, o gate tem
    // de citar o contador de GRAVADOS (salvos/upsert/gravad). Se o seu contador tem outro
    // nome, marque com // padrao-ok: <motivo>.
    //
    // A checagem é por JANELA, não por arquivo: testar o arquivo inteiro faz qualquer
    // `console.log('… imóveis salvos')` desarmar a regra. Foi assim na primeira versão desta
    // trava, que passou verde nas DUAS versões defeituosas — um guarda que não guarda é pior
    // que nenhum, porque dá a impressão de cobertura.
    testar: (texto, rel) => {
      if (!/^(scripts|api)\//.test(rel)) return false;
      // Sweep DE RODADA: `atualizado_em` comparado ao instante em que a coleta começou.
      // Sweep por IDADE (ex.: "sem atualizar há 90 dias") NÃO entra — ali o gate por gravados
      // não faria sentido, e incluí-lo só produziria alarme falso.
      const sweeps = [...texto.matchAll(/\.lt\(\s*['"]atualizado_em['"]\s*,\s*(\w+)|atualizado_em=lt\.\$\{(\w+)\}/g)];
      return sweeps.some(m => {
        const varAlvo = m[1] || m[2] || '';
        if (!/^(runStart|inicio|start|inicioRodada|t0)$/i.test(varAlvo)) return false;
        const antes = texto.slice(Math.max(0, m.index - 900), m.index);
        if (!/ativo:\s*false|ativo=eq\.true/.test(texto.slice(Math.max(0, m.index - 900), m.index + 400))) return false;
        // A CONDIÇÃO que libera o sweep é o último `if (...)` antes dele. Testar a JANELA
        // inteira não serve: na primeira versão desta trava, um `console.log('… imóveis
        // salvos')` a dez linhas de distância desarmava a regra, e ela passou verde nas DUAS
        // versões defeituosas. Um guarda que não guarda é pior que nenhum — dá impressão de
        // cobertura. Esta versão foi conferida contra o código ANTES e DEPOIS do conserto.
        const ifs = [...antes.matchAll(/if\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g)];
        const cond = ifs.length ? ifs[ifs.length - 1][1] : '';
        return !/\b(salvos|gravouTudo|gravados|up)\b/.test(cond);
      });
    },
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
          // O caminho relativo entra na regra (como já acontece em REGRAS_ARQUIVO): algumas
          // só fazem sentido numa família de arquivos — `medida-ausente-virando-zero` é
          // defeito de APRESENTAÇÃO e não deve ser cobrada de código de servidor.
          // Algumas regras precisam do ARQUIVO ao redor (a ligação `const r = await fetch(`
          // mora numa linha e o `r.json()` em outra): passamos texto, o índice e as linhas.
          if (!r.testar(linha, rel.replace(/\\/g, '/'), texto, i, linhas)) continue;
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

/**
 * VERIFICAÇÃO GLOBAL — nome de variável de ambiente que não existe (15/08).
 *
 * POR QUE. A leitura da matrícula por visão foi escrita de manhã lendo
 * `process.env.CLAUDE_API_KEY`. O projeto inteiro usa `CLAUDE_KEY`. A guarda batia SEMPRE,
 * a função devolvia `null` na primeira linha e a leitura nunca rodou uma única vez em
 * produção — com a aparência exata de "o documento não tem a área", que é o defeito que
 * ela tinha sido escrita para corrigir. Nenhuma trava pegava: o código compila, passa no
 * lint, passa no build, e `process.env.QUALQUER_COISA` é `undefined` em silêncio.
 *
 * A REGRA: um nome usado em UM só arquivo cujos segmentos CONTÊM os de outro nome usado em
 * dois ou mais é quase sempre typo (`CLAUDE_API_KEY` ⊃ `CLAUDE_KEY`, 1 arquivo contra 27).
 * Três pares legítimos do acervo entram como exceção declarada — são variáveis realmente
 * distintas, não erros de digitação.
 */
const ENV_PARES_LEGITIMOS = new Set([
  'ONR_ALERT_EMAIL~ONR_EMAIL',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID~GOOGLE_ADS_CUSTOMER_ID',
  'ADMIN_ALERT_EMAIL~ADMIN_EMAIL',
]);
function envsSuspeitas() {
  // COMENTÁRIO É IGNORADO POR LINHA, não por parser de estado. A primeira tentativa usou o
  // removedor de comentários do verificador de schema e ele se PERDEU neste arquivo: as
  // regras aqui são regexes literais cheias de aspas (`['"]`), o parser entende cada aspa
  // como início de string e dessincroniza — o comentário de bloco sobrevivia inteiro e o
  // verificador acusava a própria documentação. Uma linha cujo início é `//`, `*` ou `/*`
  // é comentário; para achar `process.env.X` isso basta e não tem como se perder.
  const porNome = new Map(); // nome → Set(arquivos)
  for (const dir of DIRS) {
    for (const rel of arquivos(dir)) {
      for (const linha of readFileSync(join(RAIZ, rel), 'utf8').split('\n')) {
        if (/^\s*(\/\/|\*|\/\*)/.test(linha)) continue;
        for (const m of linha.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
          if (!porNome.has(m[1])) porNome.set(m[1], new Set());
          porNome.get(m[1]).add(rel);
        }
      }
    }
  }
  const seg = (k) => new Set(k.split('_').filter(Boolean));
  const contido = (a, b) => [...a].every((x) => b.has(x));
  const achados = [];
  const nomes = [...porNome.keys()];
  for (const a of nomes) {
    if (porNome.get(a).size !== 1) continue;
    for (const b of nomes) {
      if (a === b || ENV_PARES_LEGITIMOS.has(`${a}~${b}`)) continue;
      const sa = seg(a), sb = seg(b);
      if (sa.size <= sb.size || !contido(sb, sa)) continue;
      if (porNome.get(b).size >= 2) {
        achados.push({ suspeita: a, arquivo: [...porNome.get(a)][0], canonica: b, usos: porNome.get(b).size });
      }
    }
  }
  return achados;
}
const envRuins = envsSuspeitas();
if (envRuins.length && !atualizar) {
  console.error('\n✗ VARIÁVEL DE AMBIENTE COM NOME PROVAVELMENTE ERRADO.\n');
  console.error('  `process.env.X` inexistente é `undefined` em silêncio: a guarda que depende');
  console.error('  dela passa a barrar sempre, e a função devolve o mesmo "não consegui" de');
  console.error('  quando não há dado. Compila, passa no lint e no build. (Caso de 15/08.)\n');
  for (const e of envRuins) {
    console.error(`  ${e.arquivo}`);
    console.error(`    usa ${e.suspeita} — só aqui no repositório inteiro.`);
    console.error(`    o projeto usa ${e.canonica}, em ${e.usos} arquivos.\n`);
  }
  console.error('Se os dois nomes existem MESMO (variáveis distintas), declare o par em');
  console.error('ENV_PARES_LEGITIMOS neste script, com o motivo no comentário.\n');
  process.exit(1);
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
