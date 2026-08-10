/**
 * /api/monitor-fontes-cron — monitor de regressão das fontes de leiloeiros.
 *
 * Lê a tabela fonte_saude (1 linha por fonte por execução do scraper) e alerta
 * por e-mail quando uma conexão que já funcionava quebra ou piora:
 *   - fonte esperada sem coleta recente (> MAX_IDADE_H) → scraper parou / seletor mudou
 *   - status 'falhou' (0 imóveis) ou 'degradado' (validação de qualidade reprovou)
 *   - queda de volume registrada pelo próprio scraper
 * Só envia e-mail se houver problema. Idempotente. Autorizado por CRON_SECRET.
 *
 * Roda 1x/dia às 15h UTC (vercel.json) — DEPOIS dos scrapers (grátis ~12:30-13:05 UTC;
 * pagos ~11:37) e da 1ª leva de captura de documentos, para não flagrar estado
 * TRANSITÓRIO de meio-de-coleta (ex.: matrícula ainda enriquecendo → % baixo momentâneo).
 * Os scrapers grátis rodam 2x/semana (seg/qui); MAX_IDADE_H tolera o gap; ver nota abaixo.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import MUNICIPIOS from './_municipios.js';

const RESEND_KEY  = process.env.RESEND_API_KEY;
const FROM_EMAIL  = process.env.APP_FROM_EMAIL || 'noreply@bidprobrasil.com.br';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br';
const APP_URL     = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

// Fontes internas (não são leiloeiros) — nunca alertar.
const FONTES_INTERNAS = ['SUPORTE', 'atribuido_manual'];
// Fontes CRÍTICAS que DEVEM reportar saúde sempre — se sumirem do fonte_saude, alerta.
const FONTES_CRITICAS = ['CEF', 'MEGA', 'SUPERBID', 'SOLD', 'ZUK', 'SODRE', 'FRAZAO', 'LJUD'];
// Scrapers PRÓPRIOS que NÃO escrevem fonte_saude (ponto-cego histórico): checados pelo
// FRESCOR do acervo (imoveis_leilao.atualizado_em). PECINI/RJLEILOES são PAGOS (Bright
// Data) — coleta parada = pagar sem coletar. Valor = dias de tolerância de frescor.
// AMBOS rodam 1x/SEMANA (PECINI seg 09h UTC, RJ ter 11h UTC — ver .github/workflows).
// A tolerância PRECISA cobrir a cadência semanal (7d) + atraso do GitHub Actions/Bright
// Data: o run de segunda pode só GRAVAR ~11:37 UTC (depois deste monitor), então 5d/7d
// disparava um falso "coleta parada" toda semana — o monitor lia o acervo da semana
// anterior ANTES de o run novo terminar. 9d dá folga sobre 1 ciclo semanal e ainda pega
// um run inteiro PULADO (frescor > 9d = scraper realmente parou).
// Inclui as fontes GRÁTIS servidas por scrapers próprios (Bright Data via GitHub Actions) que
// NÃO escreviam fonte_saude e eram ponto-cego: GESTAOLEILOES (qui), CALIL/VEGAS/TORRES3 (plataforma
// SOLEON, seg). Frescor pelo acervo (imoveis_leilao.atualizado_em). 9d cobre a cadência semanal.
// SATO (02/08): era ponto cego TOTAL — não escreve fonte_saude, não estava aqui nem em
// BASELINE_FONTES e `scraper-sato.yml` não tem cron (só dispatch manual). Resultado: coleta
// única em 30/07 com url_lote inventado (/leilao/{id}, "palpite" do próprio scraper) que dá
// 404 — 30 lotes com "Acessar leiloeiro" morto e ninguém para avisar. Entra aqui para que a
// ausência de coleta seja VISÍVEL; quando ganhar cron, a tolerância acompanha a cadência.
// FREIO RESIDENCIAL × CRON SEMANAL (10/08): as fontes PAGAS servidas por
// `.github/workflows/scraper-{rj,pecini,gestao,soleon}.yml` passam por `coleta-recente.mjs
// <FONTE> 7` — se o runner residencial (grátis) coletou nos últimos 7 dias, o run agendado
// PULA para não pagar à toa. Com cron SEMANAL, esse freio consome o ciclo inteiro: coleta
// residencial no dia 0 → o cron do dia ~7 pula (5-6 dias < 7) → a próxima coleta real só no
// dia ~14. Ou seja, **acervo com 12-14 dias é o funcionamento CORRETO**, e a tolerância de 9
// acusava "coleta parada (silenciosa)" toda vez que o freio pegava. Foi o caso do RJLEILOES
// hoje: o run agendado de 04/08 terminou `success` com o passo "Rodar scraper RJ" = `skipped`
// pelo freio — nada quebrou, e mesmo assim o monitor alertou. Alarme que chora lobo treina o
// dono a ignorar o e-mail, que é o pior efeito possível (mesma lição do CREPALDI).
// 16d = 2 ciclos semanais + folga: absolve o freio e AINDA pega o scraper que morreu de vez
// (dois ciclos seguidos sem coletar não tem explicação legítima).
// VLANCE e SATO seguem em 9: não têm freio, então não têm por que gastar dois ciclos.
const FONTES_SEM_SAUDE = { PECINI: 16, RJLEILOES: 16, GESTAOLEILOES: 16, CALIL: 16, VEGAS: 16, TORRES3: 16, VLANCE: 9, SATO: 9 };
// Fontes PARADAS por decisão nossa (acervo zerado de propósito, aguardando conserto). Não
// alerta "sem acervo ativo" — já está registrado e a repetição só vira ruído; a checagem de
// FRESCOR continua valendo, então quando a fonte voltar e parar de novo o monitor avisa.
// SATO (02/08): url_lote inventado dá 404 — recon pendente.
// CREPALDI (07/08): NÃO é bug — o leiloeiro está com o acervo VAZIO. Provado por recon
// (.github/workflows/recon-crepaldi.yml): o PRÓPRIO site chama a API do Superbid com
// `stores.id:16139` — exatamente o id que o scraper usa — e recebe HTTP 200 com
// `{"total":0}`. Ou seja: id certo, plataforma certa, scraper certo, zero lote publicado.
// Ficava alertando todo dia como "falhou (0 imóveis)" por 9 dias seguidos, treinando o dono
// a ignorar o e-mail do monitor — que é o pior efeito possível num alarme.
const FONTES_PARADAS = new Set(['SATO', 'CREPALDI']);
// Frescor máximo tolerado (h) para as fontes grátis que reportam saúde (Seção A).
// Elas rodam 2x/semana — seg e qui (cron '1,4' em scraper.yml e leiloeiros-puppeteer.yml).
// O MAIOR gap NORMAL é quinta→segunda = 96h; com este monitor às 11h UTC e o scrape às
// 9-10h UTC, o pior frescor legítimo num check ≈ 96h + eventual atraso do Actions. 108h
// (4,5 dias) limpa esse gap com folga e AINDA alerta quando uma execução agendada é pulada
// (fica > 108h). NÃO baixar para ~48h: dispara falso-positivo todo sáb/dom/seg (o "coleta
// parada" fantasma). A regressão de VOLUME (scraper rodou mas coletou pouco) é pega à parte
// pela linha de base (Seção C), independente do frescor — este teto cobre só "não rodou".
const MAX_IDADE_H = 108;

// LINHA DE BASE por leiloeiro (ver docs/BASELINE_CAPTURA_LEILOEIROS.md — mantenha os dois
// em sincronia). `min` = piso de acervo ativo (abaixo disso o scrape encolheu). `campos` =
// cobertura mínima aceitável (%) dos campos que ESSA fonte entrega de forma confiável
// (folga de ~15pts sobre o baseline medido); campo fora do mapa NÃO é esperado (não alerta).
// Chaves de campo = colunas de public.fonte_cobertura(): foto/valor/area/data/matricula/edital/avaliacao.
// Pisos RECALIBRADOS contra a métrica REAL de edital/matrícula (fonte_cobertura agora mede
// o DOCUMENTO de verdade, não "coluna não nula"). Threshold ~15pts abaixo da cobertura real
// (0 falso-positivo). `edital` foi REMOVIDO das fontes com lacuna genuína de origem/WIP —
// SUPERBID (captura em validação), SOLD/SBID9/VENDASGOV (source/login-gated), PECINI (Bright
// Data) — para não naguear sobre gap conhecido. Re-adicionar quando a captura estabilizar.
const BASELINE_FONTES = {
  CEF:        { min: 20000, campos: { foto: 85, valor: 95, area: 90, matricula: 55, avaliacao: 90 } },
  SUPERBID:   { min: 900,   campos: { foto: 85, valor: 95, data: 90 } },
  LJUD:       { min: 600,   campos: { valor: 95, data: 90, matricula: 78, edital: 70 } },
  ZUK:        { min: 420,   campos: { foto: 90, valor: 95, data: 70, edital: 85, avaliacao: 90 } },
  MEGA:       { min: 400,   campos: { foto: 90, valor: 95, area: 80, data: 90, matricula: 85, edital: 85, avaliacao: 90 } },
  GRUPOLANCE: { min: 250,   campos: { foto: 90, valor: 95, area: 75, matricula: 78, edital: 85 } },
  PESTANA:    { min: 120,   campos: { foto: 80, valor: 95, area: 75, data: 90, matricula: 78, edital: 85 } },
  // Piso 120: acervo REAL medido pela captura robusta nova (listagem agregada ?pagina) =
  // 144 em 21/07 (o site oscila; era ~370 em meados de 07). Abaixo de 120 = regressão real.
  BIASI:      { min: 120,   campos: { foto: 90, valor: 95, matricula: 83, edital: 85 } },
  FRAZAO:     { min: 90,    campos: { foto: 90, valor: 95, data: 90, matricula: 85, edital: 85 } },
  WEBLEILOES: { min: 60,    campos: { foto: 90, valor: 95, area: 80, matricula: 78, edital: 78 } },
  LEILOTECH:  { min: 60,    campos: { valor: 95, data: 90, matricula: 68, edital: 60, avaliacao: 80 } },
  SOLD:       { min: 55,    campos: { foto: 90, valor: 95, area: 75, data: 90 } },
  VIP:        { min: 40,    campos: { foto: 90, valor: 95, matricula: 75, edital: 85 } },
  SBID9:      { min: 20,    campos: { foto: 90, valor: 95, data: 90 } },
  LEILOFY:    { min: 15,    campos: { foto: 90, valor: 95, data: 90, matricula: 85, edital: 85 } },
  SODRE:      { min: 15,    campos: { foto: 90, valor: 95, area: 85, data: 90, matricula: 82, edital: 85 } },
  PECINI:     { min: 15,    campos: { foto: 90, valor: 95, avaliacao: 90 } },
  RJLEILOES:  { min: 8,     campos: { foto: 90, valor: 95, data: 90, matricula: 78, edital: 78 } },
  VENDASGOV:  { min: 2,     campos: { foto: 90, valor: 95 } },
  SBID21:     { min: 1,     campos: {} },
};

// Dedup de e-mail: só envia quando o CONJUNTO de fontes-problema (fonte:tipo) muda, ou
// quando um OUTAGE sério persiste além de REENVIO_DIAS. Mata o e-mail diário repetindo a
// mesma condição já conhecida/aceita (ex.: "BIASI degradado 173<369" — 173 é o acervo
// real do site, decisão do dono). Estado em public.alerta_estado (chave 'monitor_fontes').
const REENVIO_DIAS = 3;
async function lerEstadoAlerta(supabase, chave) {
  try {
    const { data } = await supabase.from('alerta_estado').select('assinatura,enviado_em').eq('chave', chave).maybeSingle();
    return data || null;
  } catch { return null; }
}
async function gravarEstadoAlerta(supabase, chave, assinatura, enviadoEm) {
  const row = { chave, assinatura, atualizado_em: new Date().toISOString() };
  if (enviadoEm) row.enviado_em = enviadoEm;
  try { await supabase.from('alerta_estado').upsert(row, { onConflict: 'chave' }); } catch { /* aditivo — nunca derruba o monitor */ }
}

