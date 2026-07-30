// Termo de ciência de compra — versionado para rastreabilidade (chargeback).
// Ao mudar o texto, incremente a versão: o aceite grava a versão vigente.
// v3.0 (30/07/2026): termo AMPLO por produto — natureza informativa, IA, ausência de
// garantia de resultado, riscos do leilão, PI, cobrança/arrependimento, LGPD, foro.
// ⚠️ Redação técnica pendente de validação do JURÍDICO (reunião do dono) — ressalvas
// viram v3.1 (aceites antigos preservam a versão com que foram gravados).
export const TERMOS_VERSAO = '3.0';

// ─── REGISTRO CENTRAL POR PRODUTO/SERVIÇO (pedido do dono, 30/07) ────────────────
// Cada produto tem TÍTULO amigável (auditoria/comprovante/360) e TERMO próprio
// versionado — o aceite grava `<família>-v<versão>` para resguardar a empresa em
// questionamento: dá para provar QUAL termo, de QUAL produto, em QUAL versão.
export const PRODUTO_TITULOS = {
  explorador: 'Assinatura Explorador',
  top2: 'Assinatura Investidor Pro',
  assessorado: 'Assessoria de Arrematação',
  clube: 'Leilão Club',
  consultor: 'Consultor/Afiliado',
  advogado: 'Advogado Parceiro',
  analista: 'Analista',
  parceiro: 'Programa de Parceiros (Termo de Adesão)',
  lgpd: 'Termos de Uso e LGPD (cadastro)',
  produto: 'Cursos e Ebooks',
};

export function tituloProduto(key) {
  const k = String(key || '').toLowerCase();
  if (PRODUTO_TITULOS[k]) return PRODUTO_TITULOS[k];
  if (/^(ebook|curso)/.test(k)) return `Cursos e Ebooks — ${key}`;
  return key || '—';
}

// Família do termo (produtos digitais colapsam em 'produto'; desconhecido = 'geral').
function familiaTermo(key) {
  const k = String(key || '').toLowerCase();
  if (PRODUTO_TITULOS[k]) return k;
  if (/^(ebook|curso)/.test(k)) return 'produto';
  return 'geral';
}

// Versão POR PRODUTO gravada no aceite (aceites_plano.termos_versao).
export function versaoTermoProduto(key) {
  return `${familiaTermo(key)}-v${TERMOS_VERSAO}`;
}

