/**
 * Leitura do RESULTADO REAL do leilão a partir da página do próprio lote — pedido do dono
 * (20/09): "no próprio site do leiloeiro... cada vai apresentar de uma forma" (vendido / sem
 * licitantes / não vendido, às vezes com o valor do lance vencedor). Não existe padrão único
 * entre fontes, então o parser é GENÉRICO: procura os dois grupos de palavras-sinal em
 * português (venda × ausência de lance). Um sinal de VENDA não-negado ganha de um "sem lance"
 * concorrente — é o caso normal de lote com 1ª praça deserta e 2ª praça vendida (o outcome que
 * importa é o final, não o histórico da 1ª). Sem nenhum sinal de venda, "sem lance" vale.
 * Nenhum dos dois → não vira palpite, fica `indeterminado` (ver comentário da migration
 * `resultado_leilao_apurado.sql`).
 *
 * FORMA #10 encontrada aqui em 21/09 (o instrumento mede uma coisa e reporta com o nome de
 * outra — ver CLAUDE.md): "vendido"/"arrematado"/"arrematante" SOZINHOS são clichê de cláusula
 * padrão que aparece em TODO edital, tenha o lote vendido ou não — "o imóvel será vendido no
 * estado em que se encontra" (condição do bem, não resultado) e "despesas do arrematante"/
 * "documentação do imóvel arrematado" (o que um FUTURO comprador pagaria, não uma afirmação de
 * que já pagou). Confirmado ao vivo: LEILOFY e PESTANA marcaram "vendido" em lotes cuja única
 * evidência era essa mesma frase-clichê, idêntica em TODO anúncio daquela fonte — 15 dos 44
 * "vendido" gravados no primeiro dia eram isso. ZUK/MEGA (genuínos, com valor real do lance
 * confirmado) NUNCA dependeram só da palavra solta. Por isso a palavra fraca só conta quando
 * há um R$ CONFIRMANDO pertinho dela — nos casos genuínos o valor sempre aparece junto; na
 * cláusula padrão, nunca.
 */

// "vendido"/"arrematado" aparecem como PALAVRA inteira dentro de "NÃO vendido"/"NÃO
// arrematado" — um `\b` sozinho casa os dois sentidos. Por isso a busca é NEGATION-AWARE:
// cada ocorrência só conta como sinal de VENDA quando os ~20 caracteres antes dela não têm
// uma negação (não/nunca/sem).
// Sinal FORTE: frase declarativa de RESULTADO, específica o bastante para não ser confundida
// com cláusula padrão de custas/condição do bem — aceita mesmo sem R$ por perto.
const RE_VENDIDO_FORTE = /\b(encerrad[oa]\s+com\s+lance|leil[aã]o\s+conclu[íi]do\s+com\s+[êe]xito|hasta\s+p[uú]blica\s+conclu[íi]da)\b/gi;
// Sinal FRACO: ambíguo por natureza (ver comentário do topo) — só confirma junto de um valor.
// "arrematante" saiu (05/10, #44): é o SUJEITO das cláusulas ("Débitos de IPTU de aprox. R$ 25.000,00,
// pagos pelo arrematante") — no MEGA, 72 de 319 "vendidos" tinham o valor do DÉBITO como lance.
const RE_VENDIDO_FRACO = /\b(vendid[oa]|arrematad[oa])\b/gi;
// A negação só vale dentro da MESMA frase — sem isso, "sem lance. Arrematado..." (frase nova)
// contaminava o "Arrematado" seguinte como se fosse negado por um "sem" de outra oração.
const RE_NEGACAO = /\b(n[aã]o|nunca|sem)\s+(?:foi\s+|houve\s+)?\S*\s*$/i;
const CORTA_FRASE = /[.!?;\n][^.!?;\n]*$/;
const RE_SEM_LANCE = /\b(sem\s+licitantes?|sem\s+lances?|n[aã]o\s+(?:foi\s+|houve\s+)?arrematad[oa]|n[aã]o\s+(?:foi\s+|restou\s+)?vendid[oa]|lote\s+deserto\b|\bdeserto\b|nenhum\s+lance|leil[aã]o\s+negativo|insucesso\s+d[eo]\s+leil[aã]o)\b/i;
const RE_VALOR = /r\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;

