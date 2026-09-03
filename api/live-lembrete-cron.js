/**
 * GET /api/live-lembrete-cron — O LEMBRETE PRÉ-AULA
 *
 * POR QUE ELE EXISTE (28/08): o e-mail de confirmação da inscrição prometia, com todas as
 * letras, "o lembrete antes de começar" — e ninguém o enviava. Procurei nos 56 crons
 * agendados: `lancamento-remarketing-cron` é a sequência do DEPOIS da aula. Quem se
 * inscrevia recebia a confirmação e silêncio até o dia. E o `link_sala` do evento não era
 * nem LIDO em `api/live-inscrever.js` (a consulta pedia só `link_grupo`), então o endereço
 * da sala dependia de dois atos manuais: a pessoa entrar no grupo do WhatsApp, e alguém
 * lembrar de postar o link lá. Uma promessa entregue como se fosse mecanismo, em cima de
 * tráfego pago. Este arquivo é o mecanismo.
 *
 * DUAS ETAPAS, e cada uma responde a uma pergunta diferente:
 *   vespera (12h–30h antes) — "é amanhã": chega a tempo de a pessoa reservar a noite, e leva
 *                             o link de adicionar na agenda, que é o que faz ela lembrar.
 *   agora   (0h–2h30 antes)  — "começa hoje às 19h": chega quando a decisão é entrar ou não.
 * As duas carregam o `link_sala`. É o ponto do conserto.
 *
 * "AMANHÃ" É CONTA DE CALENDÁRIO, NÃO DE HORAS. Ver `diasAte` abaixo: a primeira versão deste
 * arquivo dizia "sua aula é amanhã" na ponta baixa da janela da véspera, que numa aula às 19h
 * cai às 6h DA MANHÃ DO PRÓPRIO DIA.
 *
 * AS JANELAS SÃO LARGAS DE PROPÓSITO. O cron roda de hora em hora; uma janela de exatamente
 * 1h perderia o disparo se uma execução falhasse ou atrasasse — e uma aula acontece UMA vez,
 * não há próxima rodada para consertar. Janela larga + dedup em `live_lembretes` dá o que
 * interessa: no máximo um envio por pessoa/etapa, e ele acontece mesmo que uma execução caia.
 * Quem se inscreve DENTRO da janela da véspera ainda a recebe; quem se inscreve depois dela
 * (faltando menos de 12h) pega só o lembrete do dia, que é o certo — mandar "é amanhã"
 * para quem se inscreveu hoje seria robô falando sozinho.
 *
 * O QUE ESTE CRON NÃO FAZ: não exclui conta interna. Os outros crons excluem, e com razão —
 * eles empurram marketing para quem não pediu. Aqui é o contrário: a pessoa PEDIU, deixou
 * telefone e cidade para receber exatamente isto. Excluir role interna faria o dono não
 * receber o lembrete da própria aula, e — pior — tornaria o fluxo impossível de testar por
 * quem precisa testá-lo antes da quarta.
 *
 * COMO REENVIAR (para testar): apague a linha em `live_lembretes`. A chave é
 * (evento_id, email, etapa) e o dedup é a única coisa que segura o reenvio.
 *
 * ELE TAMBÉM ROLA A AULA SEMANAL (28/08). Antes de procurar o que lembrar, chama
 * `live_rolar_recorrentes()`: passada a aula E fechada a janela de oferta, `data_hora` avança
 * para a quarta seguinte. Sem isso, "recorrência semanal" era só um texto na landing — e este
 * cron nunca mais teria o que fazer, porque ele só olha aula no FUTURO.
 */
import { isCronAuthorized } from './_auth.js';
import { edicaoDe } from './_live-edicao.js';
import { createClient } from '@supabase/supabase-js';
import { enviarEmail } from './_email.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const TETO_ENVIOS = 300;
const TZ = 'America/Bahia';   // mesmo fuso que o resto da aula usa (UTC-3, sem horário de verão)

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Exportadas (junto de `corpo`) para poderem ser exercitadas fora do handler: a régua de
// janela e o texto que vai ao cliente são o que precisa ser conferido antes de ir ao ar,
// e conferir uma CÓPIA da lógica não prova nada sobre a que roda.
// Etapa a partir das horas que faltam. Negativo = a aula já começou: nada a mandar (um
// "estamos começando" atrasado é pior do que nenhum — anuncia que o remetente não sabe as horas).
export function etapaPor(horas) {
  if (horas > 12 && horas <= 30) return 'vespera';
  // (0, 2.5] e não (0, 1.5]: com o cron de hora em hora, uma janela de 1,5h é alcançada por
  // UMA única rodada — e se ela falhar ou atrasar, ninguém recebe o link, numa aula que
  // acontece uma vez só. Com 2,5h duas rodadas caem dentro e a segunda cobre a primeira (o
  // dedup faz dela um no-op quando a primeira deu certo). O preço é o disparo sair ~2h antes
  // em vez de ~1h — por isso o texto desta etapa diz "é HOJE, às 19h" e não "estamos
  // começando agora": a mensagem tem de ser verdadeira nas duas pontas da janela.
  if (horas > 0 && horas <= 2.5) return 'agora';
  return null;
}

