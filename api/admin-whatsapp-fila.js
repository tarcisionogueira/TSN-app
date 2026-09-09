/**
 * GET  /api/admin-whatsapp-fila  → a fila ordenada + a mensagem pronta de cada pessoa
 * POST /api/admin-whatsapp-fila  → marca uma pessoa como enviada  { user_id }
 *
 * POR QUE ESTE ENDPOINT EXISTE, E POR QUE ELE NÃO ENVIA NADA (01/09).
 * Não há como disparar WhatsApp a partir do navegador. `wa.me` ABRE a conversa com o texto
 * escrito — quem aperta enviar é a pessoa. A API oficial (Cloud API) exige template de
 * marketing aprovado pela Meta e opt-in explícito; as não-oficiais dirigem o WhatsApp Web por
 * fora e o número que elas queimam é o do próprio negócio, o mesmo que está no site e nos
 * anúncios. Então a mecânica é ASSISTIDA de propósito: a máquina escolhe a ordem, escreve o
 * texto e guarda a prova; o envio é humano.
 *
 * O QUE ELE ENTREGA, E É O QUE FALTAVA: ordem (cliente → parceiro → quem abriu o e-mail),
 * texto já personalizado com nome e cidade, e o registro de quem já foi — que é o que permite
 * parar aos 12 e retomar sem duplicar. Mensagem repetida no WhatsApp custa mais caro que
 * mensagem nenhuma.
 *
 * TELEFONE DE CLIENTE É PII. Por isso passa por aqui, com sessão de admin conferida no
 * servidor, e não por uma leitura direta do cliente: a RPC `whatsapp_fila_live` é SECURITY
 * DEFINER e só o `service_role` a executa.
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';
import { edicaoDe } from './_live-edicao.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const TZ = 'America/Bahia';

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

// A EDIÇÃO vem de `_live-edicao.js` — havia três cópias desta mesma regra no `api/`, e regra
// copiada só funciona enquanto as cópias forem idênticas. `diaNoFuso` fica como nome local
// porque é o que `quandoPorExtenso` usa para contar CALENDÁRIO (hoje/amanhã), não edição.
const diaNoFuso = (d) => edicaoDe(d);

/**
 * A AULA VIVA entre as ativas: a mais próxima que ainda não passou.
 *
 * Pura e exportada de propósito — é a regra que o defeito de 03/09 violava, e regra que não
 * se pode rodar em seco volta a apodrecer calada. Recebe o que `live_proxima` já resolveu
 * (nunca a coluna `data_hora`) e devolve UMA aula, ou `null` quando nenhuma está viva.
 *
 * A JANELA DE 2h é a mesma da `live_proxima`: quem abre às 19h05 vê "começando agora", e a
 * fila de WhatsApp precisa continuar valendo durante a aula. Depois dela, o evento só some
 * daqui se NÃO for recorrente — no recorrente a própria RPC já devolveu a semana seguinte.
 */
export function escolherAulaViva(proximas, agora = Date.now()) {
  let viva = null;
  for (const aula of Array.isArray(proximas) ? proximas : []) {
    const quando = Date.parse(aula?.data_hora);
    if (!Number.isFinite(quando)) continue;
    if (quando < agora - 2 * 3600000) continue;
    if (!viva || quando < Date.parse(viva.data_hora)) viva = aula;
  }
  return viva;
}

/**
 * "hoje" / "amanhã" é conta de CALENDÁRIO, não de horas — a mesma armadilha que o cron do
 * lembrete documenta: numa aula às 19h, "faltam 20 horas" cai às 23h do dia anterior, e
 * "amanhã" ali está certo, mas às 6h da manhã do próprio dia estaria errado.
 */
export function quandoPorExtenso(dataHora, agora = Date.now()) {
  const alvo = new Date(dataHora);
  const dias = Math.round((Date.parse(`${diaNoFuso(alvo)}T00:00:00Z`) - Date.parse(`${diaNoFuso(new Date(agora))}T00:00:00Z`)) / 86400000);
  const hhmm = alvo.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  // "19:00" é como se escreve um horário em formulário; "19h" é como se escreve num convite.
  // O minuto só aparece quando existe — "19h30" é informação, "19h00" é ruído.
  const [hh, mm] = hhmm.split(':');
  const hora = mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
  const semana = alvo.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long' }).replace('-feira', '');
  if (dias === 0) return `hoje, às ${hora}`;
  if (dias === 1) return `amanhã (${semana}), às ${hora}`;
  return `na ${semana}, às ${hora}`;
}

