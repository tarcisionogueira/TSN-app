// CENÁRIO REALISTA E TETO DE LANCE DO VEÍCULO (29/09, pedido do dono).
//
// Regra do dono: a soma arrematação + comissão do leiloeiro + despesas assumidas (SEM honorários)
// tem teto de 65% da FIPE. Daí sai o TETO DE LANCE. E a revenda não é pela FIPE cheia: veículo de
// leilão, com km alta, de frota ou sinistrado vende abaixo dela — o deságio abaixo é uma régua FIXA
// e explicável (cada item aparece no relatório), não um número da IA.
// Usado pela tela (src/pages/AnaliseVeiculo.jsx) e pelo PDF do relatório.

export const TETO_FIPE = 0.65;
export const COMISSAO_PADRAO_PCT = 5; // praxe de leilão (edital costuma fixar 5%); o relatório diz quando é presumida

export function desagioFipe(v, anoAtual = new Date().getFullYear()) {
  const fatores = [{ motivo: 'Liquidez de veículo de leilão (histórico de leilão reduz o preço de revenda)', pct: 10 }];
  const ano = Number(v?.ano_modelo || v?.ano_fabricacao) || null;
  const km = Number(v?.km) || 0;
  if (ano && km > 0) {
    const esperado = 15000 * Math.max(0.5, anoAtual - ano + 0.5);
    const r = km / esperado;
    if (r > 4) fatores.push({ motivo: `Quilometragem muito acima do esperado (${km.toLocaleString('pt-BR')} km; ~${Math.round(esperado).toLocaleString('pt-BR')} km para a idade)`, pct: 15 });
    else if (r > 2.5) fatores.push({ motivo: `Quilometragem bem acima do esperado (${km.toLocaleString('pt-BR')} km; ~${Math.round(esperado).toLocaleString('pt-BR')} km para a idade)`, pct: 12 });
    else if (r > 1.5) fatores.push({ motivo: `Quilometragem acima do esperado (${km.toLocaleString('pt-BR')} km)`, pct: 7 });
  }
  if (['orgao_publico', 'corporativo'].includes(v?.origem_venda)) fatores.push({ motivo: 'Uso de frota (órgão público/empresa) — desgaste acima da média', pct: 5 });
  if (v?.origem_venda === 'patio') fatores.push({ motivo: 'Veículo de pátio (apreendido/removido)', pct: 5 });
  const sin = String(v?.sinistro || '').toLowerCase();
  if (/grande/.test(sin)) fatores.push({ motivo: 'Sinistro de grande monta', pct: 35 });
  else if (/m[eé]dia/.test(sin)) fatores.push({ motivo: 'Sinistro de média monta', pct: 20 });
  else if (/pequena/.test(sin)) fatores.push({ motivo: 'Sinistro de pequena monta', pct: 10 });
  if (['nao_funciona', 'avariado'].includes(v?.motor_status) || v?.motor_alerta) fatores.push({ motivo: 'Motor com dano declarado', pct: 20 });
  if (v?.is_sucata) fatores.push({ motivo: 'Sucata — só certificado de baixa, não volta a circular', pct: 60 });
  const pct = Math.min(60, fatores.reduce((s, f) => s + f.pct, 0));
  return { pct, fatores };
}

