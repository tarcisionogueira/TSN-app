// Termo de ciência de compra — versionado para rastreabilidade (chargeback).
// Ao mudar o texto, incremente a versão: o aceite grava a versão vigente.
export const TERMOS_VERSAO = '2.0';

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

// Texto do termo da família (usa montarTermo + cláusulas específicas). Os parâmetros
// são opcionais: sem eles o texto sai com o rótulo genérico do produto — suficiente
// para o comprovante; no checkout, passe nome/valor/modelo reais.
export function termoDoProduto(key, { nome, valorLabel, modelo, inclui } = {}) {
  const fam = familiaTermo(key);
  const base = {
    explorador: { modelo: 'recorrente', inclui: 'busca de imóveis em leilão e relatórios conforme o plano' },
    top2: { modelo: 'recorrente', inclui: 'busca, relatórios mercadológico/documental/laudo e recursos do plano' },
    clube: { modelo: 'recorrente', inclui: 'comunidade, encontros e conteúdos do Leilão Club' },
    assessorado: { modelo: 'parcelado', honorarios: true, inclui: 'assessoria completa de arrematação com equipe e advogado parceiro' },
    consultor: { modelo: 'recorrente' },
    advogado: { modelo: 'recorrente' },
    analista: { modelo: 'recorrente' },
    produto: { modelo: 'unico', inclui: 'conteúdo digital (curso/ebook) com acesso imediato após a confirmação do pagamento' },
    geral: { modelo: 'unico' },
  }[fam];
  let texto = montarTermo({
    nome: nome || tituloProduto(key),
    valorLabel: valorLabel || 'o valor apresentado no checkout',
    modelo: modelo || base.modelo,
    inclui: inclui ?? base.inclui ?? '',
    honorarios: !!base.honorarios,
  });
  if (fam === 'produto') {
    texto += ' Por se tratar de conteúdo digital com acesso imediato, solicito o início da execução do serviço antes do prazo de 7 dias do art. 49 do CDC, ciente de que o exercício do arrependimento após o consumo do conteúdo poderá ser limitado.';
  }
  if (fam === 'assessorado') {
    texto += ' A assessoria rege-se também pelo contrato de prestação de serviços firmado no ato da contratação, que prevalece em caso de divergência.';
  }
  return { familia: fam, titulo: tituloProduto(key), versao: versaoTermoProduto(key), texto };
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
