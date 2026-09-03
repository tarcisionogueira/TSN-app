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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const TZ = 'America/Bahia';

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

const diaNoFuso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

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

  const edicao = diaNoFuso(new Date(evento.data_hora));

  if (req.method === 'POST') {
    const userId = String(req.body?.user_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'user_id invalido' });
    const r = await sb('whatsapp_disparo_log', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ evento_id: evento.id, edicao, user_id: userId, enviado_por: user.id }),
    });
    // 409 = já estava marcado (duas abas, clique duplo). Não é erro: o desfecho desejado
    // já vale. Qualquer outro status precisa aparecer, senão a tela marca "enviado" em
    // cima de uma gravação que não aconteceu e a retomada duplica a mensagem.
    if (r.status === 409) return res.status(200).json({ ok: true, ja_estava: true });
    if (!r.ok) return res.status(502).json({ error: 'nao_gravou', detalhe: await r.text() });
    return res.status(200).json({ ok: true });
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
