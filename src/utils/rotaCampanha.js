/**
 * src/utils/rotaCampanha.js — o que é uma ROTA DE CAMPANHA, num lugar só.
 *
 * POR QUE EXISTE (01/09). `LiveInscricao.jsx` afirma, em comentário: *"não há menu nem link
 * para sair — cada saída daqui é um inscrito a menos"*. Medido renderizando a página: a LP
 * monta a barra de navegação inteira do site — logo, Home, Calculadora, **Buscar Leilões**,
 * **Planos**, Entrar e o hamburger. São SEIS saídas, acima da promessa, na primeira tela de
 * uma página paga. E "Buscar Leilões" é a mais tentadora de todas para quem acabou de ver um
 * anúncio sobre achar imóvel em leilão.
 *
 * Ninguém colocou o menu ali: a rota cai no `MainLayout` (`<Route path="*">`), que monta o
 * `<Header />` para todo mundo. A landing herdou o shell do app sem que o autor dela soubesse
 * — é o tipo de coisa que revisão de código não pega, porque o defeito não está em nenhum
 * dos dois arquivos, está na composição.
 *
 * O banner "Instalar o app BidPro" entra pelo mesmo caminho (`<PwaInstall />` global) e tem o
 * mesmo problema: um botão azul, `position:fixed` com z-index 9999, disputando a atenção com
 * o CTA de inscrição. Medido: ele só aparece no **iOS Safari** — nos navegadores internos do
 * Facebook e do Instagram, não. Ou seja, atinge uma fatia do tráfego, não todo ele; ainda
 * assim, numa página de campanha não há motivo para oferecer instalação de app.
 *
 * REGRA ÚNICA, e não duas: se `Header` e `PwaInstall` decidissem cada um por conta própria,
 * uma rota de campanha nova entraria só numa das listas e o defeito voltaria pela metade.
 */

// `/live/:slug` — a landing da aula ao vivo. Ao criar outra página cujo único trabalho é
// converter, acrescente o prefixo aqui e ela nasce sem menu e sem banner.
const PREFIXOS = ['/live/'];

export function ehRotaDeCampanha(pathname) {
  const p = String(pathname || '');
  return PREFIXOS.some((pre) => p.startsWith(pre));
}
