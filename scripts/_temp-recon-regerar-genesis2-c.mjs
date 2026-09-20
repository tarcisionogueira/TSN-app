/**
 * Descartável — regera de novo o relatório do terreno "Gênesis II", desta vez com o
 * objeto `imovel` COMPLETO (mesma forma que ImovelDetalhe.jsx monta a partir do acervo,
 * incluindo valorMinimo/valorAvaliacao/dataLeilao/nomeCondominio já corrigido). A
 * regeneração anterior usou um payload sintético mínimo (só id/tipo/cidade/endereco),
 * sem valorMinimo — e como MinhasAnalises.jsx repassa exatamente o que está salvo em
 * `analises_mercado.imovel` via location.state, o card "Lance mínimo (praça atual)" da
 * tela nunca buscava a versão fresca do banco (o efeito de recuperação só dispara quando
 * o objeto do state NÃO tem cidade/endereço) — ficou "—" mesmo com valor_minimo=1.480.000
 * no acervo. Não é bug de produto: é a regeneração anterior que persistiu um snapshot
 * incompleto. Aqui replico fielmente o mapeamento de ImovelDetalhe.jsx (linhas 882-915) e
 * a semeadura de Analise.jsx (sementeDoImovel + montarMercadoInputs).
 */
const BASE = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace(/\/+$/, '');
const CRON = process.env.CRON_SECRET || '';
if (!CRON) { console.error('❌ CRON_SECRET ausente'); process.exit(1); }

const IMOVEL_ID = 'c157f052-4bfa-46a2-ad55-50484e39b1d4';
const PARA_USER_ID = '92c713f3-1f1a-4758-bab2-32e6c83da433';

