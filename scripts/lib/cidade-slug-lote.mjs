// CIDADE DO SLUG DO LOTE (16/11, #371) — família SUPORTE (bessaleiloes, valeroleiloes…): o título é só "Apto 701" e o
// campo de local vem vazio, mas a URL do LOTE nomeia o lugar: ".../lote/321/apto-no-centro-de-gov-valadares-701",
// ".../lote/1548/apto-71-…-higienopolis-sao-paulo". O slug do EVENTO não vale: é a comarca ("leilao-judicial-de-
// ipatinga-mg" vende uma casa em Trancoso/BA). Regras, todas conferidas no IBGE:
//  1. "<cidade>-<uf>" mais perto do fim do slug do lote;
//  2. sem UF: "de|em|no|na <cidade>" ou o FIM do slug, só nome com 2+ palavras que existe em UMA UF (palavra solta como
//     "Vitória"/"Planalto" casa demais e fica de fora) — exceto depois de "cidade de", que já diz que é cidade;
//  3. nada no lote → o slug do EVENTO, só quando ele NÃO é de juízo ("venda-direta-de-terras-em-sarandi", "…-na-cidade-
//     de-bage"); evento com comarca/vara/juizado/tribunal/trt/judicial nomeia o foro, não o bem.
// "gov" é abreviação de "governador" nos slugs (Gov. Valadares). Nada casou → { cidade: null, estado: null }.
import MUNICIPIOS from '../../api/_municipios.js';
import { normCidade, inferirUF } from './inferir-uf.mjs';

const UFS = new Set(['ac','al','ap','am','ba','ce','df','es','go','ma','mt','ms','mg','pa','pb','pr','pe','pi','rj','rn','rs','ro','rr','sc','sp','se','to']);
const tc = (s) => s.replace(/\b([a-zà-ÿ])([a-zà-ÿ]*)/g, (_, a, b) => (/^(de|da|do|das|dos|e)$/.test(a + b) ? a + b : a.toUpperCase() + b));
const nomeDe = (pal) => pal.map((w) => (w === 'gov' ? 'governador' : w === 'sta' ? 'santa' : w === 'sto' ? 'santo' : w)).join(' ');

const VAZIO = Object.freeze({ cidade: null, estado: null });
const RE_FORO = /(?:^|-)(?:comarca|vara|juizado|ju[ií]zo|tribunal|trt|trf|tjm?|judicial|forum|foro)(?:-|$)/i;

export function cidadeDoSlugLote(url = '') {
  const u = String(url);
  const doLote = deSlug((u.match(/\/lote\/\d+\/([^/?#]+)/i) || [])[1]);
  if (doLote.cidade) return doLote;
  const evento = (u.match(/\/leilao\/([^/?#]+)\/lote\//i) || [])[1] || '';
  if (!evento) return VAZIO;
  let ev; try { ev = decodeURIComponent(evento); } catch { ev = evento; }   // malformado: segue cru (a falha É a resposta)
  return RE_FORO.test(ev) ? VAZIO : deSlug(evento);
}

function deSlug(slug) {
  if (!slug) return VAZIO;
  let t;
  try { t = decodeURIComponent(slug); } catch { t = slug; }   // slug malformado: segue com o texto cru (a falha É a resposta)
  t = t.toLowerCase().split('-').filter(Boolean);
  for (let j = t.length - 1; j >= 1; j--) {
    if (!UFS.has(t[j])) continue;
    const uf = t[j].toUpperCase();
    for (let n = Math.min(5, j); n >= 1; n--) {
      const c = nomeDe(t.slice(j - n, j));
      if (Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`)) return { cidade: tc(c), estado: uf };
    }
  }
  const semNum = (pal) => { while (pal.length && /^\d+$/.test(pal[pal.length - 1])) pal = pal.slice(0, -1); return pal; };
  const unica = (pal, min = 2) => {
    if (pal.length < min) return null;
    const c = nomeDe(pal);
    const x = inferirUF({ cidade: c });
    return x?.via === 'cidade_unica' ? { cidade: tc(c), estado: x.uf } : null;
  };
  // "…-de-gov-valadares-701": depois da ÚLTIMA preposição, até 5 palavras (sem o número final).
  for (let i = t.length - 2; i >= 0; i--) {
    if (!/^(de|em|no|na)$/.test(t[i])) continue;
    const resto = semNum(t.slice(i + 1));
    const min = t[i] === 'de' && t[i - 1] === 'cidade' ? 1 : 2;   // "na-cidade-de-bage": a palavra já diz que é cidade
    for (let n = Math.min(5, resto.length); n >= min; n--) { const r = unica(resto.slice(0, n), min); if (r) return r; }
    break;
  }
  // "…-higienopolis-sao-paulo": o maior sufixo do slug que é cidade.
  const fim = semNum(t);
  for (let n = Math.min(5, fim.length); n >= 2; n--) { const r = unica(fim.slice(fim.length - n)); if (r) return r; }
  return VAZIO;
}
