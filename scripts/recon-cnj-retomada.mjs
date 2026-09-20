// _temp: recon descartável — testa buscarProcessosCNJ com bancos reais e checa se dá pra
// extrair placa/RENAVAM do TEXTO dos movimentos (sem ler PDF nenhum). Não grava nada.
import { buscarProcessosCNJ } from '../api/_cnj.js';

const BANCOS = [
  'Banco Bradesco Financiamentos S.A.',
  'Aymoré Crédito, Financiamento e Investimento S.A.',
  'Banco Votorantim S.A.',
  'Omni Banco S.A.',
];

const RE_PLACA_ANTIGA = /\b[A-Z]{3}-?\d{4}\b/g;
const RE_PLACA_MERCOSUL = /\b[A-Z]{3}\d[A-Z]\d{2}\b/g;
const RE_RENAVAM = /RENAVAM[:\s]*n?[ºo°.]?\s*(\d[\d.\s]{9,14}\d)/gi;

function extrairPistas(processo) {
  const texto = [
    processo.classe, processo.assuntos,
    ...(processo.movimentos || []).map(m => m.descricao || ''),
  ].join(' \n ');
  const placas = new Set();
  for (const m of texto.matchAll(RE_PLACA_ANTIGA)) placas.add(m[0]);
  for (const m of texto.matchAll(RE_PLACA_MERCOSUL)) placas.add(m[0]);
  const renavams = new Set();
  for (const m of texto.matchAll(RE_RENAVAM)) renavams.add(m[1].replace(/[.\s]/g, ''));
  return { placas: [...placas], renavams: [...renavams] };
}

let totalProcessos = 0, comAlienacao = 0, comPlacaOuRenavam = 0;
for (const banco of BANCOS) {
  console.log(`\n=== ${banco} ===`);
  const r = await buscarProcessosCNJ({ nome_parte: banco, nacional: true });
  console.log(`total bruto: ${r.total} | erros: ${r.erros?.length || 0} tribunal(is)`);
  totalProcessos += r.total;
  const alienacao = r.processos.filter(p =>
    p.riscos.some(x => x.categoria === 'Alienação Fiduciária') ||
    /aliena[çc][aã]o fiduci[aá]ria|busca e apreens[aã]o/i.test(`${p.classe} ${p.assuntos}`));
  comAlienacao += alienacao.length;
  console.log(`processos de alienação fiduciária/busca e apreensão: ${alienacao.length}`);
  for (const p of alienacao.slice(0, 8)) {
    const pistas = extrairPistas(p);
    const achou = pistas.placas.length || pistas.renavams.length;
    if (achou) comPlacaOuRenavam++;
    console.log(`  - ${p.numero} (${p.tribunal}) exec=${p.partes.filter(x=>/passivo/i.test(x.tipo)).map(x=>x.nome).join(',')||'?'} valor_causa=${p.valor_causa ?? '?'} placas=${JSON.stringify(pistas.placas)} renavams=${JSON.stringify(pistas.renavams)}`);
  }
}
console.log(`\n\nRESUMO: ${totalProcessos} processos brutos | ${comAlienacao} de alienação/busca-e-apreensão | ${comPlacaOuRenavam} com placa/renavam extraível do texto do movimento (amostra checada)`);
