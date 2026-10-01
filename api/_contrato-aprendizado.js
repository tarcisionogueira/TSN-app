// Utilitários do APRENDIZADO do gerador de contratos (gerar-contrato.js grava,
// gerar-contrato-ia.js injeta). Arquivo com "_" = módulo, não rota.

// DADO PESSOAL NÃO VIRA LIÇÃO (01/10). A correção "preenchi o fiador à mão" era gravada com
// o NOME e o CPF do fiador em `texto_final` e injetada como "aplique estas lições" em todos os
// contratos seguintes do mesmo tipo — um CPF de outra pessoa à disposição do modelo exatamente
// quando ele não conseguiu ler o do fiador atual. Lição boa é o PADRÃO ("transcreva o fiador da
// CNH anexada"), nunca o valor. Este filtro é a rede: tira os identificadores que dá para
// reconhecer por forma (CPF, CNPJ, RG/CNH/matrícula/inscrição — qualquer número longo —,
// e-mail, telefone, CEP). Nome de pessoa não tem forma; quem cuida dele é o prompt do extrator.
export function semDadosPessoais(s) {
  return String(s || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, '[CNPJ]')
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '[CPF]')
    .replace(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, '[telefone]')
    .replace(/\d{5}-\d{3}|\d{2}\.\d{3}-\d{3}/g, '[CEP]')
    // qualquer sequência com 6+ dígitos (aceitando . / - entre eles): RG, nº da CNH, matrícula,
    // inscrição imobiliária, conta bancária. Data (dd/mm/aaaa) fica — é prazo, não pessoa.
    .replace(/\d[\d./-]{4,}\d/g, (m) => (/^\d{2}\/\d{2}\/\d{4}$/.test(m) || m.replace(/\D/g, '').length < 6 ? m : '[número]'));
}

// TRECHOS QUE MUDARAM entre a minuta da IA e o texto enviado (01/10). O extrator recebia os
// dois textos cortados em 12.000 caracteres cada — e um contrato de locação comercial tem
// 40-75 mil: qualquer correção depois do primeiro sexto (o bloco de assinaturas do fiador, a
// cláusula de garantia, o reajuste) era INVISÍVEL para o aprendizado, que respondia "nenhuma
// correção" com cara de verdade. Agora vai só o que mudou, com uma linha de contexto, por
// diff de linhas (LCS). Contratos muito grandes caem num diff mais grosso (prefixo/sufixo
// comuns), que ainda mostra TODA mudança — só com mais contexto.
export function trechosAlterados(antes, depois, { maxChars = 20000, contexto = 1 } = {}) {
  const a = String(antes || '').split('\n');
  const b = String(depois || '').split('\n');
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fa = a.length - 1, fb = b.length - 1;
  while (fa >= ini && fb >= ini && a[fa] === b[fb]) { fa--; fb--; }
  if (ini > fa && ini > fb) return '';
  // devolve `contexto` linhas iguais de cada ponta, para o trecho não começar "no ar"
  const volta = Math.min(contexto, ini);
  ini -= volta;
  const avanca = Math.min(contexto, a.length - 1 - fa, b.length - 1 - fb);
  fa += avanca; fb += avanca;
  const ma = a.slice(ini, fa + 1), mb = b.slice(ini, fb + 1);

  // ops: [tipo, linha] com tipo ' ' (igual), '-' (só na minuta), '+' (só no enviado)
  let ops;
  if (ma.length * mb.length <= 4_000_000) {
    const n = ma.length, m = mb.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i][j] = ma[i] === mb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) { ops.push([' ', ma[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', ma[i++]]);
      else ops.push(['+', mb[j++]]);
    }
    while (i < n) ops.push(['-', ma[i++]]);
    while (j < m) ops.push(['+', mb[j++]]);
  } else {
    ops = [...ma.map((l) => ['-', l]), ...mb.map((l) => ['+', l])];
  }

  // Agrupa em blocos com `contexto` linhas iguais em volta.
  const manter = new Array(ops.length).fill(false);
  ops.forEach(([t], k) => {
    if (t === ' ') return;
    for (let d = -contexto; d <= contexto; d++) if (ops[k + d]) manter[k + d] = true;
  });
  const saida = [];
  let anteriorMantido = true;
  ops.forEach(([t, l], k) => {
    if (!manter[k]) { anteriorMantido = false; return; }
    if (!anteriorMantido && saida.length) saida.push('…');
    if (l.trim() || t !== ' ') saida.push(`${t === ' ' ? '  ' : t === '-' ? 'MINUTA DA IA: ' : 'ENVIADO:      '}${l}`);
    anteriorMantido = true;
  });
  const texto = saida.join('\n');
  return texto.length > maxChars ? `${texto.slice(0, maxChars)}\n[… mais alterações omitidas por tamanho]` : texto;
}
