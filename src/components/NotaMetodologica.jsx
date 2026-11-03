/**
 * NOTA METODOLÓGICA — o "rodapé em letras pequenas" (pedido do dono, 06/08).
 *
 * "Assim como funciona em apresentações fazendo o referenciamento: ter as letras pequenas no
 *  rodapé dizendo a metodologia de pesquisa e de análise realizada, para resguardo das
 *  informações em cima de um parecer. Isso vale para todos os relatórios e índices."
 *
 * A regra que faz este rodapé valer alguma coisa: ele é MONTADO DOS FATOS DAQUELA GERAÇÃO,
 * não é texto fixo. Se os comparáveis vieram da base própria, o rodapé diz isso e diz o
 * período; se vieram de pesquisa, diz a data da pesquisa; se a área usada foi a da matrícula,
 * diz que prevaleceu sobre o anúncio. Um rodapé padrão que repete a mesma frase em todo
 * relatório não resguarda nada — resguarda o rodapé que BATE com o relatório acima dele.
 *
 * Usado na tela e no PDF dos três relatórios e do Índice, com o mesmo texto, para o cliente
 * ler a mesma metodologia onde quer que veja o número.
 */
import React from 'react';
import { frasesMercadologico, frasesDocumental, frasesLaudo, frasesIndice, fraseCondicoesPagamento, RESSALVA } from '../lib/nota-metodologica.js';
export { frasesMercadologico, frasesDocumental, frasesLaudo, frasesIndice, fraseCondicoesPagamento, notaMetodologicaTexto } from '../lib/nota-metodologica.js';

export default function NotaMetodologica({ tipo, dados, extra, compacto = false, condicoesPagamento = null }) {
  let frases = [];
  try {
    if (tipo === 'mercadologico') frases = frasesMercadologico(dados?.mercado || dados, dados?.divergenciaArea || extra, dados?.cidade);
    else if (tipo === 'documental') frases = frasesDocumental(dados);
    else if (tipo === 'laudo') frases = frasesLaudo(dados);
    else if (tipo === 'indice') frases = frasesIndice(dados, extra);
  } catch { frases = []; }
  const cor = '#94a3b8';
  return (
    <div style={{ marginTop: compacto ? 10 : 16, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: cor, marginBottom: 5 }}>
        Metodologia e ressalvas
      </div>
      <p style={{ fontSize: 9.5, lineHeight: 1.55, color: cor, margin: 0, textAlign: 'justify' }}>
        {frases.join(' ')} {fraseCondicoesPagamento(condicoesPagamento)} {RESSALVA}
      </p>
    </div>
  );
}