// IMPORTANTE: exportar por MÉTODO nomeado (GET/POST), não `export default`. No runtime
// Node da Vercel, `export default` é tratado como assinatura Express `(req, res)` e o
// `Response` retornado é IGNORADO — a função nunca sinaliza fim e trava até o maxDuration
// (504) a cada execução. Com GET/POST o `req` é um Request Web e o `Response` é honrado.
export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // 15 dias: cobre TODAS as fontes que reportam saúde (não só uma allowlist de 8 —
  // BIASI/PESTANA/etc. degradavam e passavam batido). Última linha por fonte = estado.
  const desde = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
  const { data: linhas, error } = await supabase
    .from('fonte_saude')
    .select('fonte,total,status,motivo,estrategia,uf_pct,valor_pct,link_pct,foto_pct,executado_em')
    .gte('executado_em', desde)
    .order('executado_em', { ascending: false });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const ultima = {};
  const penultima = {}; // 2ª leitura mais recente por fonte — p/ a trava de PERSISTÊNCIA (anti-ruído)
  for (const l of linhas || []) {
    if (!ultima[l.fonte]) ultima[l.fonte] = l;
    else if (!penultima[l.fonte]) penultima[l.fonte] = l;
  }

  const agoraMs = Date.now();
  const problemas = [];

  // A) TODAS as fontes que reportam saúde: coleta parada / falhou / degradado.
  for (const [fonte, u] of Object.entries(ultima)) {
    if (FONTES_INTERNAS.includes(fonte)) continue;
    const idadeH = (agoraMs - new Date(u.executado_em).getTime()) / 3600000;
    if (idadeH > MAX_IDADE_H) {
      problemas.push({ fonte, tipo: 'coleta parada', detalhe: `última coleta há ${idadeH.toFixed(0)}h (${u.total} imóveis)` });
    } else if (u.status === 'falhou') {
      // Fonte declarada PARADA não vira alerta de 'falhou': o zero é conhecido e esperado
      // (leiloeiro sem acervo publicado). A checagem de FRESCOR acima continua valendo, então
      // se o scraper realmente parar de rodar o monitor avisa do mesmo jeito — e no dia em que
      // a fonte voltar a publicar e depois regredir, a linha de base aprendida assume.
      if (!FONTES_PARADAS.has(fonte)) {
        problemas.push({ fonte, tipo: 'falhou (0 imóveis)', detalhe: u.motivo || 'coleta zerada' });
      }
    } else if (u.status === 'degradado') {
      // PERSISTÊNCIA (anti-ruído): um "degradado" isolado quase sempre é dip TRANSITÓRIO da
      // janela de scrape (a fonte no meio da coleta) que recupera no próximo run → e-mail
      // desnecessário. Só alerta se a leitura ANTERIOR também foi degradado/falhou (o problema
      // persiste), OU se não há leitura anterior (1ª vez que a fonte reporta — trata como real).
      const ant = penultima[fonte];
      if (!ant || ant.status === 'degradado' || ant.status === 'falhou') {
        problemas.push({ fonte, tipo: 'degradado', detalhe: `${u.total} imóveis — ${u.motivo || 'qualidade abaixo do critério'}` });
      }
    }
  }

  // A2) Fontes CRÍTICAS que sumiram do fonte_saude (nem apareceram em 15 dias).
  for (const fonte of FONTES_CRITICAS) {
    if (!ultima[fonte] && !problemas.some(p => p.fonte === fonte)) {
      problemas.push({ fonte, tipo: 'sem coleta', detalhe: 'nenhuma execução nos últimos 15 dias' });
    }
  }

  // B) Scrapers PRÓPRIOS que não escrevem fonte_saude (ponto-cego): FRESCOR do acervo.
  //    Cobre a falha SILENCIOSA (o scraper parou e nem reporta) — caso PECINI (pago).
  for (const [fonte, diasTol] of Object.entries(FONTES_SEM_SAUDE)) {
    const { data: mx } = await supabase
      .from('imoveis_leilao')
      .select('atualizado_em')
      .eq('fonte', fonte).eq('ativo', true)
      .order('atualizado_em', { ascending: false }).limit(1);
    const ultimoAt = mx?.[0]?.atualizado_em;
    if (!ultimoAt) {
      if (!FONTES_PARADAS.has(fonte)) {
        problemas.push({ fonte, tipo: 'sem acervo ativo', detalhe: 'scraper próprio (pago?) sem imóvel ativo' });
      }
      continue;
    }
    const idadeD = (agoraMs - new Date(ultimoAt).getTime()) / 86400000;
    if (idadeD > diasTol) {
      problemas.push({ fonte, tipo: 'coleta parada (silenciosa)', detalhe: `acervo sem atualização há ${idadeD.toFixed(0)}d — scraper próprio não reporta saúde` });
    }
  }

  // B2) GATE da coleta GRÁTIS/residencial (coleta_cliente): fonte ATIVA que nunca coletou
  //     (ultima_em nulo) ou parou além do intervalo previsto. Era ponto-cego total (o monitor lia
  //     só fonte_saude/acervo). Hoje cobre o VLANCE (client-side puro, que não grava fonte_saude
  //     nem tem workflow) — assim a falha silenciosa da via residencial fica VISÍVEL/alertada.
  try {
    const { data: gate } = await supabase
      .from('coleta_cliente').select('fonte,ultima_em,intervalo_horas,ativo').eq('ativo', true);
    for (const g of gate || []) {
      if (!g.ultima_em) {
        problemas.push({ fonte: g.fonte, tipo: 'coleta grátis nunca concluiu', detalhe: 'via residencial/client-side sem nenhuma coleta bem-sucedida (ultima_em nulo)' });
      } else {
        const idadeH = (agoraMs - new Date(g.ultima_em).getTime()) / 3600000;
        const tol = (Number(g.intervalo_horas) || 84) * 1.5; // 1,5× o intervalo previsto = folga
        if (idadeH > tol) problemas.push({ fonte: g.fonte, tipo: 'coleta grátis parada', detalhe: `via residencial sem coleta há ${idadeH.toFixed(0)}h (intervalo ${g.intervalo_horas}h)` });
      }
    }
  } catch { /* aditivo: nunca derruba o monitor */ }

  // C) LINHA DE BASE (docs/BASELINE_CAPTURA_LEILOEIROS.md): o scraper roda mas REGREDIU —
  //    acervo encolheu abaixo do piso, ou um campo que vinha alto sumiu. Pega a degradação
  //    SILENCIOSA que atingia assinantes (relatório sem área/data/avaliação). Aditivo: se a
  //    RPC falhar, nunca derruba o monitor (as seções A/B seguem valendo).
  try {
    const { data: cobertura } = await supabase.rpc('fonte_cobertura');
    for (const row of cobertura || []) {
      const base = BASELINE_FONTES[row.fonte];
      if (!base) continue;
      if (typeof row.ativos === 'number' && row.ativos < base.min) {
        // Anti-ruído: se a ÚLTIMA coleta (fonte_saude) JÁ voltou acima do piso, o snapshot de
        // cobertura está atrasado (o dip da janela de scrape já recuperou) → não alerta.
        const uSaude = ultima[row.fonte];
        const recuperou = uSaude && Number(uSaude.total) >= base.min;
        if (!recuperou) {
          problemas.push({ fonte: row.fonte, tipo: 'acervo abaixo da linha de base', detalhe: `${row.ativos} ativos (piso ${base.min})` });
        }
      }
      for (const [campo, minPct] of Object.entries(base.campos || {})) {
        const atual = row[campo];
        if (typeof atual === 'number' && atual < minPct) {
          problemas.push({ fonte: row.fonte, tipo: `campo "${campo}" regrediu`, detalhe: `${atual}% (linha de base ≥ ${minPct}%)` });
        }
      }
    }
  } catch { /* baseline é aditivo — não bloqueia o restante do monitor */ }

  // C2) QUALIDADE / CORREÇÃO (pedido do dono): a Seção C mede campo VAZIO (cobertura); esta
  //     mede campo TROCADO ou FRACO, que a cobertura escondia (uma matrícula que é a página,
  //     ou o edital==matrícula, CONTAM como "tem" e até inflam). Via RPC fonte_qualidade():
  //       • tipologia fraca  = % alto do balde genérico 'imovel' (captura de tipo regrediu).
  //       • documento trocado = link_edital == link_matricula (o bug "Edital abre Matrícula").
  //       • matrícula = lote  = link_matricula == url_lote (aponta p/ a página, não é doc).
  //     Calibrado p/ 0 falso-positivo no acervo atual: gate de VOLUME (≥50 ativos) + limite
  //     RELATIVO (≥3% e ≥5 lotes) — pega a REGRESSÃO em massa, ignora ruído de fonte pequena.
  //     Aditivo: se a RPC falhar, nunca derruba o monitor.
  try {
    const { data: qualidade } = await supabase.rpc('fonte_qualidade');
    for (const row of qualidade || []) {
      const n = Number(row.ativos) || 0;
      if (n >= 50 && Number(row.imovel_pct) > 25) {
        problemas.push({ fonte: row.fonte, tipo: 'tipologia fraca', detalhe: `${row.imovel_pct}% dos lotes sem tipo (balde genérico 'imovel') — captura de tipologia regrediu` });
      }
      const edm = Number(row.ed_eq_matr) || 0;
      if (edm >= 5 && (edm * 100) / n >= 3) {
        problemas.push({ fonte: row.fonte, tipo: 'documento trocado (edital=matrícula)', detalhe: `${edm} lote(s) com o Edital apontando para a mesma URL da Matrícula` });
      }
      const mel = Number(row.matr_eq_lote) || 0;
      if (mel >= 5 && (mel * 100) / n >= 3) {
        problemas.push({ fonte: row.fonte, tipo: 'matrícula não é documento', detalhe: `${mel} lote(s) com a Matrícula apontando para a página do lote (não é arquivo)` });
      }
    }
  } catch { /* qualidade é aditiva — nunca derruba o monitor */ }

  // C3) BUG BOUNTY dos leiloeiros — piso de acervo AUTO-APRENDIDO (pedido do dono). O piso
  //     hardcoded de BASELINE_FONTES fica obsoleto (foi preciso recalibrar o BIASI 150->120
  //     na mão). Aqui o piso é APRENDIDO do próprio histórico de cada fonte
  //     (fonte_baseline_aprendida = min dos runs SAUDÁVEIS * 0.65): auto-calibra os leiloeiros
  //     atuais e ONBOARDA os futuros — sem hardcode. Compara com o TOTAL do último scrape
  //     (fonte_saude), a MESMA métrica que aprendeu, então é imune à desativação de
  //     estrangeiros da Seção D (que reduz `ativos`, não o total do scrape). Pega a regressão
  //     GROSSA e SILENCIOSA (ex.: 369->26) que um piso fixo obsoleto deixaria passar. Também
  //     grava o snapshot diário de métricas (a matéria-prima do aprendizado). 100% aditivo.
  // Snapshot (matéria-prima do aprendizado) em try/catch PRÓPRIO: se fonte_cobertura/
  // fonte_qualidade mudarem de assinatura, o INSERT lança — logamos e seguimos, sem
  // mascarar a comparação de baseline (que nem depende do snapshot).
  try {
    const { error: eSnap } = await supabase.rpc('snapshot_metricas_fontes');
    if (eSnap) console.error('snapshot_metricas_fontes:', eSnap.message);
  } catch (e) { console.error('snapshot_metricas_fontes:', e?.message); }
  // Comparação com o piso APRENDIDO (mediana*0.5; tem_baseline já exige volume >= 20 p/ não
  // falsar em fonte minúscula). Compara o TOTAL do último scrape (imune à Seção D).
  try {
    const { data: aprend } = await supabase.rpc('fonte_baseline_aprendida');
    for (const b of aprend || []) {
      if (!b.tem_baseline) continue;
      if (problemas.some(p => p.fonte === b.fonte)) continue;  // já sinalizado (A/B/C) — não empilha
      const u = ultima[b.fonte];
      if (!u || typeof u.total !== 'number') continue;
      if (u.total < b.ativos_piso) {
        problemas.push({ fonte: b.fonte, tipo: 'acervo abaixo do normal aprendido',
          detalhe: `último scrape ${u.total} < piso aprendido ${b.ativos_piso} (normal ~${b.ativos_mediana}, mín ${b.ativos_min} em ${b.n_amostras} runs)` });
      }
    }
  } catch { /* aprendizado é aditivo — nunca derruba o monitor */ }

  // C4) INVARIANTES DE FUNCIONALIDADE (QA — "bug bounty" de features). Asserções por
  //     botão/feature (RPC qa_invariantes) com LIMITE calibrado p/ 0 falso-positivo hoje;
  //     alerta quando um invariante REGRIDE: documento trocado, avaliação mis-read, valor
  //     sentinela, perfil sem role, ou uma lacuna de captura que CRESCEU além do teto.
  //     Complementa a Seção C (acervo/quantidade) com CORRETUDE por funcionalidade. Aditivo.
  try {
    const { data: inv } = await supabase.rpc('qa_invariantes');
    for (const i of inv || []) {
      if (i.status !== 'alerta') continue;
      problemas.push({ fonte: 'QA', tipo: `invariante ${i.chave}`,
        detalhe: `${i.titulo}: ${i.valor} (limite ${i.limite}; ${i.gravidade})` });
    }
  } catch { /* QA é aditivo — nunca derruba o monitor */ }

  // D) VARREDURA "só Brasil" pós-geocode (rede Superbid). O guard do scraper
  //    (ehEstrangeiroSemUF) só reconhece estrangeiro quando a CIDADE já vem preenchida;
  //    lotes internacionais (Paraguai/Argentina) que chegam com cidade VAZIA passam o
  //    guard e a cidade é preenchida DEPOIS (geocode) — furo confirmado em 18/07 (6 lotes
  //    do Paraguai). Aqui, com a cidade já resolvida, aplicamos a MESMA lógica e
  //    DESATIVAMOS quem não é município BR. Só olha lotes com UF vazia (foreign com UF
  //    válida já é barrado no save). Teto de 50 evita que um erro de dataset zere o acervo.
  try {
    const FONTES_INTL = ['SUPERBID', 'SBID9', 'SBID21', 'SOLD'];
    const normCidadeBR = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const CIDADES_BR = new Set(Object.keys(MUNICIPIOS).map(k => normCidadeBR(k.split('|')[1])));
    const { data: candidatos } = await supabase
      .from('imoveis_leilao')
      .select('id, fonte, cidade, estado')
      .eq('ativo', true)
      .in('fonte', FONTES_INTL)
      .or('estado.is.null,estado.eq.')       // só UF vazia (foreign com UF válida já é barrado no save)
      .not('cidade', 'is', null)
      .neq('cidade', '');
    const estrangeiros = (candidatos || []).filter(im => {
      if (String(im.estado || '').trim() !== '') return false;   // reforço em JS
      const c = normCidadeBR(im.cidade);
      return c.length >= 3 && !CIDADES_BR.has(c);
    });
    if (estrangeiros.length && estrangeiros.length <= 50) {
      const { error: eDesat } = await supabase
        .from('imoveis_leilao')
        .update({ ativo: false })
        .in('id', estrangeiros.map(im => im.id));
      if (!eDesat) {
        const porFonte = {};
        for (const im of estrangeiros) porFonte[im.fonte] = (porFonte[im.fonte] || 0) + 1;
        for (const [fonte, n] of Object.entries(porFonte)) {
          problemas.push({ fonte, tipo: 'lote estrangeiro desativado', detalhe: `${n} lote(s) fora do Brasil (cidade não é município BR) desativado(s) automaticamente` });
        }
      }
    } else if (estrangeiros.length > 50) {
      // Muitos de uma vez = provável erro de dataset/normalização. NÃO desativa; só alerta.
      problemas.push({ fonte: 'rede Superbid', tipo: 'varredura estrangeiros suspensa', detalhe: `${estrangeiros.length} lotes marcados como não-BR (acima do teto de 50) — verificar dataset antes de desativar` });
    }
  } catch { /* varredura é aditiva — nunca derruba o monitor */ }

  if (!problemas.length) {
    // condição limpa: zera o estado p/ que uma recorrência futura volte a avisar.
    const st = await lerEstadoAlerta(supabase, 'monitor_fontes');
    if (!st || st.assinatura !== '') await gravarEstadoAlerta(supabase, 'monitor_fontes', '', null);
    return new Response(JSON.stringify({ ok: true, problemas: 0, fontes: Object.keys(ultima).length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Dedup: assinatura = conjunto ordenado de (fonte:tipo). Ignora o texto volátil do
  // detalhe (contadores de horas/imóveis) p/ não parecer "mudança" a cada dia.
  const assinatura = problemas.map(p => `${p.fonte}:${p.tipo}`).sort().join('|');
  const estado = await lerEstadoAlerta(supabase, 'monitor_fontes');
  const mudou = !estado || estado.assinatura !== assinatura;
  const outageSerio = problemas.some(p => /coleta parada|falhou|sem coleta|sem acervo/i.test(p.tipo));
  const heartbeat = outageSerio && estado?.enviado_em &&
    (Date.now() - new Date(estado.enviado_em).getTime()) > REENVIO_DIAS * 86400000;
  const enviar = mudou || heartbeat;
  let emailEnviado = false; // vira true só com HTTP ok do Resend — é o que libera gravar o estado

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (enviar && RESEND_KEY) {
    const linhasHtml = problemas.map(p => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700">${p.fonte}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#dc2626">${p.tipo}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.detalhe}</td>
      </tr>`).join('');
    const html = `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
        <div style="background:#dc2626;color:white;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">🔴 Fontes de leilão com problema (${problemas.length})</h2>
          <p style="margin:8px 0 0;opacity:.9">${agora} (BRT)</p>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead><tr style="text-align:left;color:#64748b">
              <th style="padding:8px 12px">Fonte</th><th style="padding:8px 12px">Problema</th><th style="padding:8px 12px">Detalhe</th>
            </tr></thead>
            <tbody>${linhasHtml}</tbody>
          </table>
          <p style="margin-top:16px;color:#64748b;font-size:13px">O acervo de imóveis dessas fontes continua no ar (o scraper não apaga em coleta ruim); o alerta é para reconectar/ajustar o parser.</p>
          <a href="${APP_URL}/#/admin" style="display:inline-block;margin-top:8px;background:#0D63DB;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Abrir Admin →</a>
        </div>
      </div>`;
    try {
      const rEmail = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject: `🔴 BidPro — ${problemas.length} fonte(s) de leilão com problema`, html }),
      });
      emailEnviado = rEmail.ok;
      if (!rEmail.ok) console.error('[monitor-fontes] Resend HTTP', rEmail.status, String(await rEmail.text().catch(() => '')).slice(0, 200));
    } catch (e) { console.error('[monitor-fontes] Resend exceção:', String(e?.message || e).slice(0, 200)); }
  }

  // SÓ marca como "avisado" quando o e-mail REALMENTE saiu (07/08). Antes o estado era gravado
  // incondicionalmente: um soluço do Resend (ou RESEND_KEY ausente) enterrava o alerta para
  // sempre, porque a assinatura já constava como enviada e a próxima rodada via "nada novo".
  // Uma fonte degradada perdia a única boca que tinha. Sem envio, não grava → re-tenta amanhã.
  if (enviar && emailEnviado) await gravarEstadoAlerta(supabase, 'monitor_fontes', assinatura, new Date().toISOString());

  return new Response(JSON.stringify({ ok: true, problemas: problemas.length, enviado: emailEnviado, alerta_pendente: enviar && !emailEnviado, detalhes: problemas }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
