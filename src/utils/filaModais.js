import { useEffect, useState } from 'react';

/**
 * UM MODAL POR VEZ (15/08, achado do dono no primeiro acesso pelo celular).
 *
 * O QUE ACONTECIA. Seis popups podem querer a tela ao mesmo tempo — contrato obrigatório,
 * cadastro incompleto, bônus de análises, vídeo de boas-vindas, tour guiado e sugestão de
 * imóvel. O `App.jsx` já os ordenava no JSX, com o comentário de que boas-vindas "entra por
 * ÚLTIMO para nunca cobrir uma pendência que trava a conta". **Só que ordem no JSX não é
 * exclusão mútua:** os seis renderizam juntos, cada um com seu próprio `z-index`, e quem tem o
 * maior fica por cima. Foi o que o dono viu ao entrar pelo celular — o vídeo de boas-vindas e o
 * tour de 5 passos empilhados na mesma tela, com o botão do chat por cima dos dois. Numa conta
 * recém-criada, que é exatamente quando os três disparam juntos.
 *
 * O efeito é pior no celular, onde não há folga: no desktop os avisos se acomodam em cantos
 * diferentes e a sobreposição passa por "muita coisa"; no telefone eles se cobrem e viram
 * "quebrou". É a mesma leitura que fez o João achar que o chat era um erro do site.
 *
 * COMO FUNCIONA. Cada modal continua decidindo SOZINHO se quer aparecer — nenhuma regra de
 * negócio muda de lugar. Ele apenas declara essa vontade aqui e recebe de volta se é a vez
 * dele. Só o de MAIOR prioridade entre os que querem aparecer é desenhado; os outros esperam,
 * e aparecem sozinhos quando o da frente sai. Nada é perdido, nada é descartado — é fila, não
 * filtro.
 *
 * A prioridade é por CUSTO DE IGNORAR, do maior para o menor: o que trava a conta vem antes do
 * que informa, que vem antes do que sugere. Boas-vindas fica atrás das pendências pelo mesmo
 * motivo que já estava no comentário do App.jsx; o tour fica atrás das boas-vindas porque
 * explicar a tela por cima de um vídeo não ensina nada.
 */
const PRIORIDADE = ['contrato', 'cadastro', 'bonus', 'boas-vindas', 'tour', 'sugestao'];

const querem = new Set();
const ouvintes = new Set();
const avisar = () => { for (const f of ouvintes) f(); };

const daVez = () => {
  for (const id of PRIORIDADE) if (querem.has(id)) return id;
  return null;
};

/**
 * @param {string} id    um dos PRIORIDADE
 * @param {boolean} quer o modal JÁ decidiu que quer aparecer (suas próprias regras)
 * @returns {boolean}    pode desenhar agora
 *
 * Id fora da lista NÃO é silenciado: seria a falha que não sabe que falhou — um modal novo
 * sumiria da tela sem ninguém entender por quê. Ele passa direto (comportamento de antes) e o
 * console diz que falta registrá-lo na prioridade.
 */
export function useVezDoModal(id, quer) {
  const conhecido = PRIORIDADE.includes(id);
  const [, forcar] = useState(0);

  useEffect(() => {
    if (!conhecido) return;
    if (quer) querem.add(id); else querem.delete(id);
    avisar();
    return () => { querem.delete(id); avisar(); };
  }, [id, quer, conhecido]);

  useEffect(() => {
    const f = () => forcar((n) => n + 1);
    ouvintes.add(f);
    return () => { ouvintes.delete(f); };
  }, []);

  if (!conhecido) {
    console.warn('[filaModais] id não registrado em PRIORIDADE, seguindo sem fila:', id);
    return quer;
  }
  return quer && daVez() === id;
}