// Espelha exatamente ImovelDetalhe.jsx (setImovel, linhas 882-915), lido do acervo em 20/09.
const imovel = {
  id: IMOVEL_ID, titulo: 'Terreno de 490m² no Res. e Comercial Gênisis II em Barueri/SP', tipo: 'terreno', modalidade: 'venda_direta',
  estado: 'SP', cidade: 'Santana de Parnaíba', bairro: null, endereco: 'Alameda lberica',
  valorAvaliacao: 1650000, valorMinimo: 1480000,
  descontoPercentual: 10, areaM2: 490, descricao: 'Cidade: São Paulo/SP Endereço: Lote Genesis 2, Quadra 16, Lote 09, Alameda Guaraunas, Barueri/SP Matrícula: Matrícula nº 127.451 do CRI de Barueri/SP Descrição: “TERRENO URBANO, situado ria Alameda das Guaraunas, constituído pelo lote residencial nº 09 da quadra nº 16, do loteamento denominado “RESIDENCIAL E COMERCIAL GÊNESIS II”, no distrito e Município de Santana de Parnaíba, Comarca de Barueri, deste Estado, que assim se descreve: mede 14,00m de frente para a Alameda das Guaraunas; na lateral direita, de quem da Alameda olha para o lote, mede 35,00m confrontando com o Late 10; na lateral esquerda mede 35,00m confrontando com a Lote 8; nos fundos mede 14,00m confrontando com o Lote 30, encerrando uma área de 490,00m²” Identificação do imóvel: Matrícula nº 127.451 do CRI de Barueri/SP',
  urlLote: 'https://www.apiceleiloes.com.br/item/16880/detalhes',
  linkEdital: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/edital-do-leilao-6a709d4aee069.pdf',
  linkMatricula: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/matricula-do-imovel-6a709d816f5e8.pdf',
  linkRegrasVenda: null,
  foto: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/img-5103-6a709be66989e.jpg',
  fotos: null,
  leiloeiro: 'Fábio Prando Fagundes Góes', dataLeilao: null,
  valorMinimo2: null, dataLeilao2: null,
  dataFim: null, praca1Fim: null, praca2Fim: null,
  pagamento: ['a_vista'], fonte: 'APICE', fonteId: 'apice_16880',
  numeroEdital: null, numeroMatricula: '127.451', numeroProcesso: null,
  anexos: [
    { url: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/edital-do-leilao-6a709d4aee069.pdf', nome: 'Edital do leilão', tipo: 'edital' },
    { url: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/anexo-1-6a709d51b03b8.pdf', nome: 'Anexo 1', tipo: 'outro' },
    { url: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/laudo-de-avaliacao-6a709d721e27f.pdf', nome: 'Laudo de avaliação', tipo: 'laudo' },
    { url: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/matricula-do-imovel-6a709d816f5e8.pdf', nome: 'Matrícula do imóvel', tipo: 'matricula' },
  ],
  enriquecidoEm: null,
  latitude: -23.4706926, longitude: -46.8491353, pontosProximos: null, geocodNivel: 'rua',
  scoreFinanceiro: 100, scoreJuridico: null, scoreLocalizacao: null,
  valorMercado: null, analiseViavel: null,
  fichaCef: { comarca: 'Barueri', matricula: '127.451' }, fichaJuridica: null, ocupacao: null,
  nomeCondominio: 'RESIDENCIAL E COMERCIAL GÊNESIS II',
  docFatos: { em: '2026-09-20T17:13:10.230Z', matricula: { areaTerrenoM2: 490, numeroMatricula: '127451' }, fonteMatricula: 'https://e5463ea145ca8f12.cdn.gocache.net/bens/0000005103/matricula-do-imovel-6a709d816f5e8.pdf' },
  docFatosEm: '2026-09-20T17:13:10.299605+00:00',
};

// sementeDoImovel: pracaAlvo (única praça, sem 2ª) → valorArrematacao = valorMinimo.
const d = {
  id: 'tsn_regen_' + Date.now(), cep: '', nome: imovel.titulo, tipo: imovel.tipo, areaM2: imovel.areaM2,
  cidade: imovel.cidade, estado: imovel.estado, origem: imovel.modalidade, riscos: [], status: 'analise', foreiro: 0, cetAnual: 12,
  endereco: imovel.endereco, laudemio: 0, leiloeiro: imovel.leiloeiro, dataLeilao: '', iptuMensal: 0, prazoMeses: 360,
  lancamentos: [], observacoes: '', valorLocacao: 0, valorMercado: 0, areaTerrenoM2: imovel.areaM2, somenteAVista: true,
  imovelIdAcervo: IMOVEL_ID, itbiPercentual: 5, nomeCondominio: '', objetivoCompra: 'investimento',
  valorAvaliacao: imovel.valorAvaliacao, prazoVendaMeses: 12, sinalPercentual: 5, condominioMensal: 0, debitosAssumidos: 0,
  valorArrematacao: imovel.valorMinimo, prazoReformaMeses: 3, tabelaAmortizacao: 'sac', manutencaoEstimada: 0, honorariosPercentual: 10,
  despesasAdministrativas: 0, taxaLeiloeiroPercentual: 0, origemCondicoesPagamento: '', taxaAdministrativaPercentual: 0,
};

const body = {
  imovelId: IMOVEL_ID,
  paraUserId: PARA_USER_ID,
  titulo: d.nome,
  cidade: d.cidade,
  estado: d.estado,
  imovel,
  mercadoInputs: { endereco: d.endereco || d.cidade, tipoImovel: d.tipo, areaM2: d.areaM2, areaTerrenoM2: d.areaTerrenoM2 || 0, cidade: d.cidade, estado: d.estado, nomeCondominio: d.nomeCondominio || '' },
  parecerInputs: { d, teto: 0, cenario: 'À Vista', metricas: {} },
};

(async () => {
  console.log(`\n🔁 Regerando ${IMOVEL_ID} (Gênesis II, payload completo) → ${BASE}/api/gerar-analise\n`);
  const t0 = Date.now();
  const resp = await fetch(`${BASE}/api/gerar-analise`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': CRON },
    body: JSON.stringify(body),
  });
  const txt = await resp.text();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (!resp.ok) { console.log(`✗ HTTP ${resp.status} (${secs}s)\n${txt.slice(0, 2000)}`); process.exit(1); }
  console.log(`✓ HTTP ${resp.status} (${secs}s) — regenerado.`);
})();
