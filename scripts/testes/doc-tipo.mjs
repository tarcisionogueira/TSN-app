// Classificação de documento pelo conteúdo (api/_doc-tipo.js) — textos no formato real.
import assert from 'node:assert/strict';
import { classificarTipoPorTexto as c } from '../../api/_doc-tipo.js';

const pad = ' texto de corpo '.repeat(20);
assert.equal(c('40ª Vara Cível do Foro Central Cível Edital de 1° e 2° leilão de bem imóvel e para intimação de Fulano, objeto da matrícula nº 12.345 do 4º Registro de Imóveis' + pad), 'edital');
assert.equal(c('EDITAL DE LEILÃO PÚBLICO EXTRAJUDICIAL. O leiloeiro oficial torna público… imóvel matriculado sob nº 98.765 no Registro de Imóveis' + pad), 'edital');
assert.equal(c('REPÚBLICA FEDERATIVA DO BRASIL 2º OFICIAL DE REGISTRO DE IMÓVEIS DE SÃO PAULO LIVRO Nº 2 - REGISTRO GERAL MATRÍCULA 45.678 FICHA 01 IMÓVEL: apartamento nº 12… R.1/45.678 - VENDA' + pad), 'matricula');
assert.equal(c('CNM: 123456.2.0045678-90 Matrícula nº 45678 … AV-1-45678 averbação … R-2-45678 alienação fiduciária' + pad), 'matricula');
assert.equal(c('LAUDO DE AVALIAÇÃO do imóvel situado à Rua X, matrícula 1.234' + pad), 'laudo');
assert.equal(c('Termo de Penhora lavrado nos autos' + pad), null);
assert.equal(c('curto'), null);
// Trechos REAIS da amostra de 05/10 (classificar-docs-espelho, run 2):
assert.equal(c('1 Este documento está classificado como: Público ANEXO I DISCRIMINAÇÃO DOS LOTES/VALORES MÍNIMOS LOTE DESCRIÇÃO DO LOTE VALOR MÍNIMO (R$) 1 BAHIA' + pad + ' matrícula 1.234 R.1/1.234 AV.2/1.234'), null);
assert.equal(c('AUTO DE AVALIAÇÃO DE IMÓVEL RURAL Aos 19 dias do mês de março do ano de 2026, nesta Comarca de Campina Grande do Sul/PR, imóvel da matrícula nº 12.345 do Registro de Imóveis' + pad), 'laudo');
assert.equal(c('Alameda Santos, 787 – CJ. 132 – (11) 3149-4600 | www.megaleiloes.com.br 1 – Identificação do Proponente edital leiloeiro' + pad), null);
assert.equal(c('Documento assinado no Assinador Registro de Imóveis. Para validar o documento e suas assinaturas acesse https://assinador.registrodeimoveis.org.br/validate/TA3G'), 'matricula');
assert.equal(c('Visualização disponibilizada pelo RI Digital (ridigital.org.br)-Visualizado em:02/09/2026 10:54:41 -- 1 of 6 --'), 'matricula');
assert.equal(c('CERTIDÃO Nº 26/012293 - PROTOCOLO 597789 Katia Marins 2º OFICIO DO REGISTRO DE IMÓVEIS DA CIDADE DO RIO DE JANEIRO Av. Nilo Peçanha'), 'matricula');
assert.equal(c('REPÚBLICA FEDERATIVA DO BRASIL ESTADO DE MINAS GERAIS SERVIÇO REGISTRAL IMOBILIÁRIO DA COMARCA DE TRÊS PONTAS - MG'), 'matricula');
assert.equal(c('PODER JUDICIÁRIO 1ª VARA CÍVEL DA COMARCA DE CACHOEIRINHA ESTADO DO RIO GRANDE DO SUL EDITAL DE LEILÃO E INTIMAÇÃO Pelo presente, se faz saber' + pad), 'edital');
assert.equal(c('CONTRATO DE ADESÃO DIGITAL Em vigor / última atualização: 28/01/2026 VEGAS LEILÕES' + pad), null);
assert.equal(c('TRIBUNAL REGIONAL DO TRABALHO DA 13ª REGIÃO CENTRAL REGIONAL DE EFETIVIDADE ATOrd 0000236-94.2020.5.13.0023 AUTOR: MARCOS RÉU: QUEIROZ oficie-se ao Registro de Imóveis' + pad), null);
assert.equal(c('Valide a certidão clicando no link a seguir: https://assinador-web.onr.org.br/docs/KA9VS-F45ZM Valide aqui a certidão.'), 'matricula');
console.log('✓ doc-tipo: 18 casos');