function naoNegado(txt, idx) {
  let antes = txt.slice(Math.max(0, idx - 30), idx);
  const corte = antes.match(CORTA_FRASE); // negação não atravessa fim de frase
  if (corte) antes = corte[0].slice(1);
  return !RE_NEGACAO.test(antes);
}

// ─── ZUK (portalzuk.com.br) — leitor próprio (24/09, recon de páginas reais) ───────────────
// O genérico errava nos dois sentidos: (a) nunca reconhecia o "sem lance" — a ZUK escreve
// "Este leilão já foi encerrado" + "R$ 0,00 Maior lance até agora" (131 indeterminados × 0
// sem_lance em 10 dias); (b) dava VENDIDO FALSO antes do pregão, pela cláusula "Em caso de
// arrematação, o Arrematante…" com um R$ por perto (Prestes Maia 241: "O 1º Leilão ocorrerá
// 24/09 às 13h00… R$ 0,00 Maior lance" gravado como vendido por R$ 389.848). Aqui só vale o
// PAINEL DE LANCES: sem o painel é página de listagem (lote retirado → redireciona) e sem
// "já foi encerrado" o pregão não acabou (ex.: 2ª praça por vir) — nos dois casos, null.
function apurarZuk(txt) {
  const painel = txt.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*Maior lance at[ée] agora/i);
  if (!painel) return null;
  if (!/Este leil[aã]o j[aá] foi encerrado/i.test(txt)) return null;
  const valor = parseFloat(painel[1].replace(/\./g, '').replace(',', '.'));
  return valor > 0 ? { resultado: 'vendido', valor } : { resultado: 'sem_lance', valor: null };
}

// ─── SUPORTE LEILÕES (JELEILOES, KLEILOES, WEBLEILOES — URL /oferta/leilao/) — 24/09 ────────
// Recon de 13 páginas reais: o genérico não lia nada aqui. A plataforma escreve o estado em
// `"statusString":"…"` e numa tabela "Lance Atual · Número de Lances · Status" (ex.: "--> R$ 0,00
// 0 Cancelado 10966"). Achados: (a) JELEILOES com praça vencida = CANCELADO pelo juízo (4 de 4,
// com anexo "Decisão de cancelamento") — nem "sem lance" nem "com lance", sai do ar; (b) KLEILOES
// = ainda ABERTO: venda direta renovada ("Data Até 23/10/2026") ou 2ª praça que não tínhamos
// ("07/10/2026 10:00 (2º Leilão)"). Aberto não é resultado: devolve `aberto` + a data nova, e o
// cron atualiza a data em vez de gastar tentativa.
const RE_DATA_BR = /(\d{2})\/(\d{2})\/(\d{4})/;
const iso = (m) => `${m[3]}-${m[2]}-${m[1]}`;
function apurarSuporte(html, txt, hojeISO) {
  const status = (String(html).match(/"statusString"\s*:\s*"([^"]{1,40})"/) || [])[1] || '';
  const tab = txt.match(/-->\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d+)\s+([A-Za-zÀ-ú][A-Za-zÀ-ú ]{2,30}?)\s+\d+\s+Visualizar/i);
  const stTab = tab ? tab[3].trim() : '';
  const lanceAtual = tab ? parseFloat(tab[1].replace(/\./g, '').replace(',', '.')) : 0;
  const nLances = tab ? Number(tab[2]) : 0;
  const st = `${stTab} ${status}`.toLowerCase();

  if (/cancelad|suspens|retirad/.test(stTab.toLowerCase())) return { resultado: 'cancelado', valor: null };
  if (/aberto|em breve|loteamento|aguardando|andamento/.test(st)) {
    // Data mais distante ainda por vir: "Data Até dd/mm/aaaa" (venda direta) ou "dd/mm/aaaa … (2º Leilão)".
    const ate = txt.match(/Data\s+At[ée]\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    const p2 = txt.match(/(\d{2})\/(\d{2})\/(\d{4})[^()]{0,20}\(\s*2\s*[º°ª]?\s*Leil[ãa]o\s*\)/i);
    const nova = {};
    if (ate && iso(ate) > hojeISO) nova.data_leilao = iso(ate);
    if (p2 && iso(p2) > hojeISO) {
      const hora = (txt.slice(p2.index, p2.index + 40).match(/(\d{2}:\d{2})/) || [])[1] || '10:00';
      nova.data_leilao_2 = `${iso(p2)}T${hora}:00-03:00`;
    }
    return { resultado: null, aberto: true, novaData: Object.keys(nova).length ? nova : null };
  }
  if (/vendid|arrematad|condicional/.test(st)) return { resultado: 'vendido', valor: lanceAtual >= 1000 ? lanceAtual : null };
  if (tab && /encerrad|desert|sem licit|n[ãa]o vendid|finalizad/.test(st)) {
    return (nLances > 0 || lanceAtual > 0) ? { resultado: 'vendido', valor: lanceAtual >= 1000 ? lanceAtual : null } : { resultado: 'sem_lance', valor: null };
  }
  return null;
}

