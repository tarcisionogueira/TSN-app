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

// Venda que dá para precificar: traz o R$/m², ou o preço e a metragem. A IA às vezes acha o anúncio e
// devolve `valor: 0` (Carpina, 08/11: 4 de 5). Contar essas como amostra travava a 2ª busca.
export const vendaComPreco = (v) => Number(v?.valorM2) > 0 || (Number(v?.valor) > 0 && Number(v?.m2) > 0);

// Anúncio sem preço nenhum não vai para a tela do cliente como "R$ 0,00". Preço sem metragem fica, porque
// vaga e área rural são precificadas por unidade. Devolve quantas amostras saíram.
export function limparAmostrasSemPreco(m) {
  let removidas = 0;
  for (const n of niveisDe(m)) {
    const vendas = arr(n.vendas).filter((v) => Number(v?.valor) > 0 || Number(v?.valorM2) > 0);
    const locacoes = arr(n.locacoes).filter((l) => Number(l?.valorMensal) > 0 || Number(l?.aluguelM2) > 0);
    const saiu = arr(n.vendas).length + arr(n.locacoes).length - vendas.length - locacoes.length;
    if (!saiu) continue;
    n.vendas = vendas; n.locacoes = locacoes; n.totalAmostras = vendas.length + locacoes.length;
    removidas += saiu;
  }
  return removidas;
}

// Conta o que o nível DECLARA (totalAmostras); se não declarou, conta o que ele trouxe.
export const totalAmostrasDe = (m) => niveisDe(m).reduce((s, n) => {
  const declarado = Number(n?.totalAmostras) || 0;
  return s + (declarado || arr(n?.vendas).length + arr(n?.locacoes).length);
}, 0);

// DEDUP ENTRE NÍVEIS (12/09; virou função em 03/11). O mesmo imóvel repetido em dois níveis
// (assinatura valor+m²+endereço) fica só no nível MAIS PRÓXIMO. Até 03/11 isto rodava só no fim de
// gerar-analise, DEPOIS da conta ponderada: em Pirituba (abd7ffd9) a média usou 42 anúncios, dois em
// dobro, e a tela listava 40 — o mesmo relatório com duas contagens e um R$/m² enviesado. Agora roda
// antes da conta também. Devolve quantas repetições saíram.
export function dedupVendasEntreNiveis(m) {
  if (!m) return 0;
  const vistos = new Set();
  let removidas = 0;
  const assinatura = (v) => `${Number(v?.valor) || 0}|${Number(v?.m2) || 0}|${String(v?.endereco || v?.bairro || '').toLowerCase().trim()}`;
  for (const nv of niveisDe(m)) {
    if (!Array.isArray(nv.vendas)) continue;
    nv.vendas = nv.vendas.filter((v) => {
      const chave = assinatura(v);
      if (!chave.trim() || chave === '0|0|') return true; // sem dado suficiente p/ comparar, não arrisca descartar
      if (vistos.has(chave)) { removidas++; return false; }
      vistos.add(chave);
      return true;
    });
  }
  return removidas;
}

// UM R$/m² SÓ POR RELATÓRIO (03/11). Quando a conta ponderada substituiu o número da IA, é ELA o
// preço do m² — no Resumo, no bloco Base de mercado, no PDF e no parecer. Relatório anterior a 03/11
// gravou o número da IA no topo (`precoMedioM2`) e o ponderado só em `consolidado`: Pirituba mostrava
// R$ 7.256 num lugar e R$ 6.684,69 no outro.
export function precoM2DoRelatorio(m) {
  const pond = Number(m?.consolidado?.precoMedioM2) || 0;
  if (m?.valorPonderado?.aplicado && pond > 0) return pond;
  return Number(m?.precoMedioM2) || 0;
}

export const totalVendasDe = (m) => vendasDe(m).length;
export const totalLocacoesDe = (m) => locacoesDe(m).length;
export const semAmostras = (m) => totalVendasDe(m) + totalLocacoesDe(m) === 0;
