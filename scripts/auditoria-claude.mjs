// Auditoria técnica do sistema pelo Claude — segurança dos dados, fluxos de API e
// funcionalidades (review ESTÁTICO do código) MAIS uma camada de FUNCIONAMENTO em
// runtime (auditarFuncionamento): coleta por leiloeiro, filas e health-check em
// produção. Roda numa GitHub Action (diária + manual).
//
// COBERTURA COMPLETA: lê TODO o código (api + scripts + src), FATIANDO arquivos
// grandes em vez de truncar, para nenhuma parte (scrapers, gerar-documental, telas)
// ficar de fora — inclui automaticamente qualquer arquivo novo que criarmos. Audita
// em lotes que cabem no contexto, junta os achados de runtime e grava o relatório em
// `auditoria_sistema` (o dashboard mostra em leitura).
//
// NÃO altera código. Correções são propostas nos achados (campo `correcao`) e
// viram PR revisável quando você aprovar — nada entra em produção sozinho.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL        = process.env.AUDIT_MODEL || 'claude-sonnet-4-6';
const COMMIT_SHA   = process.env.GITHUB_SHA || null;

// Mitigações conhecidas / riscos aceitos: injetadas no prompt para o modelo NÃO
// re-classificar como crítico o que o time já revisou (webhook MP reconferido via
// API, VITE_ público, selfie fail-safe-para-revisão…). O runner faz checkout do
// repo, então o arquivo está em disco. Sem o arquivo, segue sem mitigações.
let MITIGACOES = '';
try { MITIGACOES = readFileSync('docs/SEGURANCA_MITIGACOES.md', 'utf8').slice(0, 12000); } catch { /* opcional */ }

