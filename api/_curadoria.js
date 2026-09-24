/**
 * CURADORIA DAS OPORTUNIDADES — o "agente" que escolhe o que vai no e-mail semanal (24/09).
 *
 * Pedido do dono: a seleção tem de levar em conta o PERFIL do investidor e a CIDADE dele, com
 * assertividade e discernimento sobre a intenção. Até aqui o `enviar-alertas-cron` era regra
 * fixa (raio + teto + desconto ≥ 40%, ordenado SÓ por desconto): a Alessandra (uso próprio)
 * abria todo e-mail e nunca clicava — recebia terreno. Duas camadas:
 *
 *  1. PONTUAÇÃO (custo zero, sempre ligada): cada candidato recebe pontos por desconto, encaixe
 *     no perfil declarado, distância da cidade do cliente, faixa de preço ideal (não só o teto),
 *     o que ele de fato ABRIU no site, nota financeira/localização e atratividade do anúncio.
 *     Cada ponto vem com o MOTIVO por extenso — vira a linha "por que este imóvel" no e-mail.
 *  2. IA (Claude Haiku, ligada por `CURADORIA_IA=1`): recebe os ~24 melhores da camada 1 e
 *     escolhe até 12, escrevendo o motivo em linguagem de gente. Se a IA falhar, recusar ou
 *     devolver algo inválido, vale a ordem da camada 1 — e o motivo da falha fica no log e em
 *     `alertas_enviados.curadoria` (nunca "a IA não achou nada" no lugar de "a IA caiu").
 */
import { anthropicFetch } from './_claude.js';

