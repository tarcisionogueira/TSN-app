/**
 * GET /api/lancamento-remarketing-cron — A SEQUÊNCIA DO LANÇAMENTO
 *
 * Pedido do dono (27/08): "disponibilizando um link ao final da live … mas caso não compre,
 * bom uma estratégia de remarketing e também uma de downsell com menor valor na assinatura".
 *
 * O QUE ESTE CRON FAZ E O QUE ELE **NÃO** FAZ
 * Ele cuida de quem VIU a oferta e nunca começou a comprar. Quem começou e não terminou já
 * é tratado por `recuperacao-checkout-cron.js` (rastro de compra 'pendente'), e os dois não
 * podem se sobrepor: por isso a fila daqui exclui quem tem compra pendente recente do mesmo
 * produto — senão a pessoa recebe dois e-mails diferentes sobre a mesma venda no mesmo dia,
 * e os dois parecem robô.
 *
 * A QUEM: inscritos da aula ao vivo (`live_inscricoes`) do evento, que ainda não têm o que
 * ela vende. Quem é o público sai da RPC `lancamento_publico`, não de dedução aqui.
 *
 * A AULA PODE VENDER DUAS COISAS (27/08):
 *   - PRODUTO (curso/eBook) — prazo = a janela de oferta do produto;
 *   - PLANO (Investidor Pro, Assessoria) — prazo = `eventos_live.oferta_fecha_em`, porque
 *     plano não tem janela própria: o preço dele é global e mudá-lo mexeria no site inteiro.
 *     Nesse caso o que fecha é a CONDIÇÃO anunciada na aula (bônus, acompanhamento), não o
 *     preço — e os textos daqui dizem exatamente isso, para não prometer desconto que a
 *     página de planos desmente em dois cliques.
 *
 * AS ETAPAS saem do RELÓGIO DA OFERTA, não da data da aula. É o prazo que faz decidir, e é
 * ele que a pessoa precisa ouvir:
 *   abertura       (falta mais de 40h)  — o link está no ar, isto é o que tem dentro
 *   vespera        (12h a 40h)          — a objeção mais comum, respondida
 *   ultima_chamada (menos de 12h)       — fecha hoje
 *   downsell       (até 36h DEPOIS)     — a oferta fechou; existe um degrau menor
 *                                        (só em oferta de PRODUTO — ver etapaPor)
 *
 * ⚠️ O DOWNSELL É A ÚNICA ETAPA QUE RODA COM A JANELA FECHADA. Isso é de propósito: mandar
 * "última chance" depois do fim seria mentira, e mandar o degrau menor ANTES do fim
 * canibalizaria a venda principal — quem ia pagar R$ 1.497 aceita R$ 37/mês se as duas
 * portas estiverem abertas ao mesmo tempo.
 *
 * REGRAS ANTI-SPAM (as mesmas do cron de recuperação, pelos mesmos motivos):
 *   - conta interna NUNCA (admin/analista/juridico/suporte/consultor/advogado);
 *   - perfil inativo fora;
 *   - UMA vez por usuário + produto + ETAPA, para sempre (não é janela de 30 dias: a
 *     etapa acontece uma vez no lançamento e repetir é spam);
 *   - no máximo UM e-mail por pessoa por execução;
 *   - teto de 60 envios por execução;
 *   - quem já assina não recebe a etapa de downsell — seria convidar a assinar quem assina.
 */
import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { enviarEmail } from './_email.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const ROLES_INTERNAS = new Set(['admin', 'analista', 'juridico', 'suporte', 'consultor', 'advogado']);
const ROLES_PAGANTES = new Set(['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual']);
const TETO_ENVIOS = 60;
const BASE = 'https://www.bidprobrasil.com.br';

// Etapa a partir das horas que faltam para a oferta fechar. Negativo = já fechou.
function etapaPor(horas, ofertaTipo) {
  if (horas > 40) return 'abertura';
  if (horas > 12) return 'vespera';
  if (horas > 0) return 'ultima_chamada';
  // O downsell existe para quem não comprou o CURSO: o degrau menor é a assinatura. Numa
  // aula que já vende a assinatura, não há degrau abaixo para oferecer — insistir depois do
  // prazo seria mandar de novo a mesma oferta com outra roupa, que é o que faz o inscrito
  // marcar como spam.
  if (horas > -36 && ofertaTipo === 'produto') return 'downsell';
  return null; // fechou há tempo demais (ou não há degrau): o lançamento acabou
}

