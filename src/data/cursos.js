// ─── CURSOS (pagamento único) ─────────────────────────────────────────────

export const CURSOS = [
  {
    id: 'onboarding',
    titulo: 'Destravando Leilões',
    subtitulo: 'Seu ponto de partida — do zero ao primeiro lance',
    tagline: 'Gratuito para sempre',
    descricao: 'Entenda como funciona o universo dos leilões imobiliários, conheça a metodologia BidPro Brasil e descubra como a plataforma vai te ajudar a encontrar, analisar e arrematar imóveis com segurança e rentabilidade.',
    emoji: '🚀',
    cor: '#0D63DB',
    bg: '#dbeafe',
    nivel: 'Iniciante',
    duracao: '45 min',
    aulas: 6,
    preco: 0,
    gratuito: true,
    categoria: 'Fundamentos',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — Sua Jornada Começa Aqui',
        licoes: [
          { id: 'ob-1', titulo: 'Por que leilões imobiliários são a maior oportunidade do Brasil hoje', duracao: '10 min', gratis: true, descricao: 'O mercado de leilões movimenta mais de R$ 30 bilhões por ano. Entenda por que investidores experientes migram para cá e como você pode entrar agora.' },
          { id: 'ob-2', titulo: 'A metodologia BidPro Brasil — o método dos 30%', duracao: '8 min', gratis: true, descricao: 'Conheça o critério exclusivo da BidPro Brasil: só aprovamos operações com ROI mínimo de 30%. Entenda o porquê e como isso protege seu capital.' },
          { id: 'ob-3', titulo: 'Navegando pela plataforma BidPro Brasil', duracao: '7 min', gratis: true, descricao: 'Tour completo: busca inteligente de leilões, análise de viabilidade, portfólio e controle financeiro. Tudo que você precisa em um só lugar.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Seus Primeiros Passos',
        licoes: [
          { id: 'ob-4', titulo: 'Qual é o seu perfil de investidor?', duracao: '8 min', gratis: true, descricao: 'Conservador, Moderado ou Arrojado — descubra seu perfil e como ele define sua estratégia de lances e alocação de capital.' },
          { id: 'ob-5', titulo: 'Entendendo o teto de lance', duracao: '10 min', gratis: true, descricao: 'O conceito mais importante que você vai aprender: como calcular o lance máximo que preserva sua margem de 30%. Nunca mais pague caro demais.' },
          { id: 'ob-6', titulo: 'Próximos passos: sua trilha de aprendizado', duracao: '5 min', gratis: true, descricao: 'Roteiro de cursos recomendado para o seu perfil e como aproveitar ao máximo os recursos da BidPro Brasil.' },
        ],
      },
    ],
  },

  {
    id: 'leilao-seguro',
    titulo: 'Leilão Seguro',
    subtitulo: 'Do zero à primeira arrematação com tranquilidade',
    tagline: 'Gratuito para sempre',
    descricao: 'Entenda profundamente o que é um leilão imobiliário, como o processo funciona na prática, quais são as proteções legais do arrematante e por que — ao contrário do que muitos pensam — leilões são mais seguros do que a compra comum quando feitos com método.',
    emoji: '🛡️',
    cor: '#7c3aed',
    bg: '#ede9fe',
    nivel: 'Iniciante',
    duracao: '1h 10min',
    aulas: 8,
    preco: 0,
    gratuito: true,
    categoria: 'Fundamentos',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — Leilão Desmistificado',
        licoes: [
          { id: 'seg-1', titulo: 'O que é um leilão imobiliário — mitos e verdades', duracao: '12 min', gratis: true, descricao: '"Leilão é coisa de endividado" — destruindo os 5 maiores mitos do mercado e apresentando a realidade dos números.' },
          { id: 'seg-2', titulo: 'Leilão Judicial vs Extrajudicial — qual a diferença?', duracao: '14 min', gratis: true, descricao: 'As duas modalidades, diferenças de risco, processo e quais os melhores para cada perfil de investidor.' },
          { id: 'seg-3', titulo: 'Primeira e Segunda Praça — onde está a oportunidade', duracao: '10 min', gratis: true, descricao: 'Os dois momentos do leilão judicial, como os preços chegam a 50% de desconto e qual a estratégia para cada praça.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Suas Garantias Legais',
        licoes: [
          { id: 'seg-4', titulo: 'A lei que protege o arrematante (CPC Art. 879)', duracao: '10 min', gratis: true, descricao: 'O Código de Processo Civil garante seus direitos. Entenda as principais proteções e o que o vendedor NÃO pode fazer após a arrematação.' },
          { id: 'seg-5', titulo: 'Como o leiloeiro credenciado garante a lisura', duracao: '8 min', gratis: true, descricao: 'O papel das Juntas Comerciais no credenciamento, responsabilidades do leiloeiro e como verificar se ele é idôneo.' },
          { id: 'seg-6', titulo: 'O que pode dar errado — e como evitar', duracao: '10 min', gratis: true, descricao: 'Os 5 erros mais comuns dos arrematantes iniciantes e como a metodologia BidPro Brasil elimina cada um deles sistematicamente.' },
          { id: 'seg-7', titulo: 'Imissão na posse — tomando o imóvel de forma legal', duracao: '8 min', gratis: true, descricao: 'Como funciona o processo de imissão, prazo, casos de ocupação pelo antigo dono e como agir em cada situação.' },
          { id: 'seg-8', titulo: 'Casos reais: 3 operações BidPro Brasil bem-sucedidas', duracao: '10 min', gratis: true, descricao: 'Três estudos de caso reais: apartamento judicial SP, casa CEF RJ e terreno comercial MG. Números, timeline e lições aprendidas.' },
        ],
      },
    ],
  },

  {
    id: 'avaliacao-mercadologica',
    titulo: 'O Olho do Perito',
    subtitulo: 'Avaliação mercadológica que nenhum comprador comum faz',
    tagline: 'Acesso vitalício por R$ 97',
    descricao: 'Aprenda a pesquisar e analisar o mercado imobiliário como um perito avaliador: comparativos no mesmo condomínio, na vizinhança, cálculo de valor de venda e locação, yield de locação e como defender um preço justo em qualquer bairro do Brasil.',
    emoji: '🔍',
    cor: '#0891b2',
    bg: '#cffafe',
    nivel: 'Intermediário',
    duracao: '1h 45min',
    aulas: 9,
    preco: 97,
    gratuito: false,
    categoria: 'Mercado',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — A Pesquisa Profissional',
        licoes: [
          { id: 'merc-1', titulo: 'Os dois níveis de pesquisa que ninguém te ensina', duracao: '12 min', gratis: true, descricao: 'Nível 1: mesmo condomínio/endereço. Nível 2: bairro/vizinhança. A metodologia BidPro Brasil de dois níveis e por que ela é mais precisa que qualquer outra.' },
          { id: 'merc-2', titulo: 'Fontes de dados — onde encontrar amostras reais', duracao: '14 min', gratis: false, descricao: 'ZAP Imóveis, VivaReal, OLX, Quinto Andar, Loft, IBGE — como usar cada fonte, coletar o máximo de amostras e identificar dados distorcidos.' },
          { id: 'merc-3', titulo: 'Como tratar e homogeneizar amostras', duracao: '12 min', gratis: false, descricao: 'Padronizar área, padrão construtivo, andar, vagas e estado de conservação. O processo que transforma dados brutos em avaliação defensável.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Calculando o Valor Real',
        licoes: [
          { id: 'merc-4', titulo: 'R$/m² — calculando o preço médio ponderado', duracao: '14 min', gratis: false, descricao: 'Como calcular o preço médio, eliminar outliers e chegar ao VGV (valor geral de vendas) que você consegue defender para qualquer imóvel.' },
          { id: 'merc-5', titulo: 'Yield de locação — quanto o imóvel vai gerar de renda', duracao: '14 min', gratis: false, descricao: 'Pesquisa de aluguel, cálculo de yield bruto e líquido, comparativo com CDI e FIIs. Como saber se o imóvel paga conta como investimento de renda.' },
          { id: 'merc-6', titulo: 'Tendências de bairro — onde o dinheiro está indo', duracao: '10 min', gratis: false, descricao: 'Como identificar bairros em valorização, detectar especulação imobiliária, onde evitar e onde concentrar suas buscas.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Usando a IA da BidPro Brasil',
        licoes: [
          { id: 'merc-7', titulo: 'Avaliação automática com IA em 2 minutos', duracao: '14 min', gratis: false, descricao: 'Como usar a função de Avaliação Mercadológica da plataforma BidPro Brasil para gerar comparativos automáticos com dezenas de amostras.' },
          { id: 'merc-8', titulo: 'Interpretando os resultados da IA', duracao: '12 min', gratis: false, descricao: 'Como ler o relatório de dois níveis, identificar distorções, ajustar manualmente e chegar ao preço de mercado final.' },
          { id: 'merc-9', titulo: 'Estudo de caso: avaliando um apartamento em SP', duracao: '18 min', gratis: false, descricao: 'Ao vivo na plataforma: avaliação mercadológica completa de um apartamento em São Paulo do zero até o número final defendido.' },
        ],
      },
    ],
  },

  {
    id: 'radiografia-imovel',
    titulo: 'Radiografia do Imóvel',
    subtitulo: 'Edital, matrícula e pré-avaliação jurídica',
    tagline: 'Acesso vitalício por R$ 147',
    descricao: 'Saiba ler e interpretar todos os documentos de um leilão como um advogado especialista: edital, matrícula, certidões, ônus reais, usufrutos, penhoras e tudo que pode impedir — ou alavancar — sua arrematação.',
    emoji: '📋',
    cor: '#dc2626',
    bg: '#fee2e2',
    nivel: 'Intermediário',
    duracao: '2h 05min',
    aulas: 10,
    preco: 147,
    gratuito: false,
    categoria: 'Jurídico',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — Documentação Essencial',
        licoes: [
          { id: 'rad-1', titulo: 'Anatomia de uma matrícula — lendo linha por linha', duracao: '20 min', gratis: true, descricao: 'O documento mais importante da operação. Aprenda a ler matrícula do zero: abertura, transmissões, ônus, averbações e o que cada campo revela.' },
          { id: 'rad-2', titulo: 'Analisando o edital — as cláusulas que definem tudo', duracao: '16 min', gratis: false, descricao: 'Cláusulas-armadilha, responsabilidade por débitos, condições de pagamento, prazo e o que pode mudar de um edital para outro.' },
          { id: 'rad-3', titulo: 'Certidões necessárias — o checklist completo', duracao: '12 min', gratis: false, descricao: 'Quais certidões solicitar antes de qualquer lance: IPTU, condomínio, ações reais, executivos fiscais, interdito proibitório.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Riscos que Podem Travar a Operação',
        licoes: [
          { id: 'rad-4', titulo: 'Usufruto vitalício — o maior perigo dos leilões', duracao: '16 min', gratis: false, descricao: 'O risco mais perigoso que existe: quando o imóvel tem usufruto e você não pode tomar posse. Como identificar, o que fazer e quando abandonar.' },
          { id: 'rad-5', titulo: 'Hipoteca e alienação fiduciária', duracao: '12 min', gratis: false, descricao: 'Diferença entre hipoteca e alienação fiduciária, sub-rogação de dívidas bancárias e como calcular o impacto real no seu ROI.' },
          { id: 'rad-6', titulo: 'Bem de família — quando o imóvel é intocável', duracao: '10 min', gratis: false, descricao: 'A Lei 8.009/90 e quando ela protege o imóvel do leilão. Como identificar casos e por que isso pode invalidar toda a operação.' },
          { id: 'rad-7', titulo: 'Débitos assumidos — IPTU, condomínio e concessionárias', duracao: '10 min', gratis: false, descricao: 'O que vai junto com o imóvel, como calcular o total de débitos, estratégias de negociação e quando o edital garante quitação.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Usando a IA para Pré-Avaliação',
        licoes: [
          { id: 'rad-8', titulo: 'Extraindo dados do edital com IA em segundos', duracao: '14 min', gratis: false, descricao: 'Como usar a função de upload da plataforma BidPro Brasil para extrair automaticamente todos os dados do edital e matrícula com IA.' },
          { id: 'rad-9', titulo: 'Interpretando os alertas de risco da plataforma', duracao: '10 min', gratis: false, descricao: 'Os três níveis de risco BidPro Brasil: bloqueante (para a operação), alerta (analise com cuidado) e informativo. Como agir em cada caso.' },
          { id: 'rad-10', titulo: 'Estudo de caso: radiografia de uma matrícula real', duracao: '18 min', gratis: false, descricao: 'Ao vivo: análise completa de uma matrícula real com ônus, penhora e usufruto. Decisão final: aprovar ou reprovar a operação.' },
        ],
      },
    ],
  },

  {
    id: 'arte-do-lance',
    titulo: 'A Arte do Lance Perfeito',
    subtitulo: 'Estratégia de arrematação do início ao fim',
    tagline: 'Acesso vitalício por R$ 197',
    descricao: 'Do checklist pré-leilão ao auto de arrematação: domine a estratégia de lance, a psicologia da disputa, quando entrar, quando parar e como sair com o imóvel certo pelo preço certo — sempre respeitando seu teto.',
    emoji: '🎯',
    cor: '#d97706',
    bg: '#fef3c7',
    nivel: 'Avançado',
    duracao: '1h 40min',
    aulas: 9,
    preco: 197,
    gratuito: false,
    categoria: 'Estratégia',
    destaque: true,
    modulos: [
      {
        titulo: 'Módulo 1 — Preparação é Vitória',
        licoes: [
          { id: 'arte-1', titulo: 'Checklist das 48h antes do leilão', duracao: '14 min', gratis: true, descricao: 'Tudo que precisa estar verificado antes de dar o primeiro lance: habilitação, documentos, capital disponível, análise confirmada e limite de lance definido.' },
          { id: 'arte-2', titulo: 'Leilão online vs presencial — o que muda na prática', duracao: '12 min', gratis: false, descricao: 'Plataformas digitais, leilão por WhatsApp, leilão presencial — diferenças práticas e como evitar erros técnicos em cada modalidade.' },
          { id: 'arte-3', titulo: 'A psicologia do leilão — não deixe a emoção custar caro', duracao: '12 min', gratis: false, descricao: 'Efeito de ancoragem, febre do lance, apego emocional ao imóvel. Como manter frieza absoluta usando o teto de lance como âncora racional.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Na Arena do Lance',
        licoes: [
          { id: 'arte-4', titulo: 'Estratégia agressiva vs conservadora — quando usar cada uma', duracao: '14 min', gratis: false, descricao: 'Quando entrar cedo com lance alto, quando esperar, incrementos ideais e jogadas psicológicas para intimidar competidores sem pagar mais.' },
          { id: 'arte-5', titulo: 'Leilão em segunda praça — a segunda chance de ouro', duracao: '12 min', gratis: false, descricao: 'Como identificar leilões que vão à segunda praça, como se preparar com antecedência e como aproveitar a queda adicional no preço mínimo.' },
          { id: 'arte-6', titulo: 'A decisão mais difícil: quando parar de dar lances', duracao: '10 min', gratis: false, descricao: 'Disciplina de saída é o que separa amadores de profissionais. Critérios objetivos para respeitar o teto e entender que perder um leilão pode ser lucrar.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Após o Martelo',
        licoes: [
          { id: 'arte-7', titulo: 'Auto de arrematação e carta — seus documentos de posse', duracao: '10 min', gratis: false, descricao: 'O que receber, em qual prazo, como registrar no cartório e quais os documentos que provam que o imóvel é seu.' },
          { id: 'arte-8', titulo: 'Processo de transferência — do pagamento ao registro', duracao: '10 min', gratis: false, descricao: 'Passo a passo: pagamento → carta de arrematação → ITBI → escritura/formal de partilha → registro na matrícula. Prazos reais.' },
          { id: 'arte-9', titulo: 'Tomando posse: imissão e negociação com ocupantes', duracao: '10 min', gratis: false, descricao: 'Imóvel ocupado? Como agir: negociação amigável, ajuda de custo, despejo liminar e imissão na posse pela via judicial. Casos reais.' },
        ],
      },
    ],
  },

  {
    id: 'portfolio-lucrativo',
    titulo: 'Portfólio Lucrativo',
    subtitulo: 'Gestão profissional de imóveis arrematados',
    tagline: 'Acesso vitalício por R$ 297',
    descricao: 'Como estruturar, controlar e escalar um portfólio de leilões imobiliários: controle financeiro real, reforma e retrofit, estratégias de venda e locação, holding imobiliária e como reinvestir os lucros sistematicamente.',
    emoji: '📈',
    cor: '#059669',
    bg: '#d1fae5',
    nivel: 'Avançado',
    duracao: '2h 15min',
    aulas: 11,
    preco: 297,
    gratuito: false,
    categoria: 'Gestão',
    destaque: true,
    modulos: [
      {
        titulo: 'Módulo 1 — Controle Financeiro de Verdade',
        licoes: [
          { id: 'port-1', titulo: 'DRE do imóvel — a conta real que todo investidor ignora', duracao: '16 min', gratis: true, descricao: 'A diferença entre ROI estimado e ROI real. Como registrar cada despesa e receita para saber exatamente quanto você ganhou.' },
          { id: 'port-2', titulo: 'Reforma e retrofit — planeja antes de bater o martelo', duracao: '14 min', gratis: false, descricao: 'Orçamento realista de reforma, cronograma, contratação de fornecedores, controle de obra e como evitar o estouro de custo mais comum.' },
          { id: 'port-3', titulo: 'KPIs do portfólio — os números que importam', duracao: '12 min', gratis: false, descricao: 'TIR, VPL, payback, múltiplo de capital — os indicadores que investidores profissionais usam e como calcular cada um com a plataforma BidPro Brasil.' },
          { id: 'port-4', titulo: 'Usando o controle financeiro da BidPro Brasil', duracao: '10 min', gratis: false, descricao: 'Como registrar lançamentos de entrada e saída por imóvel na plataforma, acompanhar o saldo em tempo real e exportar relatórios.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Estratégias de Saída',
        licoes: [
          { id: 'port-5', titulo: 'Vender ou alugar? — o modelo de decisão BidPro Brasil', duracao: '14 min', gratis: false, descricao: 'Quando o yield de locação compensa segurar o imóvel vs quando vender e reinvestir. O modelo de decisão em 4 critérios.' },
          { id: 'port-6', titulo: 'Precificação para vender em 90 dias', duracao: '12 min', gratis: false, descricao: 'Como precificar para girar rápido sem queimar margem. Posicionamento de preço, marketing, fotos e home staging básico que funciona.' },
          { id: 'port-7', titulo: 'Gestão de locatários — do contrato ao reajuste', duracao: '10 min', gratis: false, descricao: 'Contrato de locação, garantias (fiança, seguro fiança, depósito), inadimplência e despejo amigável. Como evitar dores de cabeça.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Escalando o Portfólio',
        licoes: [
          { id: 'port-8', titulo: 'PF vs PJ — quando criar sua holding imobiliária', duracao: '14 min', gratis: false, descricao: 'Vantagens tributárias da pessoa jurídica, IR sobre ganho de capital, distribuição de lucros e quando a holding começa a fazer sentido.' },
          { id: 'port-9', titulo: 'Captando sócios — como estruturar uma SPE', duracao: '12 min', gratis: false, descricao: 'Como criar uma Sociedade de Propósito Específico para um único imóvel, como apresentar a oportunidade e dividir resultados.' },
          { id: 'port-10', titulo: 'Alavancagem responsável — até onde ir com financiamento', duracao: '12 min', gratis: false, descricao: 'A teoria do ROE na prática: quando financiar aumenta seu retorno e quando te coloca em risco. Os limites seguros de alavancagem.' },
          { id: 'port-11', titulo: 'Construindo o pipeline — nunca fique sem operação', duracao: '12 min', gratis: false, descricao: 'Como ter sempre 3-5 imóveis em análise simultânea, o sistema de funil BidPro Brasil e como escalar de 1 para 10 imóveis no portfólio.' },
        ],
      },
    ],
  },
];

// ─── PACOTE COMPLETO ─────────────────────────────────────────────────────────
export const PACOTE = {
  id: 'pacote-completo',
  titulo: 'Método BidPro Brasil Completo',
  descricao: 'Acesso vitalício a todos os 6 cursos pagos + material de apoio exclusivo + acesso prioritário a novos conteúdos.',
  preco: 497,
  precoOriginal: 838,
  economia: 341,
  cursoIds: ['avaliacao-mercadologica','radiografia-imovel','arte-do-lance','portfolio-lucrativo'],
};

// ─── PLANOS DE ASSINATURA ─────────────────────────────────────────────────────
// homepage:true  → aparece na página inicial (3 primeiros)
// homepage:false → só aparece na página completa de Planos
export const PLANOS = {
  explorador: {
    id: 'explorador',
    nome: 'Explorador',
    preco: 0,
    precoLabel: 'Grátis',
    periodicidade: '',
    cor: '#64748b',
    bg: '#f1f5f9',
    homepage: true,
    destaque: false,
    descricao: 'Comece a explorar o mercado de leilões sem pagar nada',
    recursos: [
      '✅ Busca de leilões em todo o Brasil',
      '✅ Flag de viabilidade (🟢/🔴)',
      '✅ Direcionamento ao site do leiloeiro',
      '✅ Cursos gratuitos (Destravando Leilões + Leilão Seguro)',
      '❌ Relatório de viabilidade',
      '❌ Análise de edital e matrícula',
    ],
    limite_analises: 10,
    relatorio: false,
    portfolio: false,
  },
  top1: {
    id: 'top1',
    nome: 'Investidor Pro',
    preco: 49.90,
    precoLabel: 'R$ 49,90',
    precoAnual: 449.90,
    precoAnualLabel: 'R$ 449,90',
    precoMensalAnual: 37.49,
    precoMensalAnualLabel: 'R$ 37,49',
    periodicidade: '/mês',
    cor: '#0D63DB',
    bg: '#dbeafe',
    homepage: false,
    destaque: false,
    descricao: 'Plano de assinatura mensal para investidores ativos em leilões imobiliários.',
    recursos: [],
    limite_analises: -1,
    relatorio: true,
    portfolio: false,
  },
  top2: {
    id: 'top2',
    nome: 'Investidor Pro',
    preco: 99.90,
    precoLabel: 'R$ 99,90',
    precoAnual: 797,
    precoAnualLabel: 'R$ 797',
    precoMensalAnual: 66.42,
    precoMensalAnualLabel: 'R$ 66,42',
    periodicidade: '/mês',
    cor: '#0D63DB',
    bg: '#dbeafe',
    homepage: true,
    destaque: true,
    descricao: 'Relatório completo de viabilidade + análise jurídica documental',
    recursos: [
      '✅ Acesso completo à busca de imóveis em leilão',
      '✅ Relatório mercadológico com valor real de mercado',
      '✅ Viabilidade financeira com projeções e fluxo de caixa',
      '✅ Análise de edital, matrícula e anexos do processo',
      '✅ Análise processual do imóvel',
      '✅ Alertas de risco (usufruto, penhora, ônus reais)',
      '✅ 15 relatórios mercadológicos/mês',
      '✅ 15 relatórios documentais e jurídicos/mês',
      '✅ Acesso à Calculadora de Arrematação',
    ],
    limite_analises: -1,
    relatorio: true,
    portfolio: false,
  },
  assessorado: {
    id: 'assessorado',
    nome: 'Assessoria',
    preco: 6000,
    precoLabel: 'R$ 6.000,00',
    precoVista: 4800,
    precoVistaLabel: 'R$ 4.800,00',
    desconto_vista_pct: 20,
    periodicidade: 'por arrematação',
    honorarios: 10,
    cor: '#d97706',
    bg: '#fef3c7',
    homepage: false,
    destaque: false,
    fidelidade_meses: null,
    multa_cancelamento_pct: 0,
    pagamento_tipo: 'unico',
    acesso_meses: 12,
    vinculado_arrematacao: true,
    descricao: 'Assessoria completa da equipe BidPro Brasil para realizar 1 arrematação. Acesso de 12 meses, extensível até a imissão de posse. Parcelamento em até 12× (juros do cliente a partir da 4ª parcela).',
    recursos: [
      '✅ Tudo do plano Investidor Pro',
      '✅ Cursos gravados e eBooks inclusos',
      '✅ Assessoria completa para 1 arrematação',
      '✅ Acesso de 12 meses (extensível até a posse)',
      '✅ Relatórios mercadológico e jurídico elaborados pela equipe',
      '✅ Acompanhamento do processo de leilão pela equipe BidPro Brasil',
      '✅ Análise jurídica pelo escritório parceiro',
      '✅ Orientação pós-arrematação + registro ONR Digital',
      '✅ + 10% de honorários sobre o valor arrematado',
    ],
    limite_analises: -1,
    relatorio: true,
    portfolio: true,
  },
  clube: {
    id: 'clube',
    nome: 'Leilão Club',
    preco: 60000,
    precoLabel: 'R$ 60.000,00',
    precoVista: 48000,
    precoVistaLabel: 'R$ 48.000,00',
    desconto_vista_pct: 20,
    periodicidade: '/mês · total R$ 60.000 em 12 meses',
    honorarios: 10,
    cor: '#059669',
    bg: '#d1fae5',
    homepage: false,
    destaque: true,
    fidelidade_meses: 12,
    multa_cancelamento_pct: 30,
    pagamento_tipo: 'recorrente',
    acesso_meses: null,
    vinculado_arrematacao: false,
    descricao: 'Mentoria contínua, assessoria e arrematações ilimitadas. R$ 5.000/mês ou 12× no cartão/PIX. Fidelidade de 12 meses; após isso cancele a qualquer momento.',
    recursos: [
      '✅ Tudo dos planos anteriores',
      '✅ Encontros regulares com Tarcísio (sócio BidPro Brasil)',
      '✅ Oportunidades de leilões judiciais e extrajudiciais',
      '✅ Arrematações ilimitadas com assessoria completa',
      '✅ Fidelidade 12 meses (R$ 60.000 total)',
      '✅ Opções: recorrente mensal ou 12× cartão/PIX',
      '✅ Após 12 meses: cancele a qualquer momento sem multa',
      '✅ Cancel. antecipado: 30% do saldo da fidelidade restante',
      '✅ + 10% de honorários sobre cada arrematação',
    ],
    limite_analises: -1,
    relatorio: true,
    portfolio: true,
  },
};

// ─── PAPÉIS / PERMISSÕES ──────────────────────────────────────────────────────
// Planos compráveis: explorador, top1, top2, assessorado, clube (campo `role` = plano)
// Papéis operacionais (atribuídos pelo admin, não comprados):
export const ROLES = {
  admin:       { nome: 'Administrador', tipo: 'operacional', descricao: 'Acesso total ao sistema e configurações' },
  explorador:  { nome: 'Explorador (Aluno)', tipo: 'plano', descricao: 'Busca gratuita de imóveis' },
  top1:        { nome: 'Investidor', tipo: 'plano', descricao: 'Relatório de viabilidade do imóvel — até 10 análises/mês' },
  top2:        { nome: 'Investidor Pro', tipo: 'plano', descricao: 'Relatório + análise jurídica documental inclusa' },
  assessorado: { nome: 'Assessorado', tipo: 'plano', descricao: 'Assessoria para 1 arrematação' },
  clube:       { nome: 'Leilão Club', tipo: 'plano', descricao: 'Mentoria contínua e arrematações ilimitadas' },
  consultor:   { nome: 'Consultor (Afiliado)', tipo: 'operacional', descricao: 'Vende cursos e planos — não assiste o conteúdo' },
  analista:    { nome: 'Analista', tipo: 'operacional', descricao: 'Gera relatórios, agenda reuniões e envia ao jurídico' },
  advogado:    { nome: 'Advogado', tipo: 'operacional', descricao: 'Emite parecer jurídico das arrematações' },
};

// ─── EBOOKS / MATERIAIS COMPLEMENTARES ────────────────────────────────────────
// Populado pelo admin. Estrutura: { id, titulo, descricao, capa, arquivo_url, gratuito }
export const EBOOKS = [];

export const CATEGORIAS = ['Todos', 'Fundamentos', 'Mercado', 'Jurídico', 'Estratégia', 'Gestão'];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
// Total real de aulas somando todas as lições de todos os cursos
export const TOTAL_AULAS = CURSOS.reduce(
  (acc, c) => acc + (c.modulos || []).reduce((a, m) => a + (m.licoes || []).length, 0),
  0
);
export const TOTAL_CURSOS = CURSOS.length;

export function formatarPreco(valor) {
  if (!valor || valor === 0) return 'Grátis';
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
