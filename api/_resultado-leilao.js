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
 */

// "vendido"/"arrematado" aparecem como PALAVRA inteira dentro de "NÃO vendido"/"NÃO
// arrematado" — um `\b` sozinho casa os dois sentidos. Por isso a busca é NEGATION-AWARE:
// cada ocorrência só conta como sinal de VENDA quando os ~20 caracteres antes dela não têm
// uma negação (não/nunca/sem).
const RE_VENDIDO_G = /\b(vendid[oa]|arrematad[oa]|arrematante|encerrad[oa]\s+com\s+lance|leil[aã]o\s+conclu[íi]do\s+com\s+[êe]xito|hasta\s+p[uú]blica\s+conclu[íi]da)\b/gi;
// A negação só vale dentro da MESMA frase — sem isso, "sem lance. Arrematado..." (frase nova)
// contaminava o "Arrematado" seguinte como se fosse negado por um "sem" de outra oração.
const RE_NEGACAO = /\b(n[aã]o|nunca|sem)\s+(?:foi\s+|houve\s+)?\S*\s*$/i;
const CORTA_FRASE = /[.!?;\n][^.!?;\n]*$/;
const RE_SEM_LANCE = /\b(sem\s+licitantes?|sem\s+lances?|n[aã]o\s+(?:foi\s+|houve\s+)?arrematad[oa]|n[aã]o\s+(?:foi\s+|restou\s+)?vendid[oa]|lote\s+deserto\b|\bdeserto\b|nenhum\s+lance|leil[aã]o\s+negativo|insucesso\s+d[eo]\s+leil[aã]o)\b/i;
const RE_VALOR = /r\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;

// Extrai o resultado do TEXTO já limpo da página (tags removidas). Devolve
// `{ resultado: 'vendido'|'sem_lance', valor: number|null }` ou `null` (indeterminado/sem sinal).
export function apurarResultadoDoTexto(html) {
  if (!html) return null;
  const txt = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  let vendidoIdx = -1;
  let m;
  RE_VENDIDO_G.lastIndex = 0;
  while ((m = RE_VENDIDO_G.exec(txt))) {
    let antes = txt.slice(Math.max(0, m.index - 30), m.index);
    const corte = antes.match(CORTA_FRASE); // negação não atravessa fim de frase
    if (corte) antes = corte[0].slice(1);
    if (!RE_NEGACAO.test(antes)) { vendidoIdx = m.index; break; } // 1º sinal POSITIVO real
  }
  if (vendidoIdx >= 0) {
    // Valor do lance vencedor: procura R$ perto da palavra que confirmou a venda; sem achado
    // ali, tenta o primeiro R$ plausível da página inteira — nunca obrigatório (fica null).
    const janela = txt.slice(Math.max(0, vendidoIdx - 150), vendidoIdx + 150);
    const mv = janela.match(RE_VALOR) || txt.match(RE_VALOR);
    const valor = mv ? parseFloat(mv[1].replace(/\./g, '').replace(',', '.')) : null;
    return { resultado: 'vendido', valor: valor && valor >= 1000 ? valor : null };
  }
  if (RE_SEM_LANCE.test(txt)) return { resultado: 'sem_lance', valor: null };
  return null;
}