// "Amanhã" é conta de CALENDÁRIO, não de horas — e essa diferença mordeu na primeira versão
// deste arquivo. A janela da véspera vai de 30h a 12h antes; numa aula às 19h, 13h antes é
// 6h da MANHÃ DO MESMO DIA, e o e-mail sairia dizendo "sua aula é amanhã" no dia da aula.
// Some-se que o corte cai no meio da madrugada e o defeito só apareceria em produção, uma
// única vez, no pior dia possível. Aqui a palavra vem da data no fuso do evento.
function diaNoFuso(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function diasAte(agora, alvo) {
  const a = Date.parse(`${diaNoFuso(new Date(agora))}T00:00:00Z`);
  const b = Date.parse(`${diaNoFuso(new Date(alvo))}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

// Link "adicionar na agenda" do Google. É URL, não anexo .ics de propósito: anexo em e-mail
// de campanha derruba entregabilidade e boa parte dos clientes móveis nem oferece abrir.
function linkAgenda(ev) {
  const ini = new Date(ev.data_hora);
  const fim = new Date(ini.getTime() + (ev.duracao_min || 90) * 60000);
  const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.titulo,
    dates: `${f(ini)}/${f(fim)}`,
    details: ev.link_sala ? `Sala: ${ev.link_sala}` : '',
    location: ev.link_sala || '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function corpo(etapa, { nome, ev, agora = Date.now() }) {
  // Saudação sem nome quando não há nome. `nome` é NOT NULL e validado na inscrição, então
  // isto não deve acontecer — mas "Olá, !" num e-mail de campanha é o tipo de detalhe que
  // só aparece quando já saiu para todo mundo.
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  const saudacao = primeiro ? `Olá, ${primeiro}!` : 'Olá!';
  const dias = diasAte(agora, ev.data_hora);
  const quandoPalavra = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : null;
  const quando = new Date(ev.data_hora).toLocaleString('pt-BR', {
    timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const hora = new Date(ev.data_hora).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const sala = ev.link_sala || '';
  const zap = ev.whatsapp_direto ? `https://wa.me/${String(ev.whatsapp_direto).replace(/\D/g, '')}` : '';

  const botao = sala
    ? `<p style="margin:22px 0"><a href="${esc(sala)}" style="background:#16a34a;color:#fff;text-decoration:none;padding:14px 26px;border-radius:10px;font-weight:700;font-size:15px">Entrar na sala →</a></p>
       <p style="font-size:12px;color:#64748b;word-break:break-all">Se o botão não abrir: ${esc(sala)}</p>`
    // Sem link de sala cadastrado o lembrete AINDA vale (a pessoa precisa saber que é hoje),
    // mas não se inventa um endereço: aponta para o canal humano em vez de prometer o que não há.
    : `<p style="font-size:14px;line-height:1.7">O link da sala vai ser enviado no grupo do WhatsApp minutos antes.</p>`;

  if (etapa === 'vespera') {
    // Sem palavra confiável (a aula não é nem hoje nem amanhã no fuso dela), cai para a data
    // por extenso — que é sempre verdadeira. Nunca se escolhe entre "hoje" e "amanhã" no chute.
    const eQuando = quandoPalavra ? `é <strong>${quandoPalavra}</strong>` : `é <strong>${esc(quando)}</strong>`;
    return {
      subject: quandoPalavra ? `É ${quandoPalavra}: ${ev.titulo}` : `Falta pouco: ${ev.titulo}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <p style="font-size:15px">${esc(saudacao)}</p>
        <p style="font-size:14px;line-height:1.7">Sua aula ${eQuando}. Guarde este e-mail: o link da sala está aqui.</p>
        <p style="font-size:15px;line-height:1.7;background:#f1f5f9;border-radius:10px;padding:14px 16px">
          📅 <strong>${esc(quando)}</strong><br>
          <span style="font-size:13px;color:#475569">Horário de Brasília</span>
        </p>
        ${botao}
        <p style="font-size:14px;line-height:1.7"><a href="${esc(linkAgenda(ev))}">Adicionar na minha agenda</a></p>
        ${ev.link_grupo ? `<p style="font-size:13px;line-height:1.7;color:#475569">Vou avisar também no grupo: <a href="${esc(ev.link_grupo)}">entrar no grupo do WhatsApp</a>.</p>` : ''}
        <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil</p>
      </div>`,
      text: `${saudacao}\n\nSua aula é ${quandoPalavra ? quandoPalavra.toUpperCase() : 'em breve'}: ${ev.titulo}\n${quando} (horário de Brasília)\n${sala ? `\nSala: ${sala}\n` : '\nO link da sala será enviado no grupo do WhatsApp minutos antes.\n'}\nAdicionar na agenda: ${linkAgenda(ev)}\n${ev.link_grupo ? `Grupo do WhatsApp: ${ev.link_grupo}\n` : ''}\nBidPro Brasil`,
    };
  }

  // "Começa às 19h" é verdade a 2h e a 1h da aula; "estamos começando agora" só seria verdade
  // na ponta de baixo da janela, e a janela é larga justamente para sobreviver a uma rodada
  // perdida. Texto que só vale numa das pontas transforma a rede de segurança em mentira.
  const eHoje = quandoPalavra === 'hoje' ? 'hoje, ' : '';
  return {
    subject: `Começa ${eHoje}às ${hora}: ${ev.titulo}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
      <p style="font-size:15px">${esc(saudacao)}</p>
      <p style="font-size:14px;line-height:1.7">Sua aula começa <strong>${esc(eHoje)}às ${esc(hora)}</strong>, horário de Brasília. É só entrar pelo link abaixo.</p>
      ${botao}
      ${zap ? `<p style="font-size:13px;line-height:1.7;color:#475569">Algum problema para entrar? <a href="${esc(zap)}">Chame no WhatsApp</a>.</p>` : ''}
      <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil</p>
    </div>`,
    text: `${saudacao}\n\nSua aula começa ${eHoje}às ${hora} (horário de Brasília) — ${ev.titulo}\n${sala ? `\nSala: ${sala}\n` : '\nO link da sala será enviado no grupo do WhatsApp.\n'}${zap ? `\nProblemas para entrar? ${zap}\n` : ''}\nBidPro Brasil`,
  };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'nao_autorizado' });

  // ── 0. A AULA SEMANAL ROLA PARA A PRÓXIMA OCORRÊNCIA ───────────────────────
  // `recorrencia = 'semanal'` era promessa sem mecanismo: a landing dizia "toda quarta", o
  // Google Agenda recebia a RRULE e `data_hora` ficava parada na primeira ocorrência. Passada
  // a aula, a página anunciava data vencida e ESTE cron não tinha mais o que lembrar — a
  // consulta abaixo pede `data_hora > agora`. Aqui, antes de tudo, o banco avança a data
  // (só depois de a aula terminar E a janela de oferta fechar; o porquê está na migração
  // `live_rolar_aula_recorrente.sql`). Erro NÃO aborta o lembrete: rolar é manutenção, mandar
  // o lembrete de uma aula que já está marcada é a obrigação — e a segunda não depende da
  // primeira.
  let rolagem = null;
  try {
    const { data, error } = await supabase.rpc('live_rolar_recorrentes');
    if (error) console.error('[live-lembrete] rolagem falhou:', error.message);
    else { rolagem = data; if (data?.roladas > 0) console.log('[live-lembrete] aula(s) roladas:', JSON.stringify(data.eventos)); }
  } catch (e) { console.error('[live-lembrete] rolagem lançou:', e?.message); }

  // ── 1. Aulas dentro do horizonte ───────────────────────────────────────────
  // 31h para a frente cobre a janela da véspera com folga. `data_hora` é a PRÓXIMA
  // ocorrência concreta, inclusive num evento recorrente — é ela que manda.
  const agora = Date.now();
  const { data: eventos, error: eEv } = await supabase.from('eventos_live')
    .select('id, slug, titulo, data_hora, duracao_min, link_sala, link_grupo, whatsapp_direto')
    .eq('ativo', true)
    .gt('data_hora', new Date(agora).toISOString())
    .lt('data_hora', new Date(agora + 31 * 3600000).toISOString());
  // Leitura que falhou NÃO é "não há aula". Aborta para o cron acusar, em vez de sair
  // verde tendo mandado zero e-mail na véspera da única aula do mês.
  if (eEv) return res.status(500).json({ error: 'eventos_ilegiveis', detalhe: eEv.message });
  if (!eventos?.length) return res.status(200).json({ ok: true, eventos: 0, enviados: 0, rolagem });

  const fila = [];
  const porEvento = [];

  for (const ev of eventos) {
    const horas = (new Date(ev.data_hora).getTime() - agora) / 3600000;
    const etapa = etapaPor(horas);
    if (!etapa) { porEvento.push({ slug: ev.slug, horas: Math.round(horas * 10) / 10, etapa: null }); continue; }

    // A EDIÇÃO desta ocorrência (03/09). O evento semanal reusa o mesmo `id`, então sem ela
    // as duas consultas abaixo misturam semanas: os inscritos viriam de TODAS as edições, e
    // o dedup do lembrete de 09/09 bateria no lembrete já enviado em 02/09 — quem ESTÁ
    // inscrito ficaria sem o link da sala, e o cron sairia verde tendo mandado zero e-mail.
    const edicao = edicaoDe(ev.data_hora);

    const { data: inscritos, error: eIns } = await supabase.from('live_inscricoes')
      .select('id, nome, email, user_id').eq('evento_id', ev.id).eq('edicao', edicao);
    if (eIns) return res.status(500).json({ error: 'inscritos_ilegiveis', evento: ev.slug, detalhe: eIns.message });

    // Dedup. `error` checado e ABORTA: se esta leitura virasse lista vazia, o cron
    // concluiria "ninguém recebeu ainda" e reenviaria para a lista inteira — de hora em
    // hora, durante toda a janela. Melhor não mandar nesta rodada do que mandar de novo.
    const { data: jaEnviados, error: eDedup } = await supabase.from('live_lembretes')
      .select('email').eq('evento_id', ev.id).eq('etapa', etapa).eq('edicao', edicao);
    if (eDedup) return res.status(500).json({ error: 'dedup_ilegivel', evento: ev.slug, detalhe: eDedup.message });
    const bloqueados = new Set((jaEnviados || []).map(r => String(r.email || '').toLowerCase()));

    let aptos = 0;
    for (const i of inscritos || []) {
      const email = String(i.email || '').toLowerCase();
      if (!email || bloqueados.has(email)) continue;
      if (fila.some(f => f.email === email && f.eventoId === ev.id)) continue;
      fila.push({ eventoId: ev.id, edicao, inscricaoId: i.id, userId: i.user_id || null, email, nome: i.nome, etapa, ev });
      aptos++;
    }
    porEvento.push({
      slug: ev.slug, horas: Math.round(horas * 10) / 10, etapa,
      edicao, inscritos: (inscritos || []).length, ja_enviados: bloqueados.size, aptos,
      // Um lembrete cuja graça é o link da sala, mandado sem link de sala, é meio lembrete.
      // Fica no retorno para aparecer no log em vez de virar surpresa no dia.
      sem_link_sala: !ev.link_sala || undefined,
    });
  }

  // ── 2. Envio ───────────────────────────────────────────────────────────────
  let enviados = 0;
  const falhas = [];
  for (const item of fila.slice(0, TETO_ENVIOS)) {
    // `agora` explícito: o mesmo instante que decidiu a etapa decide a palavra do texto.
    // Deixar cair no default seria ler o relógio duas vezes e deixar a fresta aberta para a
    // rodada que atravessa a virada do dia dizer 'amanhã' sobre uma aula que é hoje.
    const c = corpo(item.etapa, { ...item, agora });
    const r = await enviarEmail({
      to: item.email, subject: c.subject, html: c.html, text: c.text,
      replyTo: 'contato@bidprobrasil.com.br',
      meta: { userId: item.userId, tipo: `live_lembrete_${item.etapa}` },
    });
    // Dedup só DEPOIS do aceite: um envio que falhou agora deve ser tentado na próxima
    // rodada — é para isso que a janela é larga.
    if (r && r.ok !== false) {
      const { error: eGrava } = await supabase.from('live_lembretes').insert({
        evento_id: item.eventoId, edicao: item.edicao, email: item.email, etapa: item.etapa, inscricao_id: item.inscricaoId,
      });
      // O e-mail já saiu e não volta. Se a prova não gravou, a próxima rodada repete —
      // então isto tem de GRITAR no log, não passar batido.
      if (eGrava) console.error('[live-lembrete] DEDUP NAO GRAVADO', item.email, item.etapa, eGrava.message);
      enviados++;
    } else {
      falhas.push({ email: item.email, motivo: r?.error || 'desconhecido' });
    }
  }

  return res.status(200).json({ ok: true, rolagem, eventos: porEvento, aptos: fila.length, enviados, falhas: falhas.length, detalhe_falhas: falhas.slice(0, 5) });
}
