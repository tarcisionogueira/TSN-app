/**
 * /api/apurar-resultado-leilao-cron — a cada 3 horas (era 1x/dia às 18h Brasília até 23/09: apurava
 *   50–90 lotes/dia contra ~350/dia entrando na janela de 3 dias — a maioria vencia sem ser olhada), apura o
 * RESULTADO REAL de cada leilão que encerrou hoje: teve lance (vendido, com valor quando a
 * página publica) ou não (sem lance/deserto). Pedido do dono (20/09): aprender quais praças são
 * mais disputadas e, sobretudo, identificar os lotes SEM lance para propor compra direta ao
 * leiloeiro — "no próprio site do leiloeiro que já faz a busca ele consta os lances... ao final
 * do dia ele acessar e puxar o lance dado e se consta o status de vendido ou sem licitantes".
 *
 * Diferente da coleta em massa (que só lê a LISTAGEM), este cron revisita a PÁGINA DE CADA LOTE
 * individualmente — mesma infraestrutura de fetch+Bright Data de `enriquecer-lote.js` — porque
 * o resultado do leilão só aparece ali, não na busca geral.
 *
 * JANELA: dos ÚLTIMOS 3 DIAS (não só hoje) — cobre o lote de hoje E dá 2 dias de reforço para
 * quem falhou (fonte fora do ar, sem cota do Bright Data naquele dia). Teto de tentativas evita
 * martelar para sempre uma página que nunca resolve.
 *
 * NUNCA INFERE: só grava `resultado_leilao` quando a própria página afirma (ver
 * `_resultado-leilao.js`). Sem sinal confiável, grava `indeterminado` — distinto de NULL (ainda
 * não apurado) e distinto de `sem_lance` (a página disse que não teve lance).
 *
 * IMÓVEIS + VEÍCULOS no MESMO run (21/09, pedido do dono: "tanto para veículos como para
 * imóveis"): o filtro de veículo era só INFERÊNCIA por data ("leilão negativo" em
 * BuscaVeiculos.jsx e o gate de api/propor-veiculo-leiloeiro.js) — mesma limitação que os
 * imóveis tinham antes de 20/09. `apurarResultadoDoTexto`/`fetchLote` são genéricos (texto e
 * URL, sem nada imóvel-específico), então uma segunda passada aqui — orçamento de tempo
 * COMPARTILHADO, sem cron novo — cobre os dois acervos com o mesmo código de apuração.
 */
export const config = { runtime: 'nodejs', maxDuration: 280 };

import { isCronAuthorized } from './_auth.js';
import { fetchLote } from './enriquecer-lote.js';
import { apurarResultadoDoTexto } from './_resultado-leilao.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MAX_TENTATIVAS = 3;
const LOTE_TAMANHO = 250;
const ORCAMENTO_MS = 250000; // corta antes do maxDuration de 280s, sobra pra responder

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

const ehVendaDireta = (m) => /venda[_\s-]?(direta|online)/i.test(String(m || ''));

// FONTES QUE ESTE MÉTODO (fetch de texto + regex) NUNCA VAI CONSEGUIR APURAR — duas causas
// raiz diferentes, achadas ao vivo, mas o mesmo efeito: melhor NÃO tentar do que gerar ruído.
//   • PESTANA / EDITAL_DJEN (21/09): `url_lote`/`link_edital` NÃO é a página do lote — é a
//     AGENDA do leilão inteiro (PESTANA: até 1.070 lotes compartilhando a mesma URL) ou a
//     HOMEPAGE do leiloeiro (EDITAL_DJEN). A cláusula padrão de "condições de venda"/"despesas
//     do arrematante", presente em QUALQUER edital, casava com o sinal de venda e marcava
//     'vendido' falso (10 lotes PESTANA no primeiro dia — reset em
//     supabase/migrations/reset_resultado_leilao_falso_positivo.sql).
//   • SODRE (21/09, achado do dono com print — "HONDA CG 160 CARGO" mostrando VENDIDO/R$9.000
//     na página, apurado como indeterminado por nós): confirmado ao vivo que a página é um
//     Nuxt SSR cujo HTML estático não contém a palavra "vendido" em lugar NENHUM — nem no texto
//     visível nem em atributo/JSON de topo. O resultado do lote só existe depois de hidratação
//     JS (ou numa chamada de API separada que só o navegador faz) — sem headless browser aqui,
//     não tem como ler. Todas as 44 tentativas SODRE (1 imóvel + 43 veículos) deram
//     'indeterminado', nunca um falso 'vendido' — mas por isso mesmo SODRE nunca teria "sem
//     lance" real: ficaria pra sempre empurrando ruído pro filtro "Sem lance" (que agora
//     também mostra indeterminado — pedido do dono, mesma sessão). Fica de fora até termos
//     como ler a página renderizada (ex.: reaproveitar Puppeteer do scraper principal).
//   • CEF/Caixa (21/09): confirmado ao vivo (fetchLote direto no lote real) que o fetch direto
//     falha — IP do servidor bloqueado, mesma causa já documentada em enriquecer-lote.js.
//     PRIMEIRA hipótese (mesmo dia): seria só orçamento — sub-cota `geral` do Bright Data
//     estava travada em 40/semana desde 03/09 (quando só tinha 2 consumidores) e este cron
//     virou o 3º sem rebalancear; subida pra 150/semana (dentro dos 210 créditos já pagos e
//     ociosos do teto global de 720). TESTADO DE NOVO com a cota disponível: `via:"fail"`,
//     `html_len:0` — o Bright Data CHEGOU à Caixa e voltou vazio mesmo assim. Não é mais
//     orçamento: `venda-imoveis.caixa.gov.br` é um site ASP clássico, provavelmente dependente
//     de sessão (cookie de navegação prévia pela busca) — abrir o link do lote direto, mesmo
//     via proxy residencial, não basta. Diferente de PESTANA/EDITAL_DJEN, a URL do lote é 1:1
//     (não é o problema); o bloqueio é de acesso mesmo. Sub-cota `geral` maior continua valendo
//     — beneficia os outros 2 consumidores que a compartilham (enriquecer-datas-cron.js,
//     enriquecer-backfill-cron.js), só não resolveu CEF.
const FONTES_APURACAO_NAO_CONFIAVEL = new Set(['PESTANA', 'EDITAL_DJEN', 'SODRE', 'CEF']);

