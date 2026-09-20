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
const RE_VENDIDO_FRACO = /\b(vendid[oa]|arrematad[oa]|arrematante)\b/gi;
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
function valorPerto(txt, idx) {
  const janela = txt.slice(Math.max(0, idx - 150), idx + 150);
  const mv = janela.match(RE_VALOR);
  const valor = mv ? parseFloat(mv[1].replace(/\./g, '').replace(',', '.')) : null;
  return valor && valor >= 1000 ? valor : null;
}

// Extrai o resultado do TEXTO já limpo da página (tags removidas). Devolve
// `{ resultado: 'vendido'|'sem_lance', valor: number|null }` ou `null` (indeterminado/sem sinal).
export function apurarResultadoDoTexto(html) {
  if (!html) return null;
  const txt = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

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
    const valor = valorPerto(txt, m.index);
    if (valor) return { resultado: 'vendido', valor };
  }

  if (RE_SEM_LANCE.test(txt)) return { resultado: 'sem_lance', valor: null };
  return null;
}