// Texto do termo da família — TERMO DE CONTRATAÇÃO AMPLO (v3.0), com as cláusulas de
// resguardo sobre o que é comercializado. Os parâmetros são opcionais: sem eles o texto
// sai com o rótulo genérico do produto — suficiente para o comprovante; no checkout,
// passe nome/valor/modelo reais.
export function termoDoProduto(key, { nome, valorLabel, modelo, inclui } = {}) {
  const fam = familiaTermo(key);
  const base = {
    explorador: { modelo: 'recorrente', inclui: 'busca de imóveis em leilão e relatórios conforme o plano contratado' },
    top2: { modelo: 'recorrente', inclui: 'busca de imóveis, relatórios mercadológico, documental e laudo de viabilidade, e demais recursos do plano contratado' },
    clube: { modelo: 'recorrente', inclui: 'comunidade, encontros ao vivo e conteúdos do Leilão Club' },
    assessorado: { modelo: 'parcelado', honorarios: true, inclui: 'assessoria de arrematação com equipe da plataforma e advogado parceiro, conforme escopo do contrato de prestação de serviços' },
    consultor: { modelo: 'recorrente' },
    advogado: { modelo: 'recorrente' },
    analista: { modelo: 'recorrente' },
    produto: { modelo: 'unico', inclui: 'conteúdo digital (curso/ebook) com acesso imediato após a confirmação do pagamento' },
    geral: { modelo: 'unico' },
  }[fam];
  const mod = modelo || base.modelo;
  const nomeProd = nome || tituloProduto(key);
  const valor = valorLabel || 'o valor apresentado no momento da contratação';
  const oQueInclui = inclui ?? base.inclui ?? '';
  const cobranca = mod === 'recorrente' ? 'assinatura recorrente'
    : mod === 'parcelado' ? 'pagamento parcelado em até 12×'
    : 'pagamento único';

  const c = [];
  // 1. Objeto e partes
  c.push(`1. OBJETO E PARTES. Declaro, de forma livre, informada e consciente, que estou contratando ${nomeProd}, pelo valor de ${valor} (${cobranca}), junto à BidPro Brasil, plataforma operada por Nogueira Empreendimentos LTDA (CNPJ 02.311.492/0001-61)${oQueInclui ? `, compreendendo: ${oQueInclui}` : ''}. A ativação ocorre após a confirmação do pagamento.`);
  // 2. Natureza do serviço (o resguardo central do negócio)
  if (fam === 'produto') {
    c.push('2. NATUREZA DO PRODUTO. Trata-se de conteúdo digital de caráter EDUCACIONAL e informativo. As informações, estratégias e exemplos apresentados não constituem promessa ou garantia de resultado financeiro, aprovação em leilões ou êxito em arrematações, que dependem de fatores alheios à plataforma e da conduta do próprio usuário.');
  } else if (fam === 'assessorado') {
    c.push('2. NATUREZA DO SERVIÇO. A assessoria constitui OBRIGAÇÃO DE MEIO, não de resultado: a equipe e o advogado parceiro empregam diligência técnica na análise e no acompanhamento, mas NÃO garantem êxito na arrematação, aprovação de proposta, desocupação do imóvel, prazo de registro ou resultado econômico, que dependem do leiloeiro, do juízo, de credores, de terceiros e das condições do certame.');
  } else {
    c.push('2. NATUREZA DO SERVIÇO. A plataforma é ferramenta de INFORMAÇÃO E APOIO À DECISÃO sobre imóveis em leilão. Os relatórios, análises, estimativas de valor, índices e pareceres têm caráter informativo e NÃO constituem garantia de resultado, recomendação de investimento, promessa de rentabilidade nem parecer jurídico definitivo. A decisão de participar de leilão e de ofertar lances é exclusiva do usuário.');
  }
  // 3. IA e fontes de dados
  c.push('3. INTELIGÊNCIA ARTIFICIAL E FONTES. Parte das análises é gerada com apoio de inteligência artificial sobre dados públicos de leilões e documentos fornecidos pelo usuário, podendo conter imprecisões, desatualizações ou omissões. Os dados de leilões provêm de fontes públicas de terceiros (leiloeiros, bancos, tribunais), cuja disponibilidade, integridade e atualização não estão sob controle da plataforma. O usuário deve conferir edital, matrícula e condições do certame nas fontes oficiais antes de qualquer decisão.');
  // 4. Independência
  c.push('4. INDEPENDÊNCIA. A BidPro Brasil NÃO é leiloeiro, banco, corretor ou parte nos leilões divulgados, não conduz os certames, não intermedeia lances e não possui vínculo com os organizadores. A divulgação de um imóvel não implica recomendação de compra nem atestado de regularidade do certame.');
  // 5. Riscos do leilão
  c.push('5. RISCOS DO LEILÃO. O usuário declara ciência de que a arrematação de imóveis em leilão envolve riscos inerentes — entre eles ocupação do imóvel, débitos e ônus, ações judiciais, suspensão ou anulação do certame, atraso de registro e custos adicionais (ITBI, cartório, desocupação, reforma) — e que tais riscos correm por conta do arrematante, cabendo-lhe avaliá-los, com apoio profissional próprio quando entender necessário.');
  // 6. Pagamento / cancelamento / arrependimento
  if (mod === 'recorrente') {
    c.push('6. PAGAMENTO E CANCELAMENTO. Autorizo a cobrança recorrente no meio de pagamento escolhido. Posso cancelar a assinatura a qualquer momento pela própria plataforma, sem multa, cessando as cobranças seguintes e mantendo o acesso até o fim do período já pago. Nos termos do art. 49 do CDC, posso desistir da contratação em até 7 dias corridos da primeira contratação, com estorno integral.');
  } else if (mod === 'parcelado') {
    c.push('6. PAGAMENTO. O valor é pago à vista ou parcelado em até 12×, conforme escolhido no checkout. Nos termos do art. 49 do CDC, posso desistir em até 7 dias corridos da contratação, com estorno integral, ressalvada a remuneração proporcional de serviços já efetivamente prestados a meu pedido nesse período.');
  } else {
    c.push('6. PAGAMENTO. Pagamento único, com acesso liberado após a confirmação. Nos termos do art. 49 do CDC, posso desistir em até 7 dias corridos da contratação, com estorno integral.');
  }
  if (fam === 'produto') {
    c.push('7. ACESSO IMEDIATO A CONTEÚDO DIGITAL. Solicito o acesso imediato ao conteúdo, antes do fim do prazo de arrependimento. Estou ciente de que, exercido o arrependimento no prazo legal, o estorno será integral; contudo, o consumo substancial do conteúdo no período poderá ser considerado na apuração de uso de má-fé do direito.');
  }
  if (base.honorarios) {
    c.push('7. HONORÁRIOS DE ÊXITO. Estou ciente de que, em caso de arrematação bem-sucedida com apoio da assessoria, incidem 10% (dez por cento) de honorários de êxito sobre o valor da arrematação, conforme contrato de prestação de serviços.');
  }
  // 8. Conta pessoal + PI
  c.push('8. CONTA PESSOAL E PROPRIEDADE INTELECTUAL. O acesso é pessoal e intransferível; o compartilhamento de credenciais ou a revenda de conteúdo autoriza a suspensão da conta. Relatórios, análises, cursos, ebooks, marcas e software são protegidos por direitos autorais e de propriedade intelectual, sendo vedadas reprodução, distribuição ou uso comercial sem autorização escrita, ressalvado o uso do relatório pelo próprio contratante na negociação do imóvel analisado.');
  // 9. Limitação
  c.push('9. LIMITAÇÃO DE RESPONSABILIDADE. Sem prejuízo dos direitos do consumidor previstos em lei, a responsabilidade da plataforma limita-se aos serviços que ela mesma presta, não respondendo por decisões de arrematação do usuário, por atos de leiloeiros, bancos, tribunais e terceiros, nem por indisponibilidades pontuais decorrentes de manutenção ou de falhas de serviços externos.');
  // 10. LGPD + legitimidade da cobrança
  c.push('10. DADOS PESSOAIS E LEGITIMIDADE. O tratamento de dados pessoais observa a Política de Privacidade e a LGPD (Lei nº 13.709/2018). Reconheço esta contratação e a respectiva cobrança como legítimas, realizadas por mim ou sob minha responsabilidade, e declaro ciência de que este aceite é registrado com data, hora, IP, dispositivo e código de verificação (hash), servindo como prova da manifestação de vontade (MP nº 2.200-2/2001, art. 10, §2º), inclusive em contestações de pagamento.');
  // 11. Regência
  c.push('11. DISPOSIÇÕES FINAIS. Este termo complementa os Termos de Uso e a Política de Privacidade da plataforma (bidprobrasil.com.br/#/termos e /#/privacidade), que declaro ter lido. Aplica-se a lei brasileira. Fica eleito o foro do domicílio do consumidor para relações de consumo e, nas demais, o da comarca da sede da empresa.');
  if (fam === 'assessorado') {
    c.push('12. CONTRATO ESPECÍFICO. A assessoria rege-se também pelo contrato de prestação de serviços firmado no ato da contratação, que prevalece sobre este termo em caso de divergência.');
  }

  return { familia: fam, titulo: tituloProduto(key), versao: versaoTermoProduto(key), texto: c.join('\n\n') };
}