// ─── FRAZÃO (frazaoleiloes.com.br) — 05/10, #44, página real lida por pg_net ──────────────────
// 112 de 117 lotes "indeterminado". Causa: o lote seguia ABERTO — "Liberado para Lance" com o 2º
// leilão por vir ("2º Leilão: 05/10/2026 às 15h00") —, mas sem a data da 2ª praça no acervo o cron
// apurava depois da 1ª, não achava resultado e gastava as 3 tentativas. O genérico não serve: o
// modal "esse lote pertence a um leilão que já foi encerrado" está no HTML de TODA página (só
// aparece quando é o caso) e "Maior lance atual: R$ 0,00" existe com o pregão aberto.
function apurarFrazao(html, hojeISO) {
  const h = String(html).replace(/&#186;/g, 'º').replace(/&#227;/g, 'ã').replace(/&#224;/g, 'à').replace(/&#233;/g, 'é');
  const status = ((h.match(/auction-status"[^>]*>\s*([^<]{1,80})</) || [])[1] || '').trim().toLowerCase();
  if (!status) return null;
  const lance = h.match(/Maior lance atual:[\s\S]{0,160}?R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const valor = lance ? parseFloat(lance[1].replace(/\./g, '').replace(',', '.')) : 0;
  if (/liberado|em breve|aberto|aguardando|andamento|lance/.test(status) && !/encerrad|finalizad|vendid|arrematad/.test(status)) {
    const nova = {};
    for (const m of h.matchAll(/(\d)º Leilão:\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s*às\s*(\d{2})h(\d{2}))?/g)) {
      const dia = `${m[4]}-${m[3]}-${m[2]}`;
      if (m[1] === '2' && dia >= hojeISO) nova.data_leilao_2 = `${dia}T${m[5] || '10'}:${m[6] || '00'}:00-03:00`;
    }
    return { resultado: null, aberto: true, novaData: Object.keys(nova).length ? nova : null };
  }
  if (/cancelad|suspens|retirad/.test(status)) return { resultado: 'cancelado', valor: null };
  if (/vendid|arrematad|condicional/.test(status)) return { resultado: 'vendido', valor: valor >= 1000 ? valor : null };
  if (/encerrad|finalizad|desert|sem licit|n[ãa]o vendid/.test(status)) {
    return valor > 0 ? { resultado: 'vendido', valor: valor >= 1000 ? valor : null } : { resultado: 'sem_lance', valor: null };
  }
  return null;
}

// ─── VIP (leilaovip.com.br) — 05/10, #44, páginas reais abertas pelo GitHub ───────────────────
// O genérico ERRAVA aqui: "Vendido por Compre Já" é RÓTULO de botão em toda página, e o R$ mais
// perto dele era o "Incremento: R$ 5.000,00" — lote vendido por R$ 109.340,02 saía "vendido R$
// 5.000". E "Status: Sem ofertas" com "O leilão está encerrado" não era reconhecido (nulo).
// Fonte da verdade: o campo "Status: X" e o "Atual : valor" do painel.
function apurarVip(txt) {
  const status = ((txt.match(/Status:\s*([A-Za-zÀ-ú ]{3,30}?)\s+Tipo de Leil/i) || [])[1] || '').trim().toLowerCase();
  if (!status) return null;
  const encerrado = /leil(?:ão|&#xe3;o|ao) est(?:á|&#xe1;|a) encerrado|Leil(?:ão|&#xe3;o|ao) Encerrado/i.test(txt);
  const atual = txt.match(/Atual\s*:\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const valor = atual ? parseFloat(atual[1].replace(/\./g, '').replace(',', '.')) : null;
  if (/cancelad|suspens|retirad/.test(status)) return { resultado: 'cancelado', valor: null };
  if (/^vendid|arrematad/.test(status)) return { resultado: 'vendido', valor: valor >= 1000 ? valor : null };
  if (/condicional/.test(status)) return null; // lance abaixo do mínimo, espera o comitente: não é resultado
  if (encerrado && /sem ofert|sem lance|sem licit|desert/.test(status)) return { resultado: 'sem_lance', valor: null };
  if (!encerrado) return { resultado: null, aberto: true, novaData: null };
  return null;
}

// ─── MEGA (megaleiloes.com.br) — 05/10, #44, página real lida por pg_net ──────────────────────
// O cabeçalho do lote encerrado diz tudo: "Leilão encerrado R$ 167.000,00 … Visitas 6.593
// Habilitados 209 Lances 1". O genérico pegava o R$ de "Débitos de IPTU de aprox. R$ 25.000,00,
// pagos pelo arrematante" (72 de 319 vendidos com o valor do débito).
function apurarMega(txt) {
  const m = txt.match(/Leil[ãa]o encerrado\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})[\s\S]{0,400}?\bLances\s+(\d+)/i);
  if (!m) return null;
  const valor = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  return Number(m[2]) > 0 ? { resultado: 'vendido', valor: valor >= 1000 ? valor : null } : { resultado: 'sem_lance', valor: null };
}

// Extrai o resultado do TEXTO já limpo da página (tags removidas). Devolve
// `{ resultado: 'vendido'|'sem_lance'|'cancelado', valor: number|null }`, `{ resultado: null, aberto: true,
// novaData }` (pregão ainda aberto — Suporte Leilões) ou `null` (indeterminado/sem sinal).
// `url` (opcional, 24/09): escolhe o leitor próprio da fonte quando existe (ZUK).
export function apurarResultadoDoTexto(html, url = '') {
  if (!html) return null;
  const txt = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  if (/portalzuk\.com\.br/i.test(String(url))) return apurarZuk(txt);
  if (/leilaovip\.com\.br/i.test(String(url))) return apurarVip(txt);
  if (/megaleiloes\.com\.br/i.test(String(url))) {
    const r = apurarMega(txt);
    if (r) return r; // sem o cabeçalho de encerrado → genérico (que agora exige o R$ DEPOIS da palavra)
  }
  if (/frazaoleiloes\.com\.br/i.test(String(url))) {
    const r = apurarFrazao(html, new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
    if (r) return r; // status não reconhecido → cai no genérico
  }
  if (/\/oferta\/leilao\//i.test(String(url)) || /"statusString"\s*:/.test(String(html))) {
    const r = apurarSuporte(html, txt, new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
    if (r) return r; // sem status reconhecível → cai no genérico abaixo
  }

  // 1) Sinal FORTE — 1º não-negado já basta; procura valor perto, senão na página inteira
  //    (aqui é seguro: a frase já é declarativa o bastante pra confiar num R$ mais distante).
  RE_VENDIDO_FORTE.lastIndex = 0;
  let m;
  while ((m = RE_VENDIDO_FORTE.exec(txt))) {
    if (naoNegado(txt, m.index)) {
      const mv = txt.slice(Math.max(0, m.index - 150), m.index + 150).match(RE_VALOR) || txt.match(RE_VALOR);
      const valor = mv ? parseFloat(mv[1].replace(/\./g, '').replace(',', '.')) : null;
      return { resultado: 'vendido', valor: valor && valor >= 1000 ? valor : null };
    }
  }

  // 2) Sinal FRACO — só conta a ocorrência que tiver um R$ CONFIRMANDO pertinho; sem isso é
  //    clichê de cláusula padrão (ver comentário do topo), continua procurando outra ocorrência.
  RE_VENDIDO_FRACO.lastIndex = 0;
  while ((m = RE_VENDIDO_FRACO.exec(txt))) {
    if (!naoNegado(txt, m.index)) continue;
    // Resultado de verdade escreve o valor LOGO DEPOIS ("Arrematado por R$ 199.680,00", "Vendido
    // R$ …"); cláusula não ("será vendido no estado…", "imóvel arrematado… R$" de outra frase).
    // Por isso o R$ tem de vir DEPOIS, na mesma frase, a até 60 caracteres (05/10, #44).
    const depois = txt.slice(m.index + m[0].length, m.index + m[0].length + 60).split(/[.;!?](?!\d)/)[0];
    if (/^\s*(no estado|um a um|ad corpus|nas condi|conforme|em car[áa]ter)/i.test(depois)) continue;
    const mv = depois.match(RE_VALOR);
    const valor = mv ? parseFloat(mv[1].replace(/\./g, '').replace(',', '.')) : null;
    if (valor && valor >= 1000) return { resultado: 'vendido', valor };
  }

  if (RE_SEM_LANCE.test(txt)) return { resultado: 'sem_lance', valor: null };
  return null;
}

// O QUE GRAVAR a partir da leitura — regra ÚNICA para o cron e para a reapuração sob demanda
// (24/09: os dois montavam o patch cada um, e o `aberto` novo teria virado resultado nulo num deles).
//   aberto     → pregão ainda não acabou: NÃO conta tentativa nem afirma resultado; só carimba a hora
//                (rodízio da fila) e, em imóvel, grava a data nova (venda direta renovada/2ª praça) e
//                religa se a limpeza tinha desligado por praça vencida.
//   cancelado  → sai do ar com motivo próprio (não é "sem lance": não dá para propor).
//   vendido / sem_lance / null(indeterminado) → como sempre; religar só se não vendeu.
export function patchDaApuracao(achado, { tabela, tentativasAntes = 0, religarSeNaoVendido = false }) {
  const agora = new Date().toISOString();
  if (achado?.aberto) {
    const patch = { resultado_apurado_em: agora };
    if (tabela === 'imoveis_leilao' && achado.novaData) {
      Object.assign(patch, achado.novaData);
      if (religarSeNaoVendido) { patch.ativo = true; patch.suprimido_motivo = null; }
    }
    return patch;
  }
  const patch = { resultado_apurado_em: agora, resultado_apuracao_tentativas: (Number(tentativasAntes) || 0) + 1 };
  if (achado?.resultado === 'cancelado') {
    return { ...patch, resultado_leilao: 'cancelado', ativo: false, suprimido_motivo: 'leilao_cancelado' };
  }
  if (achado?.resultado) {
    patch.resultado_leilao = achado.resultado;
    if (achado.valor) patch.valor_lance_vencedor = achado.valor;
  } else {
    patch.resultado_leilao = 'indeterminado';
  }
  if (religarSeNaoVendido && patch.resultado_leilao !== 'vendido') { patch.ativo = true; patch.suprimido_motivo = null; }
  return patch;
}