// Comissão DECLARADA: número ≥ 0 (0 = "sem comissão", 10/10). null/ausente = não informada → presume o padrão.
const comissaoDeclarada = (p) => (p !== null && p !== undefined && p !== '' && Number.isFinite(Number(p)) && Number(p) >= 0 && Number(p) <= 20 ? Number(p) : null);
export function calcularViabilidade({ fipe, lanceMinimo, comissaoPct, despesas = [], desagioPct = 0, revendaMercado = null }) {
  const F = Number(fipe) || 0;
  const L = Number(lanceMinimo) || 0;
  if (!(F > 0) || !(L > 0)) return null;
  const c = (comissaoDeclarada(comissaoPct) ?? COMISSAO_PADRAO_PCT) / 100;
  // Só entra na conta o que o leiloeiro DECLARA (débitos, taxas). Reparo estimado pela condição
  // (pneus, bateria, funilaria) é citado no relatório mas não tem valor (regra do dono, 30/09) —
  // relatórios antigos ainda trazem `origem: 'estimado'` com valor, e eles ficam fora do teto.
  const itens = (despesas || []).filter((d) => Number(d?.valor) > 0 && d?.origem !== 'estimado');
  const despesasTotal = itens.reduce((s, d) => s + Number(d.valor), 0);
  const r2 = (x) => Math.round(x * 100) / 100;
  const tetoAquisicao = r2(F * TETO_FIPE);
  const tetoLance = r2(Math.max(0, (tetoAquisicao - despesasTotal) / (1 + c)));
  const investimentoNoMinimo = r2(L * (1 + c) + despesasTotal);
  // Revenda: anúncios reais (média dos 5 mais baratos − 10%) quando houver; senão a régua sobre a FIPE.
  const fipeRealista = Number(revendaMercado) > 0 ? r2(Number(revendaMercado)) : r2(F * (1 - desagioPct / 100));
  return {
    comissaoPct: c * 100, comissaoPresumida: comissaoDeclarada(comissaoPct) == null,
    despesas: itens, despesasTotal: r2(despesasTotal),
    tetoAquisicao, tetoLance, investimentoNoMinimo,
    investimentoNoTeto: tetoAquisicao,
    fipeRealista, desagioPct, revendaPorMercado: Number(revendaMercado) > 0,
    lucroNoMinimo: r2(fipeRealista - investimentoNoMinimo),
    lucroNoTeto: r2(fipeRealista - tetoAquisicao),
    fechaNaRegra: L <= tetoLance,
    pctInvestimentoFipe: (investimentoNoMinimo / F) * 100,
  };
}

// AQUISIÇÃO PARCELADA (29/09, pedido do dono): "considerar o sinal e informar quantas parcelas e o
// valor a suportar". Sinal = entrada sobre o lance + comissão do leiloeiro + débitos assumidos (é o
// que sai do bolso no ato — a comissão e os débitos não se parcelam no leilão). O saldo do lance
// divide-se nas parcelas SEM correção: o índice (quando o edital informa) vai escrito ao lado.
// O teto de 65% da FIPE não muda por ser parcelado — é sobre o custo total da aquisição.
export function planoParcelado({ lance, comissaoPct, despesasTotal = 0, entradaPct, parcelas }) {
  const L = Number(lance) || 0, e = Number(entradaPct) / 100, n = Math.round(Number(parcelas));
  if (!(L > 0) || !(e > 0 && e < 1) || !(n >= 2)) return null;
  const c = (comissaoDeclarada(comissaoPct) ?? COMISSAO_PADRAO_PCT) / 100;
  const r2 = (x) => Math.round(x * 100) / 100;
  const entradaLance = r2(L * e);
  return {
    entradaLance, comissao: r2(L * c), despesas: r2(despesasTotal),
    sinal: r2(entradaLance + L * c + (Number(despesasTotal) || 0)),
    saldo: r2(L - entradaLance), parcelas: n, valorParcela: r2((L - entradaLance) / n),
  };
}

