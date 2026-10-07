/**
 * Parser puro do CARD de imóvel do WEBLEILÕES — reescrito em 07/10, depois que o site
 * reestruturou as URLs e o coletor passou a trazer ZERO (pendência #148).
 *
 * O QUE MUDOU, medido na página viva (workflow _temp-recon-webleiloes, 07/10 22:21 e 22:25):
 *  · `/busca?categoria=imoveis` e `/leiloes` agora devolvem HTTP 404 — duas das três rotas
 *    do coletor morreram. Só `/imoveis` está de pé, com 49 lotes em 2 páginas.
 *  · o endereço do lote saiu de `/oferta/{leilao|venda-direta}/imoveis/…id-NNN` para
 *    `/imoveis/<categoria>/<uf>/<cidade>/<slug>-<uf>-<ID>`. Não há mais `/oferta/` nem
 *    `id-NN` em NENHUM dos 243 links da página — por isso o seletor antigo achava zero.
 *  · a MODALIDADE sumiu da URL e passou a viver no texto do card ("Extrajudicial Aberto …").
 *  · em compensação o card ganhou o que faltava: as DATAS e os VALORES de cada praça.
 *
 * A URL nova é a fonte boa de categoria, UF, cidade e id (são segmentos, não texto solto);
 * o card é a fonte de modalidade, valores e datas. Cada campo vem de onde é menos ambíguo.
 */
import { normalizarTipo } from '../../api/_tipo.js';

const BASE = 'https://www.webleiloes.com.br';

// /imoveis/<categoria>/<uf>/<cidade>/<slug>-<uf>-<ID>
const RE_LOTE = /^\/imoveis\/([a-z0-9-]+)\/([a-z]{2})\/([a-z0-9-]+)\/(.+?)-(\d+)$/i;

const titulo = (s) => String(s || '').toLowerCase().replace(/(?:^|\s|-)(\S)/g, (c) => c.toUpperCase());
const brl = (s) => (s ? parseFloat(String(s).replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim()) || 0 : 0);

/** Separa o caminho de um href absoluto ou relativo; devolve '' se não for do WebLeilões. */
export function caminhoDoHref(href) {
  const h = String(href || '').trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) {
    try {
      const u = new URL(h);
      return /(^|\.)webleiloes\.com\.br$/i.test(u.hostname) ? u.pathname : '';
    } catch { return ''; }   // padrao-ok: href malformado não é lote; a falha É a resposta
  }
  return h.split('?')[0].split('#')[0];
}

/** Dados que só a URL dá, de forma inequívoca. `null` quando o href não é de um lote. */
export function loteDaUrl(href) {
  const m = caminhoDoHref(href).match(RE_LOTE);
  if (!m) return null;
  const [, categoria, uf, cidadeSlug, slug, id] = m;
  return {
    id, categoria, uf: uf.toUpperCase(), cidade: titulo(cidadeSlug.replace(/-/g, ' ')),
    slug, url: `${BASE}/imoveis/${categoria}/${uf}/${cidadeSlug}/${slug}-${id}`,
  };
}

/**
 * Praças do card. Exemplo real (lote 25931, página 2 de 07/10):
 *   "… 25931 · Lote 1 R$ 89.988,01 1º Leilão 24/09/2026 14:00 28/09/2026 14:00 R$ 149.980,01
 *    2º Leilão 28/09/2026 14:00 21/10/2026 14:00 R$ 89.988,01"
 * Cada praça traz DUAS datas — abertura e ENCERRAMENTO — e o valor vem depois delas. A data
 * que interessa é a segunda: o contador do card ("2º leilão encerra em 13D") bate com ela
 * (21/10 é 13 dias depois de 07/10), e é ela que a limpeza horária usa para expirar o lote.
 */
export function pracasDoCard(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  // "Leilão Único" (praça única, sem 1º/2º) é a forma de 12 dos 49 lotes no ensaio em seco de
  // 07/10 — sem ela, saíam todos sem data, e lote sem data nunca expira pela limpeza horária.
  const re = /(?:(\d)[ºo°]\s*Leil[ãa]o|Leil[ãa]o\s+[ÚU]nico)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s*(?:R\$\s*([\d.]+,\d{2}))?/gi;
  const out = [];
  for (const m of t.matchAll(re)) {
    const [dia, mes, ano] = m[4].split('/');
    out.push({ n: m[1] ? Number(m[1]) : 1, fim: `${ano}-${mes}-${dia}T${m[5]}:00-03:00`, valor: brl(m[6]) });
  }
  return out;
}

/**
 * Monta a linha do acervo a partir do href + texto do card (+ foto, quando houver).
 * Devolve `null` quando o href não é de um lote — chamador descarta.
 */