// Mesma lista acima, mas pronta pro operador `not.in` do PostgREST — aplicada DENTRO da
// consulta SQL (não só depois em JS). Achado 21/09: aplicar só em JS deixava o `LIMIT 250`
// ser consumido pelas 587 linhas candidatas de PESTANA + 587 de CEF ANTES do filtro rodar,
// varrendo o lote inteiro e sobrando zero vaga pro dia inteiro para fontes menores (SATO,
// CALIL, KRONLEILOES, LEILOTECH, FRAZAO, TORRES3, VIP, SUPERBID, APICE, GRUPOLANCE,
// HASTAPUBLICA, LANCEJA, LEFFA, AGOSTINHO, CERULI, RIGOLONLEILOES, ROCHALEILOES,
// SIMONLEILOES, FRANCOLEILOES — todas com 100% "não apurado", zero tentativas). Excluir na
// própria query devolve essas vagas pra quem tem URL de lote real e pode ser lido.
const FONTES_EXCLUIDAS_SQL = `fonte=not.in.(${[...FONTES_APURACAO_NAO_CONFIAVEL].join(',')})`;

// Apura um LOTE de candidatos (imóvel ou veículo — mesma forma mínima: id, url do lote,
// tentativas já feitas) contra a MESMA tabela de origem. `T0`/`orcamentoRestante` são
// compartilhados entre as duas passadas (imóveis primeiro, veículos com o que sobrar).
// `tentarProxyIsp` (22/09, pedido do dono): só os VEÍCULOS passam true — 831 candidatos
// SUPERBID no backlog, a sub-cota diária do Web Unlocker (25/dia, compartilhada com outros 2
// crons) nunca daria conta. Imóveis já ficaram saudáveis com o fix de ordenação/filtro de
// ativo (21/09) e continuam só nas cotas normais — sem motivo pra gastar o proxy ISP ali.
async function apurarLote(tabela, candidatos, T0, orcamentoRestante, tentarProxyIsp = false) {
  let vendidos = 0, semLance = 0, indeterminados = 0, semUrl = 0, semConteudo = 0, cortado = false;
  for (const c of candidatos) {
    if (Date.now() - T0 > orcamentoRestante) { cortado = true; break; }
    const tentativas = (Number(c.resultado_apuracao_tentativas) || 0) + 1;
    if (!c.alvo || !/^https?:\/\//.test(c.alvo)) {
      semUrl++;
      await sb(`${tabela}?id=eq.${encodeURIComponent(c.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ resultado_leilao: 'indeterminado', resultado_apurado_em: new Date().toISOString(), resultado_apuracao_tentativas: tentativas }) }).catch(() => {});
      continue;
    }
    let html = '';
    // fetchLote() já resolve/loga suas próprias falhas (direto→BrightData→proxy ISP→'fail');
    // este catch só protege contra um throw inesperado fora desse contrato — html='' cai no
    // ramo de "sem conteúdo" logo abaixo, honesto (não conta tentativa, não afirma resultado).
    try { ({ html } = await fetchLote(c.alvo, { proposito: 'geral', tentarProxyIsp })); } catch { html = ''; } // padrao-ok: fetchLote já loga a falha real; ver comentário acima
    if (!html) {
      // Sem conteúdo (fonte fora do ar, bloqueio, sem cota do dia): NÃO conta como tentativa —
      // a janela de 3 dias já cobre o reforço, e martelar sem ter respondido nada não ensina.
      semConteudo++;
      continue;
    }
    const achado = apurarResultadoDoTexto(html);
    const patch = { resultado_apurado_em: new Date().toISOString(), resultado_apuracao_tentativas: tentativas };
    if (achado) {
      patch.resultado_leilao = achado.resultado;
      if (achado.valor) patch.valor_lance_vencedor = achado.valor;
      if (achado.resultado === 'vendido') vendidos++; else semLance++;
    } else {
      patch.resultado_leilao = 'indeterminado';
      indeterminados++;
    }
    // Lote que a limpeza HORÁRIA já desligou por praça vencida, antes de este cron diário
    // chegar nele (23/09 — ver a consulta de candidatos): se não vendeu, volta ao ar e entra
    // na retenção de 15 dias de `desativar_leiloes_encerrados()`. Vendido continua desligado.
    if (c.religarSeNaoVendido && patch.resultado_leilao !== 'vendido') { patch.ativo = true; patch.suprimido_motivo = null; }
    await sb(`${tabela}?id=eq.${encodeURIComponent(c.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }).catch(() => {});
  }
  return { candidatos: candidatos.length, vendidos, semLance, indeterminados, semUrl, semConteudo, cortado };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const hojeBRT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const desde = new Date(Date.now() - 3 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const T0 = Date.now();

  // Interruptor no banco (`app_config.brightdata_isp_proxy_ativo`), sem redeploy — pedido do
  // dono (22/09) depois do incidente de build causado pelo `undici` do proxy ISP: se ele der
  // problema em produção (custo, timeout, comportamento inesperado), desligar vira um UPDATE
  // de uma linha, não um commit+deploy. Diferente do padrão de `ativacao-nudge-cron.js` (que
  // é DESLIGADO por padrão e falha fechado), aqui o proxy ISP já está em produção desde 22/09
  // — falha de leitura ou chave ausente mantém o comportamento ATUAL (ligado), pra este
  // interruptor não desligar sozinho uma coisa que já funciona só porque o app_config
  // momentaneamente não respondeu.
  let proxyIspLigado = true;
  try {
    const rFlag = await sb('app_config?key=eq.brightdata_isp_proxy_ativo&select=value');
    const linhas = await rFlag.json().catch(() => []); // padrao-ok: leitura best-effort dentro de try/catch — `proxyIspLigado` já começa com o valor seguro (ligado, comportamento atual) e só muda se a leitura vier completa
    const v = linhas?.[0]?.value;
    if (v !== undefined) proxyIspLigado = String(v).toLowerCase() !== 'false';
  } catch { /* mantém ligado — ver comentário acima */ }

  // ── Imóveis (data_fim é `date`) ──────────────────────────────────────────────────────────
  // Achado ao vivo do dono (21/09): "não está puxando imóveis sem lance" — confirmado, ZERO
  // imóvel ativo tinha `resultado_leilao` preenchido, apesar do cron rodar todo dia. Causa:
  // esta query não filtrava `ativo` (diferente da de veículos, logo abaixo, que sempre filtrou)
  // e ordenava por `data_fim ASC` (mais antigo primeiro) dentro da janela de 3 dias — o site do
  // leiloeiro tira o lote do ar quase assim que o leilão encerra, então os mais ANTIGOS da
  // janela já estão `ativo=false` bem antes dos de HOJE. Resultado medido: dos 250 processados
  // por rodada, 144 eram inativos (0 relevância pro filtro "Sem lance", que só mostra `ativo`)
  // e ZERO eram os 229 ativos-e-vencidos que existiam na mesma janela — o orçamento de tempo
  // (Bright Data é lento) sempre se esgotava no lixo antigo antes de chegar no que importa.
  // Corrigido: filtra `ativo=true` (só o que o cliente pode ver, igual veículos) e ordena
  // DESC (o que venceu HOJE primeiro — é literalmente o pedido: "puxar os leilões que
  // venceram no dia"), com os 2 dias de reforço vindo depois se sobrar orçamento.
  //
  // 22/09 (pedido do dono: "ao buscar vai tirar essa dúvida de indeterminado ou sem lance"):
  // até aqui só reprocessava `resultado_leilao is null` — uma vez marcado 'indeterminado', o
  // cron diário NUNCA mais tentava de novo; só resolvia se um CLIENTE abrisse a tela do imóvel
  // (reapuração on-demand em ImovelDetalhe.jsx). Agora a busca diária também tenta de novo os
  // 'indeterminado' (dentro do mesmo teto de `resultado_apuracao_tentativas` — não vira loop
  // infinito nas fontes que nunca respondem, ex. SODRE, já filtradas à parte).
  // 23/09 (dono: "Sem lance" na BA vazio). CORRIDA ENTRE DOIS ROBÔS: `desativar_leiloes_
  // encerrados()` roda de HORA em hora e desliga o lote assim que a praça vence; este cron roda
  // 1x/dia (21h UTC) e só olhava `ativo=true`. Leilão que acabou de manhã já estava desligado à
  // noite — nunca era apurado, nunca virava "sem lance". Medido na BA, 30 dias: 518 leilões
  // realizados, 50 ativos, 0 apurados. A retenção de 15 dias de 22/09 protegia só o que JÁ
  // tinha sido apurado. Agora entram também os desligados POR PRAÇA VENCIDA (não os
  // "sumiu_da_fonte": esses a fonte tirou do ar) — e o não-vendido é religado (apurarLote).
  const rIm = await sb(`imoveis_leilao?and=(or(ativo.eq.true,suprimido_motivo.eq.praca_vencida),or(resultado_leilao.is.null,resultado_leilao.eq.indeterminado))&data_fim=gte.${desde}&data_fim=lte.${hojeBRT}&resultado_apuracao_tentativas=lt.${MAX_TENTATIVAS}&${FONTES_EXCLUIDAS_SQL}&select=id,fonte,modalidade,url_lote,link_edital,resultado_apuracao_tentativas,ativo&order=data_fim.desc&limit=${LOTE_TAMANHO}`);
  if (!rIm.ok) {
    const detalhe = await rIm.text().catch(() => '');
    console.error('[apurar-resultado-leilao] imoveis', rIm.status, detalhe.slice(0, 300));
    res.status(500).json({ error: 'Falha ao selecionar imóveis', detalhe: detalhe.slice(0, 300) });
    return;
  }
  const candidatosImoveis = (await rIm.json().catch(() => []))
    .filter(im => !ehVendaDireta(im.modalidade))
    .map(im => ({ id: im.id, alvo: im.url_lote || im.link_edital, resultado_apuracao_tentativas: im.resultado_apuracao_tentativas, religarSeNaoVendido: im.ativo === false }));
  const resumoImoveis = await apurarLote('imoveis_leilao', candidatosImoveis, T0, ORCAMENTO_MS * 0.6);

  // ── Veículos (data_leilao é `timestamptz`, sem praça2/data_fim — usa a própria coluna) ────
  const desdeISO = new Date(Date.now() - 3 * 86400000).toISOString();
  const agoraISO = new Date().toISOString();
  // Mesma correção de ordem do bloco de imóveis acima: DESC prioriza o que venceu HOJE
  // (o pedido do dono) sobre o backlog dos 2 dias de reforço, evitando que este último
  // esgote o orçamento antes de chegar no lote de hoje. Mesma reabertura de 'indeterminado'
  // do bloco de imóveis acima (22/09).
  const rVe = await sb(`veiculos_leilao?ativo=eq.true&data_leilao=gte.${desdeISO}&data_leilao=lte.${agoraISO}&or=(resultado_leilao.is.null,resultado_leilao.eq.indeterminado)&resultado_apuracao_tentativas=lt.${MAX_TENTATIVAS}&${FONTES_EXCLUIDAS_SQL}&select=id,fonte,link_lote,resultado_apuracao_tentativas&order=data_leilao.desc&limit=${LOTE_TAMANHO}`);
  let resumoVeiculos = { candidatos: 0, vendidos: 0, semLance: 0, indeterminados: 0, semUrl: 0, semConteudo: 0, cortado: false, erro: null };
  if (!rVe.ok) {
    const detalhe = await rVe.text().catch(() => '');
    console.error('[apurar-resultado-leilao] veiculos', rVe.status, detalhe.slice(0, 300));
    resumoVeiculos.erro = `HTTP ${rVe.status}`;
  } else {
    const candidatosVeiculos = (await rVe.json().catch(() => []))
      .map(v => ({ id: v.id, alvo: v.link_lote, resultado_apuracao_tentativas: v.resultado_apuracao_tentativas }));
    resumoVeiculos = { ...(await apurarLote('veiculos_leilao', candidatosVeiculos, T0, ORCAMENTO_MS, proxyIspLigado)), erro: null };
  }

  // Log incondicional (mesmo princípio já usado em outras rotinas desta base): sem isto, "não
  // havia candidato hoje" e "a rotina parou de rodar" são indistinguíveis de fora.
  const resumo = { imoveis: resumoImoveis, veiculos: resumoVeiculos, proxyIspLigado };
  console.log('[apurar-resultado-leilao]', JSON.stringify(resumo));
  res.status(200).json({ ok: true, ...resumo });
}