// REVENDA PELO MERCADO. 29/09: "média dos 5 anúncios mais em conta da Webmotors, 10% abaixo".
// 30/09 (dono): "pegar a MÉDIA dos anúncios da Webmotors [...] 10% abaixo dessa média" — a média é
// de TODOS os anúncios comparáveis da Webmotors, não só dos mais baratos. Outros portais só entram
// quando a Webmotors tem menos de 3 (e o relatório diz qual base valeu). Substitui a régua de
// deságio sobre a FIPE quando há anúncios suficientes; a régua continua como reserva.
// Sanidade, ANTES da média: preço fora de 30%–200% da FIPE é outro veículo (peça, sucata, versão
// de outra faixa); e, com 4+ anúncios, o que fica fora de 60%–160% da mediana do conjunto é versão
// errada que a busca trouxe — um único anúncio desses puxa a média inteira.
export const REVENDA_DESCONTO_PCT = 10;
export const REVENDA_MIN_ANUNCIOS = 3;
export function revendaPorAnuncios(anuncios, fipe) {
  const F = Number(fipe) || 0;
  const lista = Array.isArray(anuncios) ? anuncios : [];
  const validos = lista
    // Link vem da resposta da IA e vira href: só http(s) (um "javascript:" ali seria XSS).
    .map((a) => {
      const url = /^https?:\/\//i.test(String(a?.url || '')) ? String(a.url).slice(0, 500) : null;
      const portal = String(a?.portal || '').slice(0, 20).toLowerCase();
      return {
        preco: Math.round(Number(a?.preco) || 0),
        titulo: String(a?.titulo || '').slice(0, 120), ano: Number(a?.ano) || null, km: Number(a?.km) || null,
        local: String(a?.local || '').slice(0, 60),
        portal: /webmotors\.com\.br/i.test(url || '') ? 'webmotors' : portal,
        url,
      };
    })
    .filter((a) => a.preco > 0 && (!(F > 0) || (a.preco >= F * 0.3 && a.preco <= F * 2)));
  const unicos = [...new Map(validos.map((a) => [a.url || `${a.preco}|${a.titulo}`, a])).values()];
  const wm = unicos.filter((a) => a.portal === 'webmotors');
  const base = wm.length >= REVENDA_MIN_ANUNCIOS ? wm : unicos;
  // Rótulo = de ONDE os anúncios vieram de fato (30/09: com o Mobiauto, "misto" diria "Webmotors +
  // outros portais" sobre uma média sem nenhum anúncio da Webmotors — forma nº 10).
  const portais = [...new Set(base.map((a) => a.portal).filter(Boolean))];
  const ord = [...base].sort((a, b) => a.preco - b.preco);
  const mediana = ord.length ? ord[Math.floor((ord.length - 1) / 2)].preco : 0;
  const usados = ord.length >= 4 ? ord.filter((a) => a.preco >= mediana * 0.6 && a.preco <= mediana * 1.6) : ord;
  if (usados.length < REVENDA_MIN_ANUNCIOS) return null;
  const media = usados.reduce((s, a) => s + a.preco, 0) / usados.length;
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    media: r2(media), valor: r2(media * (1 - REVENDA_DESCONTO_PCT / 100)), descontoPct: REVENDA_DESCONTO_PCT,
    base: base === wm ? 'webmotors' : portais.length === 1 ? portais[0] : 'misto',
    anuncios: usados, descartados: lista.length - usados.length,
  };
}

// COMISSÃO DO LEILOEIRO lida do TEXTO (30/09, dono: "nem sempre é cinco por cento"). Determinística,
// antes da IA: "Comissão: 5.00% do valor do lance" (SODRÉ), "comissão do leiloeiro de 10%",
// "5% (cinco por cento) de comissão". Ignora "Comissão de Alienação/Licitação" (é um colegiado, não
// taxa) e percentuais de sinal/entrada. Devolve o número (0 < x ≤ 20) ou null — nunca presume.
export function extrairComissaoPct(texto) {
  const t = consertarAcentos(texto).replace(/\s+/g, ' ');
  const num = (s) => { const n = Number(String(s).replace(',', '.')); return n > 0 && n <= 20 ? n : null; };
  const padroes = [
    /comiss(?:[aã]o|[oõ]es)(?! de (?:alien|licit|avalia))(?:[^%.;]{0,60}?)(?:leiloeir[oa]|leil[aã]o)?[^%.;\d]{0,40}?(\d{1,2}(?:[.,]\d{1,2})?) ?%/i,
    /(\d{1,2}(?:[.,]\d{1,2})?) ?%(?: ?\([^)]{0,30}\))?[^.;%]{0,25}?(?:de |a t[ií]tulo de )?comiss[aã]o/i,
  ];
  for (const re of padroes) { const m = t.match(re); if (m && num(m[1]) != null) return num(m[1]); }
  return null;
}

