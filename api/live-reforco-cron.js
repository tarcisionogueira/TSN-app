/**
 * GET /api/live-reforco-cron — O REFORÇO DO CONVITE DA AULA
 *
 * POR QUE EXISTE (31/08). O convite da edição de 02/09 saiu domingo 30/08 11h e o desfecho,
 * medido, foi: 73 entregues · **21 aberturas (28,8%)** · **0 cliques**. O rastreador funciona
 * (o tipo `convite_live` tem clique registrado em 29/08), então o zero é real — 21 pessoas
 * leram o convite e nenhuma chegou à página. Nenhum dos 4 inscritos veio do e-mail.
 *
 * TRÊS SITUAÇÕES, TRÊS PEÇAS. Um reenvio único para a base inteira responderia a mesma coisa
 * a problemas diferentes, e a única alavanca que sobra sem gastar mídia é acertar a peça:
 *
 *   assunto (52 hoje) — entregue e NÃO aberto. O que falhou foi o ASSUNTO; reenviar o mesmo
 *                       texto com o mesmo assunto é repetir o que já não funcionou.
 *   prova   (21 hoje) — ABRIU e não clicou. O assunto funcionou, a PROMESSA não converteu:
 *                       aqui vale dizer o que acontece na aula, em vez de convidar de novo.
 *   ultima  ( 0 hoje) — CLICOU e não se inscreveu. É o mais quente que existe; falta a vaga.
 *
 * ⚠️ "NÃO ABRIU" PODE SER "AINDA NÃO SEI", e essa é a armadilha central deste arquivo.
 * `aberto_em` chega por webhook. Tratar a ausência dele como desinteresse entrega atraso de
 * instrumentação como se fosse comportamento do cliente — a forma #1 desta base, aplicada a
 * marketing, e o prejuízo é concreto: manda "você não abriu" para quem abriu. MEDIDO sobre os
 * 149 e-mails com abertura: mediana 6 min, p80 5,7 h, **p90 17,2 h**, p95 26,7 h. Daí o corte
 * de 18 h DEPOIS DA ENTREGA (não do envio) antes de alguém ser chamado de "não abriu". Se a
 * entregabilidade mudar, refaça o p90 — o número é argumento, não gosto.
 *
 * AS JANELAS SÃO LARGAS + PORTÃO DE HORÁRIO. O cron roda de hora em hora, como o do lembrete,
 * e pela mesma razão: uma aula acontece UMA vez e uma janela de 1 h se perde numa execução
 * atrasada. Mas reforço é peça de marketing, e madrugada arruína abertura — então, além da
 * janela larga, há o portão `HORA_INICIO..HORA_FIM` no fuso do evento. Janela larga decide
 * SE cabe; o portão decide QUANDO sai; o dedup garante que sai uma vez só.
 *
 * O TETO É 2 POR PESSOA/EDIÇÃO, e está na RPC. Uma base de ~86 pessoas não aguenta três peças
 * numa semana, e a aula é SEMANAL: o que hoje parece insistência vira, em um mês, quatro
 * edições de e-mail. Quem não abriu nem o convite nem o reforço de segunda não recebe uma
 * terceira — silêncio ali é resposta, não etapa faltando.
 *
 * QUEM NUNCA FOI CONVIDADO NÃO É CASO DESTE ARQUIVO. Contas criadas depois do disparo de
 * domingo não precisam de reforço, precisam do CONVITE — e o buraco era o `convidar-live-cron`
 * rodar só aos domingos (`0 11 * * 0`) para uma aula de quarta: quem entrava de segunda a
 * quarta ficava de fora, toda semana. Eram 8 pessoas na edição de 02/09. Resolvido passando
 * aquele cron para DIÁRIO — o UNIQUE (evento_id, user_id, edicao) já impedia o convite duplo,
 * então diário só alcança quem ainda não foi alcançado.
 *
 * SECO: `?seco=1` conta quem receberia e NÃO envia nada. É como se confere antes de tocar em
 * ~70 caixas de entrada de uma vez.
 */
import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { enviarEmail } from './_email.js';
import { linkRastreado } from './_link-email.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { utmEmail } from './_utm.js';
import { escapeHtml } from './_sanitize.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const TZ = 'America/Bahia';        // mesmo fuso do lembrete: UTC-3, sem horário de verão
const TETO_ENVIOS = 300;
const HORAS_ESPERA = 18;           // p90 medido da abertura (17,2 h), arredondado para cima
const HORA_INICIO = 9;             // portão humano, no fuso do evento
const HORA_FIM = 21;

const esc = (s) => escapeHtml(String(s ?? ''));

