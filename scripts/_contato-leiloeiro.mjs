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
// lgpd/privacidade/encarregado (29/09): canal de PROTEÇÃO DE DADOS não recebe proposta — o 1º
// varredor pegou lgpd@kleiloes.com.br como "contato do leiloeiro".
const BLOQUEADOS = /^(noreply|no-reply|naoresponda|nao-responda|donotreply|webmaster|postmaster|abuse|privacy|privacidade|lgpd|dpo|encarregado|unsubscribe|newsletter|mailer-daemon)@/i;
// Padrões que sinalizam "isto é o contato de atendimento" — preferidos quando há mais de um.
const PREFERIDOS = /^(contato|atendimento|sac|faleconosco|fale-conosco|comercial|leiloes|leilao|central|info|contact|suporte)@/i;

// E-MAIL PROTEGIDO PELO CLOUDFLARE (29/09). Medido nas homes das 57 fontes sem contato: 25 servem
// o e-mail só como `data-cfemail="<hex>"` / `/cdn-cgi/l/email-protection#<hex>` (o navegador
// decodifica com JS; o HTML cru não tem "@" nenhum). Era a MAIOR causa de "leiloeiro sem e-mail":
// o coletor via a página, não achava "@" e seguia calado. Formato: 1º byte é a chave, os demais
// XOR com ela — decodificar não é contornar nada, é o mesmo que o navegador faz para exibir.
export function decodificarCfEmail(hex) {
  const h = String(hex || '');
  if (!/^[0-9a-f]{6,}$/i.test(h) || h.length % 2) return null;
  const k = parseInt(h.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16) ^ k);
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(out) ? out.toLowerCase() : null;
}