// DÉBITOS COM VALOR declarados ("DÉBITOS: R$ 7.473,15 E TAXAS DE LICENCIAMENTO" — SUPERBID, o
// Cronos do print de 30/09, que saiu com "débitos —"; "Débitos em aberto: R$1.070,20"; na SODRÉ,
// "Depósito de Bens: R$ 2.350,00, Outros Débitos: 123,00"). Rede de segurança sob a IA.
// Exige DOIS-PONTOS antes do valor, medido no acervo em 30/09: sem isso casavam "multa de R$ 200,00"
// (penalidade por atraso na retirada) e "débitos até o valor de R$ 350,00" (teto condicional) — nenhum
// dos dois é dívida do lote. "R$ 0,00"/"R$00,00" e "NADA CONSTA" não entram.
export function extrairDebitosDeclarados(texto) {
  const t = consertarAcentos(texto).replace(/\s+/g, ' ');
  const out = [];
  const re = /(d[ée]bitos?(?: em aberto| pendentes| do ve[ií]culo)?|outros d[ée]bitos|ipva(?: em aberto)?|multas?(?: em aberto)?|taxa administrativa|taxa de p[áa]tio|estadia|di[áa]rias? de p[áa]tio|dep[óo]sito de bens|log[íi]stica e\/ou despachante|despachante|remo[çc][ãa]o) ?: ?(?:R\$ ?)?(\d+(?:\.\d{3})*(?:,\d{2})?)(?![\d%])/gi;
  for (const m of t.matchAll(re)) {
    const valor = Number(m[2].replace(/\./g, '').replace(',', '.'));
    if (valor > 0) out.push({ item: `${m[1].toLowerCase().replace(/^./, (c) => c.toUpperCase())} (declarado pelo leiloeiro)`, valor, origem: 'declarado' });
  }
  // Mesmo valor = mesmo débito citado duas vezes (o Cronos traz "DÉBITOS: R$ 7.473,15" no topo e
  // "Débitos em aberto: R$ 7.473,15" no rodapé) — somar os dois dobraria o custo.
  return [...new Map(out.map((d) => [d.valor, d])).values()];
}

// UTF-8 lido como Latin-1 ("ComissÃ£o", "DepÃ³sito" — raw da SODRÉ): refaz a decodificação. Só age
// quando o texto tem a assinatura do defeito e todo caractere cabe em 1 byte; senão devolve igual.
export function consertarAcentos(texto) {
  const s = String(texto || '');
  if (!/Ã[\u0080-\u00BF]/.test(s) || [...s].some((c) => c.charCodeAt(0) > 0xFF)) return s;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0))); } catch { return s; } // bytes que não formam UTF-8: o texto não era o defeito — fica como veio
}

// ─── MOBIAUTO (30/09) ─────────────────────────────────────────────────────────────────────────
// A Webmotors recusa robô (403/PerimeterX, e a busca web da IA não traz o preço). O Mobiauto abre
// pela via banco (grátis) e publica a listagem por modelo E ano em URL estável
// (/comprar/carros/brasil/<marca>/<modelo>/ano-<AAAA>), com cada anúncio em JSON-LD
// ("url": ".../<local>/<marca>/<modelo>/<ano>/<versão>/detalhes/<id>", "price": N). Medido: Montana
// 2015 → 22 anúncios, Cronos 2022 → 24, todos do modelo/ano pedidos.
const MARCAS_MOBIAUTO = { vw: 'volkswagen', gm: 'chevrolet', 'gm-chevrolet': 'chevrolet', 'vw-volkswagen': 'volkswagen',
  mercedes: 'mercedes-benz', 'm-benz': 'mercedes-benz', mb: 'mercedes-benz', mmc: 'mitsubishi', 'land-rover': 'land-rover' };
