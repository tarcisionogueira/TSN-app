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
import { PLANOS, formatarPreco } from '../src/data/cursos.js';
import { lanceVitrine } from './_lance-vitrine.js';

const linhas = (...ls) => ls.filter((l) => l !== null && l !== undefined).join('\n');
const RECURSOS_MOSTRADOS = 4; // top N da lista real de `recursos` — a completa é longa demais pra WhatsApp

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
//
// `linkTipo` (11/09, pedido do dono): o link de fechamento pode ser o convite pra aula (padrão)
// OU uma oportunidade real do acervo parecida com o case ("uma operação similar que foi
// citada") — troca só a FRASE de chamada, nunca inventa link nenhum; quem decide qual link
// entra é `admin-mensagens-grupo.js`, que já busca a lista real de oportunidades.
const CTA_CASE = {
  aula: (l) => `Quer aprender a fazer o mesmo? ${l}`,
  oportunidade: (l) => `Tem uma oportunidade parecida no acervo agora — dá uma olhada:\n${l}`,
};
export function montarCase({ depoimento, link, linkTipo = 'aula' }) {
  const nome = String(depoimento?.nome || '').trim();
  const resultado = String(depoimento?.resultado || '').trim();
  if (!nome || !resultado) return null;
  const onde = depoimento?.local ? ` (${depoimento.local})` : '';
  const tag = depoimento?.tag ? ` — ${String(depoimento.tag).trim()}` : '';
  const texto = String(depoimento?.texto || '').trim();
  const l = String(link || '').trim();
  const cta = l ? (CTA_CASE[linkTipo] || CTA_CASE.aula)(l) : null;
  return linhas(
    `🏠 Case real da comunidade${onde}`,
    '',
    `*${nome}*${tag}`,
    texto ? `"${texto}"` : null,
    '',
    resultado,
    '',
    cta,
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
// `imovel` vem de `imoveis_leilao` (api/admin-mensagens-grupo.js busca a lista real, priorizando
// quem tem praça marcada) — mesmas colunas que api/og-share.js já usa no cartão de `/i/:id`,
// pedido do dono 08/09 ("mandar oportunidades compartilhando os imóveis como já temos essa
// função"). O link SEM hash gera o preview com FOTO sozinho no WhatsApp; o TEXTO do chat é o
// que a pessoa lê por inteiro (o WhatsApp corta a descrição do cartão em 1-2 linhas), então o
// texto aqui é a versão completa — nada é calculado ou afirmado além do que já está no acervo.
//
// 2ª rodada (08/09, pedido do dono: "mais atratividade, sensualidade comercial" + dizer o TIPO
// de leilão): `modalidade` é campo REAL de `imoveis_leilao` (judicial/extrajudicial/venda_
// direta/venda_online) — o rótulo só TRADUZ o valor pra português, não afirma prazo/risco/
// procedimento (isso é papel do parecer jurídico, revisado por admin). A diferença em R$ é só
// avaliação − lance, a mesma subtração que o relatório de viabilidade já mostra.
const RUBRICA_MODALIDADE = {
  judicial: 'LEILÃO JUDICIAL',
  extrajudicial: 'LEILÃO EXTRAJUDICIAL',
  venda_direta: 'VENDA DIRETA',
  venda_online: 'VENDA ONLINE',
};
export function montarOportunidade({ imovel, link }) {
  const titulo = String(imovel?.titulo || '').trim();
  const l = String(link || '').trim();
  if (!titulo || !l) return null;

  const tipoBruto = String(imovel?.tipo || '').trim();
  const tipoLabel = tipoBruto ? tipoBruto.charAt(0).toUpperCase() + tipoBruto.slice(1) : 'Imóvel';
  const onde = [imovel?.bairro, imovel?.cidade].filter(Boolean).join(', ');
  const local = onde ? `${onde}${imovel?.estado ? '/' + imovel.estado : ''}` : (imovel?.cidade || null);
  const cabecalho = local ? `${tipoLabel} em ${local}` : tipoLabel;

  const rubrica = RUBRICA_MODALIDADE[String(imovel?.modalidade || '').trim()] || null;

  // Preço, desconto e data saem todos de `lanceVitrine` para que falem da MESMA praça. Antes
  // esta mensagem imprimia "Avaliação: R$ 308.000 / Lance inicial: R$ 330.000 / → 40% abaixo da
  // avaliação" — as três linhas juntas, o desconto da 2ª praça ao lado do lance da 1ª.
  const v = lanceVitrine(imovel);
  const avaliacao = v.avalUtil > 0 ? `Avaliação: R$ ${Math.round(v.avalUtil).toLocaleString('pt-BR')}` : null;
  const lance = v.valor > 0
    ? `${v.ehSegunda ? '2ª praça' : 'Lance inicial'}: R$ ${Math.round(v.valor).toLocaleString('pt-BR')}`
    : null;
  const diferenca = v.desconto > 0 ? v.avalUtil - v.valor : 0;
  const linhaDesconto = v.desconto > 0
    ? `→ ${v.desconto}% abaixo da avaliação${diferenca > 0 ? ` (R$ ${Math.round(diferenca).toLocaleString('pt-BR')} de diferença)` : ''}`
    : null;

  const praca = String(v.data || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dataPraca = praca ? `📅 Praça em ${praca[3]}/${praca[2]}/${praca[1]}` : null;

  // 3ª rodada (08/09, pedido do dono): NADA de header gritando "assine agora" — isso soou
  // chamativo de forma negativa numa versão anterior (testada só como rascunho, nunca foi ao
  // ar). O pitch do Investidor Pro vira uma DEIXA no final, depois do link, só citando que o
  // relatório completo existe — a oportunidade real continua sendo o assunto principal.
  return linhas(
    rubrica ? `🔨 OPORTUNIDADE REAL — ${rubrica}` : '🔨 OPORTUNIDADE REAL NO ACERVO',
    '',
    cabecalho,
    '',
    avaliacao,
    lance,
    linhaDesconto,
    dataPraca,
    '',
    'Veja a ficha completa (grátis):',
    l,
    '',
    'Quer saber se esse desconto vira lucro de verdade? O relatório de viabilidade financeira e a análise jurídica completa desse imóvel ficam liberados na assinatura Investidor Pro.',
  );
}

// ─── CURSO PAGO — vem de `cursos_admin` (o cadastro REAL do admin), não do array estático ──
// Correção do dono (08/09): a 1ª versão desta mensagem citava conteúdo do array estático
// `src/data/cursos.js`/CURSOS — que a própria tela de Membros NÃO usa mais (ela lê
// `cursos_admin` direto). "Não é pra criar um aleatório que não existe": o catálogo que
// vale é o que o admin efetivamente CADASTROU e ATIVOU ali, hoje pode ter zero cursos pagos
// prontos — e aí esta função devolve `null` como qualquer outra sem dado suficiente, nunca
// inventa um curso pra preencher a mensagem.
export function montarCurso({ curso, link }) {
  const titulo = String(curso?.titulo || '').trim();
  const l = String(link || '').trim();
  const preco = Number(curso?.preco) || 0;
  if (!titulo || !l || preco <= 0) return null; // "pago" sem preço real cadastrado não anuncia
  const emoji = String(curso?.emoji || '').trim() || '🎓';
  const subtitulo = String(curso?.subtitulo || '').trim();
  const descBruta = String(curso?.descricao || '').trim();
  const descricao = descBruta.length > 220 ? `${descBruta.slice(0, 220).trim()}…` : descBruta;
  const nivel = String(curso?.nivel || '').trim();
  return linhas(
    `${emoji} CURSO DISPONÍVEL`,
    '',
    titulo,
    subtitulo || null,
    '',
    descricao || null,
    '',
    nivel ? `Nível: ${nivel}` : null,
    `💰 ${formatarPreco(preco)}`,
    '',
    'Conheça o curso:',
    l,
  );
}

// ─── ASSESSORIA — dado real de PLANOS.assessorado (a mesma fonte que a tela de Planos usa) ─
export function montarAssessoria({ link }) {
  const l = String(link || '').trim();
  if (!l) return null;
  const p = PLANOS.assessorado;
  const recursos = (p.recursos || []).slice(0, RECURSOS_MOSTRADOS);
  const preco = `${p.precoLabel}${p.precoVistaLabel ? ` (${p.precoVistaLabel} à vista)` : ''} ${p.periodicidade || ''}`.trim();
  // `p.honorarios` já vem com o "+" (ex.: "+10% de honorários..."), então NÃO prefixa outro —
  // o teste real pegou "por arrematação + +10%..." antes deste ajuste (sinal duplicado).
  return linhas(
    `🤝 ${String(p.nome || 'Assessoria').toUpperCase()} BIDPRO BRASIL`,
    '',
    p.descricao || null,
    '',
    ...recursos,
    '',
    `💰 ${preco}${p.honorarios ? ` ${p.honorarios}` : ''}`,
    '',
    'Veja como funciona:',
    l,
  );
}

// ─── ASSINATURA (Investidor Pro) — dado real de PLANOS.top2 ────────────────────────────────
export function montarAssinatura({ link }) {
  const l = String(link || '').trim();
  if (!l) return null;
  const p = PLANOS.top2;
  const recursos = (p.recursos || []).slice(0, RECURSOS_MOSTRADOS);
  const preco = `${p.precoLabel}${p.periodicidade || ''}${p.precoMensalAnualLabel ? ` (${p.precoMensalAnualLabel}/mês no plano anual)` : ''}`;
  return linhas(
    `📊 ${String(p.nome || 'Investidor Pro').toUpperCase()}`,
    '',
    p.descricao || null,
    '',
    ...recursos,
    '',
    `💰 ${preco}`,
    '',
    'Conheça o plano:',
    l,
  );
}

export const TIPOS_VALIDOS = ['convite', 'case', 'educacao', 'enquete', 'urgencia', 'followup', 'oportunidade', 'curso', 'assessoria', 'assinatura'];

export function montarMensagemGrupo(tipo, dados) {
  switch (tipo) {
    case 'convite': return montarConvite(dados);
    case 'case': return montarCase(dados);
    case 'educacao': return montarEducacao(dados);
    case 'enquete': return montarEnquete(dados);
    case 'urgencia': return montarUrgencia(dados);
    case 'followup': return montarFollowup(dados);
    case 'oportunidade': return montarOportunidade(dados);
    case 'curso': return montarCurso(dados);
    case 'assessoria': return montarAssessoria(dados);
    case 'assinatura': return montarAssinatura(dados);
    default: return null;
  }
}
