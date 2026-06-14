// Catálogo de cursos da Área de Membros TSN Ativos
export const CURSOS = [
  {
    id: 'onboarding',
    titulo: 'Bem-vindo à TSN Ativos',
    subtitulo: 'Onboarding — Comece aqui',
    descricao: 'O ponto de partida para quem quer dominar o mercado de leilões imobiliários. Entenda a metodologia TSN, como usar a plataforma e qual o seu perfil de investidor.',
    emoji: '🚀',
    cor: '#2563eb',
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
        titulo: 'Módulo 1 — Bem-vindo',
        licoes: [
          { id: 'ob-1', titulo: 'Como funciona a TSN Ativos', duracao: '8 min', gratis: true, descricao: 'Conheça a missão da TSN e como a plataforma foi pensada para maximizar seus resultados em leilões imobiliários.' },
          { id: 'ob-2', titulo: 'Navegando pela plataforma', duracao: '7 min', gratis: true, descricao: 'Tour completo pelas ferramentas: busca de leilões, análise de viabilidade, portfólio e controle financeiro.' },
          { id: 'ob-3', titulo: 'Qual é o seu perfil de investidor?', duracao: '10 min', gratis: true, descricao: 'Descubra se você é perfil Conservador, Moderado ou Arrojado e como isso define sua estratégia de lances.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Primeiros passos',
        licoes: [
          { id: 'ob-4', titulo: 'Seu primeiro imóvel em leilão', duracao: '8 min', gratis: true, descricao: 'Passo a passo de como encontrar, filtrar e selecionar seu primeiro imóvel para análise.' },
          { id: 'ob-5', titulo: 'Entendendo o teto de lance', duracao: '6 min', gratis: true, descricao: 'O conceito mais importante: como a TSN calcula o teto de disputa para garantir rentabilidade mínima de 40%.' },
          { id: 'ob-6', titulo: 'Próximos passos na sua jornada', duracao: '6 min', gratis: true, descricao: 'Roteiro de aprendizado recomendado e como aproveitar ao máximo os cursos avançados.' },
        ],
      },
    ],
  },

  {
    id: 'o-que-e-leilao',
    titulo: 'O Que É Leilão de Imóveis',
    subtitulo: 'Fundamentos essenciais',
    descricao: 'Entenda profundamente o universo dos leilões: tipos, modalidades, participantes, leis e como o mercado funciona na prática brasileira.',
    emoji: '⚖️',
    cor: '#7c3aed',
    bg: '#ede9fe',
    nivel: 'Iniciante',
    duracao: '1h 20min',
    aulas: 9,
    preco: 97,
    gratuito: false,
    categoria: 'Fundamentos',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — Conceitos Básicos',
        licoes: [
          { id: 'leil-1', titulo: 'O que é um leilão imobiliário', duracao: '12 min', gratis: true, descricao: 'Definição, história e por que os leilões existem. Como credores recuperam ativos.' },
          { id: 'leil-2', titulo: 'Leilão Judicial vs Extrajudicial', duracao: '15 min', gratis: false, descricao: 'As duas modalidades, diferenças de risco, prazo e processo de cada uma.' },
          { id: 'leil-3', titulo: 'Primeira e Segunda Praça', duracao: '10 min', gratis: false, descricao: 'Como funcionam os dois momentos do leilão judicial e qual o melhor para arrematar.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Participantes e Regras',
        licoes: [
          { id: 'leil-4', titulo: 'Quem pode participar de um leilão', duracao: '8 min', gratis: false, descricao: 'Pessoa física, jurídica, CNPJ, documentação necessária e habilitação.' },
          { id: 'leil-5', titulo: 'O papel do leiloeiro oficial', duracao: '10 min', gratis: false, descricao: 'Credenciamento nas Juntas Comerciais, responsabilidades e como verificar a idoneidade.' },
          { id: 'leil-6', titulo: 'Plataformas e editais online', duracao: '8 min', gratis: false, descricao: 'Caixa Econômica, Sold, Biasi, Zukerman e mais — como acompanhar calendários.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Legislação',
        licoes: [
          { id: 'leil-7', titulo: 'Base legal dos leilões (CPC Art. 879)', duracao: '12 min', gratis: false, descricao: 'Artigos do Código de Processo Civil que regem os leilões judiciais.' },
          { id: 'leil-8', titulo: 'Decreto-Lei 70 e leilões extrajudiciais', duracao: '10 min', gratis: false, descricao: 'Fundamento legal dos leilões de imóveis hipotecados e alienação fiduciária.' },
          { id: 'leil-9', titulo: 'Direitos do arrematante', duracao: '7 min', gratis: false, descricao: 'O que o arrematante pode e não pode exigir, prazo de imissão na posse e recurso de terceiros.' },
        ],
      },
    ],
  },

  {
    id: 'analise-viabilidade',
    titulo: 'Análise de Viabilidade Financeira',
    subtitulo: 'O método TSN de 40%',
    descricao: 'Domine a metodologia exclusiva da TSN para analisar viabilidade: ROI, ROE, teto de lance, fluxo de caixa, SAC e PRICE. Da teoria à prática com casos reais.',
    emoji: '📊',
    cor: '#059669',
    bg: '#d1fae5',
    nivel: 'Intermediário',
    duracao: '2h 15min',
    aulas: 12,
    preco: 197,
    gratuito: false,
    categoria: 'Financeiro',
    destaque: true,
    modulos: [
      {
        titulo: 'Módulo 1 — Métricas de Retorno',
        licoes: [
          { id: 'fin-1', titulo: 'ROI vs ROE — quando usar cada um', duracao: '14 min', gratis: true, descricao: 'Return on Investment (à vista) e Return on Equity (alavancado) — diferença prática e quando cada métrica é mais relevante.' },
          { id: 'fin-2', titulo: 'Por que 40% de ROI mínimo?', duracao: '10 min', gratis: false, descricao: 'A lógica por trás do critério TSN: risco de liquidez, imprevistos, tempo de capital imobilizado.' },
          { id: 'fin-3', titulo: 'Calculando o Teto de Lance', duracao: '18 min', gratis: false, descricao: 'O cálculo por busca binária que define o lance máximo preservando a rentabilidade mínima.' },
          { id: 'fin-4', titulo: 'Honorários, taxas e impostos', duracao: '12 min', gratis: false, descricao: 'Mapa completo de custos: honorários jurídicos (10%), taxa leiloeiro, ITBI, registro, laudêmio, foreiro.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Projeções',
        licoes: [
          { id: 'fin-5', titulo: 'Fluxo de Caixa da Operação', duracao: '16 min', gratis: false, descricao: 'Mês a mês: investimento inicial, carrego, reforma, parcelas bancárias, venda. Como ler o fluxo.' },
          { id: 'fin-6', titulo: 'Tabela SAC vs Tabela PRICE', duracao: '14 min', gratis: false, descricao: 'Qual escolher? Comparativo de parcelas, juros totais e estratégia de quitação antecipada.' },
          { id: 'fin-7', titulo: 'Yield de locação', duracao: '10 min', gratis: false, descricao: 'Como calcular yield bruto e líquido, vacância, despesas e comparativo com renda fixa.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Casos Práticos',
        licoes: [
          { id: 'fin-8', titulo: 'Caso 1: Apartamento judicial SP', duracao: '20 min', gratis: false, descricao: 'Análise completa de um apartamento judicial em São Paulo — do edital ao laudo de viabilidade.' },
          { id: 'fin-9', titulo: 'Caso 2: Casa extrajudicial RJ', duracao: '18 min', gratis: false, descricao: 'Análise de casa em leilão extrajudicial — CEF — incluindo riscos e negociação de débitos.' },
          { id: 'fin-10', titulo: 'Caso 3: Operação de retrofit', duracao: '16 min', gratis: false, descricao: 'Imóvel degradado: cálculo de reforma, impacto no ROI, cenários pessimista/base/otimista.' },
          { id: 'fin-11', titulo: 'Uso Próprio vs Investimento', duracao: '12 min', gratis: false, descricao: 'Como a análise muda quando o objetivo é moradia — economia real vs mercado.' },
          { id: 'fin-12', titulo: 'Simulando com a plataforma TSN', duracao: '15 min', gratis: false, descricao: 'Live usando a plataforma para analisar um imóvel real do zero até o laudo em PDF.' },
        ],
      },
    ],
  },

  {
    id: 'avaliacao-mercadologica',
    titulo: 'Avaliação Mercadológica',
    subtitulo: 'Comparativos que valem ouro',
    descricao: 'Aprenda a fazer pesquisa de mercado profissional: encontrar comparativos no mesmo condomínio e na vizinhança, calcular valor de venda e locação com precisão de perito avaliador.',
    emoji: '🏘️',
    cor: '#0891b2',
    bg: '#cffafe',
    nivel: 'Intermediário',
    duracao: '1h 40min',
    aulas: 8,
    preco: 147,
    gratuito: false,
    categoria: 'Mercado',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — Pesquisa de Mercado',
        licoes: [
          { id: 'merc-1', titulo: 'Metodologia de dois níveis', duracao: '12 min', gratis: true, descricao: 'Nível 1: mesmo condomínio. Nível 2: bairro. Por que essa prioridade importa para a precificação.' },
          { id: 'merc-2', titulo: 'Fontes de dados confiáveis', duracao: '14 min', gratis: false, descricao: 'ZAP, VivaReal, OLX, Quinto Andar, Loft, IBGE — como usar cada fonte e identificar distorções.' },
          { id: 'merc-3', titulo: 'Como tratar amostras', duracao: '10 min', gratis: false, descricao: 'Homogeneização: padronizar área, padrão construtivo, andar, vagas e estado de conservação.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Valoração',
        licoes: [
          { id: 'merc-4', titulo: 'Calculando o R$/m²', duracao: '12 min', gratis: false, descricao: 'Como calcular preço médio ponderado, eliminar outliers e chegar ao VGV defensável.' },
          { id: 'merc-5', titulo: 'Locação: aluguel médio e yield', duracao: '14 min', gratis: false, descricao: 'Pesquisa de locação, cálculo de yield bruto/líquido, comparativo com CDI e FIIs.' },
          { id: 'merc-6', titulo: 'Tendências de bairro', duracao: '10 min', gratis: false, descricao: 'Como identificar bairros em valorização, especulação imobiliária e onde evitar investir.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Laudo Mercadológico',
        licoes: [
          { id: 'merc-7', titulo: 'Estruturando o laudo', duracao: '14 min', gratis: false, descricao: 'Como montar um laudo mercadológico profissional para apresentar a sócios e clientes.' },
          { id: 'merc-8', titulo: 'Usando a IA da TSN', duracao: '14 min', gratis: false, descricao: 'Como usar a função de Avaliação Mercadológica da plataforma para gerar comparativos automáticos.' },
        ],
      },
    ],
  },

  {
    id: 'riscos-juridicos',
    titulo: 'Riscos Jurídicos em Leilões',
    subtitulo: 'Proteja seu investimento',
    descricao: 'Os maiores erros dos arrematantes são jurídicos. Aprenda a ler matrículas, identificar ônus reais, entender usufrutos, penhoras, hipotecas e quando abandonar uma operação.',
    emoji: '⚠️',
    cor: '#dc2626',
    bg: '#fee2e2',
    nivel: 'Intermediário',
    duracao: '1h 55min',
    aulas: 10,
    preco: 147,
    gratuito: false,
    categoria: 'Jurídico',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — Documentação',
        licoes: [
          { id: 'jur-1', titulo: 'Como ler uma matrícula de imóvel', duracao: '18 min', gratis: true, descricao: 'Anatomia completa de uma matrícula: abertura, transferências, ônus, averbações e o que cada campo significa.' },
          { id: 'jur-2', titulo: 'Analisando o edital', duracao: '14 min', gratis: false, descricao: 'Cláusulas-armadilha nos editais, responsabilidade por débitos, condições de pagamento e prazo.' },
          { id: 'jur-3', titulo: 'Certidões necessárias', duracao: '10 min', gratis: false, descricao: 'Quais certidões solicitar antes do leilão: IPTU, condomínio, ações reais, executivos fiscais.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Riscos Bloqueantes',
        licoes: [
          { id: 'jur-4', titulo: 'Usufruto vitalício', duracao: '16 min', gratis: false, descricao: 'O risco mais perigoso: quando o imóvel tem usufruto e você não pode tomar posse. Como identificar e o que fazer.' },
          { id: 'jur-5', titulo: 'Hipoteca e alienação fiduciária', duracao: '12 min', gratis: false, descricao: 'Diferença entre hipoteca e alienação fiduciária, sub-rogação de dívidas e impacto na rentabilidade.' },
          { id: 'jur-6', titulo: 'Bem de família e impenhorabilidade', duracao: '10 min', gratis: false, descricao: 'Quando o imóvel é protegido pela Lei 8.009/90 e como isso pode invalidar o leilão.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Gestão de Riscos',
        licoes: [
          { id: 'jur-7', titulo: 'Riscos de alerta vs bloqueantes', duracao: '12 min', gratis: false, descricao: 'A classificação TSN de riscos: bloqueante (para a operação), alerta (precisa analisar), informativo.' },
          { id: 'jur-8', titulo: 'Débitos assumidos e negociação', duracao: '10 min', gratis: false, descricao: 'IPTU atrasado, condomínio, água, luz: o que vai junto com o imóvel e como negociar abatimento.' },
          { id: 'jur-9', titulo: 'Imissão na posse', duracao: '12 min', gratis: false, descricao: 'Como funciona o processo de imissão, prazo, ocupação pelo antigo dono e ação de despejo.' },
          { id: 'jur-10', titulo: 'Quando desistir de um leilão', duracao: '9 min', gratis: false, descricao: 'Critérios objetivos da TSN para abandonar uma análise. Red flags que eliminam o imóvel.' },
        ],
      },
    ],
  },

  {
    id: 'estrategia-arrematacao',
    titulo: 'Estratégia de Arrematação',
    subtitulo: 'Do lance ao contrato',
    descricao: 'A arte de disputar um leilão: quando entrar, quando parar, como usar o teto de lance como âncora psicológica, estratégias para leilão online e presencial.',
    emoji: '🎯',
    cor: '#d97706',
    bg: '#fef3c7',
    nivel: 'Avançado',
    duracao: '1h 30min',
    aulas: 8,
    preco: 197,
    gratuito: false,
    categoria: 'Estratégia',
    destaque: true,
    modulos: [
      {
        titulo: 'Módulo 1 — Preparação',
        licoes: [
          { id: 'est-1', titulo: 'Checklist pré-leilão', duracao: '14 min', gratis: true, descricao: 'Tudo que você precisa verificar nas 48h antes do leilão: habilitação, documentos, limite de lance e capital.' },
          { id: 'est-2', titulo: 'Leilão online vs presencial', duracao: '12 min', gratis: false, descricao: 'Diferenças práticas, plataformas digitais (Leilão Online, WhatsApp) e como evitar erros técnicos.' },
          { id: 'est-3', titulo: 'Psicologia do leilão', duracao: '10 min', gratis: false, descricao: 'Como evitar o efeito de ancoragem, febre do lance e apego emocional. Seu teto é sagrado.' },
        ],
      },
      {
        titulo: 'Módulo 2 — No Lance',
        licoes: [
          { id: 'est-4', titulo: 'Estratégia de lance agressivo vs conservador', duracao: '14 min', gratis: false, descricao: 'Quando entrar cedo, quando esperar. Lances de abertura, incrementos e jogadas psicológicas.' },
          { id: 'est-5', titulo: 'Competindo em segunda praça', duracao: '12 min', gratis: false, descricao: 'A segunda praça é uma oportunidade extra: como identificar leilões que vão à segunda praça e se preparar.' },
          { id: 'est-6', titulo: 'Quando parar de dar lances', duracao: '8 min', gratis: false, descricao: 'Disciplina de saída: respeitar o teto e entender que perder um leilão pode ser o melhor resultado.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Pós-Arrematação',
        licoes: [
          { id: 'est-7', titulo: 'Auto de arrematação e carta', duracao: '10 min', gratis: false, descricao: 'Documentos recebidos, prazo de pagamento, carta de arrematação e registro no cartório.' },
          { id: 'est-8', titulo: 'Processo de transferência do imóvel', duracao: '10 min', gratis: false, descricao: 'Do pagamento ao registro na matrícula: prazo, cartório, ITBI e quando o imóvel é realmente seu.' },
        ],
      },
    ],
  },

  {
    id: 'gestao-portfolio',
    titulo: 'Gestão de Portfólio Imobiliário',
    subtitulo: 'Escale com consistência',
    descricao: 'Como estruturar e escalar um portfólio de leilões imobiliários: controle financeiro, reforma, venda, locação, holding e quando reinvestir os lucros.',
    emoji: '📈',
    cor: '#7c3aed',
    bg: '#ede9fe',
    nivel: 'Avançado',
    duracao: '2h 00min',
    aulas: 10,
    preco: 247,
    gratuito: false,
    categoria: 'Gestão',
    destaque: false,
    modulos: [
      {
        titulo: 'Módulo 1 — Controle Financeiro',
        licoes: [
          { id: 'gest-1', titulo: 'Lançamentos e DRE do imóvel', duracao: '16 min', gratis: true, descricao: 'Como registrar cada despesa e receita do imóvel para ter a rentabilidade real (não estimada).' },
          { id: 'gest-2', titulo: 'Reforma: planejamento e controle', duracao: '14 min', gratis: false, descricao: 'Orçamento de retrofit, cronograma, fornecedores e como evitar estouros de custo.' },
          { id: 'gest-3', titulo: 'KPIs do portfólio', duracao: '12 min', gratis: false, descricao: 'TIR, VPL, payback, múltiplo do capital — os indicadores que profissionais usam.' },
        ],
      },
      {
        titulo: 'Módulo 2 — Estratégias de Saída',
        licoes: [
          { id: 'gest-4', titulo: 'Vender ou alugar?', duracao: '14 min', gratis: false, descricao: 'Modelo de decisão: quando o yield de locação compensa segurar vs quando vender e reinvestir.' },
          { id: 'gest-5', titulo: 'Precificação para venda rápida', duracao: '12 min', gratis: false, descricao: 'Como precificar para vender em até 90 dias sem queimar margem. Marketing e home staging básico.' },
          { id: 'gest-6', titulo: 'Gestão de locatários', duracao: '10 min', gratis: false, descricao: 'Contrato, garantias (fiança, seguro fiança, depósito), inadimplência e despejo amigável.' },
        ],
      },
      {
        titulo: 'Módulo 3 — Escalando',
        licoes: [
          { id: 'gest-7', titulo: 'Estrutura jurídica: PF vs PJ', duracao: '14 min', gratis: false, descricao: 'Quando criar uma holding, vantagens tributárias, IR sobre ganho de capital e distribuição de lucros.' },
          { id: 'gest-8', titulo: 'Captando sócios e investidores', duracao: '12 min', gratis: false, descricao: 'Como estruturar uma SPE para um imóvel específico, como apresentar a oportunidade e dividir os lucros.' },
          { id: 'gest-9', titulo: 'Alavancagem responsável', duracao: '12 min', gratis: false, descricao: 'Até onde ir com financiamentos: teoria de Modigliani-Miller adaptada para o mercado brasileiro.' },
          { id: 'gest-10', titulo: 'Construindo o pipeline', duracao: '14 min', gratis: false, descricao: 'Como ter sempre 3-5 imóveis em análise simultânea e nunca ficar sem operação para trabalhar.' },
        ],
      },
    ],
  },
];

export const CATEGORIAS = ['Todos', 'Fundamentos', 'Financeiro', 'Mercado', 'Jurídico', 'Estratégia', 'Gestão'];

export const PLANOS_MEMBROS = {
  gratuito: { nome: 'Gratuito', preco: 0, descricao: 'Acesso às aulas gratuitas de cada curso', cor: '#64748b' },
  essencial: { nome: 'Essencial', preco: 97, descricao: 'Acesso a todos os cursos de Fundamentos', cor: '#2563eb' },
  profissional: { nome: 'Profissional', preco: 297, descricao: 'Acesso completo a todos os cursos', cor: '#7c3aed' },
  vitalicio: { nome: 'Vitalício', preco: 997, descricao: 'Todos os cursos + futuros lançamentos para sempre', cor: '#f59e0b' },
};