export function mapaCardWebLeiloes({ href, texto = '', img = '' } = {}) {
  const u = loteDaUrl(href);
  if (!u) return null;
  const t = String(texto || '').replace(/\s+/g, ' ').trim();

  // Valor VIGENTE: o 1º "R$" do card, que vem logo depois de "<ID> · Lote N" e é o valor da
  // praça em andamento (conferido nos dois cards reais: 89.988,01 = o 2º leilão, que é o
  // vigente). Fora desse formato, cai no 1º R$ do texto, como fazia o mapeador antigo.
  const vigente = brl((t.match(/\b\d+\s*·\s*Lote\s*\d+\s*R\$\s*([\d.]+,\d{2})/i) || t.match(/R\$\s*([\d.]+,\d{2})/) || [])[1]);
  const pracas = pracasDoCard(t);
  // AVALIAÇÃO = o MAIOR valor entre as praças. A 1ª praça costuma sair pela avaliação e a 2ª
  // por um mínimo menor (lote 25931: 149.980,01 → 89.988,01, com o selo "40% abaixo no 2º
  // leilão" conferindo). Mas o acervo tem o contrário: no lote 25884 o card imprime 1ª praça
  // R$ 858.000,00 e 2ª R$ 1.811.647,93. Pegar sempre a 1ª ali gravaria "mínimo MAIOR que a
  // avaliação" e um desconto negativo na vitrine; o maior valor é a referência honesta nos
  // dois casos, e no normal dá exatamente a 1ª praça.
  const avaliacao = Math.max(0, ...pracas.map((p) => p.valor));
  // "Venda Direta" primeiro: é a única que liga a reconferência de preço na página do lote
  // (enriquecerDocumentosLote, `reconferirPreco`). O recon de 07/10 não achou nenhuma em
  // /imoveis, mas o acervo tinha 20 ativas na rota antiga — se voltarem, entram certas.
  const modalidade = /\bvenda\s+direta\b/i.test(t) ? 'venda_direta'
    : /\bjudicial\b/i.test(t) && !/\bextrajudicial\b/i.test(t) ? 'judicial' : 'extrajudicial';

  // Título: o trecho entre o contador e o "<ID> · Lote" já vem pronto e com acento
  // ("Casa em Condomínio 44m² Vila Belo Horizonte, Itapetininga/SP"). Sem ele, o slug — que
  // tem a mesma informação, só que sem acento.
  // O contador diz "Encerra em 13D 18:33:58" no lote aberto e "Inicia em 14D …" no que ainda
  // não abriu — o ensaio em seco achou 11 destes caindo no título do slug, sem acento.
  const mt = t.match(/(?:encerra|inicia)\s+em\s+(?:\d+\s*D\s+)?[\d:]+\s+(.*?)\s+\d+\s*·\s*Lote/i);
  const bruto = mt ? mt[1] : titulo(u.slug.replace(/-/g, ' '));
  // O trecho é "<título que termina em Cidade/UF> <Cidade, UF da linha de localização>". Corta
  // logo DEPOIS do primeiro "/UF" — o título fica no padrão do acervo ("…, Sorocaba/SP") e a
  // linha de localização, que repete a cidade, sai. Duas tentativas anteriores erravam por
  // REGEX DE NOME DE CIDADE: com vírgula obrigatória sobrava "Casa 100m² Americana/", e o padrão
  // guloso comia o "SP" do meio. A UF da URL é exata; não há nome de cidade para adivinhar.
  const fimUf = bruto.search(new RegExp(`\\/${u.uf}\\b`));
  const tituloLimpo = (fimUf > 0 ? bruto.slice(0, fimUf + 3) : bruto).trim() || bruto;

  // Área: "1437m²" no título, ou "44m2" no slug. Duas formas, e as DUAS mordem:
  //  · com separador de milhar, o padrão tem de exigir grupos de EXATAMENTE 3 dígitos, senão
  //    "22.677,54 m²" vira 677 m² — lote 33× menor (achado de 03/09, em outro coletor);
  //  · sem separador, exigir grupos de 3 faz "1437m²" virar 437 m² (visto aqui, no lote 25884:
  //    o `\d{1,3}` casa "143", falha no "7m²", e o motor recomeça em "437").
  // Por isso a alternância: ou a forma agrupada INTEIRA, ou uma corrida simples de dígitos.
  const RE_AREA = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*m²/i;
  const am = bruto.match(RE_AREA) || u.slug.match(/(\d+)m2\b/i);
  // Hectare (ensaio de 07/10: "Sítio 14 hectares" saía com área 0). 1 ha = 10.000 m².
  const ha = !am && bruto.match(/(\d+(?:,\d+)?)\s*(?:ha|hectares?)\b/i);
  const area = am ? parseFloat(String(am[1]).replace(/\./g, '').replace(',', '.'))
    : ha ? Math.round(parseFloat(ha[1].replace(',', '.')) * 10000) : 0;

  const p1 = pracas.find((p) => p.n === 1) || pracas[0] || null;
  const p2 = pracas.find((p) => p.n === 2) || null;
  return {
    fonte: 'WEBLEILOES', fonte_id: `webleiloes_${u.id}`,
    titulo: tituloLimpo.slice(0, 180),
    // `tipo` canônico (api/_tipo.js), nunca a categoria crua da URL: a coluna é `tipo` — não
    // existe `categoria` em imoveis_leilao, e o upsert com ela daria 400 no lote inteiro — e a
    // Busca filtra por igualdade exata no conjunto canônico. A categoria da URL ("glebas",
    // "imoveis-rurais") entra junto com o título para desempatar.
    tipo: normalizarTipo(`${u.categoria.replace(/-/g, ' ')} ${tituloLimpo}`),
    modalidade, estado: u.uf, cidade: u.cidade, bairro: '', endereco: '',
    valor_avaliacao: avaliacao, valor_minimo: vigente || avaliacao, area_m2: area || 0,
    descricao: t.slice(0, 500),
    link_edital: u.url, url_lote: u.url,
    link_foto: /^https?:\/\//.test(String(img || '')) ? img : null,
    leiloeiro: 'WebLeilões', forma_pagamento: 'a_vista',
    data_leilao: p1 ? p1.fim : null,
    data_leilao_2: p2 ? p2.fim : null,
  };
}