// ── Régua e textos ficam EXPORTADOS ──────────────────────────────────────────
// Pelo mesmo motivo do cron do lembrete: a janela e o texto que chega ao cliente são o que
// precisa ser conferido antes de ir ao ar, e conferir uma CÓPIA da lógica não prova nada
// sobre a que roda. `npm run testar:reforco` exercita estas funções, não uma reescrita delas.

/**
 * Etapa a partir das horas que faltam para a aula. Faixas contíguas e sem sobreposição, para
 * que em qualquer instante exista NO MÁXIMO uma etapa ativa — duas etapas ativas ao mesmo
 * tempo mandariam dois e-mails no mesmo dia para pessoas de segmentos vizinhos.
 *
 * Numa aula de quarta 19h (BRT), com o convite saindo domingo 11h UTC:
 *   [44h, 70h)  cai na SEGUNDA   → 'assunto'
 *   [20h, 44h)  cai na TERÇA     → 'prova'
 *   [ 3h, 20h)  cai na QUARTA    → 'ultima'
 * Abaixo de 3 h o lembrete `agora` do outro cron já está fazendo esse trabalho, e duas
 * mensagens na mesma hora se anulam. Negativo = a aula começou: nada a mandar.
 */
export function etapaReforco(horas) {
  if (horas >= 3 && horas < 20) return 'ultima';
  if (horas >= 20 && horas < 44) return 'prova';
  if (horas >= 44 && horas < 70) return 'assunto';
  return null;
}

/** Hora local (fuso do evento) de um instante — o portão humano é decidido por ela. */
export function horaNoFuso(ts, tz = TZ) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(ts)));
}

/**
 * O portão de horário. Existe porque reforço mandado às 3h da manhã é reforço queimado: a
 * pessoa acorda com ele já enterrado na caixa. A janela larga garante que a etapa CABE no
 * calendário; isto garante que ela SAI numa hora em que alguém lê.
 */
export function emHoraDeEnviar(ts, tz = TZ) {
  const h = horaNoFuso(ts, tz);
  return h >= HORA_INICIO && h <= HORA_FIM;
}

/**
 * Os textos. Três ângulos, porque os três segmentos falharam em pontos diferentes do funil —
 * e nenhum deles repete o assunto do convite ("Quarta, 19h: eu avalio um imóvel de leilão ao
 * vivo com você"), que já foi testado nestas mesmas caixas.
 */
