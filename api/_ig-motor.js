/**
 * api/_ig-motor.js — o MOTOR de resposta do Instagram. Classifica, redige, e decide.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * NÃO ENVIA NADA. O envio é a peça seguinte (`_ig-envio.js`), separada de propósito: assim
 * este arquivo roda inteiro em seco, sobre conversa real, antes de existir permissão da Meta.
 * `npm run testar:ig-motor` exercita tudo o que é decisão pura, sem rede.
 *
 * ─── CLASSIFICADOR ANTES DO REDATOR, E ISSO NÃO É ORDEM DE EXECUÇÃO, É ARQUITETURA ────
 * Sem uma classe, a única forma de decidir se uma resposta pode sair sozinha seria olhar o
 * texto que o próprio redator produziu — e o redator não sabe quando errou. A classe é
 * julgada a partir da PERGUNTA, que é dado da pessoa; a resposta é produção nossa. Julgar a
 * própria produção é o que faz um sistema aprovar o que ele mesmo inventou.
 *
 * ─── AS TRÊS TRAVAS, EM ORDEM, E TODAS PRECISAM PASSAR ────────────────────────────────
 *   1. a CLASSE é autônoma?          (dado, em `ig_classe` — muda sem deploy)
 *   2. a CONFIANÇA passou do piso?   (senão vira `outro`, que nunca é autônomo)
 *   3. o TEXTO não viola a persona?  (trava MECÂNICA sobre `nunca_dizer`)
 * A terceira existe porque as duas primeiras são julgamento do modelo, e "lucro garantido"
 * numa DM sobre leilão é risco regulatório — não é o tipo de coisa que se confia a um prompt
 * que pede gentilmente. Instrução o modelo às vezes ignora; um `includes` não.
 *
 * ─── MODELO ──────────────────────────────────────────────────────────────────────────
 * A spec de 30/08 dizia "usar Haiku, DM é curta e o volume é alto". Isso é decisão de CUSTO,
 * e custo é decisão do dono — fica num constante só, medida antes de mudar. O padrão é o
 * modelo bom: uma resposta ruim sai assinada como se fosse ele, para 9.730 seguidores.
 */
import { anthropicFetch } from './_claude.js';

const CLAUDE_KEY = process.env.CLAUDE_KEY;   // mesmo nome dos outros 28 arquivos

export const MODELO_CLASSE   = 'claude-opus-5';
export const MODELO_REDACAO  = 'claude-opus-5';
// Piso de confiança. Abaixo dele a mensagem é `outro` — que existe justamente para "não sei"
// ter uma saída própria em vez de virar palpite com cara de classe (forma de falha nº 10).
export const PISO_CONFIANCA = 0.7;

// ─────────────────────────────────────────────────────────────────────────────────────
// PURO — tudo abaixo é testável sem rede, e é onde moram as decisões que custam caro
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza para comparação: minúsculas e SEM acento. "Lucro Garantído" tem de bater com
 * "lucro garantido" — a trava não pode ser derrotada por um til.
 */
export function normalizar(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * A trava mecânica da persona. Devolve a frase proibida encontrada, ou null.
 * Devolve QUAL — e não um booleano — porque o rascunho vai para o dono com o motivo, e
 * "reprovado" sem motivo é a mesma coisa que silêncio.
 */
export function violaPersona(texto, nuncaDizer = []) {
  const t = normalizar(texto);
  for (const frase of nuncaDizer) {
    const f = normalizar(frase);
    if (f && t.includes(f)) return frase;
  }
  return null;
}

/**
 * Lê a saída do classificador. Defensiva de propósito: o modelo pode devolver JSON dentro de
 * cerca de markdown, texto antes, ou nada.
 *
 * ⚠️ O RETORNO DE FALHA É `outro` COM CONFIANÇA 0, NUNCA uma classe plausível. Se o parse
 * falhar e isto devolvesse, digamos, `duvida_leilao`, o defeito viraria uma resposta
 * automática sobre um assunto que ninguém confirmou — erro de leitura entregue como
 * conteúdo válido, que é a forma de falha nº 1 desta base.
 */
export function lerClasse(bruto, classesValidas) {
  const vazio = { classe: 'outro', confianca: 0, motivo: 'nao_parseou' };
  if (typeof bruto !== 'string') return vazio;
  const m = bruto.match(/\{[\s\S]*\}/);
  if (!m) return vazio;
  let j;
  try { j = JSON.parse(m[0]); } catch { return vazio; }
  const classe = String(j?.classe || '');
  const conf = Number(j?.confianca);
  if (!classesValidas.includes(classe)) return { ...vazio, motivo: 'classe_desconhecida' };
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) return { ...vazio, motivo: 'confianca_invalida' };
  // Abaixo do piso NÃO é a classe que o modelo disse. É "não sei" — e tem de virar `outro`
  // aqui, e não lá no chamador, senão cada chamador reimplementa o piso e um deles esquece.
  if (conf < PISO_CONFIANCA) return { classe: 'outro', confianca: conf, motivo: 'abaixo_do_piso' };
  return { classe, confianca: conf, motivo: 'ok' };
}

/**
 * A DECISÃO. Recebe o item da fila, o texto redigido e a persona; devolve o que fazer.
 * Toda saída carrega `motivo` — quando o dono perguntar "por que isto não saiu sozinho?",
 * a resposta tem de estar no dado, não numa reconstrução.
 */
