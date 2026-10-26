// TRAVA DE PROPORÇÃO DO SWEEP de "sumidos" (24/10, #277) — puro, testado em scripts/testes/sweep-trava.mjs.
//
// O sweep desliga o lote ativo que a rodada NÃO regravou. O risco que a trava protege: lista parcial
// (paginação cortada, página quebrada) tomada como "o site esvaziou" — desligaria lote vivo (formas 4/5).
// A trava antiga comparava `salvos` com TODO o acervo ativo, e o acervo inclui o "sem lance" retido 15 dias
// pela regra do dono (o site já não lista; o sweep nunca toca). Na VIP: 74 retidos de 95 ativos, a rodada
// gravava os 39 que o site tem, 39 < 47,5 — sweep pulado TODO DIA, lote que saiu do site ficava ativo.
//
// Agora são DUAS comparações, cada uma de igual com igual (comparar coletado com gravado seria a forma nº 10:
// FRAZAO coleta ~150 e grava ~28, LJUD coleta ~1.400 e tem ~770 ativos):
//   · `salvos` (gravados nesta rodada) × `varriveisAntes` (ativos que o sweep PODE desligar, fora da janela);
//   · `coletados` (o que a lista trouxe nesta rodada) × `totalRecente` (mediana do `total` das últimas rodadas
//     SADIAS em fonte_saude — que é exatamente o coletado, `metricasColeta(imoveis).n`).
// A segunda é o que mantém a proteção quando a primeira encolhe: sem ela, tirar os retidos do denominador
// deixaria passar uma lista cortada pela metade (VIP: 16 varríveis × ~38 no site). Queda grande LEGÍTIMA só
// atrasa a saída por algumas rodadas (a mediana alcança), e a limpeza por data segue aposentando o vencido.
// Histórico ilegível ⇒ `totalRecente` null ⇒ trava antiga (`salvos` × TODO o acervo ativo): na dúvida, não desliga.
export function medianaTotais(linhas) {
  const v = (linhas || []).map(l => Number(l?.total)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function travaDoSweep({ salvos, coletados, varriveisAntes, ativosAntes, totalRecente }) {
  if (!Number.isFinite(totalRecente) || !Number.isFinite(varriveisAntes)) {
    const bloqueado = Number(ativosAntes) > 0 && salvos < ativosAntes * 0.5;
    return { bloqueado, motivo: bloqueado ? `gravou ${salvos} de ${ativosAntes} ativos (< 50%; histórico da fonte ilegível)` : null };
  }
  if (varriveisAntes > 0 && salvos < varriveisAntes * 0.5) {
    return { bloqueado: true, motivo: `gravou ${salvos} de ${varriveisAntes} ativos varríveis (< 50%)` };
  }
  if (totalRecente > 0 && coletados < totalRecente * 0.5) {
    return { bloqueado: true, motivo: `a lista trouxe ${coletados}, menos da metade da mediana ${totalRecente} das últimas rodadas sadias` };
  }
  return { bloqueado: false, motivo: null };
}

// PISO DA ENUMERAÇÃO (24/10, #277) — coletor que varre por SITEMAP (scraper-pecini.mjs: PECINI, SUBLIME, PW).
// Era `lotes.length >= 40` fixo: o sitemap da PECINI encolheu para 38–43 em 22–23/10 e a varredura de ausentes
// passou a ser PULADA na maioria das rodadas — o lote que saía do site ficava ativo. O piso agora é metade da
// mediana do que o próprio sitemap enumerou nas últimas rodadas (`fonte_saude.enumerados`, medido mesmo quando
// o detalhe falha — é a medida da LISTA, não da coleta). Sem histórico legível: o piso fixo antigo.
export function pisoEnumeracao(linhas, pisoFixo) {
  const v = (linhas || []).map(l => Number(l?.enumerados)).filter(n => Number.isFinite(n) && n > 0);
  if (v.length < 3) return { piso: pisoFixo, via: 'fixo' };
  const med = medianaTotais(v.map(total => ({ total })));
  return { piso: Math.max(3, Math.ceil(med * 0.5)), via: `metade da mediana ${med} de ${v.length} rodadas` };
}

// Quantos ausentes uma rodada pode desligar de uma vez: mais da metade do acervo (ou de 5, em fonte pequena)
// sumindo junto é lista ruim, não site esvaziado — mesma régua do motor (runner.mjs, "sumidos pela lista").
export const demaisParaUmaRodada = (sumidos, ativos) => sumidos > Math.max(5, ativos * 0.5);

// SWEEP POR TENANT (26/10). Fonte multi-tenant (LEILOTECH, SUPORTE, HASTAPUBLICA por leilão) grava vários
// leiloeiros na MESMA `fonte`, e o sweep desliga o que a rodada não tocou NA FONTE. Um tenant que deu erro, que
// voltou com a paginação cortada, ou que voltou VAZIO tendo lote ativo no banco tinha o acervo dele inteiro marcado
// `sumiu_da_fonte` — a LEILOTECH perdeu 13 lotes vivos assim no 1º dia. Este é o veredito de UM tenant: devolve o
// motivo para protegê-lo do sweep (o resto da fonte segue varrido normalmente), ou null quando a rodada dele é prova
// de ausência. `ativosNoBanco` null = não consegui contar ⇒ na dúvida, protege (forma nº 2 do CLAUDE.md).
export function tenantParcial({ erro = null, n = 0, parcial = null, ativosNoBanco = 0 } = {}) {
  if (erro) return `erro (${String(erro).slice(0, 80)})`;
  if (parcial) return `parcial (${String(parcial).slice(0, 80)})`;
  if (n > 0) return null;
  if (ativosNoBanco == null || !Number.isFinite(Number(ativosNoBanco))) return 'vazio e acervo do tenant ilegível';
  if (Number(ativosNoBanco) > 0) return `vazio com ${ativosNoBanco} ativo(s) no banco`;
  return null;
}

// Prefixo de fonte_id como literal de LIKE: `_` e `%` são curingas, e `sl_bl_` casaria `slXblX…`.
export const likePrefixo = (prefixo) => `${String(prefixo).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Mais prefixos que isso viram URL enorme no PostgREST e, de todo modo, já não é "um tenant caiu" — é a rodada
// que caiu: aí o sweep inteiro fica para a próxima.
export const MAX_PROTEGIDOS = 40;

// FREIO QUE NÃO DESTRAVA (26/10, #277). "Mais da metade sumindo de uma vez é lista ruim" protege contra a lista
// parcial de UMA rodada — mas em fonte pequena o fantasma ACUMULA: GIORDANO tinha 14 de 23 ativos fora da lista
// (parados desde 23/09–20/10, todos lidos em rodadas antigas e nunca mais listados) e o freio dizia "demais para
// uma rodada" todo dia, para sempre. Passado o freio, o lote só sai com DUAS provas que a lista ruim não dá:
//   · a enumeração de hoje não encolheu — ≥ metade da mediana do que o site enumerou nas últimas rodadas
//     (`pisoEnumeracao`, a mesma régua do sitemap); sem histórico legível, nada sai (na dúvida, não desliga);
//   · o lote está fora há DIAS, não só hoje: `atualizado_em` mais velho que `diasParado` (lote listado é relido
//     e regravado; o que sumiu numa lista ruim de hoje foi tocado ontem e fica).
export function sumidosLiberados({ fora, ativos, enumerados, historico, agora = Date.now(), diasParado = 3 }) {
  if (!fora.length || !demaisParaUmaRodada(fora.length, ativos)) return { liberar: fora, motivo: null };
  const { piso, via } = pisoEnumeracao(historico, Infinity);
  if (via === 'fixo') return { liberar: [], motivo: `${fora.length} de ${ativos} fora da lista e sem histórico de enumeração para conferir — NÃO desligados` };
  if (!(enumerados >= piso)) return { liberar: [], motivo: `${fora.length} de ${ativos} fora da lista e a lista encolheu (${enumerados} < piso ${piso}, ${via}) — NÃO desligados` };
  const corte = agora - diasParado * 864e5;
  const liberar = fora.filter(a => Date.parse(a.atualizado_em || '') < corte);
  return { liberar, motivo: `${fora.length} de ${ativos} fora da lista (acima do freio); lista inteira (${enumerados} ≥ piso ${piso}) — saem só os ${liberar.length} parados há ${diasParado}+ dias` };
}