/**
 * Monta o texto do termo de ciência adaptado ao produto.
 * @param {object} p
 * @param {string} p.nome        Nome do produto (ex.: "Investidor Pro")
 * @param {string} p.valorLabel  Valor formatado (ex.: "R$ 49,90")
 * @param {'recorrente'|'unico'|'parcelado'} p.modelo  Modelo de cobrança
 * @param {string} [p.inclui]    Resumo do que está incluso
 * @param {boolean} [p.honorarios] Se incide 10% de honorários em caso de êxito
 */
export function montarTermo({ nome, valorLabel, modelo = 'unico', inclui = '', honorarios = false }) {
  const cobranca = modelo === 'recorrente' ? 'assinatura mensal recorrente'
    : modelo === 'parcelado' ? 'pagamento parcelado em até 12×'
    : 'pagamento único';

  const linhas = [
    `Declaro, para os devidos fins, que estou contratando de forma livre e consciente o produto ${nome}, no valor de ${valorLabel} (${cobranca}).`,
    `Estou ciente de que se trata de um serviço/produto digital de acesso à plataforma BidPro Brasil, com ativação imediata após a confirmação do pagamento${inclui ? `, incluindo: ${inclui}` : ''}.`,
  ];
  if (modelo === 'recorrente') {
    linhas.push('Autorizo a cobrança recorrente e estou ciente de que posso cancelar a qualquer momento pela plataforma, sem multa.');
  }
  if (honorarios) {
    linhas.push('Estou ciente de que, em caso de arrematação bem-sucedida, incidirão 10% de honorários sobre o valor arrematado.');
  }
  linhas.push('Reconheço esta cobrança como legítima e de minha responsabilidade. Confirmo a leitura dos Termos de Uso e da Política de Privacidade.');
  return linhas.join(' ');
}
