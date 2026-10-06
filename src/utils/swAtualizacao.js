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

// TRABALHO NÃO SALVO SEGURA A ATUALIZAÇÃO (06/10, Alphaville). A checagem roda ao voltar o FOCO — e escolher
// um arquivo no explorador e voltar é exatamente isso: o dono anexou edital e matrícula, a tela recarregou
// para a versão nova e os arquivos (só em memória) sumiram sem aviso. Com algo não salvo, a troca de versão
// espera: o próximo foco/visibilidade verifica de novo. (Chunk velho quebrado continua recarregando — é erro.)
let trabalhoNaoSalvo = false;
export function definirTrabalhoNaoSalvo(ativo) { trabalhoNaoSalvo = !!ativo; }
function recarregarSePuder(motivo) {
  if (trabalhoNaoSalvo) { console.info('[atualizacao] versão nova adiada: há trabalho não salvo na tela', motivo); return; }
  recarregarComGuarda();
}

export function vigiarAtualizacaoDoApp(registration) {
  if (!registration || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Havia controlador no momento em que o app subiu? Se não, esta é a primeira instalação:
  // o controllerchange que vem a seguir é a posse inicial, não uma atualização.
  const jaTinhaControlador = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaTinhaControlador) return;
    recarregarSePuder('service worker novo');
  });

  let ultimaChecagem = 0;
  const checar = () => {
    if (document.visibilityState !== 'visible') return;
    const agora = Date.now();
    if (agora - ultimaChecagem < MIN_ENTRE_CHECAGENS_MS) return;
    ultimaChecagem = agora;
    // `update()` rejeita quando está offline — é esperado e não é problema nosso.
    registration.update().catch(() => {});
    verificarVersaoNova();
  };

  document.addEventListener('visibilitychange', checar);
  window.addEventListener('focus', checar);
  checar();
}

// VERSÃO NOVA SEM SERVICE WORKER NOVO (02/10). O `controllerchange` acima só dispara quando o
// /sw.js MUDA — e um deploy comum (só telas) não muda o sw.js. Medido no celular do dono: o
// servidor já estava na versão das 15:3x e o app instalado seguia no JavaScript das 15:20,
// retomado do segundo plano a cada "fechei e abri"; duas correções nunca chegaram a ele.
// Aqui: ao voltar a ficar visível, compara o bundle principal que ESTÁ RODANDO com o que o
// index.html publicado referencia agora. Diferente → recarrega UMA vez (mesma guarda anti-loop).
// Falha de rede = não sabe = não faz nada (nunca recarrega por não conseguir ler).
const RE_BUNDLE = /\/assets\/index-[\w-]+\.js/;
function bundleAtual() {
  try {
    const s = [...document.querySelectorAll('script[type="module"][src]')].map((el) => el.getAttribute('src')).find((x) => RE_BUNDLE.test(x || ''));
    return s ? s.match(RE_BUNDLE)[0] : null;
  } catch { return null; }
}
async function verificarVersaoNova() {
  const atual = bundleAtual();
  if (!atual) return;   // dev (vite) ou formato inesperado: não decide
  try {
    const r = await fetch('/index.html', { cache: 'no-store' });
    if (!r.ok) return;
    const publicado = (await r.text()).match(RE_BUNDLE)?.[0];
    if (publicado && publicado !== atual) {
      console.info('[atualizacao] versão nova publicada', { atual, publicado });
      recarregarSePuder('bundle novo');
    }
  } catch (e) {
    console.warn('[atualizacao] não consegui verificar a versão publicada', e?.message);
  }
}
