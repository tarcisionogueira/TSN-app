// #44 (05/10): MEGA — trecho REAL. Gravávamos "vendido R$ 25.000" (o débito de IPTU da cláusula
// "pagos pelo arrematante"); a página diz 1 lance de R$ 167.000,00.
import assert from 'node:assert/strict';
import { apurarResultadoDoTexto } from '../../api/_resultado-leilao.js';
const U = 'https://www.megaleiloes.com.br/imoveis/apartamentos/pr/curitiba/apartamento-51-m2-x129097';
const base = (lances) => `Entrar ou Criar conta Leilão encerrado R$ 167.000,00 Extrajudicial Leilão ML34739 Código Lote X129097 Número Lote Lote 14 Lotes neste leilão 26 --> Visitas 6.593 Habilitados 209 Lances ${lances} Mega Leilões Imóveis (iii) Débitos de IPTU e condomínio de aprox. R$ 25.000,00 , deverão ser apurados e pagos pelo arrematante, sem direito a reembolso. O bem será vendido no estado em que se encontra. Arrematados por valor superior a R$ 100.000,00: Sinal de 30%`;
assert.deepEqual(apurarResultadoDoTexto(base(1), U), { resultado: 'vendido', valor: 167000 });
assert.deepEqual(apurarResultadoDoTexto(base(0), U), { resultado: 'sem_lance', valor: null });
// O genérico (outra fonte, mesmo texto de cláusula) não pode mais tirar "vendido R$ 25.000" daí.
const clausula = 'Débitos de IPTU e condomínio de aprox. R$ 25.000,00 , deverão ser apurados e pagos pelo arrematante, sem direito a reembolso. O bem será vendido no estado em que se encontra, R$ 300.000,00.';
assert.equal(apurarResultadoDoTexto(clausula, 'https://exemplo.com.br/lote/1'), null);
assert.deepEqual(apurarResultadoDoTexto('Lote encerrado. Arrematado por R$ 199.680,00 em 24/09.', 'https://exemplo.com.br/lote/2'), { resultado: 'vendido', valor: 199680 });
console.log('ok — mega: lance do cabeçalho; cláusula de débito não vira venda');
