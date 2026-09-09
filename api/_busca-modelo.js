/**
 * QUAL MODELO CLAUDE FAZ A BUSCA DE MERCADO — e com QUAL variante da ferramenta.
 *
 * O Gemini (Google Search grounding) é o motor primário desde 30/07. O Claude é o FALLBACK,
 * e em 08/09 ele deixou de ser exceção: o projeto do Gemini foi negado (HTTP 403 "Your project
 * has been denied access") e TODA busca passou a cair aqui. Foi então que o custo e o tempo do
 * fallback saíram do papel — o `claude-sonnet-4-6` abortava no teto de tempo em 17 de 17
 * relatórios do dia, contra 0 em 62 nos 13 dias anteriores.
 *
 * Decisão do dono (09/09): "na falta do Gemini o Claude entra automaticamente usando um modelo
 * econômico e eficiente (Haiku)". Haiku 4.5 custa US$ 1/US$ 5 por milhão de tokens contra
 * US$ 3/US$ 15 do Sonnet 4.6 — **3x mais barato** — e responde bem mais rápido, que é o outro
 * lado do problema: o fallback não abortava por ser fraco, abortava por ser lento.
 *
 * ── O PAREAMENTO É OBRIGATÓRIO, E ERRAR NELE É UM 400 ────────────────────────────────────
 * A ferramenta de busca do Claude tem duas variantes, e elas NÃO valem para todo modelo:
 * `web_search_20260209` (filtragem dinâmica) só existe em Opus 4.6+/5 e Sonnet 4.6/5;
 * modelos fora dessa lista — Haiku 4.5 entre eles — usam a básica `web_search_20250305`.
 * Mandar a nova para o Haiku devolve 400, e um 400 aqui não é "sem amostras": é o relatório
 * inteiro caindo. Por isso a variante NÃO é escolhida à mão em nenhum chamador; ela sai daqui,
 * do lado do modelo, e o teste `testar:busca-modelo` vigia o par.
 *
 * ── A CASCATA É BARATO → CAPAZ, E SÓ SOBE DE GRAÇA ───────────────────────────────────────
 * Haiku primeiro; se o Anthropic recusar por ESTRUTURA (4xx — modelo/ferramenta incompatíveis,
 * ou o contexto de 200 mil tokens do Haiku estourado pelos ~114 mil que o resultado da busca
 * devolve), sobe para o Sonnet. Um 4xx volta em segundos, então subir não custa tempo.
 * Timeout/abort NÃO sobe degrau: ali o orçamento já foi gasto, e repetir com um modelo mais
 * lento só troca o instante da morte — foi exatamente o que a medição de 09/09 refutou quando
 * ampliamos o orçamento de 118s para 180s e o Claude abortou no teto do mesmo jeito.
 */

// Sufixo de data não faz parte do id atual (`claude-haiku-4-5`), mas o acervo tem chamadas
// antigas com ele — normaliza antes de comparar, senão o par silenciosamente escolhe errado.
const semData = (m) => String(m || '').trim().toLowerCase().replace(/-\d{6,8}$/, '');

/** Modelos em que a variante NOVA da busca (filtragem dinâmica) existe. */
const WEB_SEARCH_DINAMICA = new Set([
  'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
  'claude-sonnet-5', 'claude-sonnet-4-6',
]);

/** A ferramenta de busca CERTA para este modelo. Nunca escolha a variante fora daqui. */
export function ferramentaBusca(model, maxUses) {
  return {
    type: WEB_SEARCH_DINAMICA.has(semData(model)) ? 'web_search_20260209' : 'web_search_20250305',
    name: 'web_search',
    ...(Number(maxUses) > 0 ? { max_uses: Number(maxUses) } : {}),
  };
}

/**
 * Degraus do fallback, do mais barato ao mais capaz. `MERCADO_MODELO_BUSCA` troca o 1º degrau
 * sem deploy (o dono pediu economia; se um dia o Haiku não der conta de uma praça, dá para
 * medir a alternativa mudando uma variável em vez de subir código).
 */
export function cascataBusca() {
  const primeiro = String(process.env.MERCADO_MODELO_BUSCA || 'claude-haiku-4-5').trim();
  const degraus = [primeiro];
  // O degrau de cima é o modelo que a busca usava antes desta mudança: se o Haiku recusar por
  // estrutura, o comportamento volta a ser EXATAMENTE o de antes. A troca não pode piorar nada.
  if (semData(primeiro) !== 'claude-sonnet-4-6') degraus.push('claude-sonnet-4-6');
  return degraus.map((model) => ({ model, ferramenta: (n) => ferramentaBusca(model, n) }));
}

/**
 * Vale a pena subir um degrau depois DESTE erro? Só quando a recusa foi estrutural e imediata.
 * `anthropic()` lança `anthropic_http_<status>`; 4xx é decisão do servidor (chegou em segundos),
 * 5xx e abort/timeout já consumiram o orçamento.
 */
export function subirDegrau(erro) {
  const m = /anthropic_http_(\d{3})/.exec(String(erro?.message || erro || ''));
  if (!m) return false;
  const status = Number(m[1]);
  // 401/403 é chave/permissão: trocar de modelo não resolve e ainda gasta uma chamada.
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;
}

/**
 * Roda `fn(degrau)` na cascata: começa no barato e só sobe quando a recusa foi estrutural.
 *
 * Existe para não haver TRÊS cópias desta regra — `gerar-analise`, `indice-mercado` e
 * `indice-reforco-cron` fazem a mesma queda de Gemini para Claude, e regra duplicada nesta
 * base sempre divergiu (o `verificar:padroes` nasceu de um caso assim). Quem chama só decide
 * quanto tempo ainda tem (`podeContinuar`) e o que registrar (`aoFalhar`).
 *
 * Propaga o erro do ÚLTIMO degrau — nunca devolve vazio disfarçado de resposta.
 */
export async function comCascataBusca(fn, { podeContinuar = () => true, aoFalhar = null } = {}) {
  const degraus = cascataBusca();
  let ultimo = null;
  for (let i = 0; i < degraus.length; i++) {
    try {
      return await fn(degraus[i], i);
    } catch (e) {
      ultimo = e;
      const sobe = subirDegrau(e) && i < degraus.length - 1 && podeContinuar();
      if (aoFalhar) { try { aoFalhar(degraus[i], e, sobe); } catch { /* log nunca derruba a busca */ } }
      if (!sobe) throw e;
    }
  }
  throw ultimo;
}
