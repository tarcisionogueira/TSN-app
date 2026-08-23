#!/usr/bin/env node
/**
 * Teste de regressão do `extrairDatasLeilao` — casos REAIS (23/08/2026).
 *
 * Cada caso é texto colhido da página de um leiloeiro pelo
 * `diagnostico-datas-fontes.mjs`, não exemplo inventado: o defeito que motivou
 * cada um foi medido em produção. Rodar: `node scripts/teste-extrair-datas.mjs`
 * (sai 1 se algo quebrar). Barato e sem rede — dá para rodar antes de qualquer
 * mexida nas âncoras de contexto, que é onde o extrator é frágil.
 */
import { extrairDatasLeilao } from '../api/enriquecer-lote.js';

// O espaçamento IMPORTA: a classificação lê os 90 caracteres antes da data, então
// texto colado muda o resultado. Os casos abaixo preservam a distância da página real.
const ENCHIMENTO = ' '.padEnd(150, 'x') + ' Descricao do imovel casa terrea dois dormitorios sala cozinha banheiro area de servico quintal ';

const CASOS = [
  {
    nome: 'SUPORTE/Valero — "Abertura … Fechamento" nas duas praças',
    // Antes de 23/08 a janela de 90 chars pegava o "Abertura" da frase e TODAS as datas
    // caíam no balde de início: o prazo para dar lance saía nulo.
    txt: 'TE C/ VISTA PARA O MAR – ILHABELA/SP 1ª Leilão Abertura 06/10/2026 14:30 Fechamento 09/10/2026 14:30 2ª Leilão Abertura 09/10/2026 14:31 Fechamento 29/10/2026 14:30',
    espera: { inicio: '2026-10-06', fim: '2026-10-29' },
  },
  {
    nome: 'SUPORTE/Sued Peter — praça única com Fechamento',
    txt: '6 2 lotes Juizados E. Cíveis de Vitória Leilão Abertura 02/09/2026 13:00 Fechamento 28/09/2026 13:00',
    espera: { inicio: '2026-09-02', fim: '2026-09-28' },
  },
  {
    nome: 'WEBLEILOES — contador "Encerra em" no mesmo dia da 1ª praça não pode apagar a 2ª',
    txt: `siga no Instagram Relação completa do leilão Encerra em 31/08/2026 às 02h00 ${ENCHIMENTO} Lance mínimo: 1º Leilão R$ 617.646,20 31/08/2026 às 14h00 2º Leilão R$ 432.352,34 23/09/2026 às 14h00`,
    espera: { inicio: '2026-08-31', fim: '2026-09-23' },
  },
  {
    nome: 'WEBLEILOES com texto APERTADO — par invertido tem que sair ordenado',
    // Mesma página sem o corpo no meio: a janela alcança o "Encerra" da data vizinha e a
    // classificação inverte. A guarda de coerência ordena em vez de publicar
    // "leilão 23/09, prazo 31/08".
    txt: 'siga no Instagram Relação completa do leilão Encerra em 31/08/2026 às 02h00 blabla Lance mínimo: 1º Leilão R$ 617.646,20 31/08/2026 às 14h00 2º Leilão R$ 432.352,34 23/09/2026 às 14h00',
    espera: { inicio: '2026-08-31', fim: '2026-09-23' },
  },
  {
    nome: 'BIASI — data única rotulada "Data:" (sem prazo publicado)',
    txt: ', São Gonçalo/RJ Fotos Mapa Street View Data: 26/08/2026',
    espera: { inicio: '2026-08-26', fim: null },
  },
];

// Este caso depende de "hoje": as duas praças precisam estar no PASSADO para o leilão
// ser dado como encerrado. Datas fixas venceriam o teste com o tempo, então derivamos.
function casoEncerrado() {
  const d = (dias) => {
    const x = new Date(Date.now() - dias * 86400000);
    return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
  };
  const p2 = d(3);
  return {
    nome: 'SUPORTE/Gustavo Reis — duas praças já vencidas viram encerradaEm',
    txt: `566 Visitas 0 Lances 1º Leilão Data do Leilão: ${d(10)} - 14:00 Valor Inicial R$ 488.000,00 2º Leilão Data do Leilão: ${p2} - 14:00`,
    espera: { inicio: null, fim: null, encerradaEm: p2.split('/').reverse().join('-') },
  };
}

let falhas = 0;
for (const c of [...CASOS, casoEncerrado()]) {
  const r = extrairDatasLeilao(c.txt);
  const fim = r.fim ? r.fim.slice(0, 10) : null;
  const ok = r.inicio === c.espera.inicio
    && fim === (c.espera.fim ?? null)
    && (c.espera.encerradaEm === undefined || r.encerradaEm === c.espera.encerradaEm);
  if (!ok) falhas++;
  console.log(`${ok ? '✓' : '✗'} ${c.nome}`);
  if (!ok) console.log(`    obtido: inicio=${r.inicio} fim=${fim} encerrada=${r.encerradaEm}\n    espera: inicio=${c.espera.inicio} fim=${c.espera.fim ?? null}${c.espera.encerradaEm ? ` encerrada=${c.espera.encerradaEm}` : ''}`);
}
console.log(falhas ? `\n${falhas} FALHA(S)` : `\n${CASOS.length + 1} casos, todos passaram`);
process.exit(falhas ? 1 : 0);
