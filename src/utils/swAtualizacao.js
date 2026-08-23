// ATUALIZAÇÃO DO PWA — o app instalado precisa PERCEBER que saiu versão nova (23/08/2026).
//
// Sintoma que motivou: o dono publicou uma tela nova, fechou e reabriu o PWA e continuou
// vendo a versão antiga. O deploy estava em produção (domínio aliasado ao commit certo) —
// o app é que não recarregou.
//
// POR QUE FECHAR E REABRIR NÃO BASTA. São duas coisas independentes:
//   1. O NAVEGADOR só busca um /sw.js novo quando há navegação (ou a cada ~24h). Um PWA
//      retomado do segundo plano é RESTAURADO, não navegado: nada é buscado.
//   2. Mesmo com service worker novo ativo, a PÁGINA JÁ CARREGADA continua rodando o
//      JavaScript que baixou antes. Trocar o worker não troca o código em execução.
// Ou seja: sem alguém pedir a verificação e recarregar, o PWA pode ficar dias numa versão
// velha — sem erro nenhum, que é o pior tipo de defeito nesta base: silencioso.
//
// O QUE ESTE MÓDULO FAZ. Pede `registration.update()` quando o app volta a ficar visível
// (é exatamente o momento "reabri o PWA") e, quando o worker novo assume o controle,
// recarrega UMA vez para o código novo entrar. O sw.js já faz `skipWaiting` + `clients.claim`,
// então o worker novo assume assim que é instalado — só faltava o pedido e o reload.
//
// AS DUAS TRAVAS CONTRA LOOP (um reload em ciclo é pior que a versão velha):
//   • só recarrega se JÁ HAVIA um controlador antes — na primeiríssima visita o
//     `clients.claim()` também dispara `controllerchange`, e ali não há nada a atualizar;
//   • `recarregarComGuarda()` é a mesma guarda do conserto de chunk velho (ignora um novo
//     reload em menos de 10s), então os dois caminhos não brigam entre si.
import { recarregarComGuarda } from './reportarErro.js';

const MIN_ENTRE_CHECAGENS_MS = 60 * 1000; // não martela o servidor a cada troca de aba

export function vigiarAtualizacaoDoApp(registration) {
  if (!registration || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Havia controlador no momento em que o app subiu? Se não, esta é a primeira instalação:
  // o controllerchange que vem a seguir é a posse inicial, não uma atualização.
  const jaTinhaControlador = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaTinhaControlador) return;
    recarregarComGuarda();
  });

  let ultimaChecagem = 0;
  const checar = () => {
    if (document.visibilityState !== 'visible') return;
    const agora = Date.now();
    if (agora - ultimaChecagem < MIN_ENTRE_CHECAGENS_MS) return;
    ultimaChecagem = agora;
    // `update()` rejeita quando está offline — é esperado e não é problema nosso.
    registration.update().catch(() => {});
  };

  document.addEventListener('visibilitychange', checar);
  window.addEventListener('focus', checar);
  checar();
}
