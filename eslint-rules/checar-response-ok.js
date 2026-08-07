/**
 * REGRA LOCAL: `checar-response-ok`
 *
 * Por que existe: "erro de API silenciado" é o bug mais reincidente deste projeto. O padrão é
 * sempre o mesmo — `const r = await fetch(...)` (ou `anthropicFetch`, `sb`, `apiCall`, `mpGet`)
 * seguido de `r.json()` SEM nunca olhar `r.ok`. Um 4xx/5xx então vira um objeto de erro que o
 * código trata como resposta válida, e o resultado é um falso-vazio: foi a causa-raiz do
 * "relatório vazio", do caso jurídico publicado sem veredito (07/08) e de vários achados das
 * varreduras. Nada no lint pegava isso — só revisão humana, que já deixou passar várias vezes.
 *
 * O que a regra faz: para cada variável que recebe o retorno de uma chamada de rede, exige que
 * `.ok` ou `.status` apareça em algum lugar do mesmo escopo antes de o código confiar no
 * `.json()`. Não tenta ser esperta com fluxo — a heurística é deliberadamente simples para não
 * gerar falso-positivo: se a variável é inspecionada de qualquer forma, a regra se cala.
 *
 * Severidade WARN, não ERROR, e o motivo é honesto: a varredura de 07/08 mediu 92 ocorrências
 * desta forma no código atual (mais 63 de uma variante inline). Boa parte é best-effort legítimo
 * — medição, log, fire-and-forget — onde a falha é inofensiva. Transformar em erro hoje
 * quebraria o build sem separar o inofensivo do perigoso. Como WARN, a regra cumpre o papel que
 * importa: TODA ocorrência NOVA aparece na hora, com nome próprio e greppável
 * (`npm run lint:resposta`), em vez de só ser descoberta meses depois por um cliente.
 */
const FONTES_REDE = new Set(['fetch', 'anthropicFetch', 'geminiFetch', 'sb', 'apiCall', 'mpGet', 'supabaseFetch']);

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Exige checar `.ok`/`.status` da resposta de rede antes de usar `.json()`' },
    schema: [],
    messages: {
      semChecagem:
        'Resposta de rede em "{{nome}}" usada com .json() sem checar .ok/.status. '
        + 'Um 4xx/5xx vira objeto de erro tratado como dado válido (falso-vazio). '
        + 'Cheque `if (!{{nome}}.ok)` ou marque como best-effort com um comentário eslint-disable explicando por quê.',
    },
  },
  create(context) {
    // Uma entrada por variável candidata: { nome, node, inspecionada, usouJson }
    const candidatas = new Map();

    const nomeDaChamada = (init) => {
      if (!init || init.type !== 'AwaitExpression') return null;
      const chamada = init.argument;
      if (!chamada || chamada.type !== 'CallExpression') return null;
      const callee = chamada.callee;
      if (callee.type === 'Identifier') return FONTES_REDE.has(callee.name) ? callee.name : null;
      // Ex.: supabase.fetch(...) — só o último segmento interessa.
      if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
        return FONTES_REDE.has(callee.property.name) ? callee.property.name : null;
      }
      return null;
    };

    return {
      VariableDeclarator(node) {
        if (node.id?.type !== 'Identifier') return;
        if (!nomeDaChamada(node.init)) return;
        candidatas.set(node.id.name, { nome: node.id.name, node, inspecionada: false, usouJson: false });
      },
      MemberExpression(node) {
        if (node.object?.type !== 'Identifier') return;
        const alvo = candidatas.get(node.object.name);
        if (!alvo || node.property?.type !== 'Identifier') return;
        const prop = node.property.name;
        // Qualquer inspeção do envelope da resposta desarma a regra.
        if (prop === 'ok' || prop === 'status' || prop === 'statusText' || prop === 'headers') alvo.inspecionada = true;
        if (prop === 'json' || prop === 'text') alvo.usouJson = true;
      },
      'Program:exit'() {
        for (const alvo of candidatas.values()) {
          if (alvo.usouJson && !alvo.inspecionada) {
            context.report({ node: alvo.node, messageId: 'semChecagem', data: { nome: alvo.nome } });
          }
        }
      },
    };
  },
};
