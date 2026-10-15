/**
 * /api/juridico-devolutivas-cron — a IA lê as respostas do escritório e aprende (15/10, pedido do dono).
 *
 * Para cada resposta NOVA do jurídico ligada a um caso (email_caixa: direcao='entrada', caso_id, sem
 * análise ainda), lê a conversa inteira do caso (inclusive o histórico importado do Gmail da Reimob) e
 * grava em caso_acompanhamento_analise:
 *   - situação, último movimento e o que se aguarda;
 *   - o que é pendência NOSSA (vai num resumo ao dono, para a decisão);
 *   - o intervalo do próximo acompanhamento: 14 dias quando o que se espera é lento (decisão judicial,
 *     carta de arrematação, registro) ou a resposta se repete sem novidade; senão 7. O
 *     casos-acompanhamento-cron respeita casos.acompanhamento_intervalo_dias;
 *   - uma referência curta ao último ponto, citada no próximo e-mail ao escritório.
 * Lições GERAIS (valem para outros imóveis) entram em juridico_aprendizado, que o gerar-documental já lê.
 *
 * Uma análise por resposta (índice único em email_id). Falha da IA não grava nada e a resposta volta na
 * próxima rodada. `?seco=1` mostra a análise sem gravar nem avisar. `?caso=<uuid>` analisa a conversa do
 * caso mesmo sem resposta nova (backfill do histórico importado).
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { iaTexto } from './_claude.js';
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MAX_POR_RODADA = 5;
const AGUARDANDO = ['juiz', 'cartorio', 'cliente', 'escritorio', 'nos', 'nada'];

async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

const SISTEMA = `Você acompanha, para uma empresa de assessoria em leilões de imóveis, a pasta de um cliente que já arrematou o imóvel. Recebe a conversa por e-mail entre a empresa e o escritório de advocacia, em ordem cronológica. Responda SOMENTE com um JSON válido:
{"situacao":"2-3 frases: onde o processo está hoje","ultimo_movimento":"o último fato concreto, com data se houver","referencia_curta":"até 110 caracteres, para citar no próximo e-mail ao escritório (ex.: \\"o pedido de reconsideração para expedição da Carta de Arrematação, protocolado em 07/10\\")","aguardando":"juiz|cartorio|cliente|escritorio|nos|nada","pendencias_nossas":["o que a EMPRESA ou o CLIENTE precisa fazer, se houver"],"intervalo_dias":7|14,"motivo_intervalo":"uma frase","licoes":[{"tema":"curto","licao":"regra geral útil para OUTROS imóveis, só se o escritório afirmou com clareza"}]}
Regras: nunca invente fatos, datas ou números; use só o que está nos e-mails. intervalo_dias=14 quando o que se espera depende de prazo longo de terceiros (decisão do juiz, expedição de carta, registro em cartório) ou quando as últimas respostas não trouxeram novidade; senão 7. Lições só quando forem regra geral (não fatos deste caso). Sem travessões no texto.`;

function conversaTexto(msgs) {
  return msgs.map((m) => `### ${String(m.criado_em).slice(0, 10)} · ${m.direcao === 'entrada' ? 'ESCRITÓRIO' : 'EMPRESA'} (${m.de_email})${(m.anexos || []).length ? ` · anexos: ${m.anexos.map((a) => a.nome).filter(Boolean).join(', ')}` : ''}\n${String(m.texto || '').slice(0, 4000)}`).join('\n\n');
}

function lerJSON(txt) {
  const ini = txt.indexOf('{'), fim = txt.lastIndexOf('}');
  if (ini < 0 || fim < 0) return null;
  try { return JSON.parse(txt.slice(ini, fim + 1)); } catch { return null; }
}

async function analisarCaso(casoId, emailId, { seco }) {
  const [caso] = await ler(`casos?id=eq.${casoId}&select=id,imovel_id,imovel_endereco,cliente_id,acompanhamento_intervalo_dias`);
  if (!caso) return { caso: casoId, erro: 'caso não encontrado' };
  const msgs = await ler(`email_caixa?caso_id=eq.${casoId}&pasta=neq.spam&pasta=neq.lixeira&select=id,direcao,de_email,criado_em,texto,anexos&order=criado_em.asc&limit=60`);
  if (!msgs.length) return { caso: casoId, erro: 'sem mensagens' };
  const ia = await iaTexto({ system: SISTEMA, prompt: `Conversa do caso (${caso.imovel_endereco || 'imóvel arrematado'}):\n\n${conversaTexto(msgs)}`, maxTokens: 1500, primario: 'claude', timeoutMs: 60000 });
  // Falha da IA não é "nada a aprender": não grava, e a resposta volta na próxima rodada.
  if (!ia) return { caso: casoId, erro: 'IA indisponível' };
  const a = lerJSON(ia.texto);
  if (!a) return { caso: casoId, erro: 'IA respondeu fora do formato' };
  const intervalo = a.intervalo_dias === 14 ? 14 : 7;
  const linha = {
    caso_id: casoId, email_id: emailId || null,
    situacao: a.situacao || null, ultimo_movimento: a.ultimo_movimento || null,
    referencia_curta: a.referencia_curta ? String(a.referencia_curta).replace(/\s*[—–]\s*/g, ', ').slice(0, 140) : null,
    aguardando: AGUARDANDO.includes(a.aguardando) ? a.aguardando : null,
    pendencias_nossas: Array.isArray(a.pendencias_nossas) ? a.pendencias_nossas.filter(Boolean).slice(0, 8) : [],
    intervalo_dias: intervalo, motivo_intervalo: a.motivo_intervalo || null, provedor: ia.provedor,
  };
  const licoes = (Array.isArray(a.licoes) ? a.licoes : []).filter((l) => l?.licao).slice(0, 5);
  if (seco) return { caso: casoId, analise: linha, licoes };

  const ins = await sb('caso_acompanhamento_analise', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(linha) });
  if (!ins.ok) {
    // 409 = esta resposta já foi analisada (rodada concorrente): não é falha.
    if (ins.status === 409) return { caso: casoId, ja_analisado: true };
    throw new Error(`gravar análise HTTP ${ins.status}: ${(await ins.text().catch(() => '')).slice(0, 200)}`);
  }
  if (caso.acompanhamento_intervalo_dias !== intervalo) {
    const up = await sb(`casos?id=eq.${casoId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ acompanhamento_intervalo_dias: intervalo }) });
    const mudou = up.ok ? await up.json() : [];
    if (!mudou.length) console.error(`[devolutivas] intervalo do caso ${casoId} NÃO atualizado: HTTP ${up.status}`);
  }
  if (licoes.length) {
    const r = await sb('juridico_aprendizado', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(licoes.map((l) => ({
      caso_id: casoId, imovel_id: caso.imovel_id || null, campo: `licao_escritorio:${String(l.tema || 'geral').slice(0, 60)}`,
      valor_ia: null, valor_advogado: String(l.licao).slice(0, 600), observacao: 'aprendido das devolutivas por e-mail (juridico-devolutivas-cron)',
    }))) });
    if (!r.ok) console.error(`[devolutivas] lições do caso ${casoId} não gravadas: HTTP ${r.status}`);
  }
  return { caso: casoId, analise: linha, licoes: licoes.length };
}

async function avisarDono(resultados) {
  const comPendencia = resultados.filter((r) => r.analise);
  if (!comPendencia.length) return;
  const admin = (await ler('perfis?role=eq.admin&ativo=eq.true&select=id,nome&order=created_at.asc&limit=1'))[0];
  const remet = admin ? (await ler(`equipe_email?user_id=eq.${admin.id}&select=endereco`))[0] : null;
  const para = process.env.ADMIN_ALERT_EMAIL || remet?.endereco;
  if (!para) { console.error('[devolutivas] sem destinatário para o resumo ao dono'); return; }
  const blocos = [];
  for (const r of comPendencia) {
    const [c] = await ler(`casos?id=eq.${r.caso}&select=imovel_endereco,cliente_id`);
    const [cli] = c ? await ler(`perfis?id=eq.${c.cliente_id}&select=nome`) : [null];
    const a = r.analise;
    blocos.push(`<h3 style="margin:18px 0 4px">${esc(cli?.nome || 'Cliente')} · ${esc(c?.imovel_endereco || '')}</h3>`
      + `<p style="margin:4px 0">${esc(a.situacao || '')}</p>`
      + (a.ultimo_movimento ? `<p style="margin:4px 0;color:#475569">Último movimento: ${esc(a.ultimo_movimento)}</p>` : '')
      + (a.pendencias_nossas.length ? `<p style="margin:4px 0"><b>Pendências nossas:</b></p><ul>${a.pendencias_nossas.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '')
      + `<p style="margin:4px 0;color:#475569">Próximo acompanhamento: ${a.intervalo_dias === 14 ? 'quinzenal' : 'semanal'} (${esc(a.motivo_intervalo || '')})</p>`);
  }
  const env = await enviarEmail({
    from: `BidPro Brasil <${remet?.endereco || 'contato@bidprobrasil.com.br'}>`, to: para,
    subject: `Devolutivas do jurídico: ${comPendencia.length} caso(s) com novidade`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;color:#1e293b;line-height:1.55">${blocos.join('')}<p style="margin-top:18px"><a href="${BASE}/atendimento">Abrir a caixa de e-mail</a></p></div>`,
    meta: { tipo: 'devolutivas_juridico' },
  }).catch((e) => ({ ok: false, error: e?.message }));
  if (!env?.ok) console.error('[devolutivas] resumo ao dono falhou:', env?.error);
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const url = new URL(req.url, BASE);
  const seco = url.searchParams.get('seco') === '1';
  const casoForcado = url.searchParams.get('caso');
  const res = { seco, analisados: 0, falhas: 0, resultados: [] };
  try {
    let alvos;
    if (casoForcado) {
      if (!/^[0-9a-f-]{36}$/i.test(casoForcado)) throw new Error('caso inválido');
      alvos = [{ caso_id: casoForcado, id: null }];
    } else {
      // Respostas do escritório ligadas a caso, das últimas 3 semanas, ainda sem análise.
      const desde = new Date(Date.now() - 21 * 864e5).toISOString();
      const novas = await ler(`email_caixa?direcao=eq.entrada&caso_id=not.is.null&pasta=eq.entrada&criado_em=gte.${desde}&select=id,caso_id,criado_em&order=criado_em.asc&limit=50`);
      const ids = novas.map((n) => n.id);
      const feitas = ids.length ? await ler(`caso_acompanhamento_analise?email_id=in.(${ids.join(',')})&select=email_id`) : [];
      const ja = new Set(feitas.map((f) => f.email_id));
      // Uma análise por caso por rodada (a da resposta mais recente cobre as anteriores).
      const porCaso = new Map();
      for (const n of novas) if (!ja.has(n.id)) porCaso.set(n.caso_id, n);
      alvos = [...porCaso.values()].slice(0, MAX_POR_RODADA);
    }
    for (const a of alvos) {
      try {
        const r = await analisarCaso(a.caso_id, a.id, { seco });
        res.resultados.push(r);
        if (r.analise) res.analisados++;
        if (r.erro) res.falhas++;
      } catch (e) {
        res.falhas++;
        res.resultados.push({ caso: a.caso_id, erro: e?.message });
        console.error(`[devolutivas] caso ${a.caso_id}:`, e?.message);
      }
    }
    if (!seco) await avisarDono(res.resultados);
  } catch (e) {
    console.error('[devolutivas] falhou:', e?.message);
    return new Response(JSON.stringify({ ok: false, erro: e?.message, ...res }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  console.log('[devolutivas]', JSON.stringify({ analisados: res.analisados, falhas: res.falhas }));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
