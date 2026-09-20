/**
 * Descartável — regera de novo o relatório do apartamento da Vila Mariana/SP, a
 * pedido do dono após o deploy da detecção de divergência de localização entre
 * documentos (commits 64341b7/c1005ff). Mesmo payload já validado em 20/09
 * (commit 738e5ef), agora contra PRODUÇÃO.
 */
const BASE = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace(/\/+$/, '');
const CRON = process.env.CRON_SECRET || '';
if (!CRON) { console.error('❌ CRON_SECRET ausente'); process.exit(1); }

const IMOVEL_ID = '104c6b3a-4354-4f25-bfee-d17fdba6f92b';
const PARA_USER_ID = '92c713f3-1f1a-4758-bab2-32e6c83da433';

const body = {
  imovelId: IMOVEL_ID,
  paraUserId: PARA_USER_ID,
  titulo: 'Apartamento de 33m² na Vila Mariana/SP',
  cidade: 'São Paulo',
  estado: 'SP',
  imovel: {
    id: '104c6b3a-4354-4f25-bfee-d17fdba6f92b', foto: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005136/img-5136-6a7a3eb687740.jpg',
    tipo: 'apartamento', fonte: 'APICE', fotos: null,
    anexos: [{ url: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005136/laudo-de-avaliacao-6a7a3f16e437b.pdf', nome: 'Laudo de avaliação', tipo: 'laudo' }],
    areaM2: 33, bairro: null, cidade: 'São Paulo', estado: 'SP', titulo: 'Apartamento de 33m² na Vila Mariana/SP',
    dataFim: null, fonteId: 'apice_16950', urlLote: 'https://www.apiceleiloes.com.br/item/16950/detalhes',
    docFatos: { em: '2026-09-06T11:20:53.475Z', matricula: { areaPrivativaM2: 33.2, numeroMatricula: '135026' }, identidade: { logradouro: 'Rua Domingos de Morais', nomeCondominio: 'Condomínio Residencial R2V' } },
    endereco: null, fichaCef: null, latitude: -23.6061166, ocupacao: null,
    descricao: 'Leilão: 30/09/2026 às 14:00, Apartamento Pronto para Morar na Vila Mariana/SP!!\r\n\r\nDesfrute do conforto e praticidade neste lindo...',
    leiloeiro: 'Fábio Prando Fagundes Góes', longitude: -46.7023399, pagamento: ['a_vista'], praca1Fim: null, praca2Fim: null,
    dataLeilao: null, docFatosEm: '2026-09-06T11:20:53.57794+00:00', linkEdital: 'https://www.apiceleiloes.com.br/item/16950/detalhes',
    modalidade: 'venda_direta', dataLeilao2: null, geocodNivel: 'endereco', valorMinimo: 420000, numeroEdital: null,
    valorMercado: null, valorMinimo2: null, analiseViavel: null, enriquecidoEm: '2026-09-20T12:45:16.407Z', fichaJuridica: null,
    linkMatricula: null, scoreJuridico: null, nomeCondominio: 'Condomínio Residencial R2V', numeroProcesso: null,
    pontosProximos: { saude: { lat: -23.6099301, lng: -46.7055713, nome: 'UBS Real Parque', dist_m: 537 }, escola: { lat: -23.6052222, lng: -46.7002543, nome: 'Avenues World School', dist_m: 235 }, mercado: { lat: -23.609468, lng: -46.7067299, nome: 'Dia', dist_m: 582 }, farmacia: { lat: -23.6077647, lng: -46.7059665, nome: 'Droga Express', dist_m: 412 }, shopping: { lat: -23.60902, lng: -46.6966216, nome: 'Shopping D&D', dist_m: 666 }, transporte: { lat: -23.606656, lng: -46.7035528, nome: 'Rua Barão De Castro Lima, 170', dist_m: 137 } },
    valorAvaliacao: 680000, linkRegrasVenda: null, numeroMatricula: null, scoreFinanceiro: 78, scoreLocalizacao: null, descontoPercentual: 38,
  },
  mercadoInputs: { areaM2: 33, cidade: 'São Paulo', estado: 'SP', endereco: 'Rua Domingos de Morais, 1.832, Vila Mariana, São Paulo/SP', tipoImovel: 'apartamento', areaTerrenoM2: 0, nomeCondominio: 'Condomínio Residencial R2V' },
  parecerInputs: {
    d: {
      id: 'tsn_regen_' + Date.now(), cep: '', nome: 'Apartamento de 33m² na Vila Mariana/SP', tipo: 'apartamento', areaM2: 33,
      cidade: 'São Paulo', estado: 'SP', origem: 'venda_direta', riscos: [], status: 'analise', foreiro: 0, cetAnual: 12,
      endereco: '', laudemio: 0, leiloeiro: 'Fábio Prando Fagundes Góes', dataLeilao: '', iptuMensal: 0, prazoMeses: 360,
      lancamentos: [], observacoes: '', valorLocacao: 0, valorMercado: 0, areaTerrenoM2: 0, somenteAVista: true,
      imovelIdAcervo: '104c6b3a-4354-4f25-bfee-d17fdba6f92b', itbiPercentual: 5, nomeCondominio: '', objetivoCompra: 'investimento',
      valorAvaliacao: 680000, prazoVendaMeses: 12, sinalPercentual: 5, condominioMensal: 0, debitosAssumidos: 0,
      valorArrematacao: 420000, prazoReformaMeses: 3, tabelaAmortizacao: 'sac', manutencaoEstimada: 0, honorariosPercentual: 10,
      despesasAdministrativas: 0, taxaLeiloeiroPercentual: 0, origemCondicoesPagamento: '', taxaAdministrativaPercentual: 0,
    },
    teto: 0, cenario: 'À Vista',
    metricas: { ir: 0, roi: -100, lucro: -483000, debitos: 0, foreiro: 0, comissao: 0, laudemio: 0, valorRef: 0, vArremate: 420000, custoVenda: 0, honorarios: 42000, manutencao: 0, valorSinal: 420000, yieldAnual: 0, custosExtra: 63000, despesasAdm: 0, yieldMensal: 0, itbiRegistro: 21000, parcelaMedia: 0, saldoDevedor: 0, aluguelMensal: 0, carregoMensal: 0, custoCarrrego: 0, parcelasPagas: 0, taxaLeiloeiro: 0, receitaLiquida: 0, mesesCarregados: 12, capitalMobilizado: 483000, desembolsoInicial: 483000, taxaAdministrativa: 0 },
  },
};

(async () => {
  console.log(`\n🔁 Regerando ${IMOVEL_ID} → ${BASE}/api/gerar-analise\n`);
  const t0 = Date.now();
  const resp = await fetch(`${BASE}/api/gerar-analise`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': CRON },
    body: JSON.stringify(body),
  });
  const txt = await resp.text();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  let j = null; try { j = JSON.parse(txt); } catch { /* html/erro */ }
  if (!resp.ok) { console.log(`✗ HTTP ${resp.status} (${secs}s)\n${txt.slice(0, 2000)}`); process.exit(1); }
  console.log(`✓ HTTP ${resp.status} (${secs}s) — regenerado.`);
})();