export function decidirEnvio({ item, texto, persona }) {
  const rascunho = (motivo) => ({ acao: 'rascunho', motivo });

  // Expirado é o primeiro teste, e ele NÃO vira rascunho: não há o que enviar nem o que o
  // dono possa mandar depois. É perda, e tem de ser contada como perda para aparecer.
  if (item?.expirado) return { acao: 'perdido', motivo: 'janela_expirada' };

  if (item?.estado && item.estado !== 'bot') return rascunho(`conversa_${item.estado}`);
  if (item?.classe === 'spam') return { acao: 'ignorar', motivo: 'spam' };
  if (!texto || !String(texto).trim()) return rascunho('sem_texto');

  const proibida = violaPersona(texto, persona?.nunca_dizer);
  // A trava da persona vem ANTES da checagem de autonomia, de propósito: um texto com
  // promessa de retorno não pode sair nem numa classe autônoma, e o dono precisa ver que
  // o motivo foi ESTE e não "a classe não está liberada".
  if (proibida) return rascunho(`persona_proibida:${proibida}`);

  if (!item?.autonomo) return rascunho('classe_nao_autonoma');
  return { acao: 'enviar', motivo: 'ok' };
}

/**
 * Monta o bloco de exemplos do dono. É AQUI que "aprender com o que ele já respondeu"
 * acontece — por exemplo, não por treino: os textos entram no prompt como referência.
 *
 * ⚠️ SÓ `autor = 'dono'`. Um exemplo escrito pelo bot faria o modelo reforçar o próprio
 * estilo a cada rodada, e ele derivaria — cada vez mais longe da voz real, sem nada parecer
 * errado. O filtro é reafirmado aqui e não só na consulta porque a consulta pode mudar.
 */
export function montarExemplos(mensagens = [], max = 8) {
  const dele = mensagens.filter((m) => m?.autor === 'dono' && String(m?.texto || '').trim());
  if (!dele.length) return '';
  const linhas = dele.slice(0, max).map((m) => `- ${String(m.texto).replace(/\s+/g, ' ').trim()}`);
  return `Exemplos REAIS de como ele responde (use o tom, nunca copie literalmente):\n${linhas.join('\n')}`;
}

export function montarPromptRedacao({ item, persona, exemplos, oferta, instrucaoClasse }) {
  const partes = [
    persona?.instrucao || '',
    instrucaoClasse ? `Sobre esta mensagem especificamente: ${instrucaoClasse}` : '',
    exemplos || '',
    oferta
      ? `Oferta vigente: ${oferta.titulo} — ${oferta.link}\nO que se quer que a pessoa faça: ${oferta.intencao}`
      : 'Não há oferta vigente cadastrada. NÃO invente link nem evento.',
    item?.janela === 'private_reply'
      ? 'Esta é a ÚNICA mensagem privada que poderemos mandar em resposta a este comentário, para sempre. '
        + 'Ela precisa carregar a resposta E o próximo passo. Jamais escreva apenas "te chamei no direct".'
      : 'Conversa aberta no direct. UMA pergunta, no máximo.',
    'Responda só com o texto da mensagem, sem aspas e sem explicação.',
  ];
  return partes.filter(Boolean).join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────────────
// COM REDE
// ─────────────────────────────────────────────────────────────────────────────────────

async function chamar(payload) {
  if (!CLAUDE_KEY) throw new Error('ig_motor_sem_chave');
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) }, { retries: 2, timeoutMs: 30000 });
  // `.ok` antes do corpo: um 400/401 do Anthropic devolve JSON, e lê-lo direto transformaria
  // "não consegui" em "veio vazio" — o defeito que causou o relatório vazio nesta base.
  if (!r.ok) {
    let corpo = ''; try { corpo = await r.text(); } catch { /* corpo indisponível no erro */ }
    console.error('[ig-motor] HTTP', r.status, String(corpo).slice(0, 300));
    throw new Error(`ig_motor_http_${r.status}`);
  }
  const j = await r.json();
  // Recusa do classificador de segurança chega em HTTP 200 — um `.ok` verdadeiro sobre uma
  // resposta que não tem conteúdo. Sem esta checagem viraria texto vazio com cara de sucesso.
  if (j?.stop_reason === 'refusal') throw new Error('ig_motor_recusado');
  return (j?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('').trim();
}

export async function classificar({ texto, origem, classes }) {
  const chaves = classes.map((c) => c.chave);
  const catalogo = classes.map((c) => `- ${c.chave}: ${c.titulo}`).join('\n');
  const bruto = await chamar({
    model: MODELO_CLASSE,
    max_tokens: 256,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: `Classifique a mensagem recebida por uma conta de Instagram sobre leilão de imóveis.\n`
      + `Classes:\n${catalogo}\n\nResponda SÓ com JSON: {"classe":"<chave>","confianca":<0 a 1>}.\n`
      + `Use "outro" quando não tiver certeza — chutar é pior do que admitir.`,
    messages: [{ role: 'user', content: `Canal: ${origem}\nMensagem: ${texto}` }],
  });
  return lerClasse(bruto, chaves);
}

export async function redigir({ item, persona, exemplos, oferta, instrucaoClasse }) {
  return chamar({
    model: MODELO_REDACAO,
    max_tokens: 600,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: montarPromptRedacao({ item, persona, exemplos, oferta, instrucaoClasse }),
    messages: [{ role: 'user', content: String(item?.texto || '') }],
  });
}
