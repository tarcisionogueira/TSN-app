/**
 * RESGATE DO DESTINO DA CAMPANHA — quem pagou para chegar na aula não pode cair na home.
 *
 * O QUE FOI MEDIDO (31/08), em `visita_origem`, sobre TODO o tráfego pago da aula:
 *
 *     CAIU NA HOME .................. 22 visitas
 *     chegou na página da aula ...... 11 visitas
 *
 * **Dois terços do tráfego pago caíam na home** e tinham de descobrir a aula sozinhos. Do lado
 * do Meta o funil já mostrava a ferida sem explicar a causa: 22 cliques no link viraram 14
 * "landing page view", e 834 impressões viraram 2 inscritos.
 *
 * POR QUE ACONTECE. A rota real da aula é `/#/live/<slug>` — hash routing. O que vem depois do
 * `#` é FRAGMENTO, e fragmento não é enviado ao servidor nem sobrevive a toda cadeia de
 * redirecionamento: o navegador embutido do Instagram/Facebook, encurtadores e rastreadores de
 * clique frequentemente entregam a URL sem ele. O que sobra é `https://bidprobrasil.com.br/?utm…`
 * — a home, com os UTMs intactos. É a mesma pegadinha do `#` que já tinha mordido em 28/08 nos
 * cartões de preview (`api/og-share` existe por causa dela), agora do lado do clique.
 *
 * POR QUE O CONSERTO É AQUI, E NÃO NO ANÚNCIO. Trocar a URL do anúncio conserta o anúncio novo;
 * isto conserta **todo o tráfego que já está no ar**, inclusive o de campanhas antigas, links
 * compartilhados por terceiros e qualquer app que corte o fragmento no futuro. Os dois consertos
 * somam — e este não depende de ninguém abrir o gerenciador de anúncios.
 *
 * FALHA PARA O LADO SEGURO. Sem campanha reconhecida, sem destino conhecido, ou com a pessoa já
 * numa rota qualquer, ele NÃO faz nada: ficar na home é um desfecho ruim, mas mandar alguém para
 * uma rota que não existe é pior. Nunca redireciona a partir de uma rota já escolhida.
 */

/**
 * Campanha → slug do evento. O slug é ESTÁVEL entre edições: a aula é semanal e
 * `live_rolar_recorrentes()` avança apenas `data_hora`, nunca o slug — então `leilao-ao-vivo`
 * vale para 02/09, 09/09 e as seguintes. A chave é comparada por PREFIXO, para `aula-02set`,
 * `aula-09set` e as próximas caírem na mesma regra sem ninguém precisar lembrar de voltar aqui.
 *
 * Ao criar uma aula com slug NOVO, acrescente a linha. Enquanto não acrescentar, o visitante
 * fica na home — que é o comportamento de hoje, não uma regressão.
 */
const DESTINO_POR_CAMPANHA = [
  { prefixo: 'aula-', slug: 'leilao-ao-vivo' },
];

/** A pessoa está na raiz, sem ter escolhido rota nenhuma? */
export function estaNaRaiz(pathname, hash) {
  const p = String(pathname || '/');
  const h = String(hash || '').replace(/^#/, '');
  const semRota = h === '' || h === '/' || h.startsWith('?');
  return (p === '/' || p === '') && semRota;
}

/**
 * O slug de destino para uma campanha, ou null quando não há regra.
 * `utm_campaign` é a chave; `utm_content` NÃO serve — ele nomeia a PEÇA (o criativo), e o mesmo
 * criativo pode ser usado em campanhas com destinos diferentes.
 */
export function slugDaCampanha(utmCampaign) {
  const c = String(utmCampaign || '').toLowerCase().trim();
  if (!c) return null;
  const achado = DESTINO_POR_CAMPANHA.find((d) => c.startsWith(d.prefixo));
  return achado ? achado.slug : null;
}

/**
 * Decide o destino a partir da URL inteira. Devolve o caminho para onde ir, ou null para ficar
 * onde está. Separada do efeito para poder ser exercitada sem navegador — a régua que decide
 * para onde o cliente vai é a parte que precisa ser conferida antes de ir ao ar.
 *
 * A QUERY STRING VAI JUNTO, e isso não é detalhe: sem ela o `fbclid` e os UTMs se perdem no
 * salto, e o tráfego pago passaria a chegar na aula SEM ORIGEM — trocaríamos uma perda de
 * conversão por uma perda de medição, com o número parecendo ótimo.
 */
export function destinoDaCampanha({ pathname, hash, search } = {}) {
  if (!estaNaRaiz(pathname, hash)) return null;
  const qs = new URLSearchParams(String(search || ''));
  const slug = slugDaCampanha(qs.get('utm_campaign'));
  if (!slug) return null;
  const cauda = String(search || '').replace(/^\?/, '');
  return `/#/live/${slug}${cauda ? `?${cauda}` : ''}`;
}

/** O efeito. `replace` e não `assign`: o botão "voltar" não pode devolver a pessoa à home. */
export function resgatarDestinoDaCampanha() {
  try {
    const { pathname, hash, search } = window.location;
    const destino = destinoDaCampanha({ pathname, hash, search });
    if (destino) window.location.replace(destino);
  } catch {
    // Navegação é melhor-esforço: se `location` não colaborar, a pessoa fica na home — que é
    // exatamente onde ela já estava. Engolir aqui não esconde falha de I/O, esconde falha de
    // uma otimização de destino.
  }
}
