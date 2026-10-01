// VENDA COM POSSÍVEL RESTRIÇÃO DE PÚBLICO (01/10, dono: Oroch da frota Alares na Superbid —
// "somente quem for da empresa pode comprar", dito pelo leiloeiro por telefone, depois da
// proposta). A restrição NÃO vinha nos dados do lote: o único sinal capturável é o marketplace
// "Corporativo" (frota de empresa) ou o texto do lote citar funcionário/colaborador. Decisão do
// dono: dar CIÊNCIA, nunca impedir — da mesma forma que negaram, podem autorizar. Por isso o
// aviso vai na análise e a PERGUNTA vai no e-mail de proposta; nenhum fluxo é bloqueado.
// Fonte única da regra: análise do veículo (gerar-analise-veiculo), e-mail do lote
// (enviar-email-caso) e proposta direta (propor-veiculo-leiloeiro).

const RE_TEXTO = /\b(exclusiv\w*|somente|apenas|restrit\w*)\b[^.]{0,60}\b(funcion[aá]ri\w*|colaborador\w*|empregad\w*)/i;

function subMarketplaces(raw) {
  const sm = raw?.auction?.subMarketplaces;
  return Array.isArray(sm) ? sm.map((s) => String(s?.subMarketplaceDesc || '').toLowerCase()) : [];
}

/** { motivo, aviso } quando há sinal de venda restrita; null quando não há. Nunca bloqueia. */
export function sinalVendaRestrita({ raw = null, descricao = '', titulo = '' } = {}) {
  const texto = [titulo, descricao].filter(Boolean).join(' ');
  if (RE_TEXTO.test(texto)) {
    return { motivo: 'texto_do_lote', aviso: 'O texto do lote cita venda restrita a funcionários/colaboradores. Confirme com o leiloeiro se a compra por terceiros pode ser autorizada (ciência — não impede a proposta).' };
  }
  if (subMarketplaces(raw).includes('corporativo')) {
    const empresa = String(raw?.auction?.desc || '').trim();
    return { motivo: 'venda_corporativa', aviso: `Venda corporativa (frota${empresa ? ` de ${empresa}` : ' de empresa'}): algumas empresas restringem a compra a funcionários. Confirme com o leiloeiro antes de contar com o lote (ciência — não impede a proposta).` };
  }
  return null;
}

export const PERGUNTA_RESTRICAO = 'Caso a venda deste lote tenha alguma restrição de público (por exemplo, exclusiva a colaboradores da empresa vendedora), peço a gentileza de me informar se há possibilidade de autorização para a minha compra.';

/** Insere o parágrafo antes da assinatura (último bloco) se o texto ainda não trata do assunto. */
export function comPerguntaRestricao(texto) {
  const t = String(texto || '');
  if (!t || /restri[çc][aã]o de p[uú]blico|colaboradores da empresa/i.test(t)) return t;
  const blocos = t.split(/\n{2,}/);
  if (blocos.length < 2) return `${t}\n\n${PERGUNTA_RESTRICAO}`;
  // Antes do agradecimento + assinatura quando houver ("Agradecemos…"), senão antes da assinatura.
  let i = blocos.length - 1;
  if (i > 1 && /^(agrade|obrigad|atenciosamente|att)/i.test(blocos[i - 1].trim())) i -= 1;
  blocos.splice(i, 0, PERGUNTA_RESTRICAO);
  return blocos.join('\n\n');
}
