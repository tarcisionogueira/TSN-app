// PREÇO E DESCONTO TÊM QUE FALAR DA MESMA PRAÇA (09/09).
//
// `desconto_percentual` NÃO é o desconto da 1ª praça: quando o lote tem 2ª praça, ele é
// calculado contra ela. Em 09/09, 3.461 lotes ativos (13% do acervo) tinham
// `desconto_percentual > 0` com `valor_minimo >= valor_avaliacao` — e em 3.461 de 3.461 o
// percentual batia exatamente com `valor_minimo_2`, que estava abaixo da avaliação em todos.
// O campo mede a 2ª praça; quatro telas o exibiam ao lado do valor da 1ª. É a forma nº 10 do
// CLAUDE.md: o número está certo e é publicado com o nome de outra coisa — e o estrago é pior
// que um vazio, porque sai como texto que o próprio cartão desmente ("Lance R$ 330.000 ·
// Avaliação R$ 308.000 · 40% abaixo da avaliação").
//
// A regra aqui é a mesma que `api/gerar-analise.js` já usa para escolher a praça operativa: o
// MENOR lance entre as praças. O percentual é recalculado a partir dele, então promessa e prova
// saem sempre do mesmo par de números — quem chamar isto não tem como reintroduzir o
// descasamento. Sem avaliação utilizável, `desconto` é 0 e o gancho simplesmente não sai.
export function lanceVitrine(im) {
  const v1 = Number(im?.valor_minimo) || 0;
  const v2 = Number(im?.valor_minimo_2) || 0;
  const aval = Number(im?.valor_avaliacao) || 0;
  const ehSegunda = v2 > 0 && (v1 <= 0 || v2 < v1);
  const valor = ehSegunda ? v2 : v1;
  return {
    valor,
    aval,
    ehSegunda,
    // Avaliação IDÊNTICA ao lance não é avaliação, é eco do próprio lance: publicá-la seria dar
    // ao valor que faltou o nome do valor que se procurava.
    avalUtil: aval > 0 && aval !== valor ? aval : 0,
    desconto: aval > 0 && valor > 0 && valor < aval ? Math.round((1 - valor / aval) * 100) : 0,
    data: ehSegunda ? (im?.data_leilao_2 || null) : (im?.data_leilao || null),
  };
}