function prazoTexto(fechaEm) {
  return new Date(fechaEm).toLocaleString('pt-BR', {
    timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function corpo(etapa, { nome, titulo, link, fechaEm, linkPlano, ofertaTipo }) {
  const primeiro = String(nome || '').trim().split(' ')[0] || 'investidor';
  const prazo = prazoTexto(fechaEm);
  const assinar = `\n\nAbraço,\nTarcísio Nogueira\nBidPro Brasil`;
  const ehPlano = ofertaTipo === 'plano';

  if (etapa === 'abertura') {
    // Em oferta de PLANO o texto fala da CONDIÇÃO, nunca do preço: o valor da assinatura é
    // o mesmo antes e depois da aula, e prometer desconto que a página de planos desmente
    // queima a confiança justamente de quem foi conferir — que é o mais interessado.
    return ehPlano ? {
      subject: `${titulo} — a condição da aula vale até ${prazo}`,
      text: `Olá, ${primeiro}!\n\nComo combinei na aula, é por aqui: ${link}\n\n`
        + `A condição que eu apresentei ao vivo vale até ${prazo}. O plano em si continua o `
        + `mesmo depois — o que fecha é o combinado da aula.\n\n`
        + `O ciclo de cobrança (mensal ou anual) você escolhe na própria tela de pagamento.\n\n`
        + `Dúvida antes de decidir? Responda este e-mail que eu mesmo respondo.${assinar}`,
    } : {
      subject: `${titulo} — a condição da aula está no ar até ${prazo}`,
      text: `Olá, ${primeiro}!\n\nComo combinei na aula, o link está aqui: ${link}\n\n`
        + `A condição especial vale até ${prazo}. Depois disso a página volta ao valor normal — `
        + `não é pressão de vendedor, é que eu abro essa condição junto com a aula e fecho junto com ela.\n\n`
        + `Se ficou alguma dúvida antes de decidir, responda este e-mail que eu mesmo respondo.${assinar}`,
    };
  }
  if (etapa === 'vespera') {
    if (ehPlano) {
      return {
        subject: 'A pergunta que mais me fazem sobre a plataforma',
        text: `Olá, ${primeiro}!\n\n"Isso serve para quem está começando?"\n\n`
          + `Serve, e por um motivo que eu mostrei ao vivo: o trabalho que eu levava dias para `
          + `fazer no braço — varrer leiloeiro por leiloeiro, ler edital e matrícula, calcular se `
          + `a conta fecha — a ferramenta faz em minutos. Quem está começando é justamente quem `
          + `mais perde tempo (e dinheiro) fazendo isso errado.\n\n${link}\n\n`
          + `A condição da aula vale até ${prazo}.${assinar}`,
      };
    }
    return {
      subject: `A dúvida que mais me perguntam sobre ${titulo}`,
      text: `Olá, ${primeiro}!\n\nA pergunta que mais recebo é: "eu preciso ter muito dinheiro para começar?".\n\n`
        + `Não. Meu primeiro imóvel de leilão foi arrematado por R$ 16 mil — estava avaliado em R$ 200 mil. `
        + `O que separa quem lucra de quem se enrosca não é capital, é saber ler o edital, a matrícula e o `
        + `processo antes de dar o lance. Foi ignorando uma linha de "efeito suspensivo" que eu mesmo fiquei `
        + `meses com dinheiro parado.\n\nÉ isso que está no ${titulo}: ${link}\n\n`
        + `A condição vale até ${prazo}.${assinar}`,
    };
  }
  if (etapa === 'ultima_chamada') {
    return {
      subject: `Encerra hoje: ${titulo}`,
      text: `Olá, ${primeiro}!\n\nA condição ${ehPlano ? 'que apresentei na aula' : `do ${titulo}`} `
        + `encerra hoje, ${prazo}.\n\n${link}\n\n`
        + `Se for para deixar passar, tudo bem — só não quero que passe por esquecimento.${assinar}`,
    };
  }
  // downsell
  return {
    subject: 'Fechou a condição do curso — mas tem um caminho menor',
    text: `Olá, ${primeiro}!\n\nA condição do ${titulo} encerrou. Não vou reabrir: quem entrou no prazo `
      + `pagou o preço combinado, e mudar isso depois seria injusto com essas pessoas.\n\n`
      + `Mas se o que te segurou foi o valor, tem um degrau menor: a própria ferramenta que eu usei na aula `
      + `para achar e avaliar os imóveis ao vivo. É com ela que eu trabalho todo dia, e ela sozinha já te `
      + `mostra as oportunidades da sua cidade com o laudo pronto.\n\n${linkPlano}\n\n`
      + `O curso continua disponível pelo valor normal quando fizer sentido para você.${assinar}`,
  };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'nao_autorizado' });

  // ── 1. Quais aulas têm oferta ligada ───────────────────────────────────────
  // Produto OU plano. O `or` do PostgREST em vez de dois `not is null` empilhados: com
  // `and` implícito, uma aula que vende só plano ficaria de fora e nunca mandaria nada.
  const { data: eventos, error: eEv } = await supabase.from('eventos_live')
    .select('slug, titulo, oferta_produto_tipo, oferta_produto_id, oferta_plano_key')
    .eq('ativo', true)
    .or('oferta_produto_id.not.is.null,oferta_plano_key.not.is.null');
  // Leitura falhou NÃO vira "nenhum lançamento em curso": aborta para o cron acusar.
  if (eEv) return res.status(500).json({ error: 'eventos_ilegiveis', detalhe: eEv.message });
  if (!eventos?.length) return res.status(200).json({ ok: true, eventos: 0, enviados: 0 });

  const fila = [];
  const porEvento = [];

  for (const ev of eventos) {
    const { data: publico, error: ePub } = await supabase.rpc('lancamento_publico', { p_evento_slug: ev.slug });
    if (ePub) return res.status(500).json({ error: 'publico_ilegivel', evento: ev.slug, detalhe: ePub.message });
    if (!publico?.length) { porEvento.push({ slug: ev.slug, publico: 0 }); continue; }

    // A etapa é a MESMA para todo o público do evento: ela vem do relógio da oferta.
    const fechaEm = publico[0].fecha_em;
    const ofertaTipo = publico[0].oferta_tipo;
    // Sem prazo não há sequência. Vale para os dois casos: curso sem janela cadastrada e
    // aula de plano sem `oferta_fecha_em`. Mandar "encerra hoje" sem data de encerramento
    // seria urgência inventada — e a pessoa percebe.
    if (!fechaEm) { porEvento.push({ slug: ev.slug, publico: publico.length, etapa: 'sem_prazo' }); continue; }
    const horas = (new Date(fechaEm).getTime() - Date.now()) / 3600000;
    const etapa = etapaPor(horas, ofertaTipo);
    porEvento.push({ slug: ev.slug, tipo: ofertaTipo, publico: publico.length, horas: Math.round(horas), etapa });
    if (!etapa) continue;

    const ids = publico.map(p => p.user_id);

    // Dedup: quem já recebeu ESTA etapa deste produto sai. `error` checado e ABORTA —
    // se esta leitura virasse lista vazia, "ninguém recebeu ainda" e todo mundo receberia
    // de novo. Melhor não mandar hoje do que mandar duas vezes.
    // Chave de dedup por OFERTA, não por produto: a mesma pessoa pode passar por um
    // lançamento de curso e depois por um de assinatura, e são sequências diferentes.
    const alvo = ofertaTipo === 'plano'
      ? `plano:${ev.oferta_plano_key}|${etapa}`
      : `${ev.oferta_produto_id}|${etapa}`;
    const { data: jaEnviados, error: eDedup } = await supabase.from('eventos_atividade')
      .select('user_id').eq('tipo', 'lancamento_email').eq('alvo', alvo).in('user_id', ids);
    if (eDedup) return res.status(500).json({ error: 'dedup_ilegivel', detalhe: eDedup.message });
    const bloqueados = new Set((jaEnviados || []).map(r => r.user_id));

    // Quem tem compra PENDENTE recente é do outro cron (recuperação de checkout). Mandar
    // os dois no mesmo dia sobre a mesma venda faz os dois parecerem automação cega.
    // Só se aplica a oferta de PRODUTO: assinatura abandonada não deixa linha em
    // compras_produtos, e filtrar por um id nulo devolveria lista vazia com cara de "ninguém".
    let emRecuperacao = new Set();
    if (ofertaTipo === 'produto') {
      const { data: pendentes, error: ePend } = await supabase.from('compras_produtos')
        .select('user_id').eq('produto_id', ev.oferta_produto_id).eq('status', 'pendente')
        .in('user_id', ids).gte('criado_em', new Date(Date.now() - 10 * 86400000).toISOString());
      if (ePend) return res.status(500).json({ error: 'pendentes_ilegiveis', detalhe: ePend.message });
      emRecuperacao = new Set((pendentes || []).map(r => r.user_id));
    }

    const { data: perfis, error: ePerfis } = await supabase.from('perfis')
      .select('id, nome, role, ativo').in('id', ids);
    if (ePerfis) return res.status(500).json({ error: 'perfis_ilegiveis', detalhe: ePerfis.message });
    const porId = new Map((perfis || []).map(p => [p.id, p]));

    for (const alvoPub of publico) {
      const p = porId.get(alvoPub.user_id);
      if (!p || p.ativo === false) continue;
      const role = String(p.role || 'explorador').toLowerCase();
      if (ROLES_INTERNAS.has(role)) continue;
      if (bloqueados.has(p.id) || emRecuperacao.has(p.id)) continue;
      // Downsell é convite para assinar: quem já assina não recebe.
      if (etapa === 'downsell' && ROLES_PAGANTES.has(role)) continue;
      if (fila.some(f => f.userId === p.id)) continue;   // um e-mail por pessoa por execução
      fila.push({
        userId: p.id, nome: p.nome || alvoPub.nome, etapa, alvo, ofertaTipo,
        titulo: alvoPub.titulo || ev.titulo,
        // Sem `&ciclo=`: mensal ou anual é escolha da pessoa na tela de pagamento, e um
        // parâmetro que o checkout não lê prometeria na URL o que a tela não cumpre.
        link: ofertaTipo === 'plano'
          ? `${BASE}/#/checkout?plano=${alvoPub.plano_key}`
          : `${BASE}/#/p/${alvoPub.produto_tipo}/${alvoPub.produto_id}`,
        linkPlano: `${BASE}/#/checkout?plano=top2`,
        fechaEm,
      });
    }
  }

  // ── 2. Envio ───────────────────────────────────────────────────────────────
  let enviados = 0;
  const erros = [];
  for (const item of fila.slice(0, TETO_ENVIOS)) {
    let email = null;
    try {
      const { data: u } = await supabase.auth.admin.getUserById(item.userId); // padrao-ok: best-effort por usuário — sem e-mail este usuário é PULADO, nunca vira envio errado
      email = u?.user?.email || null;
    } catch { /* segue sem este usuário */ }
    if (!email) continue;

    const c = corpo(item.etapa, item);
    const r = await enviarEmail({
      to: email, subject: c.subject, text: c.text,
      replyTo: 'contato@bidprobrasil.com.br',
      meta: { userId: item.userId, tipo: `lancamento_${item.etapa}` },
    });
    // Dedup só depois do aceite: envio que falhou hoje deve ser tentado de novo.
    if (r && r.ok !== false) {
      const { error: eGrava } = await supabase.from('eventos_atividade').insert({
        user_id: item.userId, tipo: 'lancamento_email', alvo: item.alvo,
        detalhe: `${item.etapa} para ${email}`,
      });
      // O e-mail já saiu e não volta. Se o dedup não gravou, a próxima execução repete —
      // então isto precisa GRITAR no log em vez de passar batido.
      if (eGrava) console.error('[lancamento] DEDUP NAO GRAVADO', item.userId, item.alvo, eGrava.message);
      enviados++;
    } else {
      erros.push(item.userId);
    }
  }

  return res.status(200).json({ ok: true, eventos: porEvento, aptos: fila.length, enviados, falhas: erros.length });
}
