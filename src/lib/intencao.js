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
  } else if (intencao === 'locacao' || intencao === 'temporada') {
    tipos = interseccao(TIPOS_RESIDENCIAL);
  }
  return { tipos, descontoMin };
}
