export const config = { runtime: 'edge' };

// COLETA OPORTUNISTA (pedido do dono): quando o STAFF abre o app (celular ou PC), dispara os
// scrapers das fontes PAGAS (Bright Data) na nuvem — SÓ se já passou o espaçamento desde o último
// disparo (gate atômico `coleta_oportunista_claim`, ~20h). Assim, quem acessa todo dia mantém as
// pagas frescas SEM depender de um computador sempre ligado, e sem gastar BD a cada abertura.
// Rede de segurança dos 7 dias = os workflows dessas fontes já rodam 1x/semana na CI.
// As fontes GRÁTIS (CEF + cluster puppeteer) já rodam diárias na CI — não entram aqui.
//
// ─── 29/08: O ESPAÇAMENTO SOZINHO NÃO SABE SE JÁ TEMOS O DADO ───────────────────────────────
// O `coleta_oportunista_claim` mede TEMPO DESDE O ÚLTIMO DISPARO e mais nada. Com o runner
// residencial finalmente gravando (RJ_DRYRUN=0, 11/08), as MESMAS fontes passaram a ser
// coletadas de graça de casa — e este endpoint continuou disparando o caminho PAGO por cima.
//
// Medido em 29/08, no mesmo dia:
//   10:29 UTC → disparo oportunista acorda os 4 workflows pagos → todos `sem_cota`
//   13:02-13:17 UTC → runner residencial coleta CALIL 11, VEGAS 37, TORRES3 37,
//                     GESTAOLEILOES 104, RJLEILOES 40, VLANCE 24 — tudo por R$ 0
// E os 4 workflows pagos tinham rodado por `workflow_dispatch` TODOS OS DIAS desde 08/08.
// Na semana de 24/08 (cota 550/550 saturada), 295 requests — 54% do teto — foram para
// soleon/pecini/gestao/rj, as quatro que o residencial cobre de graça.
//
// A pergunta certa não é "faz quanto tempo que eu disparo?", e sim **"o acervo está fresco?"** —
// a mesma virada que `scripts/coleta-recente.mjs` fez em 11/08 pelo mesmo motivo. Se está, não
// há o que comprar. A intenção do dono fica intacta: a janela é curta o bastante para que a casa
// falhar UM ciclo já traga o pago de volta, muito antes da rede de segurança semanal.
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_ACTIONS_TOKEN;
const REPO_OWNER   = 'tarcisionogueira';
const REPO_NAME    = 'TSN-app';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC          = process.env.SUPABASE_SERVICE_KEY;
const STAFF        = new Set(['admin', 'analista', 'advogado', 'consultor']);
const ESPACAMENTO  = process.env.COLETA_OPORTUNISTA_ESPACAMENTO || '20 hours';
// Dias de frescor que dispensam o disparo pago. **4, e o número foi medido, não estimado.**
// O gate residencial é `coleta_cliente.intervalo_horas = 72`, e o acervo confirma o ciclo:
// CALIL e TORRES3 gravaram em 20, 23, 26 e 29/08 — exatamente de 3 em 3 dias. Com um limite de
// 3, o acervo estaria SEMPRE na borda no momento em que a casa roda, e qualquer atraso de
// algumas horas dispararia o caminho pago sem necessidade — o freio virando gasto.
// 4 dá um dia de folga sobre o ciclo e ainda dispara MUITO antes da rede de segurança semanal:
// se a casa perder um ciclo inteiro, o pago acorda no 4º dia, não no 7º.
const DIAS_FRESCO  = Number(process.env.COLETA_OPORTUNISTA_DIAS_FRESCO || 4);
// Fonte → workflow (só as PAGAS por Bright Data).
const FONTES = { SOLEON: 'scraper-soleon.yml', GESTAO: 'scraper-gestao.yml', RJ: 'scraper-rj.yml', PECINI: 'scraper-pecini.yml' };
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, Accept: 'application/json' };

/**
 * O acervo desta fonte já está fresco? `true` = não há o que comprar; `false` = dispare.
 *
 * ⚠️ FAIL-OPEN DELIBERADO, e a razão é a forma nº 1 do CLAUDE.md: leitura que falhou NÃO é
 * "está fresco". Tratar erro como frescor faria este freio calar a coleta paga em silêncio —
 * o pior desfecho possível, porque o sintoma seria acervo congelado com tudo verde. Falhou a
 * leitura, dispara: o custo de errar para esse lado é uma coleta a mais.
 *
 * O mapa gate → fontes do acervo vem de `coleta_cliente.fontes_acervo` (um gate pode cobrir
 * várias, como SOLEON → CALIL/VEGAS/TORRES3), e só conta como fresco quando TODAS estão —
 * senão a que ficou para trás nunca seria recoletada por causa das que deram certo.
 */
async function acervoFresco(fonte) {
  try {
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/coleta_cliente?fonte=eq.${encodeURIComponent(fonte)}&select=fontes_acervo`,
      { headers: H },
    );
    if (!rc.ok) throw new Error(`HTTP ${rc.status} em coleta_cliente`);
    const [linha] = await rc.json();
    const acervos = Array.isArray(linha?.fontes_acervo) ? linha.fontes_acervo.filter(Boolean) : [];
    // Gate sem mapa = não sei o que ele cobre. Desconhecido não é fresco → dispara.
    if (!acervos.length) return false;

    const corte = Date.now() - DIAS_FRESCO * 86400000;
    const idades = await Promise.all(acervos.map(async (nome) => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/imoveis_leilao?fonte=eq.${encodeURIComponent(nome)}&ativo=eq.true`
        + '&select=atualizado_em&order=atualizado_em.desc&limit=1',
        { headers: H },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status} lendo ${nome}`);
      const [l] = await r.json();
      const t = l?.atualizado_em ? Date.parse(l.atualizado_em) : 0;
      return t > 0 && t > corte;
    }));
    return idades.every(Boolean);
  } catch { return false; }   // padrao-ok: fail-open é a decisão; o motivo está no comentário acima
}

async function claim(fonte) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/coleta_oportunista_claim`, {
      method: 'POST',
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_fonte: fonte, p_espacamento: ESPACAMENTO }),
    });
    return (await r.json().catch(() => false)) === true;
  } catch { return false; }
}

async function dispatch(wf) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${wf}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (!STAFF.has(role)) return forbidden();
  if (!GITHUB_TOKEN || !SUPABASE_URL || !SVC) return new Response(JSON.stringify({ ok: false, erro: 'infra ausente (GITHUB_ACTIONS_TOKEN/SERVICE_KEY)' }), { status: 200, headers: cors });

  // Dispara cada fonte paga cujo espaçamento venceu (o claim é atômico → sem corrida entre abas).
  const disparadas = [];
  const frescas = [];
  for (const [fonte, wf] of Object.entries(FONTES)) {
    // FRESCOR ANTES DO CLAIM, de propósito: se o claim viesse primeiro, ele carimbaria
    // `ultimo_disparo` de uma coleta que não aconteceu e empurraria o próximo disparo REAL
    // por mais 20h — o freio de custo virando causa de acervo velho.
    if (await acervoFresco(fonte)) { frescas.push(fonte); continue; }
    if (!(await claim(fonte))) continue;
    if (await dispatch(wf)) disparadas.push(fonte);
  }
  // `frescas` sai na resposta porque um freio que age em silêncio é indistinguível de um
  // endpoint quebrado — e foi exatamente essa indistinção que deixou o gasto duplo passar.
  return new Response(JSON.stringify({ ok: true, disparadas, frescas, dias_frescor: DIAS_FRESCO }), { status: 200, headers: cors });
}