/**
 * Roda DENTRO da página (page.evaluate) — por isso é autocontida, sem nada de fora do corpo.
 * Mora aqui, e não inline no coletor, para que o ensaio em seco (scripts/recon-webleiloes-seco.mjs)
 * meça exatamente o mesmo código que a coleta de verdade roda.
 * Devolve os cards (href + texto + foto) e o total que a própria página declara.
 */
export function extrairCardsWebLeiloes() {
  const RE_LOTE = /\/imoveis\/[a-z0-9-]+\/[a-z]{2}\/[a-z0-9-]+\/.+-(\d+)(?:[?#]|$)/i;
  const idDe = (h) => (String(h || '').match(RE_LOTE) || [])[1] || null;
  const vistos = new Set(); const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    const id = idDe(href);
    if (!id || vistos.has(id)) continue; vistos.add(id);
    // O CARD É O MAIOR ANCESTRAL QUE SÓ CONTÉM ESTE LOTE (07/10). A 1ª versão usava
    // `closest('[class*="card"]')` — o ancestral mais PRÓXIMO com "card" na classe — e no site
    // novo esse é o invólucro da FOTO: o ensaio em seco trouxe 49 de 49 cards com texto VAZIO,
    // logo sem valor e sem data. Sobe-se até o nível em que aparece o link de OUTRO lote (aí já
    // é a grade); o último nível antes disso é o card inteiro, sem depender de nome de classe.
    let card = a.parentElement;
    for (let el = a.parentElement, i = 0; el && el !== document.body && i < 15; el = el.parentElement, i++) {
      const outro = [...el.querySelectorAll('a[href]')].some((x) => { const o = idDe(x.getAttribute('href')); return o && o !== id; });
      if (outro) break;
      card = el;
      // Já tem tudo o que o mapeador lê (marca do lote, praças e modalidade)? Para aqui. Sem esta
      // parada, uma página com UM lote só subiria até o <body> e o texto do card seria o menu.
      const t = el.textContent || '';
      if (new RegExp(`\\b${id}\\s*·\\s*Lote`).test(t) && /\d[ºo°]\s*Leil[ãa]o|Leil[ãa]o\s+[ÚU]nico/i.test(t) && /judicial|venda\s+direta/i.test(t)) break;
    }
    const img = card ? card.querySelector('img') : null;
    out.push({
      href,
      texto: card ? (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600) : '',
      // A PROPRIEDADE `src` (não o atributo): o navegador já a devolve absoluta. O atributo cru
      // é caminho relativo e o mapeador o descartava — o ensaio de 07/10 saiu com 0 de 49 fotos.
      img: img ? ([img.currentSrc, img.src, img.getAttribute('data-src')].find((x) => x && !/^data:/i.test(x)) || '') : '',
    });
  }
  // "Imóveis 1-32 de 49 itens" — o total que a própria página declara.
  const m = (document.body.innerText || '').match(/(\d+)\s*-\s*(\d+)\s+de\s+(\d+)\s+itens/i);
  return { lotes: out, itens: m ? Number(m[3]) : 0 };
}
