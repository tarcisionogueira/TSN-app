/**
 * PESO DA AMOSTRA PELA PROVA (15/11, arena #484). Módulo puro (Edge e Node).
 *
 * Contar linhas tratava igual o anúncio conferido e o número que a IA declarou sem link. Agora cada unidade pesa pelo
 * que se sabe dela (estado de prova da view indice_amostra_indep / indice_link_prova):
 *   conferido 1,0 · link próprio ainda não conferido / não conferível 0,5 · página de busca 0,3 · sem link 0,2.
 * (morto nem chega aqui: sai do cálculo antes.)
 *
 * TETO POR ORIGEM: nenhuma origem (site do anúncio; "sem link" conta como uma origem) passa de 35% do peso total —
 * um portal ou uma página de busca com dezenas de amostras não decide sozinho o número. Só aplica com 3+ origens:
 * com 1 ou 2 o teto é impossível (as partes somam 100%) e o peso fica como está.
 */
export const PESO_PROVA = { conferido: 1, link_proprio: 0.5, nao_conferivel: 0.5, listagem: 0.3, sem_link: 0.2 };
export const TETO_ORIGEM = 0.35;

export const pesoDaProva = (prova) => PESO_PROVA[prova] ?? 0.3;   // estado desconhecido = como página de busca

export function origemDe(a) {
  try { return a?.url ? new URL(a.url).hostname.replace(/^www\./, '') : '(sem link)'; }
  catch (e) { return '(link ilegível)'; }   // URL malformada: origem própria, nunca mistura com outra
}

/** Devolve as amostras com `peso` (prova × teto por origem). Não altera o array de entrada. */
export function aplicarPesos(amostras, teto = TETO_ORIGEM) {
  const out = (amostras || []).map((a) => ({ ...a, peso: pesoDaProva(a.prova), origem: origemDe(a) }));
  const origens = [...new Set(out.map((a) => a.origem))];
  if (origens.length < 3 || !(teto > 0 && teto < 1)) return out;
  // Iterativo: reduzir uma origem muda o total e pode empurrar outra acima do teto; 6 voltas convergem na prática.
  for (let volta = 0; volta < 6; volta++) {
    const soma = new Map(); let total = 0;
    for (const a of out) { soma.set(a.origem, (soma.get(a.origem) || 0) + a.peso); total += a.peso; }
    let mexeu = false;
    for (const [o, s] of soma) {
      const resto = total - s;
      const limite = (teto / (1 - teto)) * resto;   // s / (s + resto) <= teto  ⇔  s <= teto/(1-teto) · resto
      if (s > limite * 1.0001 && s > 0) {
        const f = limite / s;
        for (const a of out) if (a.origem === o) a.peso *= f;
        mexeu = true;
      }
    }
    if (!mexeu) break;
  }
  return out;
}

/** Mediana ponderada de `{ v, p }`. Sem peso válido em nenhuma → mediana simples. */
export function medianaPonderada(itens) {
  const a = (itens || []).map((x) => ({ v: Number(x.v), p: Number(x.p) })).filter((x) => x.v > 0).sort((x, y) => x.v - y.v);
  if (!a.length) return null;
  const total = a.reduce((s, x) => s + (x.p > 0 ? x.p : 0), 0);
  if (!(total > 0)) { const m = Math.floor(a.length / 2); return a.length % 2 ? a[m].v : Math.round((a[m - 1].v + a[m].v) / 2); }
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc += a[i].p > 0 ? a[i].p : 0;
    if (acc >= total / 2) {
      // Empate exato na metade: média com o próximo (como a mediana simples faz com n par).
      if (Math.abs(acc - total / 2) < 1e-9 && i + 1 < a.length) return Math.round((a[i].v + a[i + 1].v) / 2);
      return a[i].v;
    }
  }
  return a[a.length - 1].v;
}
