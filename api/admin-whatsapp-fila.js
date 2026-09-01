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
 * O QUE ELE ENTREGA, E É O QUE FALTAVA: ordem (pagante → quem abriu o e-mail → o resto),
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
 * AS MENSAGENS. Duas, e não uma — porque a mesma frase não serve para quem paga e para quem
 * nunca usou. Mandar "venha conhecer" para um assinante do Investidor Pro queima a única
 * conversa que se vai ter com ele na semana.
 *
 * A LINHA QUE FAZ A MENSAGEM FUNCIONAR É A QUE PRECISA SER VERDADE. "Você se cadastrou e ainda
 * não rodou nenhuma análise" é o que prova que não é disparo em massa — e medido em 01/09, vale
 * para 73 das 76 pessoas não-pagantes da fila. Para as OUTRAS TRÊS ela seria falsa, e uma frase
 * falsa sobre a conta da própria pessoa prova exatamente o contrário do que pretende. Por isso
 * a fila devolve `nunca_analisou` e o texto se adapta em vez de generalizar.
 *
 * SEM PREÇO E SEM OFERTA, de propósito: o convite serve para levar à aula, e é a AULA que vende.
 * Preço no convite transforma conversa em anúncio e derruba a resposta.
 *
 * O PEDIDO NO MEIO ("me diga a cidade e a faixa") não é enfeite: quem responde uma pergunta já
 * entrou na conversa, o dono chega na aula com casos reais para analisar, e a resposta TRIA —
 * quem escreve "R$ 300 mil em Curitiba" é conversa de assessoria, não de plano mensal.
 *
 * O link fica sozinho na última linha para o WhatsApp montar o cartão de prévia (`/aula/<slug>`
 * é servida por `api/og-share` com título, data e capa).
 */
/**
 * ⚠️ "ANTES DE ABRIR PARA O RESTO" SAIU — 01/09, feedback de uma assinante do Investidor Pro.
 * Ela respondeu ao convite com três palavras: **"Quem é o resto?"**
 *
 * A frase existia para provar prioridade, e provou outra coisa. Dois defeitos, e o segundo é
 * o grave: (a) "o resto" não tem referente — quem lê não sabe se é a base, o público, ou ela
 * própria numa segunda leva; (b) ela **divide o mundo em dois e nomeia só um dos lados**, o
 * que num assunto de patrimônio e renda soa como clube com porta, não como atendimento. E o
 * pior: para provar deferência, a frase precisou de alguém para diminuir.
 *
 * A correção NÃO foi abrandar a exclusividade — foi trocá-la pelo fato. "Quis te chamar
 * pessoalmente" é literalmente o que está acontecendo (o dono manda um a um, com o texto na
 * tela dele), prova a mesma coisa que "antes do resto" pretendia provar, e não precisa de
 * ninguém embaixo para funcionar. **Uma frase que só é elogiosa por comparação está pedindo
 * a pergunta que a Neuma fez.**
 *
 * O NOME DO PLANO É DADO, NÃO LITERAL NO TEXTO — correção anterior, de mais cedo em 01/09.
 * A mensagem de pagante dizia "Você é assinante do Investidor Pro" para TODO mundo com
 * prioridade 1 — e prioridade 1 inclui `top2`, `assessorado` e `clube`. O Matheus, que é
 * ASSESSORADO, recebeu que era assinante de um plano que não tem. Um booleano não carrega
 * QUAL plano, e a RPC `whatsapp_fila_live` já devolvia `role` o tempo todo; o JS é que não lia.
 *
 * `assessorado` não é assinatura: é cliente de assessoria. Por isso a linha dele não fala em
 * "assinante", e sim no que ele de fato é.
 *
 * Agora são SINTAGMAS e não frases inteiras, para caberem dentro de "Como você é ___". Frase
 * fechada não compõe: era o que forçava o "então" e a oração seguinte, de onde "o resto" saiu.
 */
const LINHA_PLANO = {
  top2:        'assinante do Investidor Pro',
  clube:       'membro do Leilão Club',
  assessorado: 'cliente da assessoria',
};

export function montarMensagem({ nome, cidade, uf, quando, link, pagante, nuncaAnalisou, role }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const ola = primeiro ? `Oi, ${primeiro}!` : 'Oi!';
  const onde = cidade ? `${cidade}${uf ? `/${uf}` : ''}` : null;
  const Q = quando.charAt(0).toUpperCase() + quando.slice(1);

  if (pagante) {
    // Sem `role` reconhecido, o convite continua sendo pessoal — mas NÃO afirma plano nenhum.
    // Perder a linha do plano custa menos do que dizer ao cliente algo errado sobre a conta
    // dele, que é o oposto do que a frase pretende provar.
    const linha = LINHA_PLANO[role];
    const abre = linha
      ? `Como você é ${linha}, quis te chamar pessoalmente:`
      : 'Quis te chamar pessoalmente:';
    return [
      `${ola} Aqui é o Tarcísio.`,
      '',
      `${abre} ${quando}, eu vou analisar imóveis de leilão ao vivo — da leitura da matrícula até a conta final, com o risco e a margem de cada caso.`,
      '',
      'Se quiser, me diga a cidade e a faixa que você tem em vista. Levo o *seu* caso para a aula e faço a análise com você.',
      '',
      link,
    ].join('\n');
  }

  // Só entra quando é verdade. Sem ela, a mensagem abre direto no convite — perde a linha
  // pessoal, mas não afirma nada errado sobre a conta de quem está lendo.
  const abertura = nuncaAnalisou
    ? `Vi que você criou a sua conta e ainda não chegou a rodar uma análise. ${Q}, eu faço isso ao vivo:`
    : `${Q}, eu vou abrir a plataforma ao vivo:`;

  return [
    `${ola} Aqui é o Tarcísio, da BidPro Brasil.`,
    '',
    // "onde é prejuízo" virou "quando o melhor negócio é não dar o lance": mesma honestidade,
    // e a segunda posiciona critério em vez de perda. Quem constrói patrimônio compra a
    // disciplina de não arrematar tanto quanto a de arrematar.
    `${abertura} escolho imóveis de leilão reais, leio a matrícula e o edital na tela e levo a conta até o fim — o custo real de arrematação, a margem na revenda e os casos em que o melhor negócio é não dar o lance.`,
    '',
    onde
      ? `Se quiser, me diga se ainda procura em ${onde} e a faixa que você tem em vista, que eu levo o seu caso e analiso na hora.`
      : `Se quiser, me diga a sua cidade e a faixa que você tem em vista, que eu levo o seu caso e analiso na hora.`,
    '',
    `A participação é gratuita. Sua vaga: ${link}`,
  ].join('\n');
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

  // A aula VIVA: a mesma que a landing e os crons enxergam (`data_hora` é a próxima
  // ocorrência concreta, mesmo num evento recorrente).
  const rEv = await sb(`eventos_live?ativo=eq.true&data_hora=gt.${new Date().toISOString()}&select=id,slug,titulo,data_hora&order=data_hora.asc&limit=1`);
  if (!rEv.ok) return res.status(502).json({ error: 'evento_ilegivel', detalhe: await rEv.text() });
  const [evento] = await rEv.json();
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
    const texto = montarMensagem({
      nome: p.nome, cidade: p.cidade, uf: p.uf, quando, link,
      pagante: p.prioridade === 1,
      nuncaAnalisou: p.nunca_analisou === true,
      role: p.role,
    });
    return {
      user_id: p.user_id, nome: p.nome, cidade: p.cidade, uf: p.uf,
      motivo: p.motivo, prioridade: p.prioridade,
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