/**
 * AS MENSAGENS, UMA POR PÚBLICO. E o público vem do BANCO, não de uma lista aqui.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ TRÊS DEFEITOS EMPILHADOS FORAM CONSERTADOS AQUI EM 01/09, e nenhum dava erro:
 *
 *  1. **O assessorado recebeu que era "assinante do Investidor Pro".** A mensagem de pagante
 *     tinha o nome do plano CHUMBADO no texto, e "pagante" é `top2` OU `assessorado` OU
 *     `clube`. Um booleano não carrega QUAL.
 *
 *  2. **"Antes de abrir para o resto"** — uma assinante respondeu perguntando *"Quem é o
 *     resto?"*. A frase não tinha referente e precisava de alguém embaixo para elogiar quem
 *     lia. Trocada pelo fato: *"quis te chamar pessoalmente"* é o que de fato acontece.
 *
 *  3. **E o que ninguém tinha visto: só existiam DOIS textos, para NOVE roles.** `consultor`,
 *     `analista` e `advogado` não são excluídos da fila (só `admin` é) e recebiam a mensagem
 *     de quem se cadastrou e nunca rodou uma análise. Para um Advogado Parceiro isso não é
 *     impreciso — é errado sobre a relação que ele tem com a empresa, e a mensagem inteira
 *     existe para provar o contrário. `top1` caía no mesmo lugar.
 *
 * ─── POR QUE O PÚBLICO NÃO É UMA LISTA NESTE ARQUIVO ─────────────────────────────────
 * Porque já foi, e a lista apodreceu sem ninguém perceber: `whatsapp_fila_live` classificava
 * como pagante `top2_anual`, `assessorado_anual` e `clube_anual` — **três valores que o CHECK
 * de `perfis.role` não admite e que o banco recusaria no insert**. Três testes que liam como
 * cobertura e não cobriam nada. Agora `planos_config.publico` e `.tratamento` são a fonte:
 * plano novo entra classificado, e plano SEM classificação cai no neutro explicitamente, em
 * vez de ser agrupado no palpite mais próximo.
 *
 * ─── A REGRA QUE VALE PARA OS QUATRO TEXTOS ──────────────────────────────────────────
 * **Toda frase que afirma algo sobre a pessoa tem de ser verdade, e some quando não for.**
 * Vale para o plano (`tratamento`), para a relação (`publico`) e para o histórico
 * (`nuncaAnalisou`). Perder a linha pessoal custa menos do que afirmar errado — porque é
 * justamente essa linha que prova que a mensagem não é disparo em massa, e errada ela prova
 * o contrário com mais força do que se não existisse.
 *
 * SEM PREÇO E SEM OFERTA, de propósito: o convite leva à aula, e é a AULA que vende. Preço no
 * convite transforma conversa em anúncio e derruba a resposta.
 *
 * O PEDIDO NO MEIO não é enfeite: quem responde uma pergunta já entrou na conversa, o dono
 * chega na aula com casos reais, e a resposta TRIA — "R$ 300 mil em Curitiba" é conversa de
 * assessoria, não de plano mensal.
 *
 * O link fica sozinho na última linha para o WhatsApp montar o cartão de prévia (`/aula/<slug>`
 * é servida por `api/og-share` com título, data e capa).
 */

// O miolo é o mesmo nos quatro textos, e é isso que a pessoa precisa saber para decidir se
// vale a hora dela. Ficar repetido nas quatro cópias garantiria que uma delas envelhecesse.
const O_QUE_ACONTECE = 'eu vou analisar imóveis de leilão ao vivo — leitura da matrícula e do '
  + 'edital na tela, risco e margem, até a conta final';