export const TIPOS_POR_PERFIL = {
  uso_proprio: ['apartamento', 'casa'],
  locacao: ['apartamento', 'casa', 'imovel'],
  revenda: ['apartamento', 'casa', 'comercial', 'imovel'],
  incorporacao: ['terreno'],
};
const PERFIL_ROTULO = {
  uso_proprio: 'quer um imóvel para morar',
  locacao: 'compra para alugar',
  revenda: 'compra para revender com lucro',
  incorporacao: 'busca terreno para construir/incorporar',
};
const FAIXA_ROTULO = { ate_150k: 'até R$ 150 mil', '150_400k': 'R$ 150–400 mil', '400k_1mi': 'R$ 400 mil–1 mi', acima_1mi: 'acima de R$ 1 mi' };

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const preco = (im) => num(im.valor_minimo_ref ?? im.valor_minimo) || 0;
const fmtMil = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toFixed(1).replace('.', ',')} mi` : `R$ ${Math.round(v / 1000)} mil`);

export function distanciaKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Resumo do que o cliente ABRIU no site (imóveis vistos nos últimos 60 dias). É o sinal mais
 * honesto de intenção que temos — mais que a triagem, que ele respondeu uma vez.
 * @param {Array<{tipo,cidade,valor_minimo_ref,valor_minimo}>} vistos
 */
export function resumoComportamento(vistos) {
  const v = (vistos || []).filter(Boolean);
  if (!v.length) return null;
  const tipos = {}, cidades = {};
  for (const im of v) {
    if (im.tipo) tipos[im.tipo] = (tipos[im.tipo] || 0) + 1;
    const c = String(im.cidade || '').toLowerCase().trim();
    if (c) cidades[c] = (cidades[c] || 0) + 1;
  }
  const precos = v.map(preco).filter(p => p > 0).sort((a, b) => a - b);
  return {
    n: v.length,
    tipos, cidades,
    precoMediano: precos.length ? precos[Math.floor(precos.length / 2)] : null,
  };
}

/**
 * Camada 1. Devolve { pontos, motivos[] } — motivos em ordem de força, para o e-mail.
 * ctx: { perfil_investidor, faixa_capital, forma_pagamento, tetoPerfil, centro:{lat,lng},
 *        comportamento (resumoComportamento), origem ('filtro'|'regiao'|...) }
 */
export function pontuarCandidato(im, ctx) {
  let pts = 0;
  const motivos = [];
  const p = preco(im);
  const desc = num(im.desconto_percentual) || 0;

  // Desconto: continua importando, mas deixa de ser o ÚNICO critério.
  pts += Math.min(desc, 70) / 70 * 30;
  if (desc >= 40) motivos.push({ f: desc, t: `${Math.round(desc)}% abaixo da avaliação` });

  // Pedido explícito do cliente (filtro salvo) vem na frente.
  if (ctx.origem === 'filtro') { pts += 20; motivos.push({ f: 90, t: 'dentro do filtro que você salvou' }); }

  // Perfil declarado na triagem.
  const tiposOk = TIPOS_POR_PERFIL[ctx.perfil_investidor];
  if (tiposOk) {
    if (tiposOk.includes(im.tipo)) pts += 12;
    else pts -= 15;
  }

  // Distância da cidade do cliente: nota contínua, não corte seco no raio.
  const d = distanciaKm(ctx.centro, im.latitude != null ? { lat: Number(im.latitude), lng: Number(im.longitude) } : null);
  if (d != null) {
    pts += Math.max(0, 1 - d / 120) * 18;
    if (d <= 15) motivos.push({ f: 80, t: d < 3 ? 'na sua cidade' : `a ${Math.round(d)} km de você` });
  }

  // Faixa de preço IDEAL: abaixo do teto não basta — R$ 60 mil para quem tem R$ 400 mil não é o alvo.
  if (ctx.tetoPerfil && p > 0) {
    const r = p / ctx.tetoPerfil;
    if (r >= 0.3 && r <= 1) pts += 10;
    else if (r < 0.15) pts -= 8;
  }

  // Comportamento no site.
  const c = ctx.comportamento;
  if (c && c.n >= 2) {
    const tot = Object.values(c.tipos).reduce((a, b) => a + b, 0) || 1;
    const shareTipo = (c.tipos[im.tipo] || 0) / tot;
    pts += shareTipo * 14;
    if (shareTipo >= 0.5) motivos.push({ f: 70, t: `${im.tipo === 'apartamento' ? 'apartamento' : im.tipo}, o tipo que você mais tem olhado` });
    if (c.cidades[String(im.cidade || '').toLowerCase().trim()]) pts += 6;
    if (c.precoMediano && p > 0 && Math.abs(p - c.precoMediano) / c.precoMediano <= 0.4) {
      pts += 6;
      motivos.push({ f: 60, t: `na faixa de preço que você procura (${fmtMil(p)})` });
    }
  }

  // Qualidade do lote segundo o próprio acervo.
  const fin = num(im.score_financeiro);
  if (fin != null) pts += (fin / 100) * 8;
  const loc = num(im.score_localizacao);
  if (loc != null) {
    pts += (loc / 10) * 8;
    if (loc >= 7.5) motivos.push({ f: 50, t: 'boa localização (comércio e serviços por perto)' });
  }
  const ocup = String(im.ocupacao || '').toLowerCase();
  if (ocup === 'desocupado') { pts += ctx.perfil_investidor === 'uso_proprio' || ctx.perfil_investidor === 'locacao' ? 10 : 5; motivos.push({ f: 85, t: 'desocupado' }); }
  else if (ocup === 'ocupado' && ctx.perfil_investidor === 'uso_proprio') pts -= 8;
  if (ctx.forma_pagamento === 'financiado') {
    if (im.forma_pagamento === 'financiado') { pts += 8; motivos.push({ f: 75, t: 'aceita financiamento' }); }
    else if (im.forma_pagamento === 'a_vista') pts -= 4;
  }

  // Vaga de garagem/box chega com tipo 'terreno', 'imovel' ou 'comercial' conforme a fonte
  // (dry-run 24/09: 7 das 40 melhores por desconto para a Alessandra eram vagas). Não é a
  // "oportunidade" que ninguém de perfil algum espera receber num e-mail de imóveis.
  if (/vaga\s+de\s+garagem|\bbox\b(\s+de\s+garagem)?|\bgaragem\b/i.test(String(im.titulo || ''))) pts -= 25;

  // Atratividade do anúncio: lote sem foto/data espanta o clique.
  pts += im.link_foto ? 4 : -10;
  if (!im.data_leilao && !im.data_fim) pts -= 3;

  motivos.sort((a, b) => b.f - a.f);
  return { pontos: Math.round(pts * 10) / 10, motivos: motivos.map(m => m.t) };
}

/** Linha curta para o card do e-mail (até 3 motivos, os mais fortes). */
export function motivoCurto(motivos) {
  const m = (motivos || []).slice(0, 3);
  if (!m.length) return '';
  const s = m.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const CURADORIA_MODELO = 'claude-haiku-4-5';

/**
 * Camada 2 — IA escolhe até `limite` entre os candidatos já pontuados e escreve o motivo.
 * Devolve { ok:true, escolhidos:[{id, motivo}] } ou { ok:false, erro } — NUNCA uma lista vazia
 * no lugar de falha (quem chama cai na ordem da camada 1).
 */
export async function curarComIA(candidatos, ctx, { limite = 12 } = {}) {
  // Mesma chave do resto do backend (docs/ENVS_VERCEL.md: CLAUDE_KEY); ANTHROPIC_API_KEY é o nome alternativo aceito.
  const chave = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!chave) return { ok: false, erro: 'CLAUDE_KEY ausente' };
  const lista = candidatos.map((c, i) => ({
    n: i + 1,
    id: c.im.id,
    tipo: c.im.tipo, cidade: c.im.cidade, uf: c.im.estado,
    preco: preco(c.im), desconto: Math.round(num(c.im.desconto_percentual) || 0),
    km: c.km != null ? Math.round(c.km) : null,
    ocupacao: c.im.ocupacao || null, pagamento: c.im.forma_pagamento || null,
    titulo: String(c.im.titulo || '').slice(0, 90),
    pontos: c.pontos, sinais: c.motivos.slice(0, 3),
    do_filtro_salvo: c.origem === 'filtro',
  }));
  const comp = ctx.comportamento;
  const cliente = {
    intencao: PERFIL_ROTULO[ctx.perfil_investidor] || 'não declarada',
    capital: FAIXA_ROTULO[ctx.faixa_capital] || 'não declarado',
    pagamento: ctx.forma_pagamento || 'não declarado',
    cidade: ctx.cidade || null,
    viu_no_site: comp ? { imoveis: comp.n, tipos: comp.tipos, preco_mediano: comp.precoMediano } : null,
  };
  const system = 'Você é o curador de oportunidades de uma plataforma brasileira de imóveis em leilão. '
    + 'Escolha, entre os candidatos, os que mais combinam com a intenção real do cliente — morar, alugar, revender ou construir —, '
    + 'com a cidade dele e com o que ele tem olhado no site. Prefira variedade útil a repetir quase o mesmo imóvel. '
    + 'Pode escolher menos que o limite se os demais não servirem para este cliente. '
    + 'Para cada escolhido, escreva um motivo curto (até 110 caracteres), em português, falando com o cliente ("você"), '
    + 'usando só fatos presentes nos dados — nunca invente metragem, bairro, quartos ou estado de conservação. '
    + 'Responda APENAS com JSON no formato {"escolhidos":[{"n":<número do candidato>,"motivo":"..."}]}, em ordem de prioridade.';
  const user = `Cliente: ${JSON.stringify(cliente)}\nLimite: ${limite}\nCandidatos: ${JSON.stringify(lista)}`;

  let res;
  try {
    res = await anthropicFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CURADORIA_MODELO, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] }),
    }, { retries: 1, timeoutMs: 30000, noFallback: true });
  } catch (e) {
    return { ok: false, erro: `rede: ${String(e?.message || e).slice(0, 120)}` };
  }
  if (!res.ok) return { ok: false, erro: `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}` };
  const data = await res.json().catch(() => null);
  if (!data) return { ok: false, erro: 'corpo não-JSON' };
  if (data.stop_reason === 'refusal') return { ok: false, erro: 'recusa do modelo' };
  if (data.stop_reason === 'max_tokens') return { ok: false, erro: 'resposta cortada (max_tokens)' };
  const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const bruto = texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1);
  let parsed;
  try { parsed = JSON.parse(bruto); } catch { return { ok: false, erro: `JSON inválido: ${texto.slice(0, 120)}` }; }
  const vistos = new Set();
  const escolhidos = (Array.isArray(parsed?.escolhidos) ? parsed.escolhidos : [])
    .map(e => ({ c: lista[Number(e?.n) - 1], motivo: String(e?.motivo || '').trim().slice(0, 140) }))
    .filter(e => e.c && !vistos.has(e.c.id) && vistos.add(e.c.id))
    .slice(0, limite)
    .map(e => ({ id: e.c.id, motivo: e.motivo }));
  if (!escolhidos.length) return { ok: false, erro: 'IA devolveu 0 escolhidos válidos' };
  return { ok: true, escolhidos, uso: data.usage || null };
}