if (!CLAUDE_KEY) { console.error('CLAUDE_KEY ausente'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Supabase ausente'); process.exit(1); }

const MAX_LOTE = 90000;       // ~22k tokens por lote (limite de contexto por chamada)
// Arquivos grandes são FATIADOS (não truncados) neste tamanho, para o código
// COMPLETO ser auditado — nada de scraper/gerar-documental cortado pela metade.
const CHUNK = Number(process.env.AUDIT_CHUNK_CHARS || 24000);
// Teto de segurança (anti-runaway). Default cobre o repositório inteiro (~4M chars);
// como a ordem prioriza segurança/back-end, um eventual corte cai só na cauda (front).
const CAP_TOTAL = Number(process.env.AUDIT_CAP_CHARS || 8_000_000);
const INCLUIR_SRC = process.env.AUDIT_INCLUIR_SRC !== '0'; // front-end entra por padrão
// Pula só DADOS puros (dicionário de municípios, catálogo de cursos) e sondas de
// debug/diagnóstico — todo o resto do código (api + scripts + src) é auditado.
const PULAR = /(_municipios\.js|.*-debug\.(js|mjs)|.*-diag\.js)$/;
const PULAR_PATH = /(^|\/)src\/data\//;
// Prioriza segurança / dinheiro / dados sensíveis / SCRAPERS / cliente de auth:
// esses entram PRIMEIRO (se o tempo apertar, o crítico já foi auditado).
const PRIORIDADE = /(_auth|AuthContext|apiCall|supabase|_webhook|_rate-limit|_email|_claude|_gemini|_uso|_geo|_onr|_cnj|_doc|mp[-_]|mp\.js|asaas|checkout|webhook|pagamento|garantia|assinar|contrato|cpf|kyc|selfie|admin|cron|token|reembolso|comiss|inbound|upload|storage|scraper|leilo|captur|enriquec|fotos?)/i;

// Fatia um arquivo grande em pedaços por LIMITE DE LINHA (nunca no meio de uma
// linha), rotulando "parte i/n" para o modelo saber que é continuação.
function fatiar(path, txt, prio) {
  if (txt.length <= CHUNK) return [{ path, txt, prio }];
  const partes = []; let buf = '';
  for (const ln of txt.split('\n')) {
    if (buf && buf.length + ln.length + 1 > CHUNK) { partes.push(buf); buf = ''; }
    buf += (buf ? '\n' : '') + ln;
  }
  if (buf) partes.push(buf);
  const n = partes.length;
  return partes.map((p, i) => ({ path: `${path} (parte ${i + 1}/${n})`, txt: p, prio }));
}

// Coleta TODO o código relevante (api + scripts + src), fatiando arquivos grandes
// para nada ser truncado. Ordena por prioridade (segurança/dinheiro/back-end antes
// do front) e só corta na cauda se estourar o teto anti-runaway (CAP_TOTAL).
function coletarArquivos() {
  const brutos = [];
  const addDir = (dir, filtro) => {
    let entradas = [];
    try { entradas = readdirSync(dir); } catch { return; }
    for (const nome of entradas) {
      const p = join(dir, nome);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { addDir(p, filtro); continue; }
      if (!filtro(nome, p)) continue;
      if (PULAR.test(nome) || PULAR_PATH.test(p)) continue;
      let txt = '';
      try { txt = readFileSync(p, 'utf8'); } catch { continue; }
      const prio = PRIORIDADE.test(nome) ? 0 : (p.startsWith('src/') ? 2 : 1);
      for (const seg of fatiar(p, txt, prio)) brutos.push(seg);
    }
  };
  addDir('api', (n) => n.endsWith('.js'));
  addDir('scripts', (n) => n.endsWith('.js') || n.endsWith('.mjs')); // scrapers/leiloeiros
  if (INCLUIR_SRC) addDir('src', (n) => n.endsWith('.js') || n.endsWith('.jsx')); // front completo
  // Prioritários primeiro; acumula até o teto anti-runaway.
  brutos.sort((a, b) => a.prio - b.prio || a.path.localeCompare(b.path));
  const out = []; let tam = 0, cortados = 0;
  for (const a of brutos) {
    if (tam + a.txt.length > CAP_TOTAL) { cortados++; continue; }
    out.push(a); tam += a.txt.length;
  }
  if (cortados) console.log(`Aviso: ${cortados} fatia(s) além do teto de ${CAP_TOTAL} chars (cauda de menor prioridade).`);
  console.log(`Cobertura: ${out.length} fatias, ${tam} chars de código auditado.`);
  return out;
}

// Agrupa arquivos em lotes que cabem no contexto.
function emLotes(arquivos) {
  const lotes = []; let atual = [], tam = 0;
  for (const a of arquivos) {
    if (tam + a.txt.length > MAX_LOTE && atual.length) { lotes.push(atual); atual = []; tam = 0; }
    atual.push(a); tam += a.txt.length;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

function parseJSON(t) {
  if (!t) return null;
  const s = t.trim();
  try { return JSON.parse(s); } catch { /* */ }
  const md = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (md) { try { return JSON.parse(md[1].trim()); } catch { /* */ } }
  const o = s.match(/\{[\s\S]*\}/); if (o) { try { return JSON.parse(o[0]); } catch { /* */ } }
  return null;
}

async function claude(system, user, maxTokens = 8000) {
  for (let tent = 0; tent < 4; tent++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * 2 ** tent)); continue; }
      const data = await r.json();
      return (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    } catch (e) { if (tent === 3) throw e; await new Promise((s) => setTimeout(s, 2000 * 2 ** tent)); }
  }
  return '';
}

const SISTEMA = `Você é um auditor sênior de engenharia e segurança da BidPro Brasil (plataforma de leilões imobiliários: React + Vite no front, funções serverless Vercel em Node/Edge, Supabase Postgres com RLS, pagamentos Asaas/Mercado Pago, e-mail Resend, IA Claude+Gemini).
Audite o CÓDIGO fornecido com foco em: (1) segurança de dados (autenticação/autorização, RLS, vazamento de segredos, injeção, verificação de webhooks, CORS, exposição de PII), (2) fluxos de API (validação de entrada, tratamento de erro, idempotência, rate-limit, timeouts), (3) funcionalidades (bugs, condições de corrida, casos de borda).
Seja concreto e conservador: só reporte o que o código realmente mostra. Priorize por severidade e risco real. Para cada achado, proponha a correção de forma acionável.

REGRAS DE CALIBRAÇÃO (aplique ANTES de atribuir severidade — o objetivo é ASSERTIVIDADE, não alarme):
1. CONTROLES COMPENSATÓRIOS: antes de reportar, verifique se OUTRO trecho do fluxo já fecha o risco. Se houver, rebaixe (ou não reporte) e cite-o em "controle_compensatorio". Ex.: um webhook sem HMAC mas que RECONFERE cada evento na API do provedor (com nosso token) NÃO é forjável — a fonte de verdade é o provedor.
2. "critica"/"alta" SÓ com CAMINHO DE EXPLORAÇÃO CONCRETO E ACIONÁVEL (quem explora, como, e o impacto direto). Sem caminho concreto → no máximo "media".
3. Separe HARDENING / defesa-em-profundidade (melhoria desejável, sem exploração concreta) de VULNERABILIDADE EXPLORÁVEL. Hardening é "baixa"/"media", nunca "critica".
4. NÃO sinalize como vulnerabilidade estes padrões INTENCIONAIS desta plataforma: (a) variáveis VITE_* são PÚBLICAS por design e a chave anon do Supabase é protegida por RLS — não é "credencial vazada"; (b) FAIL-SAFE PARA REVISÃO MANUAL: verificação automática que, ao falhar por erro técnico/falta de chave, apenas ADIA para conferência humana SEM conceder acesso/role/plano não é "bypass"; (c) RECONFERÊNCIA VIA API DO PROVEDOR (Mercado Pago/Asaas) é a fonte de verdade do pagamento.
5. Se o próprio comentário do código explica que o comportamento é intencional e descreve o controle compensatório, respeite-o (no máximo sugira hardening como "baixa").`;

function promptLote(arquivos) {
  const corpo = arquivos.map((a) => `\n===== ARQUIVO: ${a.path} =====\n${a.txt}`).join('\n');
  return `Audite os arquivos abaixo. Responda APENAS este JSON (sem markdown):
{"achados":[{"categoria":"seguranca|api|funcionalidade|dados","severidade":"critica|alta|media|baixa","area":"resumo curto","arquivo":"caminho","linha":0,"descricao":"o problema, objetivo","caminho_exploracao":"passo a passo concreto de como seria explorado (quem, como, impacto), ou vazio se não houver","controle_compensatorio":"controle existente no código que já mitiga, se houver","correcao":"como corrigir (código/passo)","tipo":"auto|manual|externo"}]}
- tipo=auto: corrigível no código deste repositório (vira PR).
- tipo=manual: exige decisão/config sua (ex.: girar um segredo, ajustar painel).
- tipo=externo: depende de serviço externo (ex.: configurar webhook no provedor).
Seja OBJETIVO: descricao e correcao curtas (1-2 frases). Só marque "critica"/"alta" com "caminho_exploracao" concreto E sem "controle_compensatorio" que já feche o risco; achados de hardening/defesa-em-profundidade sem exploração concreta → "baixa"/"media". Reporte no máximo os 10 achados MAIS RELEVANTES. Se não houver achados relevantes, retorne {"achados":[]}.${MITIGACOES ? `

MITIGAÇÕES CONHECIDAS / RISCOS ACEITOS (já revisados pelo time — se um achado for exatamente um destes padrões, NÃO reporte como crítica/alta: rebaixe para "baixa" ou omita. Não confundir com os bugs reais listados ao fim do documento, que DEVEM continuar sendo reportados):
${MITIGACOES}` : ''}
${corpo}`;
}

// CAMADA DE FUNCIONAMENTO (runtime, determinística): lê o estado de PRODUÇÃO via a
// função SQL auditoria_funcionamento() e transforma anomalias em achados — falha
// de conexão com leiloeiro (fonte sem imóveis/estagnada), filas de documentos com
// erro, health-check parado. A auditoria do Claude é estática (só código); esta
// camada é o que faltava para o relatório ser "de segurança E funcionamento".
async function auditarFuncionamento() {
  let snap = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/auditoria_funcionamento`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (r.ok) snap = await r.json();
    else console.log(`  (funcionamento: RPC ${r.status} — camada de runtime pulada)`);
  } catch (e) { console.log(`  (funcionamento: falha ao ler runtime — ${e.message})`); }
  if (!snap || typeof snap !== 'object') return [];

  const out = [];
  const add = (severidade, area, descricao, correcao) => out.push({
    categoria: 'funcionamento', severidade, area, arquivo: '(runtime/produção)', linha: 0,
    descricao, caminho_exploracao: '', controle_compensatorio: '', correcao, tipo: 'manual',
  });

  // Coleta por leiloeiro: fonte sem imóveis ou estagnada = provável queda de conexão.
  for (const f of Array.isArray(snap.fontes) ? snap.fontes : []) {
    const dias = Number(f.dias_sem_atualizar);
    if (Number(f.ativos) === 0) {
      add('alta', `Coleta ${f.fonte} — sem imóveis ativos`,
        `A fonte ${f.fonte} está com 0 imóveis ativos — provável falha de coleta/conexão com o leiloeiro.`,
        `Rodar/inspecionar o scraper da fonte ${f.fonte} (GitHub Action) e conferir se o site do leiloeiro mudou ou está bloqueando.`);
    } else if (Number.isFinite(dias) && dias > 7) {
      add('alta', `Coleta ${f.fonte} — estagnada`,
        `A fonte ${f.fonte} não recebe atualização há ${dias} dias — scraper parado ou conexão com o leiloeiro caiu.`,
        `Verificar a última execução do scraper de ${f.fonte} e a conectividade com o site do leiloeiro.`);
    } else if (Number.isFinite(dias) && dias > 3) {
      add('media', `Coleta ${f.fonte} — atraso`,
        `A fonte ${f.fonte} está há ${dias} dias sem atualizar (esperado ~diário) — acompanhar.`,
        `Conferir se o scraper de ${f.fonte} rodou nas últimas execuções.`);
    }
  }

  // Filas de captura de documentos.
  const de = Number(snap.docs_fila_erro) || 0;
  if (de > 10) add('media', 'Fila de documentos com erros', `${de} lotes na fila de documentos com status=erro — captura falhando.`, 'Revisar documentos_fila (status=erro) e o worker captura-documentos.');
  else if (de > 0) add('baixa', 'Fila de documentos com erros', `${de} lote(s) na fila de documentos com status=erro.`, 'Revisar documentos_fila (status=erro).');
  const dp = Number(snap.docs_fila_pend_antigos) || 0;
  if (dp > 20) add('media', 'Fila de documentos represada', `${dp} itens pendentes há mais de 2 dias na fila de documentos.`, 'Verificar se o cron/worker de captura está processando a fila.');
  const cfe = Number(snap.cef_fila_erro) || 0;
  if (cfe > 10) add('media', 'Fila de matrícula CEF com erros', `${cfe} itens com erro na fila de matrícula da Caixa.`, 'Revisar cef_matricula_fila (status=erro).');
  const uf = Number(snap.ufs_falhando) || 0;
  if (uf > 5) add('media', 'Coleta CEF por UF falhando', `${uf} UFs da Caixa em scraper_retry (falha de coleta).`, 'Verificar scraper_retry e a coleta da Caixa por UF.');

  // Health-check (cron diário 06:00 UTC).
  const h = snap.health;
  if (!h || h.ultimo == null) {
    add('alta', 'Health-check ausente', 'Não há registro de health-check — o monitor de saúde pode não estar rodando.', 'Conferir o cron /api/health-check no Vercel.');
  } else {
    const horas = Number(h.horas_atras);
    if (Number.isFinite(horas) && horas > 26) add('alta', 'Health-check parado', `O health-check não roda há ${horas}h (esperado a cada 24h) — automações podem estar paradas.`, 'Conferir o cron /api/health-check e o CRON_SECRET.');
    if (h.status && h.status !== 'ok') add('alta', 'Health-check com falha', `O último health-check retornou status "${h.status}".`, 'Abrir health_check_logs.itens para ver qual verificação falhou.');
  }

  console.log(out.length ? `  Funcionamento: ${out.length} achado(s) de runtime.` : '  Funcionamento: coleta/filas/health-check saudáveis.');
  return out;
}

// Avisa o dono por e-mail quando a auditoria acha algo CRÍTICO. Best-effort: uma
// falha de e-mail não pode derrubar a auditoria (o relatório já está gravado).
async function avisarCritico(criticos, nAlto) {
  const KEY = process.env.RESEND_API_KEY;
  const destino = process.env.AUDITORIA_EMAIL_DESTINO;
  if (!KEY || !destino) {
    console.log('  (aviso de crítico não enviado: RESEND_API_KEY ou AUDITORIA_EMAIL_DESTINO ausente)');
    return;
  }
  const esc = (s) => String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const itens = criticos.slice(0, 10).map((a) => `
    <li style="margin-bottom:12px">
      <b>${esc(a.area)}</b> — <code>${esc(a.arquivo)}${a.linha ? ':' + a.linha : ''}</code><br>
      ${esc(a.descricao)}<br>
      <i>Correção proposta:</i> ${esc(a.correcao)}
    </li>`).join('');
  const html = `
    <p>A auditoria semanal do código encontrou <b>${criticos.length} achado(s) CRÍTICO(S)</b>${nAlto ? ` (e ${nAlto} de severidade alta)` : ''}.</p>
    <p>Este e-mail só é disparado em achado crítico — os demais ficam no painel admin, em “Auditoria do Sistema”.</p>
    <ul>${itens}</ul>
    <p style="color:#64748b;font-size:12px">Auditoria automática · roda semanal só quando não há sessão de trabalho há 7+ dias.</p>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BidPro Brasil <noreply@bidprobrasil.com.br>',
        to: destino,
        subject: `[BidPro] Auditoria: ${criticos.length} achado(s) CRÍTICO(S) no código`,
        html,
      }),
    });
    console.log(r.ok ? '  Aviso de crítico enviado por e-mail.' : `  (falha ao enviar aviso: ${r.status})`);
  } catch (e) { console.log(`  (falha ao enviar aviso: ${e.message})`); }
}