export function slugMobiauto(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function marcaMobiauto(marca) {
  const bruta = String(marca || '').replace(/^i\s*\//i, '');
  const sl = slugMobiauto(bruta);
  if (!sl) return null;
  if (MARCAS_MOBIAUTO[sl]) return MARCAS_MOBIAUTO[sl];
  const ultima = slugMobiauto(bruta.split(/\s+-\s+|\//).pop());
  return MARCAS_MOBIAUTO[ultima] || ultima || null;
}
// Candidatos de slug do MODELO, do mais específico ao mais genérico ("c3 aircross" antes de "c3").
export function modelosMobiauto(modelo) {
  // "NOVA SAVEIRO", "NOVO UNO": o portal usa o nome sem o prefixo de geração.
  const toks = String(modelo || '').trim().split(/\s+/).filter(Boolean).filter((t, i) => !(i === 0 && /^nov[oa]$/i.test(t)));
  if (!toks.length) return [];
  const um = slugMobiauto(toks[0]);
  const dois = toks[1] && /^[a-z]{3,}$/i.test(toks[1]) ? slugMobiauto(`${toks[0]} ${toks[1]}`) : null;
  return [...new Set([dois, um].filter(Boolean))];
}
// Puro: anúncios do JSON-LD da listagem, SÓ do modelo/ano pedidos (a página traz vitrines de outros).
export function anunciosMobiauto(html, { marca, modelo, ano }) {
  const re = /"url"\s*:\s*"(https:\/\/www\.mobiauto\.com\.br\/comprar\/carros\/([^/"]+)\/([^/"]+)\/([^/"]+)\/(\d{4})\/([^/"]+)\/detalhes\/\d+)[^"]*"\s*,\s*"price"\s*:\s*(\d+(?:\.\d+)?)/g;
  const out = [];
  for (const m of String(html || '').matchAll(re)) {
    const [, url, local, mc, md, a, versao, preco] = m;
    if (mc !== marca || md !== modelo || Number(a) !== Number(ano)) continue;
    out.push({ preco: Math.round(Number(preco)), titulo: `${md} ${versao}`.replace(/-/g, ' '), ano: Number(a), km: null,
      local: local.replace(/^([a-z]{2})-(.*)$/, (_, uf, c) => `${c.replace(/-/g, ' ')}/${uf.toUpperCase()}`), portal: 'mobiauto', url });
  }
  return [...new Map(out.map((x) => [x.url, x])).values()];
}
// Mesma versão/motor primeiro: "MONTANA LS 1.4" prefere anúncios "ls-1-4-flex". Se a versão não
// tiver 3 comparáveis, fica o modelo/ano inteiro (a média diz isso no rótulo, não esconde).
// `ignorar`: palavras do NOME DO MODELO (l200, triton, sport…) — nunca contam como versão (30/09: com
// Mobiauto + OLX juntos, "triton" casava com os títulos da OLX e não com o trecho de versão do Mobiauto,
// e o filtro chamava de "mesma versão" os 46 anúncios da OLX de um lote GL 2.5 que não tinha nenhum).
export function filtrarVersao(anuncios, modelo, ignorar = []) {
  const fora = new Set((ignorar || []).flatMap((w) => String(w || '').toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const toks = String(modelo || '').toLowerCase().replace(/(\d)[.,](\d)/g, '$1-$2').split(/\s+/).slice(1)
    .map((t) => t.replace(/[^a-z0-9-]/g, '')).filter((t) => t.length >= 2 && !fora.has(t));
  if (!toks.length) return { lista: anuncios, versao: false };
  // Casa por segmento inteiro ("-ls-" em "-ls-1-4-flex-"), nunca substring solta ("at" em "flat").
  // Palavra de 4+ letras também casa por PREFIXO do segmento: o título abrevia ("ENDURAN" → "endurance").
  const casa = (v, t) => v.includes(`-${t}-`) || (/^[a-z]{4,}$/.test(t) && v.includes(`-${t}`));
  // Chave da versão: o segmento da URL no Mobiauto; o título inteiro (em slug) nos demais portais.
  const chave = (a) => `-${a.versao || String(a.url || '').split('/')[9] || ''}-`;
  // Token que casa com TODOS os anúncios não distingue versão (30/09: na OLX o título traz o modelo —
  // "triton" casava com os 46 e o filtro dizia "mesma versão" sobre o modelo inteiro).
  const uteis = anuncios.length > 1 ? toks.filter((t) => !anuncios.every((a) => casa(chave(a), t))) : toks;
  const pont = anuncios.map((a) => ({ a, n: uteis.filter((t) => casa(chave(a), t)).length }));
  const max = Math.max(0, ...pont.map((p) => p.n));
  const melhores = pont.filter((p) => max > 0 && p.n === max).map((p) => p.a);
  return melhores.length >= REVENDA_MIN_ANUNCIOS ? { lista: melhores, versao: true } : { lista: anuncios, versao: false };
}

// Slugs de MODELO que a página da marca/ano do Mobiauto lista começando por um dos candidatos
// (30/09: "L200 TRITON" → o portal só tem 2021 em "l200-triton-sport"; chutar sufixo não escala).
export function slugsModeloMobiauto(html, marca, candidatos) {
  const achados = new Set();
  for (const m of String(html || '').matchAll(/\/comprar\/carros\/[^/"]+\/([a-z0-9-]+)\/([a-z0-9-]+)/g)) {
    if (m[1] !== marca || /^ano-\d{4}$/.test(m[2])) continue;
    if ((candidatos || []).some((c) => m[2] === c || m[2].startsWith(`${c}-`))) achados.add(m[2]);
  }
  return [...achados];
}

// Puro: anúncios da busca da OLX (30/09, dono: "procurar anúncios na OLX, Mercado Livre e portais").
// Lida VIA BANCO (a OLX responde 200 com os cards renderizados; o Mercado Livre devolve a página de
// "tráfego suspeito" e fica fora). Só entra anúncio com o ANO pedido e o 1º termo do modelo no título.
export function anunciosOlx(html, { ano, modelo }) {
  const s = String(html || '');
  const re = /href="(https:\/\/[a-z]{2}\.olx\.com\.br\/[^"]+)"[^>]*>\s*<h2[^>]*olx-adcard__title[^>]*>([^<]+)<\/h2>/g;
  const cards = [...s.matchAll(re)];
  const primeiro = slugMobiauto(String(modelo || '').split(/\s+/).find((t) => !/^nov[oa]$/i.test(t)) || '');
  const out = [];
  cards.forEach((m, i) => {
    const bloco = s.slice(m.index, i + 1 < cards.length ? cards[i + 1].index : m.index + 20000);
    const titulo = m[2].replace(/&amp;/g, '&').trim();
    const slugT = slugMobiauto(titulo);
    const preco = Number(((bloco.match(/olx-adcard__price[^>]*>\s*R\$\s*([\d.]+)/) || [])[1] || '').replace(/\./g, ''));
    const anoT = Number((titulo.match(/\b(19[89]\d|20[0-4]\d)\b(?!.*\b(19[89]\d|20[0-4]\d)\b)/) || [])[1]) || null;
    if (!preco || (ano && anoT !== Number(ano)) || (primeiro && !`-${slugT}-`.includes(`-${primeiro}-`))) return;
    const km = Number((bloco.match(/aria-label="(\d+) quil[ôo]metros rodados"/) || [])[1]) || null;
    const local = ((bloco.match(/olx-adcard__location"[^>]*>(?:\s*<svg[\s\S]*?<\/svg>)?(?:\s*<!--[\s\S]*?-->)*\s*([^<]{3,60})</) || [])[1] || '')
      .trim().replace(/\s*-\s*([A-Z]{2})$/, '/$1');
    out.push({ preco, titulo: titulo.slice(0, 120), ano: anoT, km, local, portal: 'olx', url: m[1].split('?')[0], versao: slugT });
  });
  return [...new Map(out.map((x) => [x.url, x])).values()];
}

// Modelo a partir do TÍTULO do lote quando `modelo` vem nulo (30/09: os 4 relatórios regerados eram
// SUPERBID sem `modelo`): "FIAT CRONOS DRIVE 1.3 ANO: 2020/2020 …" → "CRONOS DRIVE 1.3";
// "RENAULT OROCH PRO 16, 2024/2025, Placa …" → "OROCH PRO 16". Tira a marca e corta no 1º
// separador (vírgula, "ANO", ano AAAA/AAAA, "PLACA").
export function modeloDoTitulo(titulo, marca) {
  let t = String(titulo || '').replace(/\s+/g, ' ').trim();
  const mc = String(marca || '').trim();
  if (mc) t = t.replace(new RegExp(`^(?:i\\s*/\\s*)?${mc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s/-]*`, 'i'), '');
  t = t.split(/,|\bano\b|\b(?:19|20)\d{2}\s*\/|\bplaca\b|\(/i)[0].trim();
  return t || null;
}
