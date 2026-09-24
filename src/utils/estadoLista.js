import { useEffect, useRef } from 'react';
import { useNavigationType } from 'react-router-dom';

/**
 * VOLTAR DO LOTE PARA A LISTA SEM PERDER O LUGAR (pedido do dono, 24/09).
 *
 * As buscas (Busca.jsx, BuscaVeiculos.jsx) DESMONTAM ao abrir o detalhe (rotas irmãs, lazy) e o
 * `RouteTracker` do App manda para o topo em toda troca de rota — e a lista recarrega de forma
 * assíncrona, então nem o navegador consegue devolver a rolagem sozinho. Aqui:
 *   - `lerSessao/gravarSessao`: estado da lista em sessionStorage (por aba; some ao fechar).
 *   - `useRolagemDaLista(chave, prontos)`: guarda o scroll ao SAIR da lista e o devolve ao
 *     VOLTAR (navegação POP = botão voltar / nav(-1)), só depois que os resultados chegaram.
 *     Entrar na lista por um link novo (PUSH) começa do topo, como antes.
 *
 * sessionStorage pode lançar (aba anônima, cota, bloqueio): falhar aqui só significa não
 * lembrar a posição — a lista funciona igual. Por isso os `catch` devolvem o padrão.
 */
export function lerSessao(chave, padrao) {
  try {
    const v = sessionStorage.getItem(chave);
    return v == null ? padrao : JSON.parse(v);
  } catch {
    return padrao; // sem storage/JSON inválido → comportamento padrão (lista do zero)
  }
}

export function gravarSessao(chave, valor) {
  try { sessionStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem storage: só não lembra */ }
}

export function useRolagemDaLista(chave, prontos) {
  const tipoNav = useNavigationType();
  const alvo = useRef(tipoNav === 'POP' ? Number(lerSessao(`rolagem_${chave}`, 0)) || 0 : 0);

  // Ao desmontar (indo para o detalhe ou qualquer outra tela) grava onde a pessoa estava.
  // O cleanup roda antes do efeito "vai ao topo" da rota nova, então window.scrollY ainda é o da lista.
  useEffect(() => () => gravarSessao(`rolagem_${chave}`, window.scrollY || 0), [chave]);

  useEffect(() => {
    if (!prontos || !alvo.current) return;
    const y = alvo.current;
    alvo.current = 0; // devolve UMA vez só
    requestAnimationFrame(() => window.scrollTo(0, y));
    const t = setTimeout(() => window.scrollTo(0, y), 150); // fotos/mapa ainda ajustando a altura
    return () => clearTimeout(t);
  }, [prontos]);
}
