// Datas do cabeçalho de evento do back-office da Gestão de Leilões (scraper-gestao.mjs). Puro, testado em
// scripts/testes/gestao-encerramento.mjs. "Encerramento 04/Nov/2026" (cluster) e "Encerramento: 11/Dez/2026"
// (Vinco, com dois-pontos — sem o `:?` a abertura virava a data do leilão e o lote saía como vencido; 17/11).
export const RE_ENCERRAMENTO = /Encerramento:?\s*(\d{1,2}\/[A-Za-zç]{3}\/\d{4})/i;
