// OS NÍVEIS DE AMOSTRA DO MERCADOLÓGICO, EM UM LUGAR SÓ.
//
// Regra do dono (09/09): "o relatório mercadológico deve encontrar amostras no mesmo
// condomínio/endereço por tipo de imóvel; segmentar em até 250m para o nível 1 e até 1km para o
// nível 2; caso encontre menos do que 5 amostras, aumentar para 2km para um nível 3 e encontrar
// amostras para apresentar dados."
//
// O nível 3 já EXISTIA na prática — o prompt mandava expandir até 2km quando os níveis 1+2
// somassem menos de 10 amostras — mas não existia como BALDE: as amostras de até 2km voltavam
// dentro do nivel2, que a tela rotula "250m a 1km". Ou seja, o dado estava certo e era publicado
// com o nome de outra faixa (a forma nº 10 do CLAUDE.md). Agora é um nível próprio, com o raio
// dito na tela.
//
// Este arquivo existe porque a soma dos níveis aparecia escrita à mão em ~50 lugares (contadores,
// achatamentos, o PDF, os selos da tela). Acrescentar um terceiro balde em 50 expressões soltas é
// a receita da divergência: bastaria esquecer uma para o relatório contar diferente de si mesmo.
export const NIVEIS = ['nivel1', 'nivel2', 'nivel3'];

// Raio de cada nível, para a tela e o prompt falarem a MESMA língua.
export const RAIO_NIVEL = {
  nivel1: 'mesmo condomínio/endereço, até 250 m',
  nivel2: '250 m a 1 km',
  nivel3: '1 km a 2 km',
};

// Abaixo disto nos níveis 1+2, o nível 3 é aberto. O gatilho do dono é 5; mantemos 10 porque é o
// que já valia e é MAIS generoso — expandir antes nunca deixa de atender "menos de 5".
export const MIN_AMOSTRAS_ANTES_DO_NIVEL3 = 10;

const arr = (x) => (Array.isArray(x) ? x : []);

export const niveisDe = (m) => NIVEIS.map((k) => m?.[k]).filter(Boolean);
export const vendasDe = (m) => niveisDe(m).flatMap((n) => arr(n?.vendas));
export const locacoesDe = (m) => niveisDe(m).flatMap((n) => arr(n?.locacoes));

// Conta o que o nível DECLARA (totalAmostras); se não declarou, conta o que ele trouxe.
export const totalAmostrasDe = (m) => niveisDe(m).reduce((s, n) => {
  const declarado = Number(n?.totalAmostras) || 0;
  return s + (declarado || arr(n?.vendas).length + arr(n?.locacoes).length);
}, 0);

export const totalVendasDe = (m) => vendasDe(m).length;
export const totalLocacoesDe = (m) => locacoesDe(m).length;
export const semAmostras = (m) => totalVendasDe(m) + totalLocacoesDe(m) === 0;
