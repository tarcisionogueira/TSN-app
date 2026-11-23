/**
 * /api/email-agendados-cron — envia os e-mails AGENDADOS da Caixa (23/11, pedido do dono: "agendar envio",
 * como a seta do Enviar no Gmail). A cada 5 min (vercel.json). CRON_SECRET.
 *
 * O agendado é um rascunho com `agendado_para` (migração email_cco_e_agendamento.sql). Vencido, ele é
 * REIVINDICADO por um PATCH condicional (`agendamento_status=eq.agendado` → 'enviando'): duas execuções
 * sobrepostas nunca mandam o mesmo e-mail, porque só uma recebe a linha de volta. O envio é a MESMA função
 * do botão Enviar (`enviarDaCaixa`), com o perfil de QUEM AGENDOU — acesso conferido de novo na hora (quem
 * perdeu o acesso à caixa entre agendar e enviar não envia). A `chave_envio` gravada ao agendar vai como
 * chave de idempotência do Resend: uma repetição não sai duas vezes.
 *
 * Saiu → o rascunho é apagado (como no envio na hora). Não saiu → 'falhou' com o motivo, à vista na pasta
 * Agendados. 'enviando' parado há > 15 min (função caiu no meio) → 'falhou' com aviso para conferir
 * Enviados antes de reenviar: não dá para saber daqui se o e-mail chegou a sair.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { SUPABASE_URL, SERVICE_KEY, sb, ler1, acessoCaixa, enviarDaCaixa } from './_caixa-envio.js';

const LOTE = 10;
const TRAVADO_MIN = 15;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// PATCH que PROVA o que mudou (`return=representation`): RLS não se aplica à service key, mas o filtro
// condicional sim — linha que outro já pegou volta vazia, e isso é a resposta, não um erro.
async function patch(filtro, corpo) {
  const r = await sb(`email_rascunhos?${filtro}`, { method: 'PATCH', prefer: 'return=representation', body: corpo });
  if (!r.ok) throw new Error(`PATCH email_rascunhos HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  return r.json();
}
const falhou = (id, erro) => patch(`id=eq.${id}`, { agendamento_status: 'falhou', agendamento_erro: String(erro || 'falha desconhecida').slice(0, 500), atualizado_em: new Date().toISOString() });

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase ausente' }, 500);

  const agora = new Date();
  const resumo = { travados: 0, vencidos: 0, enviados: 0, falharam: 0, disputados: 0 };

  // 1) Envio interrompido no meio (a função caiu depois de reivindicar).
  try {
    const limite = new Date(agora.getTime() - TRAVADO_MIN * 60e3).toISOString();
    const t = await patch(`agendamento_status=eq.enviando&atualizado_em=lt.${encodeURIComponent(limite)}`, {
      agendamento_status: 'falhou', atualizado_em: agora.toISOString(),
      agendamento_erro: 'O envio foi interrompido no meio. Confira em Enviados se ele saiu ANTES de reenviar.',
    });
    resumo.travados = t.length;
  } catch (e) { console.error('[email-agendados] destravar:', e.message); }

  // 2) Vencidos, mais antigo primeiro.
  const r = await sb(`email_rascunhos?agendamento_status=eq.agendado&agendado_para=lte.${encodeURIComponent(agora.toISOString())}&order=agendado_para.asc&limit=${LOTE}&select=*`);
  if (!r.ok) {
    console.error('[email-agendados] leitura dos vencidos HTTP', r.status);
    return json({ error: `leitura dos agendados falhou (HTTP ${r.status})` }, 500);
  }
  const vencidos = await r.json();
  resumo.vencidos = vencidos.length;

  for (const a of vencidos) {
    let meu;
    try {
      meu = await patch(`id=eq.${a.id}&agendamento_status=eq.agendado`, {
        agendamento_status: 'enviando', agendamento_tentativas: (a.agendamento_tentativas || 0) + 1, atualizado_em: new Date().toISOString(),
      });
    } catch (e) { console.error('[email-agendados] reivindicar', a.id, e.message); continue; }
    if (!meu.length) { resumo.disputados += 1; continue; } // outra execução pegou, ou foi cancelado agora

    try {
      const perfil = await ler1(`perfis?id=eq.${a.user_id}&select=role,funcao_equipe,nome`);
      const { permitido, soPessoal } = acessoCaixa(perfil);
      if (!permitido) { await falhou(a.id, 'Quem agendou não tem mais acesso à caixa de e-mail. Nada foi enviado.'); resumo.falharam += 1; continue; }
      const corpo = {
        acao: 'enviar', de: a.de, para: a.para, cc: a.cc, cco: a.cco, assunto: a.assunto, texto: a.texto,
        responder_a: a.responder_a || undefined, citar: a.citar === true, caso_id: a.caso_id || undefined,
        anexos: Array.isArray(a.anexos) && a.anexos.length ? a.anexos.map(({ arquivo, nome, inline }) => ({ arquivo, nome, inline })) : undefined,
        encaminhar_anexos: Array.isArray(a.encaminhar_anexos) && a.encaminhar_anexos.length ? a.encaminhar_anexos : undefined,
        chave_envio: a.chave_envio || undefined,
      };
      const env = await enviarDaCaixa({ user: { id: a.user_id }, perfil, soPessoal, body: corpo });
      if (!env.obj?.ok) { await falhou(a.id, env.obj?.error || `HTTP ${env.status}`); resumo.falharam += 1; continue; }
      resumo.enviados += 1;
      // Saiu: o rascunho some, como no envio na hora. Se não conseguir apagar, ele NÃO pode voltar a
      // 'agendado' (sairia de novo) — vira rascunho comum, com o aviso no erro.
      const d = await sb(`email_rascunhos?id=eq.${a.id}`, { method: 'DELETE', prefer: 'return=representation' });
      const apagado = d.ok ? await d.json().catch(() => []) : [];
      if (!apagado.length) {
        console.error('[email-agendados] enviado, mas o rascunho ficou', a.id, d.status);
        await patch(`id=eq.${a.id}`, { agendamento_status: null, agendado_para: null, agendamento_erro: `Este e-mail JÁ FOI ENVIADO em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — não envie de novo.` })
          .catch((e) => console.error('[email-agendados] nem o aviso gravou', a.id, e.message));
      }
    } catch (e) {
      console.error('[email-agendados] envio', a.id, e.message);
      await falhou(a.id, `Erro no envio agendado: ${e.message}`).catch((e2) => console.error('[email-agendados] gravar falha', a.id, e2.message));
      resumo.falharam += 1;
    }
  }

  // Batimento: sem ele, cron parado e "nada agendado" seriam indistinguíveis.
  const hb = await sb('rpc/registrar_heartbeat', { method: 'POST', body: { p_chave: 'email_agendados', p_detalhe: JSON.stringify(resumo) } });
  if (!hb.ok) console.error('[email-agendados] heartbeat HTTP', hb.status);

  return json({ ok: true, ...resumo });
}
