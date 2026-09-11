/**
 * CAPTURA AUTOMÁTICA DE E-MAIL DO LEILOEIRO (11/09, pedido do dono).
 *
 * "Pedir informações ao leiloeiro" (Análise documental) só dispara e-mail de verdade quando
 * `leiloeiro_contato` tem endereço para a fonte — e nenhuma fonte tinha, até agora, cadastro
 * nenhum. Em vez de depender só de cadastro manual, o SCRAPER já visita o site de cada
 * leiloeiro a cada rodada; aqui reaproveitamos ISSO: uma busca leve (fetch simples, sem
 * Puppeteer — o rodapé de contato costuma ser HTML estático mesmo em site com SPA) na home do
 * site já visitado, procurando o e-mail que o PRÓPRIO leiloeiro expõe.
 *
 * Best-effort por natureza: site sem rodapé estático (SPA 100% client-rendered) simplesmente
 * não encontra nada e segue sem erro — nunca deve atrasar nem derrubar a coleta.
 *
 * `origem` é o que protege contra sobrescrever uma correção humana: 'auto' só é regravado por
 * 'auto' (e só depois de 30 dias — não fica batendo na mesma fonte toda rodada); 'manual' nunca
 * é tocado por esta função. A tela de ajuste no Admin é para quando o e-mail capturado vier
 * errado (endereço genérico, formulário sem e-mail direto, etc.) — o `observacao` guarda o
 * trecho de texto ao redor de onde o e-mail foi achado, para quem revisa confirmar que faz
 * sentido sem precisar abrir o site de novo.
 */

// Endereços de sistema — nunca são "o contato do leiloeiro", mesmo sendo o único achado.
const BLOQUEADOS = /^(noreply|no-reply|naoresponda|nao-responda|donotreply|webmaster|postmaster|abuse|privacy|dpo|unsubscribe|newsletter|mailer-daemon)@/i;
// Padrões que sinalizam "isto é o contato de atendimento" — preferidos quando há mais de um.
const PREFERIDOS = /^(contato|atendimento|sac|faleconosco|fale-conosco|comercial|leiloes|leilao|central|info|contact|suporte)@/i;

function candidatosEmail(html) {
  if (!html) return [];
  const vistos = new Set();
  const out = [];
  // mailto: primeiro — é o sinal mais forte de "este é o contato clicável da página", não
  // apenas um e-mail que apareceu solto em algum texto (ex.: e-mail de exemplo, de terceiro).
  for (const m of html.matchAll(/mailto:([^"'?\s]+)/gi)) {
    const e = String(m[1] || '').trim().toLowerCase();
    if (e && !vistos.has(e)) { vistos.add(e); out.push({ email: e, forte: true, pos: m.index }); }
  }
  for (const m of html.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const e = String(m[0] || '').trim().toLowerCase();
    if (e && !vistos.has(e)) { vistos.add(e); out.push({ email: e, forte: false, pos: m.index }); }
  }
  return out;
}

/** Exportado para poder testar isoladamente (ver scripts/lib scraper-core não se aplica aqui — HTML puro). */
export function extrairEmailDeHtml(html) {
  const cands = candidatosEmail(html).filter(c => !BLOQUEADOS.test(c.email));
  if (!cands.length) return null;
  const escolhido = cands.find(c => PREFERIDOS.test(c.email)) || cands.find(c => c.forte) || cands[0];
  // Contexto: texto ao redor da posição onde o candidato foi achado, sem tags — é o "texto
  // descritivo" que permite ao admin confirmar de relance que o e-mail faz sentido.
  const ini = Math.max(0, (escolhido.pos || 0) - 60);
  const bruto = html.slice(ini, (escolhido.pos || 0) + escolhido.email.length + 40);
  const contexto = bruto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  return { email: escolhido.email, contexto: contexto || null };
}

const TRINTA_DIAS_MS = 30 * 24 * 3600 * 1000;

/**
 * `urlAmostra`: qualquer URL real do site do leiloeiro (ex.: link_lote de um item recém
 * coletado) — só usamos a ORIGEM dela (protocolo+domínio) para buscar a home, onde o rodapé
 * de contato normalmente vive. Nunca lança: chamador não precisa de try/catch.
 */
export async function capturarContatoSeAusente(supabase, fonte, urlAmostra) {
  if (!fonte || !urlAmostra) return;
  try {
    const { data: existente, error: erroLeitura } = await supabase
      .from('leiloeiro_contato').select('origem, atualizado_em').eq('fonte', fonte).maybeSingle();
    // Falha de LEITURA não pode virar "não existe contato manual" — proceder sem saber
    // arriscaria sobrescrever uma correção humana que só não conseguimos enxergar agora.
    if (erroLeitura) return;
    if (existente?.origem === 'manual') return; // correção humana é definitiva
    if (existente?.origem === 'auto' && existente.atualizado_em
        && (Date.now() - new Date(existente.atualizado_em).getTime()) < TRINTA_DIAS_MS) return;

    let origin;
    try { origin = new URL(urlAmostra).origin; } catch { return; }

    const res = await fetch(origin, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BidProBrasilBot/1.0)' } }).catch(() => null);
    if (!res?.ok) return;
    const html = await res.text();
    const achado = extrairEmailDeHtml(html);
    if (!achado) return;

    const { error } = await supabase.from('leiloeiro_contato').upsert({
      fonte, email: achado.email, origem: 'auto', observacao: achado.contexto,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'fonte' });
    if (!error) console.log(`    📧 ${fonte}: contato capturado automaticamente (${achado.email})`);
  } catch { /* padrao-ok: captura de contato é best-effort — nunca pode atrasar/derrubar a coleta */ }
}
