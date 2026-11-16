// AUTORIZAÇÃO DE LANCE (16/11, #419 — termo de assessoria, cláusula 1.5). Módulo PURO, usado pelo navegador (mostra o
// texto) e pelo servidor (grava o texto e o hash): o cliente envia o texto que leu e o servidor só registra se for
// idêntico ao que ele mesmo monta. Por isso nada de toLocaleString aqui — navegador e Node podem diferir no espaço
// (U+00A0 × U+202F) e a igualdade falharia sem motivo visível.
// Redação provisória da equipe, autorizada pelo dono em 16/11 ("o trecho do aceite você pode redigir"). Mudou a
// redação? Suba a versão.
export const VERSAO_AUTORIZACAO = 'rascunho-2026-11-16';

export function brlTexto(v) {
  const centavos = Math.round(Number(v) * 100);
  if (!Number.isFinite(centavos)) return 'R$ —';
  const inteiro = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${inteiro},${String(centavos % 100).padStart(2, '0')}`;
}

// Brasília é UTC−3 o ano todo desde 2019 (sem horário de verão).
export function dataTexto(d) {
  const t = Date.parse(d || '');
  if (!Number.isFinite(t)) return 'data não informada';
  const [a, m, dia] = new Date(t - 3 * 3600e3).toISOString().slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
}

export function textoAutorizacao({ titulo, cidade, uf, valorMaximo, relatorios }) {
  const lugar = [cidade, uf].filter(Boolean).join('/');
  return [
    `Autorizo a equipe da BidPro Brasil a dar lance em meu nome no imóvel "${String(titulo || 'Imóvel').trim()}"${lugar ? ` (${lugar})` : ''}, neste leilão, até o valor máximo de ${brlTexto(valorMaximo)}.`,
    'Nenhum lance acima desse valor será dado sem uma nova autorização minha.',
    `Declaro que recebi e li, antes desta autorização, o relatório mercadológico (gerado em ${dataTexto(relatorios?.mercado?.gerado_em ?? relatorios?.mercado_em)}) e o relatório documental (gerado em ${dataTexto(relatorios?.documental?.gerado_em ?? relatorios?.documental_em)}) deste imóvel, e que eles separam o que está documentado do que é estimativa.`,
    'Sei que o valor máximo é o do lance e não inclui a comissão do leiloeiro, impostos, registro, débitos do imóvel e demais custos previstos no edital, que ficam por minha conta.',
    'Posso revogar esta autorização pela plataforma a qualquer momento antes do lance. A revogação não desfaz um lance já dado.',
  ].join(' ');
}