function candidatosEmail(html) {
  if (!html) return [];
  const vistos = new Set();
  const out = [];
  // Cloudflare: o link protegido equivale a um mailto (forte); o texto protegido, a texto solto.
  for (const [re, forte] of [[/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, true], [/data-cfemail="([0-9a-f]+)"/gi, false]]) {
    for (const m of html.matchAll(re)) {
      const e = decodificarCfEmail(m[1]);
      if (e && !vistos.has(e)) { vistos.add(e); out.push({ email: e, forte, pos: m.index }); }
    }
  }
  // mailto: primeiro — é o sinal mais forte de "este é o contato clicável da página", não
  // apenas um e-mail que apareceu solto em algum texto (ex.: e-mail de exemplo, de terceiro).
  // Exclui `\` do que pode compor o e-mail (achado 11/09, dado real: LJUD capturou
  // "contato@leiloesjudiciais.com.br\" com barra grudada). Causa: o mailto vinha dentro de um
  // JSON serializado na própria página (`__NEXT_DATA__`-like), onde a aspa de fechamento
  // aparece escapada (`\"`) — sem excluir `\`, a captura engolia a barra da escape ANTES da
  // aspa real, já que só aspas/interrogação/espaço cortavam o match.
  for (const m of html.matchAll(/mailto:([^"'\\?\s]+)/gi)) {
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
export function extrairEmailDeHtml(html, origemSite = null, { paginaContato = false } = {}) {
  // Na página de CONTATO do próprio site, e-mail exibido é o contato por definição — vale como
  // mailto (é o que libera o gmail/hotmail do leiloeiro pequeno, ex.: JE Leilões).
  const cands = candidatosEmail(html).map(c => (paginaContato ? { ...c, forte: true } : c)).filter(c => !BLOQUEADOS.test(c.email)
    && (!origemSite || motivoRecusaEmail(c.email, origemSite, c.forte) === null));
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

// ── O E-MAIL É DO DONO DO SITE? (28/09) ─────────────────────────────────────────────────────
// A home de plataforma multi-tenant exibe e-mail de TERCEIRO: o SUPERBID mostrava o de UM
// leiloeiro em destaque (contato@jrfleiloes.com.br, que passou a receber pedido de veículo de
// leiloeiros que não eram ele), a HASTAPUBLICA o da Valland, a MEGA o da agência que fez o
// site (meta "copyright"). Regra: só vale e-mail do MESMO domínio do site; provedor gratuito
// (leiloeiro pequeno usa gmail) só se vier num `mailto:` — link clicável de contato, não texto
// solto de vitrine/JSON. Fora disso não grava: sem contato a tela PEDE o e-mail certo, com
// contato errado o pedido vai para a pessoa errada e parece ter funcionado.
const SUFIXOS_2 = /^(com|net|org|gov|edu|adv|art|ind|inf|leilao|srv|eco|blog|emp|log|imb)$/;
const GRATUITOS = /^(gmail\.com|googlemail\.com|hotmail\.com(\.br)?|outlook\.com(\.br)?|live\.com|yahoo\.com(\.br)?|uol\.com\.br|bol\.com\.br|terra\.com\.br|ig\.com\.br|icloud\.com)$/;
export function dominioBase(host) {
  const p = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (p.length < 2) return p.join('.');
  const n = (p[p.length - 1].length === 2 && SUFIXOS_2.test(p[p.length - 2])) ? 3 : 2;
  return p.slice(-n).join('.');
}
/** `null` = aceito; string = motivo da recusa. */
export function motivoRecusaEmail(email, origemSite, forte) {
  const dom = String(email || '').split('@')[1] || '';
  let host = '';
  try { host = new URL(origemSite).hostname; } catch { return 'site sem URL válida'; }
  if (dominioBase(dom) === dominioBase(host)) return null;
  // Mesma marca em outro TLD (29/09): alfaleiloes.com.br publica contato@alfaleiloes.com. O
  // rótulo precisa ser específico (≥ 6 letras e não genérico), senão "leiloes.com" casaria tudo.
  const rotulo = (d) => dominioBase(d).split('.')[0];
  if (rotulo(dom) === rotulo(host) && rotulo(dom).length >= 6 && !/^(leiloes?|leilao|imoveis|contato)$/.test(rotulo(dom))) return null;
  if (GRATUITOS.test(dom)) return forte ? null : 'provedor gratuito fora de mailto:';
  return `domínio de terceiro (${dom} ≠ ${dominioBase(host)})`;
}

// ── RECON: "este leiloeiro vende veículo?" (11/09) ──────────────────────────────────────────
// Reaproveita o MESMO fetch da home (já feito para o e-mail) para procurar um link de menu
// tipo "Veículos"/"Carros"/"Automóveis" — sem nenhum custo de rede extra. Isto NÃO é um
// scraper de veículos: é só o sinal que decide se vale a pena escrever um, fonte por fonte,
// depois de ver o dado real (mesma lição do CLAUDE.md que já mordeu esta base várias vezes:
// nunca supor estrutura de site sem checar).
const ANCORA_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
const PALAVRA_VEICULO = /\b(ve[íi]culos?|autom[óo]veis?|carros?)\b/i;
const HREF_VEICULO = /[/?](veiculos?|carros?|automoveis?)(?:[/?&-]|$)/i;

export function detectarSegmentoVeiculos(html) {
  if (!html) return null;
  for (const m of html.matchAll(ANCORA_RE)) {
    const href = String(m[1] || '');
    if (!href || /^(javascript:|#|mailto:|tel:)/i.test(href)) continue;
    const textoTag = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (PALAVRA_VEICULO.test(textoTag)) return { url: href, texto: textoTag.slice(0, 80) };
    if (HREF_VEICULO.test(href)) return { url: href, texto: textoTag.slice(0, 80) || '(achado pela URL do link, sem texto claro)' };
  }
  return null;
}

// Links da home que levam à página de contato do MESMO site (29/09): 17 das fontes sem contato
// não têm e-mail na home, só em /contato, /fale-conosco, /atendimento etc.
export function linksDeContato(html, origin) {
  const out = [];
  let host;
  try { host = new URL(origin).hostname; } catch { return out; }
  for (const m of String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (/^(mailto:|tel:|javascript:)/i.test(href) || !/(contato|fale-?conosco|atendimento|contact)/i.test(href)) continue;
    let u;
    try { u = new URL(href, origin); } catch { continue; }
    if (dominioBase(u.hostname) !== dominioBase(host) || /indique|como-vender|comprovante|privacidade|cookies|termos/i.test(u.pathname)) continue;
    if (!out.includes(u.href)) out.push(u.href);
  }
  return out.sort((a, b) => a.length - b.length).slice(0, 2);
}

const UA_NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
async function htmlDe(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA_NAVEGADOR, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Procura o e-mail do leiloeiro na home e, se não houver, na página de contato. Nunca lança:
 * devolve `{ achado, url, motivo, htmlHome }` — `motivo` diz POR QUE não achou (bloqueado, sem
 * e-mail, só e-mail de terceiro), porque "não achei" calado foi o que escondeu o buraco.
 */
export async function buscarEmailDoSite(origin, { obterHtml = htmlDe } = {}) {
  let htmlHome;
  try { htmlHome = await obterHtml(origin); } catch (e) { return { achado: null, motivo: `home inacessível (${String(e?.message || e).slice(0, 60)})` }; }
  let achado = extrairEmailDeHtml(htmlHome, origin);
  if (achado) return { achado, url: origin, htmlHome };
  const recusados = candidatosEmail(htmlHome).map(c => c.email).filter(e => !BLOQUEADOS.test(e));
  for (const url of linksDeContato(htmlHome, origin)) {
    let html;
    try { html = await obterHtml(url); } catch { continue; } // padrao-ok: página de contato é 2ª tentativa; o motivo final sai abaixo
    achado = extrairEmailDeHtml(html, origin, { paginaContato: true });
    if (achado) return { achado, url, htmlHome };
    recusados.push(...candidatosEmail(html).map(c => c.email).filter(e => !BLOQUEADOS.test(e)));
  }
  const motivo = recusados.length
    ? `só e-mail de outro domínio (${[...new Set(recusados)].slice(0, 3).join(', ')})`
    : `nenhum e-mail na home${linksDeContato(htmlHome, origin).length ? ' nem na página de contato' : ' (sem link de contato)'}`;
  return { achado: null, motivo, htmlHome };
}

/**
 * `urlAmostra`: qualquer URL real do site do leiloeiro (ex.: link_lote de um item recém
 * coletado) — só usamos a ORIGEM dela (protocolo+domínio) para buscar a home, onde o rodapé
 * de contato e o menu principal normalmente vivem. Nunca lança: chamador não precisa de
 * try/catch. Faz UM fetch só e alimenta as duas capturas (e-mail + sinal de veículos).
 */
export async function capturarContatoSeAusente(supabase, fonte, urlAmostra) {
  if (!fonte || !urlAmostra) return;
  let origin;
  try { origin = new URL(urlAmostra).origin; } catch { return; }

  try {
    // Duas checagens de "já sei disso e é recente" INDEPENDENTES — uma não pode bloquear a
    // outra. Sem isto, uma fonte com e-mail já capturado (ex.: SODRE) nunca mais teria o
    // sinal de veículos verificado, porque o `return` antecipado do e-mail cortava tudo.
    const [{ data: contato, error: erroContato }, { data: seg, error: erroSeg }] = await Promise.all([
      supabase.from('leiloeiro_contato').select('origem, atualizado_em').eq('fonte', fonte).maybeSingle(),
      supabase.from('leiloeiro_segmento_veiculos').select('atualizado_em').eq('fonte', fonte).maybeSingle(),
    ]);
    // Falha de LEITURA do e-mail não pode virar "não existe contato manual" — proceder sem
    // saber arriscaria sobrescrever uma correção humana que só não conseguimos enxergar agora.
    if (erroContato) return;
    const emailEmDia = contato?.origem === 'manual' ||
      (contato?.origem === 'auto' && contato.atualizado_em && (Date.now() - new Date(contato.atualizado_em).getTime()) < TRINTA_DIAS_MS);
    // Falha de leitura do sinal de veículos É segura de ignorar (não há "correção manual" a
    // proteger aqui) — só significa "trata como se nunca tivesse verificado".
    const segmentoEmDia = !erroSeg && seg?.atualizado_em && (Date.now() - new Date(seg.atualizado_em).getTime()) < TRINTA_DIAS_MS;
    if (emailEmDia && segmentoEmDia) return; // nada a atualizar — não busca a página à toa

    const busca = await buscarEmailDoSite(origin);
    const html = busca.htmlHome;
    if (!html) { console.log(`    📧 ${fonte}: ${busca.motivo}`); return; }

    if (!emailEmDia) {
      const achado = busca.achado;
      if (!achado) console.log(`    📧 ${fonte}: sem contato — ${busca.motivo}`);
      // Endereço já suprimido (bounce permanente / reclamação) não volta pela porta dos fundos:
      // o gatilho do banco o tirou daqui, e recapturá-lo desfaria a contramedida.
      let suprimido = false;
      if (achado) {
        const { data: sup, error: eSup } = await supabase.from('emails_supressao').select('suprimido').eq('destinatario', achado.email).maybeSingle();
        suprimido = eSup ? true : !!sup?.suprimido; // não consegui checar → não grava (conservador)
        if (suprimido) console.log(`    📧 ${fonte}: ${achado.email} ignorado (${eSup ? `supressão ilegível: ${eSup.message}` : 'endereço suprimido'})`);
      }
      if (achado && !suprimido) {
        const { error } = await supabase.from('leiloeiro_contato').upsert({
          fonte, email: achado.email, origem: 'auto', observacao: achado.contexto,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'fonte' });
        if (!error) console.log(`    📧 ${fonte}: contato capturado automaticamente (${achado.email})`);
      }
    }

    if (!segmentoEmDia) {
      const segmento = detectarSegmentoVeiculos(html);
      const { error: erroGravaSeg } = await supabase.from('leiloeiro_segmento_veiculos').upsert({
        fonte, tem_sinal: !!segmento,
        url_segmento: segmento ? new URL(segmento.url, origin).href : null,
        texto_sinal: segmento?.texto || null,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'fonte' });
      if (!erroGravaSeg && segmento) console.log(`    🚗 ${fonte}: sinal de veículos no menu ("${segmento.texto}" → ${segmento.url})`);
    }
  } catch { /* padrao-ok: captura de contato/recon é best-effort — nunca pode atrasar/derrubar a coleta */ }
}

// ── CONTATO POR LEILOEIRO NA REDE SUPERBID (28/09) ──────────────────────────────────────────
// Na rede Superbid cada oferta traz o `store` = o leiloeiro de verdade daquele lote. O mesmo
// objeto que a home exibe carregava o e-mail dele no `ticker` ("+55 (18) 3351-2317 ::
// contato@jrfleiloes.com.br :: :: ") — foi daí que o coletor antigo tirou a JRF e a gravou como
// contato do SUPERBID INTEIRO. Aqui o e-mail fica preso ao leiloeiro que o publicou.
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export function lojaSuperbid(store) {
  if (!store || typeof store !== 'object') return { nome: typeof store === 'string' ? store.trim() : '', email: null };
  const nome = String(store.description ?? store.name ?? '').trim();
  const fonteEmail = typeof store.ticker === 'string' ? store.ticker : JSON.stringify(store);
  const email = (fonteEmail.match(RE_EMAIL) || [])[0]?.toLowerCase() || null;
  return { nome, email: email && !BLOQUEADOS.test(email) ? email : null };
}

/** Grava {leiloeiro,email} da coleta. Nunca lança; loga quanto gravou (ou por que não). */
export async function gravarContatosTenant(supabase, fonte, itens) {
  const lista = (itens || []).filter(i => i?.leiloeiro && i?.email);
  if (!lista.length) { console.log(`    📧 ${fonte}: nenhum e-mail de leiloeiro publicado nas ofertas desta rodada`); return 0; }
  try {
    const { data, error } = await supabase.rpc('contato_leiloeiro_tenant_auto', { p_fonte: fonte, p_itens: lista });
    if (error) { console.log(`    📧 ${fonte}: contatos por leiloeiro NÃO gravados (${error.message})`); return 0; }
    console.log(`    📧 ${fonte}: ${data} contato(s) por leiloeiro gravados/atualizados (${lista.length} leiloeiro(s) com e-mail na rodada)`);
    return data;
  } catch (e) { console.log(`    📧 ${fonte}: contatos por leiloeiro falharam (${String(e?.message || e).slice(0, 120)})`); return 0; }
}
