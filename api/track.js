/**
 * /api/track — ingest de eventos de atividade do cliente (navegação, cliques, falhas de API).
 * Alimenta o Cliente 360 (diagnóstico de possíveis falhas). Só registra usuários IDENTIFICADOS
 * (user_id do token — o cliente não escolhe o user_id). Escrita só pelo servidor (service key).
 * Fire-and-forget: nunca quebra o cliente.
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import { getUser, getUserRoleById } from './_auth.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
// api_vazio = ação-chave (relatório) que voltou SEM estimativa — o dono quer ver isso no 360
// (era enviado pelo apiCall.js mas caía fora da allowlist e sumia silenciosamente).
// submit/change = ações sem clique (ENTER em form, select/filtro/arquivo); api_falha_rede =
// fetch que nem chegou ao servidor; pdf_gerado/pdf_falha = ENTREGA do documento (choke point
// do pdfImprimir) — auditoria de cobertura do tracker de 30/07.
// geracao_recuperada = a conexão do fetch caiu no meio da geração, o SERVIDOR seguiu e
// concluiu, e a tela deliberadamente NÃO mostra erro (decisão do dono, 14/08: erro que se
// resolve sozinho vai para o Cliente 360, não para o usuário). Como a tela não mostra mais,
// esta allowlist é o único caminho até o diagnóstico — fora dela o evento morre em silêncio e
// uma rede ruim recorrente vira "nada aconteceu".
// limite_sessao = o coletor atingiu o teto de eventos e PAROU de gravar. O tracker emite este
// aviso desde 11/08 justamente para que o 360 não pareça um dia que acaba no meio da tarde —
// mas ele nunca chegou: ficava de fora daqui e era descartado. O aviso contra o silêncio
// estava sendo silenciado; corrigido em 14/08 junto com o de cima.
// `analise_*` (29/08): o clique genérico já existia e mostrou que 10 das 16 contas novas que
// abriram a /analise NUNCA clicaram em Gerar — mas ele não diz QUAL relatório, nem COMO
// terminou, nem o que a pessoa VIU ao chegar. Sem isso, qualquer mexida na tela é palpite:
//   analise_estado   → o que a tela oferecia na chegada (cada card: livre/plano/cota/encerrado)
//   analise_gerar    → tentativa e DESFECHO, por tipo de relatório
//   analise_bloqueio → clicou numa porta fechada, com o motivo dela
// `origem_lote` (29/08): a página pública do lote manda a pessoa para
// `/#/login?modo=cadastro&imovel=<id>` — e `Login.jsx` NUNCA leu esse parâmetro (procurado
// `params.get('imovel')` no src inteiro: zero consumidores). Antes de consertar, medir quanta
// gente de fato chega assim. Este é o único evento da lista que nasce para o VISITANTE, então
// tem de entrar também em TIPOS_ANON logo abaixo — sem isso ele seria descartado com 204 e a
// medição voltaria zero, que é a terceira vez que esta lista deixaria de fora exatamente a
// página que estava recebendo gente (ver `leiloes`, `leilao` e `live` mais abaixo).
const TIPOS = new Set(['pageview', 'click', 'submit', 'change', 'api_erro', 'api_vazio', 'api_falha_rede', 'pdf_gerado', 'pdf_falha', 'geracao_recuperada', 'limite_sessao', 'erro_ui', 'analise_estado', 'analise_gerar', 'analise_bloqueio', 'origem_lote']);

// Defesa em profundidade: NUNCA persistir token/segredo no log de atividade, mesmo que um cliente
// antigo/adulterado mande (ex.: #access_token=... do fluxo implícito, ou um JWT eyJ...). Redige.
const RE_SEGREDO = /(access_token|refresh_token|provider_token|provider_refresh_token|id_token|[?&#]token=|[?&]code=|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i;
const redigir = (s) => { const v = String(s || ''); return RE_SEGREDO.test(v) ? '(redigido)' : v; };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const b = req.body || {};
    const eventos = Array.isArray(b.eventos) ? b.eventos.slice(0, 30) : [];
    if (!eventos.length || !SB || !KEY) { res.status(204).end(); return; }

    let userId = null, role = null;
    try { const u = await getUser(req); userId = u?.id || null; if (userId) role = await getUserRoleById(userId); } catch { /* anônimo */ }
    // FUNIL PÚBLICO (30/07): visitante SEM conta também conta — mas com regras mais duras:
    // exige anon_id, só ROTAS PÚBLICAS, menos tipos e lote menor (anti-abuso; RLS fechado e
    // retenção de 30d seguem valendo). Sem isto, quem clicava num link de venda e não
    // cadastrava era invisível — impossível distinguir "ninguém clicou" de "página quebrou".
    const anonId = typeof b.anon_id === 'string' ? (b.anon_id.replace(/[^\w-]/g, '').slice(0, 48) || null) : null;
    const TIPOS_ANON = new Set(['pageview', 'click', 'submit', 'api_erro', 'api_falha_rede', 'erro_ui', 'origem_lote']);
    // `leiloes` entrou em 12/08 e é a correção mais cara da lista: são as ~33 mil páginas de
    // acervo público (servidas por /api/publico, FORA do React), o principal ativo de aquisição
    // do site. Sem esta palavra, o evento chegava aqui e era descartado com 204 — silêncio dos
    // dois lados: o tracker não rodava lá E o servidor recusaria se rodasse. Medido antes da
    // correção: em 30 dias, visitante anônimo aparecia em CINCO rotas (/, /planos, /login,
    // /termos, /privacidade) e ZERO nas 33 mil. Não dava para distinguir "o SEO não traz
    // ninguém" de "não estamos medindo" — que são diagnósticos opostos.
    // `leilao` (SINGULAR) entrou horas depois de `leiloes`, e a lacuna era exatamente a mesma
    // que a allowlist existia para corrigir: a página do LOTE é `/leilao/<id>/<slug>` e a de
    // listagem é `/leiloes/<uf>/<cidade>`. Só o plural estava aqui, então a página de lote —
    // que é onde o SEO de cauda longa entrega gente — continuava descartada com 204 silencioso.
    // Pego no primeiro dado real: uma visita orgânica do Google caiu em
    // `/leilao/.../restaurante-desocupado-...-araxa-mg`, gravou a origem e perdeu o pageview.
    // `live` entrou em 28/08 e é a TERCEIRA vez que esta lista deixa de fora justamente a
    // página que estava recebendo o dinheiro (as duas anteriores estão narradas acima:
    // `leiloes` e `leilao`). `/live/<slug>` é a landing da aula ao vivo — a peça de captação
    // sobre a qual a campanha vai ser ligada. Sem esta palavra o visitante anônimo entrava,
    // lia, ia embora, e o evento voltava 204: nenhum pageview, nenhum clique e, pior, o
    // bloco de ORIGEM lá embaixo nem era alcançado (o `return` antecipado da lista vazia),
    // então gclid/fbclid de quem chega pelo anúncio NÃO virava linha em `visita_origem`.
    // Medido antes da correção: `visita_origem` tinha ZERO linhas com landing `/live/%`,
    // desde sempre. Não dava para distinguir "o anúncio não traz ninguém" de "não estamos
    // medindo" — os dois diagnósticos opostos de sempre.
    const ROTA_PUBLICA = /^\/($|p\/|leil(ao|oes)|live|r\/|planos|login|cadastro|termos|privacidade|convite|cadastro-parceiro|contrato|testemunha|ativar|redefinir|recuperar|\(auth-redirect\))/;
    let lista = eventos;
    if (!userId) {
      if (!anonId) { res.status(204).end(); return; }
      lista = eventos.filter((e) => e && TIPOS_ANON.has(e.tipo) && ROTA_PUBLICA.test(String(e.rota || ''))).slice(0, 12);
      if (!lista.length) { res.status(204).end(); return; }
    }

    // Hora da AÇÃO (ts do cliente), não da ingestão — exigência de auditoria (data+hora fiel).
    // Aceita só ts plausível (últimas 48h até +2min de clock skew); fora disso, now() do banco.
    const agora = Date.now();
    const tsValido = (t) => Number.isFinite(t) && t > agora - 48 * 3600 * 1000 && t < agora + 120000;
    const rows = lista
      .filter((e) => e && TIPOS.has(e.tipo))
      .map((e) => ({
        user_id: userId, role: userId ? (role || null) : 'anonimo', anon_id: anonId, tipo: e.tipo,
        rota: (redigir(e.rota).slice(0, 200)) || null,
        alvo: (redigir(e.alvo).slice(0, 200)) || null,
        detalhe: (redigir(e.detalhe).slice(0, 300)) || null,
        ...(tsValido(Number(e.ts)) ? { criado_em: new Date(Number(e.ts)).toISOString() } : {}),
      }));
    if (rows.length) {
      await fetch(`${SB}/rest/v1/eventos_atividade`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(rows), signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    // ORIGEM DO CLIQUE (gclid/UTM) — PRIMEIRO TOQUE, gravado uma única vez por anon_id.
    // `ignore-duplicates` é o que garante o first touch: a pessoa volta pelo orgânico depois,
    // e o crédito continua com o clique que a trouxe. Sem isto, a última visita sobrescreveria
    // a campanha e o Ads pareceria não converter nada.
    const o = b.origem;
    if (anonId && o && typeof o === 'object') {
      const txt = (v, n = 120) => {
        const s = String(v ?? '').trim();
        return s && !RE_SEGREDO.test(s) ? s.slice(0, n) : null;
      };
      const linha = {
        anon_id: anonId,
        // `fbclid` fecha o par do gclid: sem ele, campanha do Meta não deixa rastro nenhum
        // em `visita_origem`, e o Lead do CAPI perde o `fbc` que faz a correspondência.
        gclid: txt(o.gclid), gbraid: txt(o.gbraid), wbraid: txt(o.wbraid), fbclid: txt(o.fbclid),
        // `oppref`: o id de clique do OpenAI Ads (ChatGPT Ads) — o gclid deles.
        oppref: txt(o.oppref),
        utm_source: txt(o.utm_source, 60), utm_medium: txt(o.utm_medium, 60),
        utm_campaign: txt(o.utm_campaign, 120), utm_term: txt(o.utm_term, 120), utm_content: txt(o.utm_content, 120),
        referrer_host: txt(o.referrer_host, 120), landing: txt(o.landing, 200),
      };
      // Só grava se houver ALGO além do anon_id — linha vazia não é origem, é ruído.
      if (Object.entries(linha).some(([k, v]) => k !== 'anon_id' && v)) {
        await fetch(`${SB}/rest/v1/visita_origem`, {
          method: 'POST',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
            Prefer: 'return=minimal,resolution=ignore-duplicates' },
          body: JSON.stringify(linha), signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    }
  } catch { /* nunca falha o cliente por causa do track */ }
  res.status(204).end();
}