export function montarMensagem({ nome, cidade, uf, quando, link, publico, tratamento, nuncaAnalisou }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const ola = primeiro ? `Oi, ${primeiro}!` : 'Oi!';
  const onde = cidade ? `${cidade}${uf ? `/${uf}` : ''}` : null;
  const Q = quando.charAt(0).toUpperCase() + quando.slice(1);
  // `tratamento` vazio com `publico` preenchido é possível: plano novo cadastrado sem a frase.
  // Aí a abertura perde o "Como você é ___" e mantém o resto — nunca "Como você é undefined".
  const trato = String(tratamento || '').trim();
  const como = trato ? `Como você é ${trato}, ` : '';
  const linhas = (...ls) => ls.filter((l) => l !== null).join('\n');

  // ─── CLIENTE — quem paga. Investidor Pro, Assessoria, Leilão Club ───────────────────
  if (publico === 'cliente') {
    return linhas(
      `${ola} Aqui é o Tarcísio.`,
      '',
      `${como}${como ? 'q' : 'Q'}uis te chamar pessoalmente: ${quando}, ${O_QUE_ACONTECE}.`,
      '',
      'Se quiser, me diga a cidade e a faixa que você tem em vista. Levo o *seu* caso para a aula e faço a análise com você.',
      '',
      link,
    );
  }

  // ─── PARCEIRO — consultor e advogado. Ele não compra: ele TRAZ e ATENDE quem compra ──
  // O convite dele é de PAR, não de lead. Mandar "venha conhecer a plataforma" para um
  // advogado parceiro é dizer que não se sabe quem ele é — e ele sabe que sabemos.
  if (publico === 'parceiro') {
    return linhas(
      `${ola} Aqui é o Tarcísio.`,
      '',
      `${como}${como ? 'q' : 'Q'}ueria te chamar: ${quando}, ${O_QUE_ACONTECE}.`,
      '',
      'Vale pelos dois lados: dá para acompanhar como eu monto a análise, e o convite serve para quem você atende e ainda está começando a olhar leilão.',
      '',
      link,
    );
  }

  // ─── EQUIPE — interno. Já conhece o roteiro; o que ele pode fazer é trazer caso ──────
  if (publico === 'equipe') {
    return linhas(
      `${ola} Aqui é o Tarcísio.`,
      '',
      `${como || 'Você '}já conhece o roteiro, mas o aviso vale: ${quando}, ${O_QUE_ACONTECE}.`,
      '',
      'Se algum cliente seu tem um caso que valha mostrar na tela, me manda que eu levo para a aula.',
      '',
      link,
    );
  }

  // ─── GRATUITO e NEUTRO ───────────────────────────────────────────────────────────────
  // A linha do histórico só entra quando é verdade, e só para quem é do plano gratuito:
  // afirmar "você criou a conta e não rodou análise" a alguém de público desconhecido seria
  // repetir, do outro lado, o erro que criou esta função.
  const contaNova = publico === 'gratuito' && nuncaAnalisou;
  const abertura = contaNova
    ? `Vi que você criou a sua conta e ainda não chegou a rodar uma análise. ${Q}, eu faço isso ao vivo:`
    : `${Q}, eu vou abrir a plataforma ao vivo:`;

  return linhas(
    `${ola} Aqui é o Tarcísio, da BidPro Brasil.`,
    '',
    // "onde é prejuízo" virou "quando o melhor negócio é não dar o lance": mesma honestidade,
    // e a segunda posiciona critério em vez de perda. Quem constrói patrimônio compra a
    // disciplina de não arrematar tanto quanto a de arrematar.
    `${abertura} escolho imóveis de leilão reais, leio a matrícula e o edital na tela e levo a conta até o fim — o custo real de arrematação, a margem na revenda e os casos em que o melhor negócio é não dar o lance.`,
    '',
    onde
      ? `Se quiser, me diga se ainda procura em ${onde} e a faixa que você tem em vista, que eu levo o seu caso e analiso na hora.`
      : 'Se quiser, me diga a sua cidade e a faixa que você tem em vista, que eu levo o seu caso e analiso na hora.',
    '',
    `A participação é gratuita. Sua vaga: ${link}`,
  );
}

/**
 * CONVITE PRO GRUPO — para quem JÁ SE INSCREVEU (09/09, pedido do dono: "as pessoas que se
 * inscreveram ainda não estão no grupo. preciso de mensagens que chamem a atenção").
 *
 * POR QUE É UMA MENSAGEM SEPARADA, e não mais um texto da fila de cima: a fila de convite
 * (`whatsapp_fila_live`) EXCLUI quem está em `live_inscricoes` — ela existe para chamar quem
 * ainda NÃO se inscreveu. No instante em que a pessoa se inscreve ela sai daquela fila e não
 * recebe mais nenhum WhatsApp: o único lugar onde o link do grupo aparece é uma linha
 * opcional no rodapé do e-mail de confirmação ("Se quiser acompanhar os avisos por lá
 * também"). Quem não abre o e-mail — a maioria — nunca vê o grupo existir.
 *
 * A RAZÃO DE ENTRAR TEM DE SER VERDADE, como nos outros quatro textos deste arquivo. Não
 * inventa escassez ("restam N vagas no grupo") nem promete bônus que não existe: o motivo é
 * o mecanismo real — aviso de mudança de horário e o link da sala em cima da hora chegam
 * primeiro no grupo, e quem está só no e-mail depende de abrir o e-mail na hora certa.
 */
