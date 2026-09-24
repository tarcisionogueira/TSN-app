/**
 * npm run testar:resultado-pagina — leitor do resultado na página do lote (api/_resultado-leilao.js).
 * Trechos copiados das páginas REAIS do recon de 24/09 (recon_dump origem 'resultado_pagina').
 */
import { apurarResultadoDoTexto as ler } from '../../api/_resultado-leilao.js';

let falhas = 0;
const ok = (c, m) => { if (c) console.log(`  ✓ ${m}`); else { falhas++; console.log(`  ✗ ${m}`); } };
const ZUK = 'https://www.portalzuk.com.br/imovel/mt/lucas-do-rio-verde/pioneiro/rua-campo-ere-472e/37167-233600';
const FRAZAO = 'https://www.frazaoleiloes.com.br/lote/41412-casa';

console.log('\nZUK');
const zukEncerradoSem = 'Encerra em 18/09/26 às 11h10 Data de encerramento Em 2º leilão pelo valor de R$ 451.200,00. Lance mínimo: 1º Leilão 16/09/26 às 11h10 R$ 752.000,00 2º Leilão 18/09/26 às 11h10 40 R$ 451.200,00 Este leilão já foi encerrado. Consulte o edital e documentos do leilão R$ 0,00 Maior lance até agora por +R$ 5.000,00 Incremento mínimo Leilão Condicional Este imóvel já atingiu o valor mínimo estipulado pelo Vendedor para aprovação da venda. Observações Caberá ao arrematante, providenciar às suas expensas';
ok(ler(zukEncerradoSem, ZUK)?.resultado === 'sem_lance', 'encerrado com R$ 0,00 de maior lance → sem lance');
ok(ler(zukEncerradoSem, '') === null, '(o genérico não reconhecia — era o indeterminado)');
const zukAntes = 'O 1º Leilão ocorrerá às 24/09/26 às 13h00. Em caso de não haver licitantes, no dia 15/10/26 às 13h00 será realizado o 2º leilão deste lote pelo valor de R$ 89.905,26 Participar do leilão Consulte o edital e documentos do leilão R$ 0,00 Maior lance até agora por +R$ 1.000,00 Incremento mínimo OBS: Em caso de arrematação, o Arrematante não responderá sobre Débitos de Condomínio R$ 389.848,44';
ok(ler(zukAntes, ZUK) === null, 'antes do pregão (Prestes Maia): nada — era VENDIDO FALSO');
ok(ler(zukEncerradoSem.replace('R$ 0,00 Maior', 'R$ 480.000,00 Maior'), ZUK)?.valor === 480000, 'encerrado com lance → com lance e o valor');
ok(ler('Filtrar 398 resultados oportunidades encontradas Lance inicial R$ 411.200,00 Leilões Encerrados', ZUK) === null, 'lote retirado (redireciona para a listagem): nada');

console.log('\nFRAZAO (genérico)');
const frazaoSem = 'Sem Licitantes 1º Leilão: 18/09/2026 às 15h00 2º Leilão: 21/09/2026 às 15h00 Maior lance atual: R$ 0,00 Lance inicial: R$ 155.500,00 Leilão Finalizado Prezado usuário, esses lote pertence a um leilão que já foi encerrado.';
ok(ler(frazaoSem, FRAZAO)?.resultado === 'sem_lance', '"Sem Licitantes" → sem lance');

console.log('\nSUPORTE LEILÕES (JELEILOES / KLEILOES)');
const JE = 'https://jeleiloes.com.br/oferta/leilao/imoveis/casas/1771/id-41302/imovel-c-5-155-48m-em-londrina-pr';
const KL = 'https://kleiloes.com.br/oferta/leilao/imoveis/casa/14399/id-57568/imovel-paranavai-pr';
const tabela = (lance, n, st) => `Lance Atual Número de Lances Status Número de visitas 4.1 Casas R$ 12.479.000,00 R$ 9.359.250,00 R$ 0,00 R$ 115.000,00 --> R$ ${lance} ${n} ${st} 10966 Visualizar Edital Visualizar Matrícula`;
const je = (lance, n, st) => `<script>{"statusString":"Encerrado"}</script> Status Encerrado Data 1º Leilão: 23/09/2026 ${tabela(lance, n, st)} Histórico de lances Internauta Data Hora Pagamento Valor do Lance`;
ok(ler(je('0,00', 0, 'Cancelado'), JE)?.resultado === 'cancelado', 'tabela "Cancelado" (decisão do juízo) → cancelado, não "sem lance"');
ok(ler(je('0,00', 0, 'Encerrado'), JE)?.resultado === 'sem_lance', 'encerrado com 0 lances → sem lance');
const venda = ler(je('150.000,00', 3, 'Encerrado'), JE);
ok(venda?.resultado === 'vendido' && venda.valor === 150000, 'encerrado com 3 lances → com lance e o valor');
ok(ler(je('0,00', 0, 'Cancelado'), '')?.resultado === 'cancelado', 'reconhece pela statusString mesmo sem a URL');
const kl = ler('<script>{"statusString":"Aberto para lances"}</script> Título SICREDI DEXIS Data Até 23/10/2099 Bens em venda direta: Interessados contactar o leiloeiro! Status Aberto para Lances', KL);
ok(kl?.aberto && kl.resultado === null && kl.novaData?.data_leilao === '2099-10-23', 'venda direta renovada ("Data Até") → aberto + data nova, sem resultado');
const kl2 = ler('<script>{"statusString":"Aberto para lances"}</script> Data 23/09/2026 10:00 (1º Leilão) Online 07/10/2099 10:00 (2º Leilão) Online', KL);
ok(kl2?.aberto && kl2.novaData?.data_leilao_2 === '2099-10-07T10:00:00-03:00', '2ª praça por vir → aberto + data da 2ª praça');
ok(ler('<script>{"statusString":"Aberto para lances"}</script> sem data nenhuma', KL)?.novaData === null, 'aberto sem data futura → aberto, sem data');

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
