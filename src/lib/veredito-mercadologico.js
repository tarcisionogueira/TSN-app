// O SELO DO MERCADOLÓGICO — uma regra só para a tela e o PDF (03/11).
//
// O selo olhava só o ROI. Dois casos do dono mostraram que o ROI pode estar certo e o selo errado:
//  • Peruíbe (57573ba9): ROI calculado sobre 3 anúncios de São Paulo e Bauru → "Operação viável, vale
//    avançar". Sem comparável LOCAL o valor de venda é palpite; viável vira INDICATIVA.
//  • Itu (9ba1ce0c): terreno de 3.017 m² avaliado em zero → "Operação reprovada". Com o terreno
//    excedente fora da conta, a reprovação pode ser efeito da lacuna; reprovada vira INDICATIVA.
import { baseLocalDe } from './origem-amostras.js';
import { vendasDe } from './niveis-mercado.js';

export const TEXTO_INDICATIVA_BASE = 'Viabilidade indicativa: sem comparáveis locais suficientes, confirme o preço na região antes de dar lance';
export const TEXTO_INDICATIVA_TERRENO = 'Viabilidade indicativa: o terreno excedente não foi avaliado, o valor de mercado está subestimado';

/**
 * `estado`: 'uso_proprio' | 'sem_dados' | 'viavel' | 'indicativa' | 'reprovada'.
 * `motivo`: 'base_nao_local' | 'terreno_nao_avaliado' | null.
 */
export function vereditoMercadologico({ isViavel, isUsoProprio = false, mercadoSemDados = false, mercado, cidade }) {
  if (isUsoProprio) return { estado: 'uso_proprio', texto: 'Aprovado para uso próprio', motivo: null };
  if (mercadoSemDados) return { estado: 'sem_dados', texto: 'Mercado não estimado nesta análise', motivo: null };
  const vendas = vendasDe(mercado);
  const bl = baseLocalDe(mercado, cidade, vendas);
  // Relatório sem amostra de venda (Índice BidPro) já tem rótulo próprio na tela; aqui só entra quem
  // tem amostra — ou quem teve amostra de outra cidade descartada.
  const baseNaoLocal = (vendas.length > 0 || bl.foraDaCidade > 0) && bl.suficiente === false && mercado?.fonteEstimativa !== 'indice_bidpro';
  const te = mercado?.consolidado?.terrenoExcedente;
  const terrenoNaoAvaliado = !!(te?.haExcedente && !te.avaliado);
  if (isViavel && baseNaoLocal) return { estado: 'indicativa', texto: TEXTO_INDICATIVA_BASE, motivo: 'base_nao_local', baseLocal: bl };
  if (!isViavel && terrenoNaoAvaliado) return { estado: 'indicativa', texto: TEXTO_INDICATIVA_TERRENO, motivo: 'terreno_nao_avaliado', baseLocal: bl };
  if (isViavel) return { estado: 'viavel', texto: 'Operação viável, vale avançar', motivo: null, baseLocal: bl };
  return { estado: 'reprovada', texto: 'Operação reprovada, retorno insuficiente', motivo: null, baseLocal: bl };
}

/** Frase da ORIGEM das amostras, para "Base de mercado". */
export function fraseOrigemAmostras(mercado, cidade, n) {
  const bl = baseLocalDe(mercado, cidade, vendasDe(mercado));
  if (bl.foraDaCidade > 0 && !bl.suficiente) {
    const cs = (bl.cidadesFora || []).join(', ');
    return ` ${bl.foraDaCidade} anúncio(s) de outras cidades${cs ? ` (${cs})` : ''}, sem comparáveis suficientes na própria cidade: usar só como referência indicativa.`;
  }
  if (!n) return '';
  if (!bl.suficiente) return ` Base fina: ${n} comparáve${n > 1 ? 'is' : 'l'} na região; confirme o preço localmente.`;
  return ` Média ponderada de ${n} comparáve${n > 1 ? 'is' : 'l'} do mesmo tipo na região.`;
}