// A MENSAGEM NÃO PODE SE REPETIR (09/09, exigência literal do dono).
//
// Por que isso virou requisito: ele chamou os 7 inscritos desta edição às 17h41–17h48 e a fila de
// "quem nunca foi chamado" zerou. O próximo convite é, por definição, o SEGUNDO para a mesma
// pessoa — e reenviar o mesmo parágrafo é o que faz a conta parecer robô (e o WhatsApp tratar
// como disparo em massa).
//
// Duas variações INDEPENDENTES, as duas determinísticas — nada de sorteio, senão o texto não é
// testável e a mesma pessoa pode receber duas vezes o mesmo por azar:
//   · `rodada`  = quantas vezes ESTA pessoa já foi chamada (vem do log, coluna `rodada`). Troca o
//                 ARGUMENTO: convite → oportunidades → lembrete curto → porta aberta.
//   · `indice`  = posição na fila daquele dia. Troca a SAUDAÇÃO, para que duas pessoas chamadas na
//                 mesma rodada, no mesmo minuto, não recebam textos idênticos.
// Os dois ciclam, então a rodada 4 volta ao argumento do convite — mas com outra saudação. Por
// isso nenhuma rodada promete "é a última vez que eu chamo": seria uma promessa que o próprio
// ciclo quebraria.
//
// O que nenhuma rodada faz: inventar número, preço, plano, prazo ou escassez. A única coisa
// concreta afirmada é o que o dono realmente publica no grupo.
const SAUDACOES_GRUPO = [
  (p) => (p ? `Oi, ${p}!` : 'Oi!'),
  (p) => (p ? `${p}, tudo certo?` : 'Tudo certo?'),
  (p) => (p ? `Olá, ${p}!` : 'Olá!'),
  (p) => (p ? `Oi ${p}, tudo bem?` : 'Oi, tudo bem?'),
];

const RODADAS_GRUPO = [
  // 0 — o convite propriamente dito. É a única que se apresenta.
  ({ ola, onde, titulo, quando, link, l }) => l(
    `${ola} Aqui é o Tarcísio, da BidPro Brasil.`,
    '',
    `Sua vaga${titulo ? ` em *${titulo}*` : ''} está confirmada${quando ? ` — ${quando}` : ''}. Só que eu ainda não te vi no grupo do WhatsApp.`,
    '',
    'É lá que eu aviso na hora se mudar alguma coisa e onde eu mando o link da sala quando a aula abre. Quem fica só no e-mail depende de abrir o e-mail na hora certa.',
    '',
    `Entra agora, leva 10 segundos: ${link}`,
    '',
    onde ? `Te espero lá — e me diga o que você procura em ${onde} que eu levo o seu caso pra aula.`
         : 'Te espero lá — e me diga o que você procura que eu levo o seu caso pra aula.',
  ),
  // 1 — o que circula no grupo. Genérica de propósito (pedido do dono: "pode ser uma mensagem
  // genérica falando das oportunidades"), e sem número: percentual concreto aqui seria promessa
  // que a fila não tem como conferir no momento do envio.
  ({ ola, onde, link, l }) => l(
    `${ola} Voltei rapidinho por causa do grupo.`,
    '',
    'É lá que eu solto os lotes que aparecem no meio da semana: imóvel abaixo da avaliação, praça já marcada, leilão de banco. Um a um por e-mail não dá.',
    '',
    `O link é este: ${link}`,
    '',
    onde ? `Entrando, me diz o que você procura em ${onde} — quando entrar algo parecido eu te chamo.`
         : 'Entrando, me diz o que você procura — quando entrar algo parecido eu te chamo.',
  ),
  // 2 — lembrete curto. Sem argumento novo, sem repetir os anteriores: só o motivo prático.
  ({ ola, link, l }) => l(
    `${ola} Uma linha só: o link da sala da aula eu mando primeiro no grupo.`,
    '',
    link,
    '',
    'É só entrar, não precisa falar nada.',
  ),
  // 3 — porta aberta, sem cobrança.
  ({ ola, titulo, quando, link, l }) => l(
    `${ola} Deixo o link do grupo aqui à mão, sem pressa: ${link}`,
    '',
    `Sua vaga${titulo ? ` em *${titulo}*` : ''} está de pé de qualquer jeito${quando ? ` — ${quando}` : ''}. O grupo é só pra você não depender do e-mail no dia.`,
  ),
  // 4 — tira o peso de entrar. São CINCO argumentos contra QUATRO saudações de propósito: os
  // ciclos são coprimos, então a combinação só se repetiria no 21º convite à mesma pessoa. Com
  // quatro de cada, a rodada 4 saía idêntica à rodada 0 — medido, e por isso este quinto existe.
  ({ ola, link, l }) => l(
    `${ola} Entrar no grupo não te compromete com nada — dá pra sair quando quiser.`,
    '',
    `${link}`,
    '',
    'O que eu não queria mesmo é você perder o aviso da sala no dia.',
  ),
];