async function main() {
  const arquivos = coletarArquivos();
  const lotes = emLotes(arquivos);
  console.log(`Auditando ${arquivos.length} arquivos em ${lotes.length} lote(s)…`);

  let achados = [];
  for (let i = 0; i < lotes.length; i++) {
    console.log(`  Lote ${i + 1}/${lotes.length} (${lotes[i].length} arquivos)…`);
    const txt = await claude(SISTEMA, promptLote(lotes[i]), 8000);
    const j = parseJSON(txt);
    if (j?.achados?.length) achados.push(...j.achados);
    else console.log(`    (lote ${i + 1}: ${j ? '0 achados' : 'resposta não parseável'})`);
  }

  // Camada de FUNCIONAMENTO (runtime) — mesma esteira de achados do relatório.
  try { achados.push(...await auditarFuncionamento()); }
  catch (e) { console.log('  (funcionamento pulado:', e.message, ')'); }

  // Guardrail DETERMINÍSTICO contra alarme falso: um achado crítico/alto que o
  // PRÓPRIO modelo marcou com um controle compensatório E sem caminho de exploração
  // concreto não é um crítico real (é hardening/defesa-em-profundidade) — rebaixa
  // para "media". Isso trava a fonte recorrente de "saúde=vermelho" indevido sem
  // esconder achados reais (que têm caminho_exploracao preenchido).
  let rebaixados = 0;
  for (const a of achados) {
    if (a.severidade !== 'critica' && a.severidade !== 'alta') continue;
    const temMitig = a.controle_compensatorio && String(a.controle_compensatorio).trim().length > 3;
    const semCaminho = !a.caminho_exploracao || String(a.caminho_exploracao).trim().length < 5;
    if (temMitig && semCaminho) {
      a.severidade_original = a.severidade; a.severidade = 'media';
      a.rebaixado_motivo = 'controle compensatório presente e sem caminho de exploração concreto';
      rebaixados++;
    }
  }
  if (rebaixados) console.log(`  ${rebaixados} achado(s) crítico/alto rebaixado(s) para média (controle compensatório, sem exploração concreta).`);

  // Ordena por severidade e limita para o relatório não explodir.
  const ordem = { critica: 0, alta: 1, media: 2, baixa: 3 };
  achados.sort((a, b) => (ordem[a.severidade] ?? 9) - (ordem[b.severidade] ?? 9));
  achados = achados.slice(0, 100);

  const nCrit = achados.filter((a) => a.severidade === 'critica').length;
  const nAlto = achados.filter((a) => a.severidade === 'alta').length;
  const saude = nCrit > 0 ? 'vermelho' : nAlto > 0 ? 'amarelo' : 'verde';

  // Síntese executiva (1 chamada) a partir dos achados consolidados.
  let resumo = '';
  try {
    const s = await claude(
      'Você é o auditor-chefe. Escreva um resumo executivo de 2-4 frases do estado do sistema a partir dos achados, destacando os riscos mais urgentes e o tom geral. Português, direto, sem markdown.',
      `Achados (JSON): ${JSON.stringify(achados)}\nSaúde calculada: ${saude} (${nCrit} críticos, ${nAlto} altos).`,
      1000,
    );
    resumo = (s || '').trim();
  } catch { resumo = `${achados.length} achados (${nCrit} críticos, ${nAlto} altos).`; }

  const row = {
    gerado_em: new Date().toISOString(), modelo: MODEL, escopo: 'api+seguranca+funcionamento',
    saude, resumo, achados, n_criticos: nCrit, n_altos: nAlto, n_total: achados.length,
    commit_sha: COMMIT_SHA,
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/auditoria_sistema`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) { console.error('Falha ao gravar auditoria:', r.status, await r.text().catch(() => '')); process.exit(1); }
  console.log(`Auditoria concluída: saúde=${saude}, ${achados.length} achados (${nCrit} críticos, ${nAlto} altos).`);

  // SINALIZAÇÃO — só CRÍTICO manda e-mail. A auditoria agendada existe justamente
  // para a janela em que o dono está 7+ dias fora; sem aviso ativo, um achado grave
  // ficaria esperando ele voltar. O corte em "crítico" é deliberado: em 27 execuções
  // os "altos" vieram de 10 a 40 POR RODADA e nenhum crítico apareceu — avisar em
  // "alto" recriaria o e-mail diário ignorado que já se provou ruído. Os altos ficam
  // no painel, que é onde se triam.
  if (nCrit > 0) await avisarCritico(achados.filter((a) => a.severidade === 'critica'), nAlto);
}

main().catch((e) => { console.error(e); process.exit(1); });
