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
function quandoPorExtenso(dataHora, agora = Date.now()) {
  const alvo = new Date(dataHora);
  const dias = Math.round((Date.parse(`${diaNoFuso(alvo)}T00:00:00Z`) - Date.parse(`${diaNoFuso(new Date(agora))}T00:00:00Z`)) / 86400000);
  const hora = alvo.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const semana = alvo.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long' }).replace('-feira', '');
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `amanhã (${semana}) às ${hora}`;
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
 * O PEDIDO NO MEIO ("me diz a cidade e a faixa") não é enfeite: quem responde uma pergunta já
 * entrou na conversa, o dono chega na aula com casos reais para analisar, e a resposta TRIA —
 * quem escreve "R$ 300 mil em Curitiba" é conversa de assessoria, não de plano mensal.
 *
 * O link fica sozinho na última linha para o WhatsApp montar o cartão de prévia (`/aula/<slug>`
 * é servida por `api/og-share` com título, data e capa).
 */
function montarMensagem({ nome, cidade, uf, quando, link, pagante, nuncaAnalisou }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const ola = primeiro ? `Oi, ${primeiro}!` : 'Oi!';
  const onde = cidade ? `${cidade}${uf ? `/${uf}` : ''}` : null;
  const Q = quando.charAt(0).toUpperCase() + quando.slice(1);

  if (pagante) {
    return [
      `${ola} Aqui é o Tarcísio.`,
      '',
      `Você é assinante do Investidor Pro, então quero te chamar antes de abrir para o resto: ${quando} eu vou analisar imóveis de leilão ao vivo, da matrícula até a conta final.`,
      '',
      `Me manda a cidade e a faixa de valor que você quer investir que eu levo o *seu* caso para a aula e analiso com você assistindo.`,
      '',
      link,
    ].join('\n');
  }

  // Só entra quando é verdade. Sem ela, a mensagem abre direto no convite — perde a linha
  // pessoal, mas não afirma nada errado sobre a conta de quem está lendo.
  const abertura = nuncaAnalisou
    ? `Vi que você se cadastrou e ainda não chegou a rodar nenhuma análise. ${Q} eu vou fazer isso ao vivo:`
    : `${Q} eu vou abrir a plataforma ao vivo:`;

  return [
    `${ola} Aqui é o Tarcísio, da BidPro Brasil.`,
    '',
    `${abertura} pego imóveis de leilão reais, leio a matrícula e o edital na tela e faço a conta até o fim — quanto o imóvel sai de verdade, quanto dá para revender e onde é prejuízo.`,
    '',
    onde
      ? `Me diz se você procura em ${onde} mesmo e a faixa que pensa em investir, que eu levo o seu caso e analiso na hora.`
      : `Me diz a sua cidade e a faixa que você pensa em investir, que eu levo o seu caso e analiso na hora.`,
    '',
    `É gratuito. Sua vaga: ${link}`,
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
