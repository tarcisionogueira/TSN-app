/**
 * api/_mensagens-grupo.js — templates das mensagens do grupo de WhatsApp da aula ao vivo.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * 100% DETERMINÍSTICO, SEM CHAMADA DE IA — de propósito, não por economia. O caso de uso mais
 * arriscado aqui é "educação jurídica" (mito ou verdade sobre leilão): uma IA que inventasse ou
 * distorcesse um fato jurídico postado num grupo de 180 pessoas seria dano real, não só
 * conteúdo ruim. O mesmo raciocínio que já vale para `montarMensagem` (admin-whatsapp-fila.js,
 * zero IA) vale aqui: cada função só reorganiza dado que ALGUÉM (o admin, ou o próprio banco em
 * `eventos_live.depoimentos`) já forneceu como verdadeiro. Nenhuma função aqui pode aumentar o
 * que sabe sobre o mundo — só formatar.
 *
 * TODA FUNÇÃO DEVOLVE `null` QUANDO NÃO TEM DADO SUFICIENTE, NUNCA UM TEXTO PELA METADE. Um
 * `null` é fácil de checar no chamador; um texto com "undefined" ou uma frase capenga postada
 * pra 180 pessoas não tem como ser desfeito.
 *
 * `npm run testar:mensagem-grupo` cobre os invariantes de cada função.
 */

const linhas = (...ls) => ls.filter((l) => l !== null && l !== undefined).join('\n');

// ─── CONVITE — motivação/preview, usa o que já existe em eventos_live ──────────────────────
// NUNCA pede pra "garantir vaga" (08/09, achado do dono): quem lê isto já está DENTRO do
// grupo, e a única porta de entrada do grupo é a confirmação em `/aula/:slug`
// (LiveInscricao.jsx: "é ali que entra o grupo") — ou seja, 100% de quem recebe esta
// mensagem já garantiu a vaga dele. Pedir de novo é ruído. O CTA vira convite pra INDICAR,
// que é a única ação que ainda faz sentido pra quem já confirmou.
export function montarConvite({ titulo, quando, destaque, link }) {
  const t = String(titulo || '').trim();
  const l = String(link || '').trim();
  if (!t || !quando || !l) return null;
  return linhas(
    `📅 Tem aula ao vivo ${quando}!`,
    '',
    `*${t}*`,
    destaque ? `\n💡 ${String(destaque).trim()}` : null,
    '',
    'Sua vaga já está garantida — chama quem você conhece que ainda não confirmou:',
    l,
  );
}

// ─── CASE DE SUCESSO — usa SÓ o depoimento real escolhido, nunca recalcula número ──────────
// `depoimento` vem de `eventos_live.depoimentos` (jsonb curado à mão pelo dono, ver HANDOFF
// 05/09): {tag, nome, local, texto, resultado}. `resultado` já é a prosa com os valores reais —
// esta função NUNCA soma, nunca calcula percentual, só encaixa o que já está escrito.
export function montarCase({ depoimento, link }) {
  const nome = String(depoimento?.nome || '').trim();
  const resultado = String(depoimento?.resultado || '').trim();
  if (!nome || !resultado) return null;
  const onde = depoimento?.local ? ` (${depoimento.local})` : '';
  const tag = depoimento?.tag ? ` — ${String(depoimento.tag).trim()}` : '';
  const texto = String(depoimento?.texto || '').trim();
  return linhas(
    `🏠 Case real da comunidade${onde}`,
    '',
    `*${nome}*${tag}`,
    texto ? `"${texto}"` : null,
    '',
    resultado,
    '',
    link ? `Quer aprender a fazer o mesmo? ${link}` : null,
  );
}

// ─── EDUCAÇÃO (mito ou verdade) — mito e verdade vêm do ADMIN, isto só formata ─────────────
// Zero geração de fato jurídico aqui. Se o admin não escreveu os dois campos, não há mensagem.
export function montarEducacao({ mito, verdade }) {
  const m = String(mito || '').trim();
  const v = String(verdade || '').trim();
  if (!m || !v) return null;
  return linhas('🔍 MITO OU VERDADE?', '', `"${m}"`, '', `✅ ${v}`);
}

// ─── ENQUETE — pergunta e opções vêm do admin (ou de um preset já revisado no front) ───────
const NUMEROS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
export function montarEnquete({ pergunta, opcoes }) {
  const p = String(pergunta || '').trim();
  const lista = (Array.isArray(opcoes) ? opcoes : [])
    .map((o) => String(o || '').trim()).filter(Boolean).slice(0, 4);
  if (!p || lista.length < 2) return null; // enquete de 1 opção só não é enquete
  return linhas('ENQUETE 📊', '', p, ...lista.map((o, i) => `${NUMEROS[i]} ${o}`));
}