export function montarMensagemGrupo({ nome, cidade, uf, titulo, quando, linkGrupo, rodada = 0, indice = 0 }) {
  if (!linkGrupo) return null; // sem grupo cadastrado não há o que convidar — nunca inventa link
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  const ola = SAUDACOES_GRUPO[(n(indice) + n(rodada)) % SAUDACOES_GRUPO.length](primeiro);
  const onde = cidade ? `${cidade}${uf ? `/${uf}` : ''}` : null;
  const l = (...ls) => ls.filter((x) => x !== null && x !== undefined).join('\n');
  return RODADAS_GRUPO[n(rodada) % RODADAS_GRUPO.length]({ ola, onde, titulo, quando, link: linkGrupo, l });
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  // `.ok` conferido ANTES de ler o corpo: um 5xx do PostgREST devolve um objeto de erro, e
  // `[perfil]` viria `undefined` — ou seja, uma falha de leitura seria tratada como "não é
  // admin". Negar por falha e negar por identidade não são a mesma coisa, e só uma delas
  // significa que alguém precisa olhar o log.
  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!rPerfil.ok) return res.status(502).json({ error: 'perfil_ilegivel', detalhe: await rPerfil.text() });
  const [perfil] = await rPerfil.json();
  if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

  // A aula VIVA: a mesma que a landing e os crons enxergam.
  // ⚠️ O COMENTÁRIO QUE ESTAVA AQUI ERA FALSO, e o filtro em cima dele custou a semana (03/09).
  // Dizia que `data_hora` "é a próxima ocorrência concreta, mesmo num evento recorrente" — não
  // é: a coluna guarda a ocorrência ANTERIOR até `live_rolar_recorrentes()` avançá-la, e ela só
  // avança depois de `oferta_fecha_em`, não depois da aula. Com a aula de 02/09 já passada e a
  // oferta aberta até 06/09, o filtro `data_hora > agora` devolvia ZERO evento e esta tela
  // respondia "nenhuma aula futura ativa" — a fila de WhatsApp ficava vazia exatamente nos
  // quatro dias em que ela existe para ser usada, sem erro nenhum na tela. Quem resolve a
  // recorrência é `live_proxima`, a mesma RPC de `_convite-live.js` e `live-criar-sala.js`.
  const rEv = await sb('eventos_live?ativo=eq.true&select=slug&order=data_hora.asc');
  if (!rEv.ok) return res.status(502).json({ error: 'evento_ilegivel', detalhe: await rEv.text() });
  const ativos = await rEv.json().catch(() => null);
  if (!Array.isArray(ativos)) return res.status(502).json({ error: 'evento_ilegivel', detalhe: 'corpo inesperado em eventos_live' });
  const proximas = [];
  for (const linha of ativos) {
    const rP = await sb('rpc/live_proxima', { method: 'POST', body: JSON.stringify({ p_slug: linha.slug }) });
    // Falha de leitura NÃO pode virar "não há aula": os dois desfechos pintam a mesma tela
    // vazia, e só um deles significa que alguém precisa olhar o log.
    if (!rP.ok) return res.status(502).json({ error: 'evento_ilegivel', detalhe: await rP.text() });
    const prox = await rP.json().catch(() => null);
    if (prox?.data_hora) proximas.push(prox);
  }
  const evento = escolherAulaViva(proximas);
  if (!evento) return res.status(200).json({ evento: null, fila: [], motivo: 'nenhuma aula futura ativa' });

  const edicao = edicaoDe(evento.data_hora);

  // MODO (09/09): 'aula' (padrão, quem ainda não se inscreveu) × 'grupo' (quem JÁ se inscreveu
  // e ainda não foi chamado pro grupo). Cada um tem fila, texto e LOG próprios — o log separado
  // é o que permite a mesma pessoa receber os dois na mesma edição sem um bloquear o outro.
  const modo = String((req.method === 'POST' ? req.body?.modo : new URL(req.url, 'http://x').searchParams.get('modo')) || 'aula');
  const ehGrupo = modo === 'grupo';
  // `todos` só faz sentido no modo grupo: a tabela de inscritos do Admin quer TODA a lista com
  // um botão por linha, não a fila do que falta.
  const todosGrupo = String((req.method === 'POST' ? req.body?.todos : new URL(req.url, 'http://x').searchParams.get('todos')) || '') === '1';

  if (req.method === 'POST') {
    const userId = String(req.body?.user_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'user_id invalido' });
    // No modo grupo a chave do log é a INSCRIÇÃO + a RODADA, não o usuário: é o que permite
    // chamar a mesma pessoa de novo (com outro texto) sem o 409 do convite anterior, e o que
    // impede inscrito anônimo de colidir com todos os outros anônimos numa chave só.
    let extra = {};
    if (ehGrupo) {
      const inscricaoId = String(req.body?.inscricao_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(inscricaoId)) return res.status(400).json({ error: 'inscricao_id invalido' });
      extra = { inscricao_id: inscricaoId, rodada: Math.max(0, Math.floor(Number(req.body?.rodada) || 0)) };
    }
    const r = await sb(ehGrupo ? 'whatsapp_disparo_grupo_log' : 'whatsapp_disparo_log', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ evento_id: evento.id, edicao, user_id: userId, enviado_por: user.id, ...extra }),
    });
    // 409 = já estava marcado (duas abas, clique duplo). Não é erro: o desfecho desejado
    // já vale. Qualquer outro status precisa aparecer, senão a tela marca "enviado" em
    // cima de uma gravação que não aconteceu e a retomada duplica a mensagem.
    if (r.status === 409) return res.status(200).json({ ok: true, ja_estava: true });
    if (!r.ok) return res.status(502).json({ error: 'nao_gravou', detalhe: await r.text() });
    return res.status(200).json({ ok: true });
  }

  // ── MODO GRUPO: quem já se inscreveu e ainda não foi chamado pro grupo ──────────────────
  // O `link_grupo` NÃO vem da `live_proxima` (RPC pública, não expõe o link de propósito) —
  // esta rota é admin-only e busca direto na tabela pelo slug já resolvido, mesmo padrão de
  // admin-mensagens-grupo.js. Sem link cadastrado a fila sai VAZIA com o motivo por extenso:
  // gerar convite sem link seria mandar a pessoa para lugar nenhum.
  if (ehGrupo) {
    const rEvG = await sb(`eventos_live?slug=eq.${encodeURIComponent(evento.slug)}&select=link_grupo&limit=1`);
    if (!rEvG.ok) return res.status(502).json({ error: 'evento_ilegivel', detalhe: await rEvG.text() });
    const [evG] = await rEvG.json().catch(() => [null]);
    const linkGrupo = evG?.link_grupo || null;
    if (!linkGrupo) {
      return res.status(200).json({
        evento: { id: evento.id, slug: evento.slug, titulo: evento.titulo, data_hora: evento.data_hora, edicao, quando: quandoPorExtenso(evento.data_hora) },
        fila: [], ja_enviados: null, modo: 'grupo',
        motivo: 'esta aula não tem link de grupo cadastrado (Admin → Aula ao vivo)',
      });
    }

    // `todos=1` devolve TODOS os inscritos da edição, não só quem nunca foi chamado — é o que a
    // tabela "Inscritos nesta edição" do Admin usa para ter um botão POR LINHA. A tela de disparo
    // em massa continua sem o parâmetro e continua vendo só a fila de quem falta.
    const rG = await sb('rpc/whatsapp_fila_grupo', {
      method: 'POST', body: JSON.stringify({ p_evento: evento.id, p_edicao: edicao, p_todos: todosGrupo }),
    });
    if (!rG.ok) return res.status(502).json({ error: 'fila_ilegivel', detalhe: await rG.text() });
    const brutoG = await rG.json();
    const quandoG = quandoPorExtenso(evento.data_hora);
    const filaG = (Array.isArray(brutoG) ? brutoG : []).map((p, i) => {
      const rodada = Number(p.rodada) || 0;
      const texto = montarMensagemGrupo({
        nome: p.nome, cidade: p.cidade, uf: p.uf, titulo: evento.titulo, quando: quandoG, linkGrupo,
        rodada, indice: i,
      });
      return {
        inscricao_id: p.inscricao_id, user_id: p.user_id, nome: p.nome, cidade: p.cidade, uf: p.uf,
        rodada,
        motivo: rodada === 0 ? 'inscrito, fora do grupo' : `já chamado ${rodada}x — texto diferente`,
        prioridade: 1, publico: 'inscrito',
        wa: `https://wa.me/${p.telefone_wa}?text=${encodeURIComponent(texto)}`,
        texto,
      };
    });

    const rJaG = await sb(`whatsapp_disparo_grupo_log?evento_id=eq.${evento.id}&edicao=eq.${edicao}&select=user_id`);
    let jaG = null;
    if (rJaG.ok) { const l = await rJaG.json().catch(() => null); jaG = Array.isArray(l) ? l.length : null; }
    else console.error('[whatsapp-fila] nao contei os ja convidados pro grupo:', await rJaG.text());

    return res.status(200).json({
      evento: { id: evento.id, slug: evento.slug, titulo: evento.titulo, data_hora: evento.data_hora, edicao, quando: quandoG },
      fila: filaG, ja_enviados: jaG, modo: 'grupo',
    });
  }

  const rFila = await sb('rpc/whatsapp_fila_live', {
    method: 'POST',
    body: JSON.stringify({ p_evento: evento.id, p_edicao: edicao }),
  });
  // Erro de leitura NÃO pode virar fila vazia: "ninguém para convidar" e "não consegui ler"
  // se parecem na tela e levam a decisões opostas.
  if (!rFila.ok) return res.status(502).json({ error: 'fila_ilegivel', detalhe: await rFila.text() });
  const bruto = await rFila.json();

  const quando = quandoPorExtenso(evento.data_hora);
  const fila = (Array.isArray(bruto) ? bruto : []).map((p) => {
    const link = `${BASE}/aula/${evento.slug}?utm_source=whatsapp&utm_medium=direct&utm_campaign=aula-${edicao}&utm_content=fila-admin`;
    // ⚠️ `publico` e `tratamento` vêm da RPC (de `planos_config`), NÃO são derivados aqui de
    // `prioridade`. Derivar reconstruiria a lista chumbada que apodreceu — e foi exatamente
    // `pagante: p.prioridade === 1` que fez o assessorado ser chamado de assinante do
    // Investidor Pro: a prioridade sabe QUE ele paga, e não O QUE ele assinou.
    const texto = montarMensagem({
      nome: p.nome, cidade: p.cidade, uf: p.uf, quando, link,
      publico: p.publico,
      tratamento: p.tratamento,
      nuncaAnalisou: p.nunca_analisou === true,
    });
    return {
      user_id: p.user_id, nome: p.nome, cidade: p.cidade, uf: p.uf,
      motivo: p.motivo, prioridade: p.prioridade, publico: p.publico ?? null,
      wa: `https://wa.me/${p.telefone_wa}?text=${encodeURIComponent(texto)}`,
      texto,
    };
  });

  // Contagem informativa. Falha aqui NÃO derruba a fila — mas devolve `null` em vez de 0,
  // porque "ninguém recebeu ainda" e "não consegui contar" mostrados como o mesmo número
  // fariam o operador achar que a edição está zerada quando ela pode estar pela metade.
  const rJa = await sb(`whatsapp_disparo_log?evento_id=eq.${evento.id}&edicao=eq.${edicao}&select=user_id`);
  let jaEnviados = null;
  if (rJa.ok) {
    const linhas = await rJa.json().catch(() => null);
    jaEnviados = Array.isArray(linhas) ? linhas.length : null;
  } else {
    console.error('[whatsapp-fila] nao contei os ja enviados:', await rJa.text());
  }

  return res.status(200).json({
    evento: { id: evento.id, slug: evento.slug, titulo: evento.titulo, data_hora: evento.data_hora, edicao, quando },
    fila,
    ja_enviados: jaEnviados,
  });
}
