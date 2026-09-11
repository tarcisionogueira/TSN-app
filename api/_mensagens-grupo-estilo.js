/**
 * api/_mensagens-grupo-estilo.js — reescreve o TOM/formato da mensagem do grupo aprendendo
 * das edições reais que o dono já fez, sem nunca poder alterar um FATO.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * `_mensagens-grupo.js` é 100% determinístico de propósito (ver o comentário de lá: uma IA
 * que inventasse/distorcesse fato jurídico postado num grupo de 180 pessoas é dano real).
 * Este arquivo NÃO reabre essa porta — ele entra DEPOIS do texto determinístico já pronto, e
 * só pode mexer em como a frase soa (tom, ordem, emoji, quebra de linha), nunca no que ela
 * afirma. A garantia não é "pedir educadamente" no prompt: é validar a SAÍDA depois —
 * `preservaFatos()` extrai todo R$, %, data e link do texto ORIGINAL e reprova a reescrita se
 * qualquer um sumir ou mudar. Reprovou (ou a chamada falhou) → devolve `null`, e quem chama
 * usa o texto determinístico como está hoje. Mesmo princípio de `_mensagens-grupo.js`: nunca
 * um texto pela metade, nunca uma versão "quase certa" saindo no lugar da original.
 *
 * Tipo "educacao" (mito/verdade jurídico) fica de FORA desta reescrita, sempre — é o único
 * tipo que o próprio `_mensagens-grupo.js` já trata como o caso de maior risco, e uma
 * reescrita de tom pode mudar a nuance de uma frase jurídica mesmo preservando os números
 * (que ali nem costumam existir). Decisão do dono, não do código: mude aqui se quiser incluir.
 */
import { iaGeminiPrimary } from './_claude.js';

const CLAUDE_KEY = process.env.CLAUDE_KEY;

const TIPOS_ESTILIZAVEIS = new Set(['convite', 'case', 'enquete', 'urgencia', 'followup', 'oportunidade', 'curso', 'assessoria', 'assinatura']);

// Mínimo de exemplos reais antes de a IA arriscar um palpite de estilo — com 1-2 edições
// o "padrão" seria só o acaso de uma correção pontual (typo, um emoji a mais), não um estilo.
const MIN_EXEMPLOS = 3;
const MAX_EXEMPLOS = 6; // últimos N — estilo recente pesa mais que o de semanas atrás

function extraiInvariantes(texto) {
  const t = String(texto || '');
  const urls = t.match(/https?:\/\/\S+/g) || [];
  const dinheiro = t.match(/R\$\s?[\d.,]+/g) || [];
  const percentuais = t.match(/\d+%/g) || [];
  const datas = t.match(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/g) || [];
  return [...urls, ...dinheiro, ...percentuais, ...datas];
}

// Todo invariante do texto BASE (fato real) precisa aparecer, verbatim, na reescrita — é a
// trava que substitui "confiar no prompt". Link cortado, número arredondado ou data trocada:
// reprova tudo, não só o trecho ruim (mesma regra de `_mensagens-grupo.js`: null, não capenga).
function preservaFatos(base, saida) {
  if (!saida || typeof saida !== 'string' || saida.trim().length < 10) return false;
  const invariantes = extraiInvariantes(base);
  return invariantes.every((tok) => saida.includes(tok));
}

/**
 * @param {string} tipo
 * @param {string} textoBase texto 100% determinístico de montarMensagemGrupo()
 * @param {{antes:string, depois:string}[]} exemplos edições reais anteriores do MESMO tipo
 * @returns {Promise<string|null>} texto estilizado validado, ou null (mantém o determinístico)
 */
export async function estilizarMensagemGrupo(tipo, textoBase, exemplos) {
  if (!TIPOS_ESTILIZAVEIS.has(tipo)) return null;
  if (!textoBase || typeof textoBase !== 'string') return null;
  const pares = (Array.isArray(exemplos) ? exemplos : [])
    .filter((e) => e?.antes && e?.depois && e.antes !== e.depois)
    .slice(0, MAX_EXEMPLOS);
  if (pares.length < MIN_EXEMPLOS) return null;
  if (!CLAUDE_KEY) return null; // env ausente: falha aberta pro determinístico, nunca quebra a geração

  const blocoExemplos = pares.map((e, i) => (
    `Exemplo ${i + 1}:\nANTES:\n${e.antes}\nDEPOIS (como o dono ajustou):\n${e.depois}`
  )).join('\n\n');

  const prompt = `Você ajusta o TOM de mensagens de WhatsApp para o dono de uma comunidade de leilão de imóveis, aprendendo do jeito que ELE mesmo edita.

Abaixo estão edições reais que ele já fez em mensagens deste mesmo tipo ("${tipo}") — cada par mostra o texto que o sistema gerou e como ele ficou depois de o dono ajustar:

${blocoExemplos}

Agora aplique o MESMO tipo de ajuste (tom, emojis, comprimento de frase, quebra de linha, forma de chamar atenção) neste novo texto:

${textoBase}

REGRAS ABSOLUTAS, sem exceção:
- Não invente, não remova, não arredonde e não troque NENHUM número, valor em R$, percentual, data ou link — todos têm que aparecer EXATAMENTE como estão no texto original.
- Não adicione nenhuma afirmação, promessa ou fato que não esteja no texto original.
- Pode mudar: ordem das frases, tom, emojis, quebras de linha, como a frase é construída.
- Responda APENAS com o texto final, pronto para colar no WhatsApp — sem comentário, sem aspas, sem explicação.`;

  let saida = null;
  try {
    const r = await iaGeminiPrimary({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // reescrita de tom, custo baixo — não é núcleo jurídico
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (r?.ok) {
      const j = await r.json().catch(() => null);
      saida = j?.content?.[0]?.text?.trim() || null;
    }
  } catch { /* rede/timeout: cai no determinístico, sem re-tentar (não é crítico) */ }

  return preservaFatos(textoBase, saida) ? saida : null;
}
