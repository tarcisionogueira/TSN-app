/**
 * CONVENÇÃO DE UTM DOS LINKS QUE A PLATAFORMA GERA (27/08).
 *
 * ⚠️ MÓDULO PROPOSITALMENTE PURO — só `URLSearchParams`, que existe no Edge e no Node.
 * Isto não é preciosismo: `utmEmail` nasceu dentro de `_link-email.js`, que importa `crypto`
 * e `Buffer` do Node, e o primeiro consumidor (`api/email-alerta.js`) roda em `runtime:
 * 'edge'`. O import teria derrubado o endpoint com 500 em produção — e nem `verificar:sintaxe`
 * nem o `vite build` pegam isso, porque o arquivo faz parse e `api/` não é compilado.
 * Qualquer coisa nova aqui precisa continuar Edge-safe.
 *
 * A REGRA: `utm_source` é o CANAL, nunca o nome do disparo.
 *
 * Era o contrário até hoje — `email_alerta` e `email_ativacao` iam como SOURCE, então cada
 * e-mail novo nascia como um "canal" próprio e o e-mail jamais aparecia somado no relatório.
 * É a mesma fragmentação que fazia `ig` e `instagram` contarem separado. Quem distingue o
 * disparo é `utm_campaign`; a posição do link dentro da peça é `utm_content`.
 *
 * E é montado por `URLSearchParams`, não por concatenação: é ele que codifica o valor
 * corretamente. Link montado à mão foi o que produziu `TRF+-+SITE+-+LEILOES+-+AGO26`
 * contando separado de `TRF - SITE - LEILOES - AGO26` no painel.
 */
export function utmEmail(campanha, conteudo) {
  const p = new URLSearchParams({
    utm_source: 'email',
    utm_medium: 'email',
    utm_campaign: String(campanha || ''),
  });
  if (conteudo) p.set('utm_content', String(conteudo));
  return p.toString();
}
