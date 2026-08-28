/**
 * INTENÇÃO DA BUSCA — a régua única de "revenda / locação / temporada".
 *
 * POR QUE ESTE ARQUIVO EXISTE (28/08): `REVENDA_DESCONTO_MIN` vivia em DUAS cópias —
 * `src/pages/Busca.jsx` e `api/enviar-alertas-cron.js`. Mudar uma e esquecer a outra faz a
 * tela e o e-mail discordarem em silêncio: o cliente vê um lote na Busca e não o recebe no
 * alerta, ou o contrário. É a mesma forma que produziu o `valor_minimo_ref` aplicado na Busca
 * e não no alerta, corrigido horas antes neste mesmo dia.
 *
 * A unificação é REAL, não espelho: `api/` já importa de `src/` em dois pontos do projeto
 * (`gerar-analise.js` → `src/utils/calculos.js`, `og-share.js` → `src/data/cursos.js`), então
 * não há motivo para repetir a convenção de cópia-espelho de `_nome.js`/`_telefone.js`.
 *
 * A REGRA TAMBÉM VIVE NO BANCO (`regra_negocio` + `public.intencao_filtro`), e
 * `npm run verificar:regras` compara os dois no CI. Não é redundância: o banco é onde a
 * `auditoria_regras_negocio()` enxerga, e o JS é onde a regra é APLICADA. A trava existe para
 * que eles não possam divergir calados — que é exatamente o defeito que este arquivo fecha.
 */

// Tipos que o mercado revende com liquidez (flip) e tipos residenciais (moradia/renda).
export const TIPOS_RESIDENCIAL = ['apartamento', 'casa', 'imovel'];
export const TIPOS_LIQUIDOS    = ['apartamento', 'casa', 'comercial', 'imovel'];

// Piso de desconto da REVENDA. Decisão do dono em 28/08: subiu de 30% para 40%.
// Medido no acervo ativo antes de mudar: 19.174 lotes passavam com 30%, 17.077 passam com
// 40% — saem 2.097 (11%), sobra 89% do material. Barato para uma régua de margem mais firme.
export const REVENDA_DESCONTO_MIN = 40;

/**
 * PISO DE DESCONTO DA LOCAÇÃO — o "1% ao mês" do dono virando FILTRO (28/08).
 *
 * A regra é "o aluguel tem que pagar 1% sobre o valor investido". Ela não pode ser filtrada
 * direto: o acervo não carrega aluguel por lote (48 dos 29.447 ativos, e só onde já houve
 * relatório). Mas ela PODE ser traduzida no que o acervo tem em todo lote — o desconto —,
 * porque quanto mais fundo o lance está abaixo da avaliação, menor o aluguel necessário.
 *
 * A conta, com números MEDIDOS nos nossos relatórios (não estimados de fora):
 *   alvo mensal        = lance × 1,10 × 1%  = 1,10% do lance          (custo de aquisição 10%)
 *   aluguel plausível  ≈ valor de mercado × 0,56%/mês                 (mediana de 48 relatórios)
 *   valor de mercado   ≈ 95,8% da avaliação do leilão                 (mediana de 37 relatórios)
 *   0,958 × aval × 0,0056 ≥ lance × 0,011  →  lance/aval ≤ 0,4877  →  desconto ≥ 51,2%
 *
 * Fica em 50, e o 1,2 ponto de folga é deliberado: 1.002 lotes ativos estão EXATAMENTE em
 * 50% — é a 2ª praça clássica (metade da avaliação). Cortá-los por 1,2 pp de uma mediana
 * amostral de 48 casos seria fingir precisão que a amostra não tem, e são justamente os
 * lotes que o relatório e a assessoria existem para julgar. O filtro é TRIAGEM, não veredito.
 *
 * ⚠️ O que este piso NÃO garante: que a avaliação do leilão seja crível. Desconto fundo sobre
 * avaliação inflada continua passando — é o relatório mercadológico, que pesquisa o preço
 * real, quem derruba esse caso. Aqui só se promete reduzir o acervo ao que MERECE relatório.
 */
export const LOCACAO_DESCONTO_MIN = 50;
// Os três números medidos que sustentam o piso acima (mantidos explícitos para que revisar a
// régua seja refazer a conta, não adivinhar de onde veio o 50).
export const LOCACAO_YIELD_MEDIANO_PCT = 0.56;   // aluguel/mês ÷ valor de mercado, 48 relatórios
export const MERCADO_SOBRE_AVALIACAO_PCT = 95.8; // valor de mercado ÷ avaliação, 37 relatórios

/**
 * Traduz a intenção nas restrições que TODOS os caminhos de consulta entendem (query direta,
 * RPC de raio e o cron de alertas). Interseção com os tipos já escolhidos pelo usuário; se a
 * interseção ficar vazia, devolve um sentinela que não casa nada — contradição vira 0
 * resultados, e não "todos", que seria mentir sobre o que o cliente pediu.
 */
export function ajustarFiltrosPorIntencao(intencao, tiposUsuario, descontoMinUsuario) {
  const base = Array.isArray(tiposUsuario) ? tiposUsuario : [];
  const interseccao = (lista) => {
    if (!base.length) return lista;
    const inter = base.filter(t => lista.includes(t));
    return inter.length ? inter : ['__sem_tipo__'];
  };
  let tipos = base, descontoMin = Number(descontoMinUsuario) || 0;
  if (intencao === 'revenda') {
    tipos = interseccao(TIPOS_LIQUIDOS);
    descontoMin = Math.max(descontoMin, REVENDA_DESCONTO_MIN);
  } else if (intencao === 'locacao') {
    tipos = interseccao(TIPOS_RESIDENCIAL);
    descontoMin = Math.max(descontoMin, LOCACAO_DESCONTO_MIN);
  } else if (intencao === 'temporada') {
    // Temporada NÃO herda o piso da locação: a diária de alta estação não se compara com
    // aluguel mensal, e a régua de 1% foi dita para locação. Enquanto não houver número
    // medido de temporada, piso inventado seria pior que piso nenhum.
    tipos = interseccao(TIPOS_RESIDENCIAL);
  }
  return { tipos, descontoMin };
}
