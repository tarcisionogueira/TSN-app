/**
 * GET /r/:codigo — link CURTO de indicação (23/08/2026, pedido do dono).
 *
 * O ARQUIVO PRECISOU DE NOME LONGO. Nasceu como `api/r.js` e a rota simplesmente não
 * existia em produção: `/api/r` caía no index.html do SPA, enquanto `/api/track`,
 * `/api/verificar-pagamento` (último alfabético — descarta teto de funções) e
 * `/api/alerta-publico` (edge, como este — descarta o runtime) respondiam normalmente.
 * A única variável restante era o nome de UMA LETRA — daí este nome longo. Se um dia
 * `/api/redirecionar` também sumir, a hipótese do nome estava errada e o suspeito passa a
 * ser o rewrite. De todo modo, o aviso vale: quando um endpoint de `api/` não vira rota, a
 * falha é SILENCIOSA — não há erro de build, o pedido só escorrega para o index.html do SPA.
 *
 * `bidprobrasil.com.br/r/C39C0C` → 302 → `/#/calculadora?ref=C39C0C`.
 *
 * Por que um endpoint e não só encurtar o texto na tela: o link é COMPARTILHADO (WhatsApp,
 * bio, story). O endereço com hash e query — `/#/calculadora?ref=C39C0C` — é feio, quebra em
 * pré-visualização de mensageiro e alguns apps cortam a partir do `#`, o que derrubaria
 * justamente o `?ref` e, com ele, a indicação do parceiro. O caminho curto sobrevive a isso.
 *
 * Sem tabela e sem estado: o código de indicação JÁ é o identificador curto. Encurtador com
 * banco criaria uma linha por link, um cache para invalidar e um jeito a mais de o link
 * "sumir"; aqui o link vale enquanto o código existir.
 *
 * Não valida o código contra o banco DE PROPÓSITO: a atribuição já é conferida no cadastro
 * (quem valida é quem grava a indicação). Barrar aqui só transformaria um erro de digitação
 * numa página de erro, em vez de abrir a calculadora — que é o que a pessoa veio fazer.
 */
export const config = { runtime: 'edge' };

// Formato do `perfis.codigo_indicacao` (ex.: C39C0C). O filtro existe para não refletir lixo
// na URL de destino: sem ele, `/r/<algo estranho>` viraria querystring montada por terceiro.
const RE_CODIGO = /^[A-Za-z0-9]{4,16}$/;

export default function handler(req) {
  const url = new URL(req.url);
  const codigo = (url.searchParams.get('codigo') || '').trim();
  const base = `${url.protocol}//${url.host}`;
  // Código ausente/inválido → abre a calculadora mesmo assim, só sem atribuição.
  const destino = RE_CODIGO.test(codigo)
    ? `${base}/#/calculadora?ref=${encodeURIComponent(codigo.toUpperCase())}`
    : `${base}/#/calculadora`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: destino,
      // Curto e sem cache de borda: se o dia de amanhã mudar o destino, ninguém fica preso
      // num redirecionamento antigo guardado no CDN ou no navegador.
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