export function corpoReforco(etapa, { nome, ev, link, agora = Date.now() }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const saudacao = primeiro ? `Olá, ${primeiro}!` : 'Olá!';
  const quando = new Date(ev.data_hora).toLocaleString('pt-BR', {
    timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const hora = new Date(ev.data_hora).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  // Horas restantes só viram texto na etapa 'ultima', e mesmo lá em forma de DIA/HORA: contar
  // "faltam 11 horas" num e-mail que pode ser lido 40 min depois é prometer precisão falsa.
  const horasRestantes = (new Date(ev.data_hora).getTime() - agora) / 3600000;

  const botao = (texto) => `
    <p style="margin:24px 0">
      <a href="${esc(link)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:800;font-size:15px">${esc(texto)}</a>
    </p>`;
  const rodape = `
    <p style="font-size:12px;color:#94a3b8;margin-top:26px">BidPro Brasil · aula ao vivo, gratuita ·
      <a href="{{UNSUB}}" style="color:#94a3b8">cancelar e-mails</a></p>`;
  const moldura = (miolo) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">${miolo}${rodape}</div>`;

  if (etapa === 'assunto') {
    // Quem não abriu não viu NADA do convite — então esta peça é autossuficiente, e curta.
    // O ângulo muda de "venha assistir" para "traga o seu caso": participação converte mais
    // que espectador, e é a diferença real entre esta aula e um vídeo gravado.
    return {
      subject: 'Traga um lote seu e eu faço a conta ao vivo',
      html: moldura(`
        <p style="font-size:15px">${esc(saudacao)}</p>
        <p style="font-size:14px;line-height:1.7">${esc(quando)}, eu abro a plataforma e avalio um imóvel de leilão do começo ao fim — matrícula, edital, dívidas, quanto dá para pagar e onde é prejuízo.</p>
        <p style="font-size:14px;line-height:1.7"><strong>Se você mandar um lote que está namorando, eu uso o seu.</strong> É ao vivo, é de graça e dá para assistir de casa.</p>
        ${botao('Quero minha vaga →')}
        <p style="font-size:13px;color:#64748b;line-height:1.6">Se não puder assistir ao vivo, inscreva-se mesmo assim: mando o aviso antes de começar.</p>`),
      text: `${saudacao}\n\n${quando}, eu abro a plataforma e avalio um imóvel de leilão do começo ao fim: matrícula, edital, dívidas, quanto dá para pagar e onde é prejuízo.\n\nSe você mandar um lote que está namorando, eu uso o seu. Ao vivo, de graça, de casa.\n\nGarantir vaga: ${link}\n\nBidPro Brasil`,
    };
  }

  if (etapa === 'prova') {
    // Esta pessoa ABRIU o convite e não clicou: ela já sabe que existe uma aula e mesmo assim
    // parou. Convidar de novo não acrescenta — o que falta é saber o que, exatamente, ela leva
    // dali. Por isso a peça é uma pauta, não um convite.
    return {
      subject: `O que a gente vai fazer, na prática, ${hora === '19:00' ? 'quarta às 19h' : `em ${quando}`}`,
      html: moldura(`
        <p style="font-size:15px">${esc(saudacao)}</p>
        <p style="font-size:14px;line-height:1.7">Você viu o convite da aula e talvez tenha ficado a dúvida do que ela é, na prática. É isto, na ordem:</p>
        <ol style="font-size:14px;line-height:1.9;padding-left:20px;margin:14px 0">
          <li>Pego um lote real que está em leilão agora e leio a <strong>matrícula</strong> na tela — o que trava e o que não trava.</li>
          <li>Abro o <strong>edital</strong>: quem paga a dívida, se dá para parcelar, qual é a entrada.</li>
          <li>Faço a <strong>conta</strong>: quanto sai o imóvel de fato, com custos, e qual é o lance máximo que ainda faz sentido.</li>
          <li>Respondo perguntas até acabar.</li>
        </ol>
        <p style="font-size:14px;line-height:1.7">São 90 minutos, ${esc(quando)}.</p>
        ${botao('Reservar minha vaga →')}`),
      text: `${saudacao}\n\nO que a aula é, na prática:\n1) Leio a matrícula de um lote real na tela — o que trava e o que não trava.\n2) Abro o edital: quem paga a dívida, se dá para parcelar, qual a entrada.\n3) Faço a conta: quanto sai de fato e qual o lance máximo que ainda faz sentido.\n4) Respondo perguntas até acabar.\n\n90 minutos, ${quando}.\n\nReservar vaga: ${link}\n\nBidPro Brasil`,
    };
  }

  // 'ultima' — clicou e não concluiu. Não há o que explicar: só remover o atrito.
  const eHoje = horasRestantes < 20 ? 'hoje' : null;
  return {
    subject: eHoje ? `Sua vaga de hoje às ${hora} ainda está aberta` : `Sua vaga ainda está aberta`,
    html: moldura(`
      <p style="font-size:15px">${esc(saudacao)}</p>
      <p style="font-size:14px;line-height:1.7">Você chegou a abrir a página da aula${eHoje ? ' de hoje' : ''} e não terminou a inscrição. A vaga continua aberta — é um clique, e não pede cartão.</p>
      <p style="font-size:15px;line-height:1.7;background:#f1f5f9;border-radius:10px;padding:14px 16px">📅 <strong>${esc(quando)}</strong><br><span style="font-size:13px;color:#475569">horário de Brasília</span></p>
      ${botao('Concluir minha inscrição →')}
      <p style="font-size:13px;color:#64748b;line-height:1.6">Não vai dar para assistir ao vivo? Inscreva-se assim mesmo — quem está inscrito recebe o aviso e o link da sala.</p>`),
    text: `${saudacao}\n\nVocê abriu a página da aula${eHoje ? ' de hoje' : ''} e não terminou a inscrição. A vaga continua aberta — é um clique e não pede cartão.\n\n${quando} (horário de Brasília)\n\nConcluir: ${link}\n\nBidPro Brasil`,
  };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'nao_autorizado' });
  const seco = String(req.query?.seco || '') === '1';
  const agora = Date.now();

  // ── 1. Aulas dentro do horizonte ───────────────────────────────────────────
  // 70 h cobre a etapa mais distante. NÃO rolamos a aula recorrente aqui: quem rola é o cron
  // do lembrete, e dois donos para a mesma escrita é como se cria corrida.
  const { data: eventos, error: eEv } = await supabase.from('eventos_live')
    .select('id, slug, titulo, data_hora')
    .eq('ativo', true)
    .gt('data_hora', new Date(agora).toISOString())
    .lt('data_hora', new Date(agora + 70 * 3600000).toISOString());
  // Leitura que falhou NÃO é "não há aula": aborta, para o cron acusar em vez de sair verde
  // tendo mandado zero reforço na semana da aula.
  if (eEv) return res.status(500).json({ error: 'eventos_ilegiveis', detalhe: eEv.message });
  if (!eventos?.length) return res.status(200).json({ ok: true, eventos: 0, enviados: 0 });

  const relatorio = [];
  const fila = [];

  for (const ev of eventos) {
    const horas = (new Date(ev.data_hora).getTime() - agora) / 3600000;
    const etapa = etapaReforco(horas);
    const linha = { slug: ev.slug, horas: Math.round(horas * 10) / 10, etapa };

    if (!etapa) { relatorio.push({ ...linha, motivo: 'fora de janela' }); continue; }
    if (!emHoraDeEnviar(agora)) {
      relatorio.push({ ...linha, motivo: `fora do horario (${horaNoFuso(agora)}h, envia entre ${HORA_INICIO}h e ${HORA_FIM}h)` });
      continue;
    }

    // A edição é o DIA da ocorrência no fuso do evento — a mesma chave que `live_convite_envio`
    // usa. Derivar de UTC faria a aula das 19h (22h UTC) virar edição do dia seguinte.
    const edicao = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ev.data_hora));

    const { data: alvos, error: eAlvos } = await supabase.rpc('live_reforco_alvos', {
      p_evento: ev.id, p_edicao: edicao, p_etapa: etapa, p_horas_espera: HORAS_ESPERA,
    });
    // Erro aqui NÃO pode virar "ninguém é alvo": seria a decisão de não mandar nada disfarçada
    // de resultado. Aborta e deixa a próxima rodada (de hora em hora) tentar de novo.
    if (eAlvos) return res.status(500).json({ error: 'alvos_ilegiveis', evento: ev.slug, etapa, detalhe: eAlvos.message });

    relatorio.push({ ...linha, edicao, alvos: (alvos || []).length });
    for (const a of alvos || []) {
      if (!a.email) continue;
      fila.push({ ev, etapa, edicao, userId: a.user_id, nome: a.nome, email: a.email });
    }
  }

  if (seco) {
    return res.status(200).json({ ok: true, seco: true, eventos: relatorio, receberiam: fila.length });
  }

  // ── 2. Envio, com o CLAIM antes ────────────────────────────────────────────
  let enviados = 0;
  const falhas = [];
  for (const item of fila.slice(0, TETO_ENVIOS)) {
    const tipo = `live_reforco_${item.etapa}`;
    // CLAIM PRIMEIRO. O UNIQUE (evento_id, user_id, edicao, etapa) é o que segura o segundo
    // e-mail se duas rodadas se cruzarem ou se uma execução morrer depois do envio. 409 aqui
    // significa "outra rodada já pegou esta pessoa" — seguir em frente é o certo.
    const { data: claim, error: eClaim } = await supabase.from('live_reforco_envio')
      .insert({ evento_id: item.ev.id, edicao: item.edicao, user_id: item.userId, etapa: item.etapa })
      .select('id')
      .maybeSingle();
    if (eClaim) {
      if (eClaim.code !== '23505') falhas.push({ email: item.email, motivo: `claim: ${eClaim.message}` });
      continue;
    }

    const caminho = `/aula/${item.ev.slug}?${utmEmail(`aula-${item.edicao}`, `reforco-${item.etapa}`)}`;
    const c = corpoReforco(item.etapa, {
      nome: item.nome, ev: item.ev, agora,
      link: linkRastreado(item.userId, tipo, caminho),
    });
    const html = c.html.replace('{{UNSUB}}', `${BASE}/api/cancelar-alertas?token=${assinarUnsub(item.userId)}`);

    const r = await enviarEmail({
      from: FROM, to: item.email, subject: c.subject, html, text: c.text,
      replyTo: 'contato@bidprobrasil.com.br',
      meta: { userId: item.userId, tipo },
    });
    const ok = !!(r && r.ok !== false);

    // DESFECHO REAL NO CLAIM. Sem isto, "reforçado" significaria apenas "tentei" — foi
    // exatamente essa distinção que fez o relatório do convite ser confiável.
    const { error: eFecha } = await supabase.from('live_reforco_envio')
      .update({ email_ok: ok }).eq('id', claim?.id).select('id');
    if (eFecha) console.error('[live-reforco] DESFECHO NAO GRAVADO', item.email, item.etapa, eFecha.message);

    if (ok) enviados++;
    else falhas.push({ email: item.email, motivo: r?.error || 'desconhecido' });
  }

  return res.status(200).json({
    ok: true, eventos: relatorio, aptos: fila.length, enviados,
    falhas: falhas.length, detalhe_falhas: falhas.slice(0, 5),
  });
}
