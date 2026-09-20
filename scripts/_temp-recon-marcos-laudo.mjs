/**
 * Descartável — regenera o relatório do galpão do Marcos (Feira de Santana/BA) para validar,
 * contra a PREVIEW do commit c1005ff (branch claude/epic-keller-t8mpce), o fix que: (a) lê o
 * anexo-sobra sem rótulo mesmo com matrícula+edital presentes, (b) extrai endereço/município
 * do laudo, (c) detecta divergência entre laudo e matrícula/card com desempate por geocode.
 * Espera: [laudo-avaliacao] mostrando enderecoLaudo/municipioLaudo preenchidos a partir do
 * 3º anexo (o que não é link_matricula nem link_edital), e — SE o dono estiver certo sobre o
 * caso — um [localizacao-diverge-documentos] no log e a anomalia
 * `localizacao_diverge_entre_documentos` gravada em relatorio_anomalias.
 */
const BASE = (process.env.APP_BASE_URL || 'https://tsn-app-git-claude-epic-kel-cdc7a7-tarcisio-nogueira-s-projects.vercel.app').replace(/\/+$/, '');
const CRON = process.env.CRON_SECRET || '';
if (!CRON) { console.error('❌ CRON_SECRET ausente'); process.exit(1); }

const IMOVEL_ID = 'dfc5ab9b-6c5d-49ba-97ec-57d704bc70ab';
const PARA_USER_ID = '94f63957-9cf6-4ab8-ae32-5767f1fbdf6b';

const body = {
  imovelId: IMOVEL_ID,
  paraUserId: PARA_USER_ID,
  titulo: 'Terreno c/ 6.335,59m² - Galpão em ruína -Feira de Santana/BA',
  cidade: 'Feira De Santana',
  estado: 'BA',
  imovel: {
    id: IMOVEL_ID, tipo: 'comercial', fonte: 'LJUD',
    areaM2: 6335.59, cidade: 'Feira De Santana', estado: 'BA',
    titulo: 'Terreno c/ 6.335,59m² - Galpão em ruína -Feira de Santana/BA',
    endereco: 'Avenida Banco do Nordeste, s/n', bairro: 'Centro Industrial do Subaé',
  },
  mercadoInputs: { areaM2: 6335.59, cidade: 'Feira De Santana', estado: 'BA', endereco: 'Avenida Banco do Nordeste, s/n, Centro Industrial do Subaé, Feira De Santana/BA', tipoImovel: 'comercial', areaTerrenoM2: 6335.59, nomeCondominio: '' },
  parecerInputs: {
    d: {
      id: 'tsn_regen_' + Date.now(), cep: '', nome: 'Terreno c/ 6.335,59m² - Galpão em ruína -Feira de Santana/BA', tipo: 'comercial', areaM2: 6335.59,
      cidade: 'Feira De Santana', estado: 'BA', origem: 'venda_direta', riscos: [], status: 'analise', foreiro: 0, cetAnual: 12,
      endereco: '', laudemio: 0, leiloeiro: '', dataLeilao: '', iptuMensal: 0, prazoMeses: 360,
      lancamentos: [], observacoes: '', valorLocacao: 0, valorMercado: 0, areaTerrenoM2: 6335.59, somenteAVista: false,
      imovelIdAcervo: IMOVEL_ID, itbiPercentual: 5, nomeCondominio: '', objetivoCompra: 'investimento',
      valorAvaliacao: 1076710.3, prazoVendaMeses: 12, sinalPercentual: 5, condominioMensal: 0, debitosAssumidos: 0,
      valorArrematacao: 538355.15, prazoReformaMeses: 3, tabelaAmortizacao: 'sac', manutencaoEstimada: 0, honorariosPercentual: 10,
      despesasAdministrativas: 0, taxaLeiloeiroPercentual: 0, origemCondicoesPagamento: '', taxaAdministrativaPercentual: 0,
    },
    teto: 0, cenario: 'À Vista',
    metricas: {},
  },
};

(async () => {
  console.log(`\n🔁 Regerando ${IMOVEL_ID} (Marcos/Feira de Santana) → ${BASE}/api/gerar-analise\n`);
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