// ─── URGÊNCIA PRÉ-LIVE — escalada por estágio, sempre com a hora REAL de `quando` ──────────
// `vagasMax` só aparece na mensagem quando o evento tem um teto de verdade cadastrado — sem
// isso, "vagas limitadas" seria a mesma frase solta sem teto que a Sessão 24·Parte 2 já
// registrou como o que o modelo do concorrente faz e este produto deliberadamente NÃO copia.
const CABECALHOS_URGENCIA = {
  't-2h': '⏰ FALTAM 2 HORAS',
  't-1h': '🔥 FALTA 1 HORA',
  't-30min': '🚨 MENOS DE 30 MINUTOS',
  't-10min': '🔓 SALA ABERTA',
};
export function montarUrgencia({ titulo, quando, estagio, vagasMax, link }) {
  const t = String(titulo || '').trim();
  const l = String(link || '').trim();
  const cab = CABECALHOS_URGENCIA[estagio];
  if (!t || !l || !quando || !cab) return null;
  // Mesmo raciocínio do convite: quem está no grupo já garantiu a vaga dele. "Vagas" aqui
  // é sobre quem AINDA VAI ser chamado, não sobre quem já está lendo.
  const vaga = Number.isFinite(vagasMax) && vagasMax > 0 ? `Vagas para convidar: ${vagasMax}.` : null;
  if (estagio === 't-10min') {
    return linhas(cab, '', `A aula já pode ser acessada — começamos ${quando}.`, '', `*${t}*`, '', l);
  }
  return linhas(cab, '', `A aula é ${quando}:`, '', `*${t}*`, '', vaga, `Sua vaga já está garantida — chama quem ainda não confirmou: ${l}`);
}

// ─── FOLLOW-UP PÓS-LIVE — sem prazo de replay inventado, só o convite pra plataforma ───────
export function montarFollowup({ titulo, link }) {
  const t = String(titulo || '').trim();
  const l = String(link || '').trim();
  if (!t || !l) return null;
  return linhas(
    '👋 E aí, o que você achou da aula de hoje?',
    '',
    `Conta pra gente aqui no grupo — e se você ainda não deu uma volta na plataforma depois de *${t}*, o link é este:`,
    '',
    l,
  );
}

// ─── OPORTUNIDADE — imóvel real do acervo, mesmo link que o botão Compartilhar usa ─────────
// `imovel` vem de `imoveis_leilao` (api/admin-mensagens-grupo.js busca a lista real) — mesmas
// colunas que api/og-share.js já usa no cartão de `/i/:id`, pedido do dono 08/09 ("mandar
// oportunidades compartilhando os imóveis como já temos essa função"). O link SEM hash gera o
// preview com FOTO sozinho no WhatsApp — o texto aqui só complementa (lance/desconto/praça),
// nunca repete o que a foto/título do cartão já mostra. Nenhum número é calculado aqui: lance,
// avaliação e desconto vêm prontos do acervo, igual ao og-share.
export function montarOportunidade({ imovel, link }) {
  const titulo = String(imovel?.titulo || '').trim();
  const l = String(link || '').trim();
  if (!titulo || !l) return null;
  const onde = [imovel?.bairro, imovel?.cidade].filter(Boolean).join(', ');
  const local = onde ? `${onde}${imovel?.estado ? '/' + imovel.estado : ''}` : (imovel?.cidade || null);
  const lance = Number(imovel?.valor_minimo) > 0
    ? `Lance a partir de R$ ${Math.round(Number(imovel.valor_minimo)).toLocaleString('pt-BR')}`
    : null;
  const desconto = Math.round(Number(imovel?.desconto_percentual) || 0);
  const praca = String(imovel?.data_leilao || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dataPraca = praca ? `Praça em ${praca[3]}/${praca[2]}/${praca[1]}` : null;
  return linhas(
    '🏠 OPORTUNIDADE NO ACERVO',
    '',
    local,
    lance,
    desconto > 0 ? `${desconto}% abaixo da avaliação` : null,
    dataPraca,
    '',
    l,
  );
}

export const TIPOS_VALIDOS = ['convite', 'case', 'educacao', 'enquete', 'urgencia', 'followup', 'oportunidade'];

export function montarMensagemGrupo(tipo, dados) {
  switch (tipo) {
    case 'convite': return montarConvite(dados);
    case 'case': return montarCase(dados);
    case 'educacao': return montarEducacao(dados);
    case 'enquete': return montarEnquete(dados);
    case 'urgencia': return montarUrgencia(dados);
    case 'followup': return montarFollowup(dados);
    case 'oportunidade': return montarOportunidade(dados);
    default: return null;
  }
}
