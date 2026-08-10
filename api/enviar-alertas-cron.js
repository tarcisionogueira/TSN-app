/**
 * /api/enviar-alertas-cron — e-mail de oportunidades. Roda TODO DIA às 11h UTC
 * (= 8h de Brasília, horário de envio ao cliente).
 * Cadência por usuário:
 *   • 1º e-mail (boas-vindas): 24h após criar a conta, em QUALQUER dia — quem se
 *     cadastra no meio da semana não fica sem oportunidade até a segunda seguinte.
 *   • Recorrente: toda SEGUNDA-feira (com trava anti-reenvio de 7 dias).
 * Benefício de AMBOS os planos (Explorador e Investidor Pro): ATÉ 12 oportunidades.
 * Quem clicar em "cancelar" para de receber (opt-out via alertas_email.ativo=false).
 *
 * ASSERTIVIDADE (só oportunidades de interesse): quando o cliente tem filtro salvo
 * na busca (praça/tipo/valor/desconto/bairros), o e-mail respeita ESSE perfil e NÃO
 * cai no fallback amplo por estado — melhor não mandar do que mandar irrelevante.
 *
 * Seleção por usuário (ordem de interesse):
 * As 12 vagas são DIVIDIDAS entre os critérios (regra do dono): com filtros salvos
 * E cidade+perfil → 6 vagas p/ os filtros salvos + 6 p/ cidade+perfil; a sobra de um
 * critério é preenchida pelo outro. Só um critério presente → ele leva as 12.
 *   1. Filtros salvos na busca (filtros_salvos) — sinal de interesse explícito.
 *   2. Cidade do cadastro/triagem (perfis.endereco_cidade/uf) com RAIO CRESCENTE
 *      (50→100→200km, MÁXIMO 200km — deslocamento viável p/ o investidor) RESPEITANDO
 *      O PERFIL DO INVESTIDOR: 1º passe com tipo/modalidade/pagamento (filtros do
 *      alerta + forma_pagamento da triagem) e TETO de capital (faixa_capital da
 *      triagem × valorMax do alerta, o menor); 2º passe relaxa as preferências mas
 *      mantém o teto — acima do capital do cliente não entra nunca.
 *   3. Se tiver arrematação registrada → inclui similares (mesmo tipo/estado, ≤ teto).
 *   4. Sem nenhuma referência de região → melhores do país (≤ teto);
 *      se não fechar 12, manda os que houver, por maior desconto.
 *
 * Links do e-mail: card → /#/imovel/:id (tela do imóvel) · logo e botão → /#/buscar
 * (leva o cliente direto à plataforma/busca). Remetente: noreply@bidprobrasil.com.br.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { escapeHtml } from './_sanitize.js';
import MUNICIPIOS from './_municipios.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { ALLOWED_HOSTS } from './_allowed-hosts.js';
import { enviarWebPush } from './_webpush.js';
import { encerradoPorDatas } from './_leilao-encerrado.js';
import { CIDADES_TEMPORADA } from './_temporada.js';

// Espelho das constantes da Busca (src/pages/Busca.jsx) — a INTENÇÃO salva no filtro
// restringe tipo/desconto e precisa valer também no e-mail. Ao mexer lá, mexa aqui.
const TIPOS_RESIDENCIAL = ['apartamento', 'casa', 'imovel'];              // locação/temporada
const TIPOS_LIQUIDOS    = ['apartamento', 'casa', 'comercial', 'imovel']; // revenda (flip)
const REVENDA_DESCONTO_MIN = 30;
// Checkbox da Busca ('aVista') → valor canônico do banco ('a_vista'). O filtro salvo guarda a
// CHAVE do checkbox; mandar a chave crua para a RPC não casava com nada e o filtro de
// pagamento simplesmente não existia no e-mail.
const PAG_CANON = { aVista: 'a_vista', financiado: 'financiado', hipotecado: 'hipotecado' };
const pagCanon = (l) => [...new Set((Array.isArray(l) ? l : [])
  .map(k => PAG_CANON[k] || (Object.values(PAG_CANON).includes(k) ? k : null)).filter(Boolean))];

const norm = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function centroide(cidade, uf) {
  if (!cidade || !uf) return null;
  const c = MUNICIPIOS[`${String(uf).toUpperCase()}|${norm(cidade)}`];
  return Array.isArray(c) ? { lat: c[0], lng: c[1] } : null;
}
const SEL = 'id,titulo,endereco,cidade,estado,tipo,modalidade,valor_minimo,valor_avaliacao,desconto_percentual,data_leilao,data_leilao_2,data_fim,link_foto,fonte,fonte_id';

// Foto para o E-MAIL: url ÚNICA e confiável (o e-mail não tem fallback onError como o
// site). Motivo do "sem foto" em alguns cards: fontes como a Caixa BLOQUEIAM hotlink de
// clientes de e-mail (referer/IP) — a foto existe (aparece no site) mas o e-mail não
// carrega. Fix: se o host da foto está na whitelist, serve pelo NOSSO /api/img-proxy
// (que manda o Referer correto e busca do nosso IP). supabase/local vai direto; host
// fora da whitelist cai no hotlink direto (best-effort); CEF deriva a foto de fonte_id
// no padrão F<num>21.jpg (confirmado servindo 200/JPEG) e proxia. URL absoluta ou null.
function fotoParaEmail(im, base) {
  // Proxy SEMPRE por www: o apex bidprobrasil.com.br responde 308 e clientes de e-mail
  // (Gmail) não seguem redirect em <img>, então a foto some.
  const proxBase = String(base || '').replace(/:\/\/(www\.)?bidprobrasil\.com\.br/, '://www.bidprobrasil.com.br');
  const src = im?.link_foto || '';
  // 1) Foto já hospedada por NÓS (Storage do Supabase): é o caminho confiável no e-mail —
  //    a Caixa RECUSA o IP da Vercel (edge e node), então o img-proxy dá 404 no Gmail.
  //    O backfill (scripts/backfill-fotos-caixa.mjs) migra as fotos da Caixa p/ o Storage.
  if (src.includes('supabase.co')) return src;
  const isCef = im?.fonte === 'CEF' || im?.fonte === 'caixa';
  if (isCef && im?.fonte_id) {
    // Fallback enquanto a foto não foi migrada: img-proxy da Caixa. ATENÇÃO: no e-mail
    // (Gmail) isto tende a FALHAR, porque a Caixa não atende o IP da Vercel — a foto só
    // aparece de verdade depois do backfill p/ o Storage. Mantido p/ não piorar o site.
    const num = String(im.fonte_id).replace(/^(caixa_|cef_)/, '');
    const caixa = `https://venda-imoveis.caixa.gov.br/fotos/F${num}21.jpg`;
    return `${proxBase}/api/img-proxy?url=${encodeURIComponent(caixa)}`;
  }
  if (!src) return null;
  if (src.startsWith('/')) return `${proxBase}${src}`;
  if (!/^https?:\/\//.test(src)) return null;
  // Demais leiloeiros carregam hotlink direto no e-mail (como no print) — não roteamos p/ não regredir.
  return src;
}

// IMPORTANTE: exportar por MÉTODO nomeado (GET/POST), não `export default`. No runtime
// Node da Vercel, `export default` é tratado como assinatura Express `(req, res)` e o
// `Response` retornado é IGNORADO — a função nunca sinaliza fim e trava até o maxDuration
// (504 "Task timed out after 300s") a cada execução. Com GET/POST o `req` é um Request
// Web e o `Response` é honrado (a função retorna assim que o trabalho termina).
export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('ok', { status: 200 });
  // Modo de teste: ?email=voce@x.com&secret=<CRON_SECRET> envia só para esse e-mail
  // (ignora a trava de 1x/semana e o opt-out) — prático para validar no navegador.
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const testeEmail = (qs.get('email') || '').trim().toLowerCase();
  // Modo FORÇAR: ?forcar=1 (com header CRON_SECRET) ignora o gate de "só segunda"
  // para um disparo pontual em outro dia (ex.: a segunda não saiu). MANTÉM o opt-out
  // e a trava anti-reenvio de 7 dias — não re-spamma quem já recebeu na semana.
  const forcar = qs.get('forcar') === '1';
  // Auth SOMENTE por header (isCronAuthorized) — sem ?secret= por query (vazaria em
  // logs e permitia bular opt-out/throttle). O ?email= só escolhe o destinatário de teste.
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });

  const URL_ = process.env.VITE_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  // Remetente do e-mail do CLIENTE: desacoplado do APP_FROM_EMAIL (que é o
  // remetente global de alertas de sistema/admin). Garante noreply@ para o
  // cliente independentemente do env global. Override dedicado se precisar.
  const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
  const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
  if (!URL_ || !KEY) return new Response(JSON.stringify({ error: 'env not configured' }), { status: 500 });
  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  // Push (opcional): mesmo conteúdo do e-mail vira notificação push para quem
  // autorizou. Best-effort — se as chaves VAPID não existirem, só o e-mail sai.
  const VAPID = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: 'mailto:alertas@bidprobrasil.com.br' };
  const pushHabilitado = !!(VAPID.publicKey && VAPID.privateKey);
  async function enviarPushOportunidades(userId, titulo, corpo) {
    if (!pushHabilitado) return;
    try {
      const r = await fetch(`${URL_}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=endpoint,p256dh,auth`, {
        headers: hdr, signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return;
      const subs = await r.json();
      if (!Array.isArray(subs) || !subs.length) return;
      const payload = { title: titulo, body: corpo, url: '/#/buscar', tag: 'oportunidades', icon: '/logo.svg' };
      await Promise.all(subs.map(async (s) => {
        const res = await enviarWebPush(s, payload, VAPID);
        // Limpa inscrição expirada (404/410) para não tentar de novo na próxima.
        if (res.status === 410 || res.status === 404) {
          await fetch(`${URL_}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE', headers: hdr }).catch(() => {});
        }
      }));
    } catch { /* push é best-effort; nunca derruba o envio de e-mail */ }
  }
  // Timeout em TODAS as chamadas de rede: sem AbortSignal, um upstream lento (PostgREST/
  // GoTrue) pendura a função até o maxDuration e corta o disparo no meio.
  // Falha de consulta NÃO pode ser silenciosa: uma query malformada (400) devolvia [] igual a
  // "não há imóveis", e a etapa inteira sumia do e-mail sem deixar rastro. Continua devolvendo
  // [] (o envio não pode cair por causa de uma etapa), mas agora aparece no log da invocação.
  const sbGet = async (path) => { try { const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: hdr, signal: AbortSignal.timeout(15000) }); if (!r.ok) { console.error('[alertas] GET', r.status, path.slice(0, 300), (await r.text().catch(() => '')).slice(0, 300)); return []; } return await r.json(); } catch (e) { console.error('[alertas] GET erro', path.slice(0, 200), e?.message); return []; } };
  const rpc = async (fn, body) => { try { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }); if (!r.ok) { console.error('[alertas] RPC', fn, r.status, (await r.text().catch(() => '')).slice(0, 300)); return []; } return await r.json(); } catch (e) { console.error('[alertas] RPC erro', fn, e?.message); return []; } };

  const seteDias = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  // Inclui 'admin' (o dono acompanha os disparos) além dos planos.
  const ROLES = 'explorador,top2,top2_anual,assessorado,clube,admin';

  // E-mail NÃO fica em perfis (fica em auth.users) — o select anterior por
  // `perfis.email` FALHAVA no PostgREST e o cron nunca enviava nada. Buscamos os
  // e-mails em lote pela Admin API do GoTrue (service role) e mapeamos por id.
  // ── ESCALA: processa os destinatários em LOTES por CURSOR (id crescente) ──────────
  // O antigo limit=1000 + loop 100% serial DROPAVA usuários em silêncio a partir de ~1000
  // e ESTOURAVA o tempo (300s) por volta de ~120 usuários. Agora cada invocação processa
  // só BATCH usuários e, se o lote veio cheio, DISPARA a próxima invocação (continuação
  // encadeada) — nenhum usuário fica sem e-mail e nenhuma invocação estoura o tempo. Os
  // e-mails são buscados só do LOTE (não mais 30 páginas do GoTrue a cada invocação).
  const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  // Em teste (?email=), varre um lote grande p/ achar o alvo (não encadeia). Normal: 120.
  const BATCH = testeEmail ? 1000 : Math.min(300, Math.max(20, Number(qs.get('batch')) || 120));
  const cursor = (qs.get('cursor') || '').trim();

  const perfisRaw = await sbGet(`perfis?select=id,nome,endereco_cidade,endereco_uf,created_at,faixa_capital,forma_pagamento&role=in.(${ROLES})${isUuid(cursor) ? `&id=gt.${cursor}` : ''}&order=id.asc&limit=${BATCH}`) || [];
  const loteCheio = Array.isArray(perfisRaw) && perfisRaw.length === BATCH;
  const ultimoIdLote = perfisRaw.length ? perfisRaw[perfisRaw.length - 1].id : null; // cursor avança mesmo p/ quem não tem e-mail

  // E-mails SÓ do lote (auth.users via GoTrue admin, por id, com concorrência limitada).
  async function emailsDoLote(lista) {
    const map = new Map(); const CONC = 8;
    for (let i = 0; i < lista.length; i += CONC) {
      const res = await Promise.all(lista.slice(i, i + CONC).map(async (p) => {
        try {
          const r = await fetch(`${URL_}/auth/v1/admin/users/${p.id}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
          if (!r.ok) return null;
          const u = await r.json();
          return u?.email ? [p.id, String(u.email).toLowerCase()] : null;
        } catch { return null; }
      }));
      for (const e of res) if (e) map.set(e[0], e[1]);
    }
    return map;
  }
  const emailMap = await emailsDoLote(perfisRaw);

  // Continuação encadeada: dispara a PRÓXIMA invocação (best-effort; o timeout curto só
  // garante que a próxima já foi acionada — ela roda independente). Não encadeia em teste.
  // ORÇAMENTO DE TEMPO (10/08). O `continuar()` só era chamado DEPOIS de processar o lote
  // inteiro, e o cursor existia apenas na query string dessa chamada encadeada — não era
  // gravado em lugar nenhum. Consequência: a invocação que estourasse os 300s matava a CADEIA,
  // e como o cron sempre reinicia em `cursor=''`, era sempre o MESMO pedaço final da tabela que
  // ficava sem e-mail. Inanição determinística, não azar. E o custo por usuário varia muito
  // (filtros salvos, 3 cidades × 3 raios × 2 passes de RPC, Resend), então "120" é um teto de
  // CONTAGEM, nunca um teto de TEMPO — o que faltava era este.
  // Agora o laço para no orçamento e encadeia a partir do ÚLTIMO PROCESSADO: ninguém é pulado.
  const T0 = Date.now();
  const ORCAMENTO_MS = 240000; // de 300s: sobra para encadear, gravar o rastro e responder
  let ultimoProcessado = null;  // id do último perfil realmente tratado neste lote
  let cortadoPorTempo = false;

  async function continuar() {
    const CRON = process.env.CRON_SECRET;
    // Encadeia quando o lote veio cheio (há mais gente adiante) OU quando o orçamento cortou
    // este lote no meio (há gente AQUI que ainda não foi tratada). No corte, o cursor é o
    // último processado — não o fim do lote, senão os não tratados seriam pulados.
    const cursorProx = cortadoPorTempo ? ultimoProcessado : ultimoIdLote;
    if ((!loteCheio && !cortadoPorTempo) || !cursorProx || testeEmail || !CRON) return;
    const q = new URLSearchParams({ cursor: cursorProx, batch: String(BATCH) });
    if (forcar) q.set('forcar', '1');
    // Força www: o apex responde 308 e o redirect pode perder o header x-cron-secret.
    const selfBase = String(BASE).replace(/:\/\/(www\.)?bidprobrasil\.com\.br/, '://www.bidprobrasil.com.br');
    try { await fetch(`${selfBase}/api/enviar-alertas-cron?${q.toString()}`, { method: 'GET', headers: { 'x-cron-secret': CRON }, signal: AbortSignal.timeout(3000) }); } catch { /* acionamento best-effort */ }
  }

  let perfis = perfisRaw.filter(p => emailMap.has(p.id)); // só quem tem e-mail conhecido
  if (testeEmail) perfis = perfis.filter(p => emailMap.get(p.id) === testeEmail); // modo teste: só esse e-mail
  if (!perfis.length) {
    await continuar(); // lote sem destinatários válidos → segue para o próximo
    return new Response(JSON.stringify({ ok: true, enviados: 0, lote: perfisRaw.length, cursor_proximo: loteCheio ? ultimoIdLote : null }), { headers: { 'Content-Type': 'application/json' } });
  }
  // Só UUIDs válidos entram na lista in.(...) — defesa contra interpolação indevida.
  const ids = perfis.map(p => p.id).filter(isUuid);
  const inList = `(${ids.join(',')})`;

  // Dedup: o e-mail NUNCA repete um imóvel já enviado a este usuário (regra do dono:
  // sempre trazer NOVAS oportunidades). Janela de 180 dias cobre qualquer leilão ativo
  // (nenhum fica ativo tanto tempo) sem deixar a consulta crescer sem limite na escala.
  const janelaDedup = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
  const [alertasArr, fsalvosArr, arremArr, enviadosArr, fbArr] = await Promise.all([
    sbGet(`alertas_email?user_id=in.${inList}&select=user_id,ativo,ultimo_envio,filtros,total_enviados`),
    sbGet(`filtros_salvos?user_id=in.${inList}&select=user_id,filtros,criado_em&order=criado_em.desc`),
    // `arrematacoes` NÃO tem coluna user_id — o dono do arremate é `arrematante_id`. Com a
    // coluna errada o PostgREST devolvia 400, o sbGet caía em [] e a etapa "similares ao que
    // você arrematou" NUNCA rodou. `user_id` é criado no map abaixo para o resto seguir igual.
    sbGet(`arrematacoes?arrematante_id=in.${inList}&select=arrematante_id,imovel_id`),
    sbGet(`alertas_enviados?user_id=in.${inList}&enviado_em=gte.${janelaDedup}&select=user_id,imovel_id`),
    // Aprendizado: imóveis marcados "sem interesse" no widget/tela → excluir do e-mail.
    sbGet(`feedback_imovel?user_id=in.${inList}&sinal=eq.sem_interesse&select=user_id,imovel_id`),
  ]);
  const alertaMap = {}; for (const a of alertasArr || []) alertaMap[a.user_id] = a;
  // TODOS os filtros salvos por usuário (mais recentes primeiro), até 6 — o e-mail
  // distribui 80% das vagas entre eles (assertividade por perfil/praça).
  const filtroListMap = {}; for (const f of fsalvosArr || []) { const l = (filtroListMap[f.user_id] = filtroListMap[f.user_id] || []); if (l.length < 6 && f.filtros) l.push(f.filtros); }
  const arremMap = {}; for (const a of arremArr || []) (arremMap[a.arrematante_id] = arremMap[a.arrematante_id] || []).push(a.imovel_id);
  const enviadosMap = {}; for (const e of enviadosArr || []) (enviadosMap[e.user_id] = enviadosMap[e.user_id] || new Set()).add(e.imovel_id);
  // "Sem interesse" do widget entra na MESMA exclusão dos já-enviados: não reaparece no e-mail.
  for (const f of fbArr || []) (enviadosMap[f.user_id] = enviadosMap[f.user_id] || new Set()).add(f.imovel_id);

  // Tipos/estados dos imóveis já arrematados (para "similares")
  const arremImovelIds = [...new Set((arremArr || []).map(a => a.imovel_id).filter(Boolean))];
  const arremInfo = {};
  if (arremImovelIds.length) {
    const rows = await sbGet(`imoveis_leilao?id=in.(${arremImovelIds.join(',')})&select=id,tipo,estado`);
    for (const r of rows || []) arremInfo[r.id] = r;
  }

  const fmtBRL = v => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtData = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null;

  // Normalização = cidade_norm do banco (minúsc., sem acento, sem espaço/pontuação).
  const normCid = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const numOnly = (v) => Number(String(v ?? '').replace(/\D/g, '')) || 0;
  // Desconto MÍNIMO para entrar no e-mail: só oportunidade ATRATIVA (regra do dono).
  // 1ª praça tem desconto ~0 (imóvel a 100% da avaliação) → naturalmente excluída.
  // Aplicado em TODOS os caminhos de seleção + rede de segurança na lista final.
  const DESC_MIN = Number(process.env.ALERTA_DESCONTO_MIN || 40);
  // Monta as condições PostgREST de UM filtro salvo (tipo/modalidade/valor/desconto/
  // bairros/cidades/pagamento/intenção) — fiel ao que o cliente salvou na Busca.
  //
  // REGRA (07/08, dono): "todos os filtros devem funcionar simultaneamente" — e isso vale
  // para o E-MAIL, não só para a tela. O filtro salvo é o CONTRATO do que o cliente quer
  // receber; qualquer chave que o cron não conheça vira um filtro SILENCIOSAMENTE ignorado,
  // e o e-mail passa a mandar imóvel que a tela não mostraria. Ao acrescentar um filtro novo
  // na Busca, inclua-o AQUI TAMBÉM (além de aplicarFiltrosImoveis + RPC + api/busca-raio.js).
  const condFiltro = (f) => {
    const p = [];
    const tipos = Array.isArray(f.tipos) ? f.tipos.filter(Boolean) : [];
    // INTENÇÃO (revenda/locação/temporada) restringe os TIPOS por cima da escolha do
    // cliente — mesma semântica de aplicarFiltrosImoveis, onde os dois `.in('tipo', …)`
    // se combinam em AND (interseção). Interseção vazia = contradição → sentinela que
    // não casa nada, em vez de "todos" (que era o que o e-mail mandava antes).
    const limIntencao = f.intencao === 'revenda' ? TIPOS_LIQUIDOS
      : (f.intencao === 'locacao' || f.intencao === 'temporada') ? TIPOS_RESIDENCIAL : null;
    const tiposBase = tipos.length ? [...tipos, 'imovel'] : null;
    const tiposFinal = (tiposBase && limIntencao)
      ? (tiposBase.filter(t => limIntencao.includes(t)).length
        ? tiposBase.filter(t => limIntencao.includes(t)) : ['__sem_tipo__'])
      : (tiposBase || limIntencao);
    if (tiposFinal) p.push(`tipo=in.(${tiposFinal.map(encodeURIComponent).join(',')})`);
    const mods = Array.isArray(f.modalidades) ? f.modalidades.filter(Boolean) : [];
    if (mods.length) p.push(`modalidade=in.(${mods.map(encodeURIComponent).join(',')})`);
    if (f.valorMin) p.push(`valor_minimo=gte.${numOnly(f.valorMin)}`);
    if (f.valorMax) p.push(`valor_minimo=lte.${numOnly(f.valorMax)}`);
    // Desconto: piso de DESC_MIN (o filtro do cliente pode exigir MAIS, nunca menos).
    // Revenda tem piso próprio de viabilidade (30%), abaixo do DESC_MIN do e-mail.
    p.push(`desconto_percentual=gte.${Math.max(DESC_MIN, Number(f.descontoMin) || 0, f.intencao === 'revenda' ? REVENDA_DESCONTO_MIN : 0)}`);
    const bairros = Array.isArray(f.bairros) ? f.bairros.filter(Boolean) : [];
    const cidades = Array.isArray(f.cidades) ? f.cidades.filter(Boolean) : [];
    // Bairro só filtra COM cidade selecionada (nomes de bairro se repetem entre cidades) —
    // mesma condição da tela.
    if (bairros.length && cidades.length) p.push(`bairro=in.(${bairros.map(b => encodeURIComponent(`"${b}"`)).join(',')})`);
    // Estado é aplicado SEMPRE (não em else) — cidades homônimas em UFs diferentes
    // (Palmas/TO vs Palmas/PR) exigem estado E cidade juntos. Antes, ter cidade no
    // filtro DROPAVA o estado e o e-mail trazia imóveis de outro estado.
    if (f.estado) p.push(`estado=eq.${encodeURIComponent(f.estado)}`);
    // TEMPORADA restringe a praças de veraneio/turismo. Com cidades escolhidas, é a
    // interseção; sem cidades, a lista curada inteira.
    const cidadesNorm = cidades.map(normCid);
    const cidadesFinal = f.intencao === 'temporada'
      ? (cidadesNorm.length
        ? (cidadesNorm.filter(c => CIDADES_TEMPORADA.has(c)).length ? cidadesNorm.filter(c => CIDADES_TEMPORADA.has(c)) : ['__sem_cidade__'])
        : [...CIDADES_TEMPORADA])
      : cidadesNorm;
    if (cidadesFinal.length) p.push(`cidade_norm=in.(${cidadesFinal.map(encodeURIComponent).join(',')})`);
    // PAGAMENTO: buckets por MODALIDADE, idênticos aos da tela e da RPC (hipotecado =
    // judicial; a_vista/financiado = não-judicial). Sem isto, o e-mail mandava imóvel
    // à vista para quem só quer parcelado.
    const canon = pagCanon(f.pagamento);
    if (canon.length) {
      const ors = [];
      if (canon.includes('a_vista'))    ors.push('and(forma_pagamento.eq.a_vista,or(modalidade.neq.judicial,modalidade.is.null))');
      if (canon.includes('financiado')) ors.push('and(forma_pagamento.eq.financiado,or(modalidade.neq.judicial,modalidade.is.null))');
      if (canon.includes('hipotecado')) ors.push('or(modalidade.eq.judicial,forma_pagamento.eq.hipotecado)');
      // Literais fixos (sem dado do cliente) → vão sem encode, que é como o PostgREST
      // documenta a árvore lógica; encodar a vírgula aqui só arrisca quebrar o parser.
      if (ors.length) p.push(`or=(${ors.join(',')})`);
    }
    return p.length ? '&' + p.join('&') : '';
  };

  // RAIO — o recorte geográfico do filtro salvo (chave `__raio`, gravada pela Busca desde
  // 07/08). Sem este caminho o cron caía no condFiltro puro: um filtro salvo COM raio e SEM
  // cidade virava uma busca NACIONAL, e o cliente recebia imóvel a 900 km do círculo que ele
  // desenhou no mapa. No modo raio a cidade é só o CENTRO (não filtra) e o bairro é ignorado
  // — exatamente como na tela.
  const buscarPorRaio = async (f, lim) => {
    const c = f.__raio?.centro; const km = Number(f.__raio?.km) || 0;
    if (!c || !km || !Number.isFinite(Number(c.lat)) || !Number.isFinite(Number(c.lng))) return null;
    const tipos = Array.isArray(f.tipos) ? f.tipos.filter(Boolean) : [];
    const limIntencao = f.intencao === 'revenda' ? TIPOS_LIQUIDOS
      : (f.intencao === 'locacao' || f.intencao === 'temporada') ? TIPOS_RESIDENCIAL : null;
    // Aqui a interseção NÃO acrescenta 'imovel' — a própria RPC já aceita `tipo='imovel'`
    // como curinga; é a mesma tradução que a tela faz no caminho do raio.
    const tiposRpc = (tipos.length && limIntencao)
      ? (tipos.filter(t => limIntencao.includes(t)).length ? tipos.filter(t => limIntencao.includes(t)) : ['__sem_tipo__'])
      : (tipos.length ? tipos : (limIntencao || []));
    const linhas = await rpc('buscar_por_raio_v2', {
      lat: Number(c.lat), lng: Number(c.lng), raio_metros: km * 1000,
      lim: Math.min(200, Math.max(lim * 4, 40)),
      tipos_filtro: tiposRpc,
      estado_filtro: f.estado || '',
      modalidades_filtro: Array.isArray(f.modalidades) ? f.modalidades.filter(Boolean) : [],
      pagamentos_filtro: pagCanon(f.pagamento),
      desconto_min: Math.max(DESC_MIN, Number(f.descontoMin) || 0, f.intencao === 'revenda' ? REVENDA_DESCONTO_MIN : 0),
      ...(numOnly(f.valorMin) ? { valor_min: numOnly(f.valorMin) } : {}),
      ...(numOnly(f.valorMax) ? { valor_max: numOnly(f.valorMax) } : {}),
    });
    // A RPC ordena por DISTÂNCIA; o e-mail leva sempre o maior desconto primeiro.
    return (linhas || []).sort((a, b) => (Number(b.desconto_percentual) || 0) - (Number(a.desconto_percentual) || 0));
  };

  const buscarPorFiltro = async (f, lim) => {
    const porRaio = await buscarPorRaio(f, lim);
    if (porRaio) return porRaio;
    return sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true${condFiltro(f)}&order=desconto_percentual.desc&limit=${lim}`);
  };

  let enviados = 0;
  const isSegunda = new Date().getUTCDay() === 1; // 11h UTC de segunda = 8h BRT de segunda

  for (const perfil of perfis) {
    // Corte por ORÇAMENTO antes de começar mais um usuário. `ultimoProcessado` só avança
    // depois que o `try` termina, então o corte nunca "pula" quem estava em andamento: ele
    // volta a ser o primeiro do próximo lote.
    if (!testeEmail && Date.now() - T0 > ORCAMENTO_MS) { cortadoPorTempo = true; break; }
    try {
      const email = emailMap.get(perfil.id); if (!email || !RESEND_KEY) continue;
      const a = alertaMap[perfil.id];
      if (!testeEmail) {
        if (a && a.ativo === false) continue;                       // opt-out (descadastrado)
        const nunca = !a?.ultimo_envio;
        if (nunca) {
          // 1º e-mail: só depois de 24h da criação da conta (em qualquer dia).
          const idadeMs = perfil.created_at ? (Date.now() - new Date(perfil.created_at).getTime()) : 0;
          if (idadeMs < 24 * 3600 * 1000) continue;
        } else {
          // Recorrente: só às segundas (ou com ?forcar=1), e não reenvia se já mandou
          // nos últimos 7 dias.
          if (!isSegunda && !forcar) continue;
          if (a.ultimo_envio > seteDias) continue;
        }
      }

      // ── Seleção assertiva ────────────────────────────────────────────────
      // Referência = CIDADE do usuário (filtro salvo ou cadastro), nunca o estado.
      const savedFilters = filtroListMap[perfil.id] || [];
      const temPerfil = savedFilters.length > 0;
      const filtroBase = savedFilters[0] || a?.filtros || {};
      const cidadesRef = (Array.isArray(filtroBase.cidades) && filtroBase.cidades.length)
        ? filtroBase.cidades.filter(Boolean)
        : [perfil.endereco_cidade].filter(Boolean);
      const cidade = cidadesRef[0] || '';
      const uf = filtroBase.estado || perfil.endereco_uf || '';

      const enviadosSet = enviadosMap[perfil.id] || new Set();
      const LIMITE = 12;
      const pool = new Map();
      const add = (im, isNovo) => { if (im && im.id && !pool.has(im.id)) pool.set(im.id, { im, isNovo }); };
      // O e-mail SÓ leva imóveis NOVOS (nunca enviados a este usuário) — sempre novas
      // oportunidades, sem repetir. Se não houver novidade suficiente, manda menos (não
      // recicla). Cada fonte já vem ordenada por maior desconto (>40% lideram).
      const despejar = (lista, limite) => {
        // LEILÃO ENCERRADO nunca entra no e-mail (07/08). Mandar toda segunda um lote cujo prazo
        // já passou é pior que mandar menos: o cliente clica, se interessa e descobre que não dá
        // mais para dar lance. Ponto de estrangulamento único — TODAS as fontes de lote (filtro
        // salvo, raio, similares, país) passam por aqui.
        const frescos = (lista || []).filter(im => im && im.id && !enviadosSet.has(im.id)
          && !encerradoPorDatas(im).encerrado);
        let n = 0;
        for (const im of frescos) {
          if (n >= limite || pool.size >= LIMITE) break;
          if (!pool.has(im.id)) { add(im, true); n++; }
        }
      };

      // 1) COTA DOS FILTROS SALVOS (regra do dono: DIVIDIR as 12 entre os critérios).
      //    Com cidade+perfil TAMBÉM presentes → metade das vagas (6) p/ os filtros
      //    salvos, distribuída entre eles; sem cidade de referência → filtros levam
      //    as 12. A sobra de um critério é preenchida pelo outro (passo 2 e 2b).
      const temCidadeRef = cidadesRef.length > 0;
      if (temPerfil) {
        const cotaFiltros = temCidadeRef ? Math.round(LIMITE / 2) : LIMITE; // 6 de 12
        const porFiltro = Math.max(1, Math.ceil(cotaFiltros / savedFilters.length));
        for (const f of savedFilters) {
          if (pool.size >= cotaFiltros) break;
          despejar(await buscarPorFiltro(f, porFiltro * 4), porFiltro);
        }
      }

      // 2) Complemento (20% + o que faltar) via RAIO CRESCENTE da(s) cidade(s) de
      //    referência, RESPEITANDO O PERFIL DO INVESTIDOR (regra do dono): a triagem
      //    (faixa de capital, forma de pagamento) + os filtros do alerta (tipo/
      //    modalidade/pagamento/teto) moldam o que entra — não só o desconto.
      //    1º passe: anéis 50→200km com o perfil completo (tipo/modalidade/pagamento
      //    + teto). Se não fechar as 12, 2º passe relaxa as PREFERÊNCIAS mas MANTÉM
      //    o teto de capital: imóvel acima do que o cliente consegue pagar é
      //    irrelevante, não vaga a preencher.
      // Raio MÁXIMO 200km (regra do dono, 01/08): acima disso o deslocamento inviabiliza
      // a visita/arremate p/ a maioria dos investidores — melhor mandar menos que mandar
      // imóvel a 400km. (Já foi 400km; antes disso, quase-nacional colava RJ p/ cliente SP.)
      const RAIOS_M = [50000, 100000, 200000];
      // Teto de capital pela faixa da triagem (folga ~30% cobre entrada+financiamento;
      // 'acima_1mi' = sem teto). O valorMax do alerta, quando menor, prevalece.
      const TETO_FAIXA = { ate_150k: 200000, '150_400k': 520000, '400k_1mi': 1300000, acima_1mi: 0 };
      const tetoFiltro = numOnly(filtroBase.valorMax);
      const tetoFaixa = TETO_FAIXA[perfil.faixa_capital] || 0;
      const tetoPerfil = tetoFiltro && tetoFaixa ? Math.min(tetoFiltro, tetoFaixa) : (tetoFiltro || tetoFaixa);
      const tiposPref = Array.isArray(filtroBase.tipos) ? filtroBase.tipos.filter(Boolean) : [];
      const modsPref = Array.isArray(filtroBase.modalidades) ? filtroBase.modalidades.filter(Boolean) : [];
      // pagCanon: o filtro salvo guarda a CHAVE do checkbox ('aVista'); a RPC espera o valor
      // canônico ('a_vista'). Sem converter, a preferência de pagamento do cliente ia para a
      // RPC como string desconhecida e não casava nada.
      const pagPref = new Set(pagCanon(filtroBase.pagamento));
      if (['a_vista', 'financiado'].includes(perfil.forma_pagamento)) pagPref.add(perfil.forma_pagamento);
      const temPref = tiposPref.length || modsPref.length || pagPref.size;
      const passes = temPref
        ? [{ tipos: tiposPref, mods: modsPref, pags: [...pagPref] }, { tipos: [], mods: [], pags: [] }]
        : [{ tipos: [], mods: [], pags: [] }];
      for (const pass of passes) {
        if (pool.size >= LIMITE) break;
        for (const cid of cidadesRef.slice(0, 3)) {
          if (pool.size >= LIMITE) break;
          const cen = centroide(cid, uf);
          if (!cen) continue;
          for (const raio of RAIOS_M) {
            if (pool.size >= LIMITE) break;
            despejar(await rpc('buscar_por_raio_v2', {
              lat: cen.lat, lng: cen.lng, raio_metros: raio, lim: 40, desconto_min: DESC_MIN,
              tipos_filtro: pass.tipos, modalidades_filtro: pass.mods, pagamentos_filtro: pass.pags,
              ...(tetoPerfil ? { valor_max: tetoPerfil } : {}),
            }), LIMITE - pool.size);
          }
        }
      }
      // Fallback por NOME da cidade (sem coordenada no centróide offline): escopado
      // pela UF (homônimas: Palmas/TO vs Palmas/PR) + teto do perfil + desconto ≥ DESC_MIN.
      if (pool.size < LIMITE) {
        for (const cid of cidadesRef.slice(0, 3)) {
          if (pool.size >= LIMITE) break;
          despejar(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true${uf ? `&estado=eq.${encodeURIComponent(uf)}` : ''}&cidade=ilike.*${encodeURIComponent(cid)}*&desconto_percentual=gte.${DESC_MIN}${tetoPerfil ? `&valor_minimo=lte.${tetoPerfil}` : ''}&order=desconto_percentual.desc&limit=24`), LIMITE - pool.size);
        }
      }

      // 2b) SOBRA da divisão: se cidade+perfil não fechou a parte dele, os filtros
      //     salvos completam ALÉM da própria cota (nenhuma vaga fica ociosa à toa).
      if (temPerfil && pool.size < LIMITE) {
        for (const f of savedFilters) {
          if (pool.size >= LIMITE) break;
          despejar(await buscarPorFiltro(f, (LIMITE - pool.size) * 2), LIMITE - pool.size);
        }
      }

      // 3) Similares às arrematações do usuário (mesmo tipo), se ainda faltar.
      if (pool.size < LIMITE) {
        const meus = arremMap[perfil.id] || [];
        const tipos = [...new Set(meus.map(i => arremInfo[i]?.tipo).filter(Boolean))];
        for (const t of tipos.slice(0, 2)) {
          if (pool.size >= LIMITE) break;
          despejar(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&tipo=eq.${encodeURIComponent(t)}${uf ? `&estado=eq.${uf}` : ''}&desconto_percentual=gte.${DESC_MIN}${tetoPerfil ? `&valor_minimo=lte.${tetoPerfil}` : ''}&order=desconto_percentual.desc&limit=8`), LIMITE - pool.size);
        }
      }

      // 4) Rede final: completa com as melhores do país (maior desconto, sem geografia)
      //    APENAS para quem NÃO tem nenhuma referência de região (sem cidade E sem filtro
      //    salvo). Para quem TEM região, NÃO caímos no acervo nacional — melhor mandar
      //    menos que mandar imóvel de outro estado (push/e-mail seguem cidade+filtros).
      const temRegiao = !!(uf || (cidadesRef && cidadesRef.length));
      if (pool.size < LIMITE && !temRegiao) {
        despejar(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&desconto_percentual=gte.${DESC_MIN}${tetoPerfil ? `&valor_minimo=lte.${tetoPerfil}` : ''}&order=desconto_percentual.desc&limit=40`), LIMITE - pool.size);
      }

      // Rede de segurança: só oportunidade ATRATIVA (desconto ≥ DESC_MIN) entra no e-mail,
      // qualquer que tenha sido o caminho de seleção. Exclui 1ª praça / valor perto da
      // avaliação (ex.: extrajudicial da Caixa antes da 2ª praça, desconto ~0 ou negativo).
      // Ordena por MAIOR desconto e pega até 12.
      const top = [...pool.values()].map(v => v.im)
        .filter(im => (Number(im.desconto_percentual) || 0) >= DESC_MIN)
        .sort((x, y) => (Number(y.desconto_percentual) || 0) - (Number(x.desconto_percentual) || 0))
        .slice(0, LIMITE);
      if (!top.length) continue;

      const local = [cidade, uf].filter(Boolean).join(' — ') || 'Brasil';
      const unsubUrl = `${BASE}/api/cancelar-alertas?token=${assinarUnsub(perfil.id)}`; // one-click LGPD (sem login)

      const cards = top.map(im => {
        const url = `${BASE}/#/imovel/${im.id}`;
        const fotoUrl = fotoParaEmail(im, BASE);
        const foto = fotoUrl ? `<a href="${url}"><img src="${fotoUrl}" alt="" style="width:100%;height:130px;object-fit:cover;display:block;border-radius:10px 10px 0 0;"></a>` : '';
        const desc = Number(im.desconto_percentual) || 0;
        const descTag = desc > 0 ? `<span style="display:inline-block;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">${Math.round(desc)}% OFF</span>` : '';
        // Prazo real: o e-mail mostra a data que o cliente precisa respeitar (encerramento),
        // não o dia em que o leilão abriu.
        const dataLabel = fmtData(im.data_fim || im.data_leilao);
        const dataTag = dataLabel ? `<span style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;margin-left:4px;">📅 ${dataLabel}</span>` : '';
        return `
        <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:12px;background:#fff;">
          ${foto}
          <div style="padding:14px 16px;">
            <a href="${url}" style="text-decoration:none;color:#0f172a;"><div style="font-size:14px;font-weight:700;margin-bottom:4px;">${escapeHtml(im.titulo || im.endereco || 'Imóvel em leilão')}</div></a>
            <div style="font-size:12px;color:#64748b;margin-bottom:8px;">📍 ${escapeHtml(im.cidade || '')}${im.estado ? ' — ' + escapeHtml(im.estado) : ''}</div>
            <div style="margin-bottom:10px;">${descTag}${dataTag}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div><div style="font-size:11px;color:#94a3b8;">Lance mínimo</div><div style="font-size:16px;font-weight:800;color:#0f172a;">${fmtBRL(im.valor_minimo)}</div></div>
              <a href="${url}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;">Ver imóvel →</a>
            </div>
          </div>
        </div>`;
      }).join('');

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <a href="${BASE}/#/buscar" style="text-decoration:none;">
    <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:#fff;">BidPro Brasil</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Leilão &amp; Investimentos</div>
    </div>
  </a>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;">Olá${perfil.nome ? ', ' + escapeHtml(perfil.nome.split(' ')[0]) : ''}!</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">Selecionamos <strong>${top.length} oportunidade${top.length > 1 ? 's' : ''}</strong> em <strong>${local}</strong> para você esta semana:</p>
    ${cards}
    <div style="text-align:center;margin-top:20px;"><a href="${BASE}/#/buscar" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">Ver todos os imóveis →</a></div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:20px;">BidPro Brasil · Você recebe estas oportunidades semanalmente · <a href="${unsubUrl}" style="color:#94a3b8;">Cancelar</a></p>
  </div>
</div></body></html>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: email, subject: `🏠 ${top.length} oportunidades em ${local} esta semana`, html }),
        signal: AbortSignal.timeout(20000),
      });
      if (emailRes.ok) {
        // ID do Resend: é a CHAVE que o /api/resend-webhook usa p/ casar o evento de
        // entrega/abertura/clique com a linha do emails_log (match por resend_id). Sem
        // gravá-lo, o rastreio do Cliente 360 NUNCA popula para o e-mail de oportunidades
        // — nem depois de o webhook voltar ao ar. Best-effort: falha na leitura não
        // derruba o envio (o e-mail já saiu).
        const resendId = await emailRes.json().then((d) => d?.id || null).catch(() => null);
        await fetch(`${URL_}/rest/v1/alertas_email?on_conflict=user_id`, {
          method: 'POST',
          headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ user_id: perfil.id, ultimo_envio: new Date().toISOString(), total_enviados: (a?.total_enviados || 0) + 1 }),
          signal: AbortSignal.timeout(15000),
        });
        // Histórico do e-mail (Cliente 360). Best-effort — não bloqueia o loop.
        try {
          await fetch(`${URL_}/rest/v1/emails_log`, {
            method: 'POST',
            headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ user_id: perfil.id, destinatario: String(email).toLowerCase(), assunto: `🏠 ${top.length} oportunidades em ${local} esta semana`, tipo: 'oportunidades', status: 'enviado', resend_id: resendId }),
            signal: AbortSignal.timeout(15000),
          });
        } catch { /* histórico é best-effort */ }
        // Registra os imóveis enviados (dedup dos próximos envios; ignora repetidos).
        if (!testeEmail) {
          try {
            await fetch(`${URL_}/rest/v1/alertas_enviados`, {
              method: 'POST',
              headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
              body: JSON.stringify(top.map(im => ({ user_id: perfil.id, imovel_id: im.id }))),
              signal: AbortSignal.timeout(15000),
            });
          } catch { /* dedup é best-effort */ }
        }
        enviados++;
        // Push com o mesmo resumo do e-mail (best-effort, não bloqueia o loop).
        if (!testeEmail) {
          await enviarPushOportunidades(
            perfil.id,
            `🏠 ${top.length} oportunidade${top.length > 1 ? 's' : ''} em ${local}`,
            top[0] ? `${(top[0].titulo || top[0].endereco || 'Imóvel em leilão').slice(0, 80)} — ${fmtBRL(top[0].valor_minimo)}` : 'Veja as oportunidades selecionadas para você.',
          );
        }
      }
    } catch (e) {
      console.error('[enviar-alertas-cron] erro user', perfil.id, e?.message);
    }
    ultimoProcessado = perfil.id; // avança SÓ depois de tratar (inclusive quando deu erro)
  }

  await continuar(); // aciona o próximo lote (se houver), depois de processar este
  // RASTRO da varredura. Sem isto, "não havia ninguém para avisar" e "a cadeia morreu no meio"
  // eram indistinguíveis: o único sinal era o corpo HTTP de uma invocação que ninguém lê.
  // `assinatura` guarda o resumo do último lote e o cursor de onde ele parou.
  try {
    await fetch(`${URL_}/rest/v1/alerta_estado`, {
      method: 'POST',
      headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        chave: 'enviar_alertas_cron',
        assinatura: JSON.stringify({ enviados, lote: perfis.length, cortado_por_tempo: cortadoPorTempo, cursor_proximo: cortadoPorTempo ? ultimoProcessado : (loteCheio ? ultimoIdLote : null) }),
        atualizado_em: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* rastro é best-effort — nunca derruba o envio */ }
  return new Response(JSON.stringify({ ok: true, enviados, lote: perfis.length, cortado_por_tempo: cortadoPorTempo, cursor_proximo: cortadoPorTempo ? ultimoProcessado : (loteCheio ? ultimoIdLote : null) }), { headers: { 'Content-Type': 'application/json' } });
}
