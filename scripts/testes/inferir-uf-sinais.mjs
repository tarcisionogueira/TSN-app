// inferirUF — sinais de 28/09 (invariante estado_fora_do_padrao: 20 lotes sem UF). Trechos REAIS.
import { inferirUF } from '../lib/inferir-uf.mjs';
let falhas = 0;
const t = (nome, lote, esperado) => {
  const r = inferirUF(lote);
  const ok = esperado === null ? r === null : (r && r.uf === esperado.uf && (esperado.cidade === undefined || r.cidade === esperado.cidade));
  if (!ok) falhas++;
  console.log(`${ok ? '✓' : '✗'} ${nome} → ${JSON.stringify(r)}`);
};
t('spencer: Comarca de Campo Mourão-Pr', { cidade: '', titulo: 'LOTE DE TERRAS Nº 5-R', descricao: 'Comitente: 1ª Vara da Fazenda Pública da Comarca de Campo Mourão-Pr LOTE DE TERRAS' }, { uf: 'PR', cidade: 'Campo Mourão' });
t('sublime: cidade gravada + comarca do Estado de SP', { cidade: 'Santo André', titulo: 'Terreno de 135m² - Santo André', descricao: 'MATRÍCULA Nº 23.103 DO 2º CARTÓRIO DE REGISTRO DE IMÓVEIS DA COMARCA DE SANTO ANDRÉ DO ESTADO DE SÃO PAULO.' }, { uf: 'SP' });
t('vasconcelos: nesta cidade de Joinville', { cidade: '', titulo: 'Terreno central em Joinville', descricao: 'SENDO UM TERRENO SITUADO NESTA CIDADE DE JOINVILLE, FAZENDO FRENTE' }, { uf: 'SC', cidade: 'JOINVILLE' });
t('superbid: CRI de São Paulo', { cidade: '', titulo: 'apto. em Santo Amaro', descricao: 'Matrícula n° 458.216 do 11° CRI de São Paulo. OBS1' }, { uf: 'SP', cidade: 'São Paulo' });
t('processo CNJ sozinho NÃO decide (93% medido)', { cidade: '', titulo: 'Apto. 196m² - Vila Andrade/SP', descricao: 'Apto 1006833-40.2025.8.26.0002 — Apto' }, null);
t('gestao: só CEP 05449-050', { cidade: null, titulo: 'TERRENO', descricao: 'Rua Andrade Fernandes, 120, Vila Madalena, CEP sob nº 05449-050 DEPOSITÁRIO' }, { uf: 'SP' });
t('número sem rótulo CEP não conta', { titulo: 'x', descricao: 'Matrícula 05449-050' }, null);
t('cidade ambígua sem UF (Santo André é SP e PB) fica sem', { titulo: 'x', descricao: 'nesta cidade de Santo André' }, null);
t('CEP de outro estado que a cidade gravada é recusado', { cidade: 'Santo André', titulo: 'x', descricao: 'CEP 88010-000' }, null);
t('CEP confirma a cidade ambígua', { cidade: 'Santo André', titulo: 'x', descricao: 'CEP 09120-000' }, { uf: 'SP' });
t('sem prova (Sitio Cercado)', { cidade: '', titulo: 'Sobrado no Sitio Cercado', descricao: 'Sobrado no Sitio Cercado' }, null);
t('regressão: Campinas-SP no título', { titulo: 'Apto 72m² | Campinas-SP' }, { uf: 'SP' });
t('Foro Regional de Santo Amaro NÃO vira Bahia', { titulo: 'apto', descricao: '4ª Vara Cível do Foro Regional de Santo Amaro' }, null);
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nOK');
