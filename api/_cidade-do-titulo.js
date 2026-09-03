/**
 * api/_cidade-do-titulo.js — a cidade sai do título CONFERIDA contra o município real.
 *
 * POR QUE EXISTE (01/09). O BIASI escrevia o TÍTULO INTEIRO no campo `cidade` em 88% do
 * acervo. Medido no acervo vivo: 308 de 350 lotes ativos com " - " DENTRO da cidade e só
 * 7% de cidades aproveitáveis — "Casa - Parque Dos Timburis - São Carlos/SP" era gravado
 * como cidade="Casa - Parque Dos Timburis - São Carlos".
 *
 * A CAUSA é a classe de caracteres do regex antigo, `[A-Za-zÀ-ÿ'.\- ]{2,40}`: ela INCLUI
 * hífen e espaço, então atravessa os separadores e come o título para trás. O comentário
 * ao lado dela já dizia o formato certo — "… - Cidade/UF" —, mas o regex não ancorava no
 * último segmento.
 *
 * E NENHUM ALARME VIA ISSO. `sem_cidade` mede cidade VAZIA; aqui ela vinha cheia — é a
 * forma nº 10 do CLAUDE.md: o campo tem valor plausível e descreve outra coisa. Cidade é
 * o filtro principal do cliente na Busca, então 350 lotes ficaram inalcançáveis por
 * cidade sem nada acusar.
 *
 * A CORREÇÃO NÃO É UM REGEX MELHOR — é parar de adivinhar. Pega-se o maior sufixo do
 * texto antes de "/UF" que seja município REAL daquela UF, conferido no dataset IBGE que
 * o projeto já carrega (`api/_municipios.js`). Medido sobre os 350 lotes: 7% → 99%.
 *
 * OS 4 QUE SOBRAM SÃO ERRO DA FONTE, e ficam VAZIOS de propósito: "Paraíso de Tocantins"
 * (o município é "do"), "Várzea Grande/SP" (Várzea Grande é MT), "Encantando" (é
 * Encantado) e "Messejana", que é bairro de Fortaleza e não município. Cidade vazia o
 * invariante `sem_cidade` enxerga; cidade ERRADA é invisível e envenena a busca — melhor
 * não saber do que saber errado.
 *
 * De quebra recupera o BAIRRO, que o mapper do BIASI descartava ('') mesmo com o título
 * trazendo: no formato "Tipo - Bairro - Cidade/UF" ele é o último segmento antes da cidade.
 */
import MUNICIPIOS from './_municipios.js';

// Mesma normalização de `api/_geo.js` e do scraper, para bater com as chaves "UF|cidade".
export const normCidadeBR = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function cidadeBairroDoTitulo(titulo) {
  const m = String(titulo || '').match(/^(.*?)\s*\/\s*([A-Za-z]{2})\s*$/);
  if (!m) return { cidade: '', uf: '', bairro: '' };
  const uf = m[2].toUpperCase();
  const antes = m[1];
  const pal = antes.split(/\s+/).filter(Boolean);
  // Do MAIOR sufixo para o menor: "São Carlos" tem de ganhar de "Carlos", e
  // "Santa Helena de Goiás" de "Goiás" — senão a cidade certa perde para um pedaço dela.
  for (let i = 0; i < pal.length; i++) {
    const cand = pal.slice(i).join(' ').replace(/^[-–—\s]+/, '');
    if (cand.length < 2) continue;
    if (!MUNICIPIOS[`${uf}|${normCidadeBR(cand)}`]) continue;
    const resto = antes.slice(0, Math.max(0, antes.length - cand.length)).replace(/[\s\-–—]+$/, '');
    const segs = resto.split(/\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
    return { cidade: cand, uf, bairro: segs.length >= 2 ? segs[segs.length - 1] : '' };
  }
  // Sem município reconhecido a UF continua valendo: ela vem do sufixo "/UF" e é
  // independente do nome. Devolver '' aqui perderia o estado junto com a cidade.
  return { cidade: '', uf, bairro: '' };
}
