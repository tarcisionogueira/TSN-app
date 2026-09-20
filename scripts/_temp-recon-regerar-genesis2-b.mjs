/**
 * Descartável — regera de novo o relatório do terreno "Gênesis II" (Santana de
 * Parnaíba/SP), a pedido do dono após o deploy da detecção de divergência de
 * localização entre documentos (commits 64341b7/c1005ff). Mesmo payload já
 * validado em 20/09 (commit 3eddc53), agora contra PRODUÇÃO.
 */
const BASE = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace(/\/+$/, '');
const CRON = process.env.CRON_SECRET || '';
if (!CRON) { console.error('❌ CRON_SECRET ausente'); process.exit(1); }

const IMOVEL_ID = 'c157f052-4bfa-46a2-ad55-50484e39b1d4';
const PARA_USER_ID = '92c713f3-1f1a-4758-bab2-32e6c83da433';

const body = {
  imovelId: IMOVEL_ID,
  paraUserId: PARA_USER_ID,
  titulo: 'Terreno de 490m² no Res. e Comercial Gênisis II em Barueri/SP',
  cidade: 'São Paulo',
  estado: 'SP',
  imovel: {
    id: IMOVEL_ID, tipo: 'terreno', fonte: 'APICE',
    areaM2: 490, cidade: 'São Paulo', estado: 'SP',
    titulo: 'Terreno de 490m² no Res. e Comercial Gênisis II em Barueri/SP',
    endereco: 'Alameda lberica',
  },
  mercadoInputs: { areaM2: 490, cidade: 'São Paulo', estado: 'SP', endereco: 'Alameda lberica, São Paulo/SP', tipoImovel: 'terreno', areaTerrenoM2: 490, nomeCondominio: '' },
  parecerInputs: {
    d: {
      id: 'tsn_regen_' + Date.now(), cep: '', nome: 'Terreno de 490m² no Res. e Comercial Gênisis II em Barueri/SP', tipo: 'terreno', areaM2: 490,
      cidade: 'São Paulo', estado: 'SP', origem: 'venda_direta', riscos: [], status: 'analise', foreiro: 0, cetAnual: 12,
      endereco: '', laudemio: 0, leiloeiro: '', dataLeilao: '', iptuMensal: 0, prazoMeses: 360,
      lancamentos: [], observacoes: '', valorLocacao: 0, valorMercado: 0, areaTerrenoM2: 490, somenteAVista: false,
      imovelIdAcervo: IMOVEL_ID, itbiPercentual: 5, nomeCondominio: '', objetivoCompra: 'investimento',
      valorAvaliacao: 0, prazoVendaMeses: 12, sinalPercentual: 5, condominioMensal: 0, debitosAssumidos: 0,
      valorArrematacao: 0, prazoReformaMeses: 3, tabelaAmortizacao: 'sac', manutencaoEstimada: 0, honorariosPercentual: 10,
      despesasAdministrativas: 0, taxaLeiloeiroPercentual: 0, origemCondicoesPagamento: '', taxaAdministrativaPercentual: 0,
    },
    teto: 0, cenario: 'À Vista',
    metricas: {},
  },
};

(async () => {
  console.log(`\n🔁 Regerando ${IMOVEL_ID} (Gênesis II) → ${BASE}/api/gerar-analise\n`);
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
