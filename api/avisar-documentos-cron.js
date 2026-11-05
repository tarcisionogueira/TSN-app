/**
 * /api/avisar-documentos-cron — "os documentos do lote chegaram, já pode gerar o relatório" (05/11, dono).
 *
 * Quem parou na Análise por falta de matrícula/edital fica em `documentos_aguardando`
 * (api/_pedido-leiloeiro-auto.js · registrarAguardando). Quando o lote passa a ter matrícula E
 * (edital ou regras), os gatilhos da migração 20261105 marcam `pronto_em` — venha o documento pela
 * resposta do leiloeiro, pelo anexo da equipe no chamado ou pela captura do coletor. Aqui sai o aviso
 * por e-mail (formato carta) para cada um; a tela de Análise mostra a mesma notícia numa faixa verde.
 *
 * Trava contra aviso duplo: marca `avisado_em` ANTES de enviar (só quem conseguiu marcar envia) e,
 * se o envio falhar, desfaz a marca e grava `aviso_erro` — o próximo ciclo tenta de novo.
 * E-mail represado pelo teto diário do Resend (`enfileirado`) conta como avisado: a fila entrega.
 *
 * `?seco=1` lista o que sairia, sem enviar nem marcar. CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const MAX = 25;

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
function sb(path, opts = {}) { return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } }); }
async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const filtroLinha = (a) => `imovel_id=eq.${a.imovel_id}&user_id=eq.${a.user_id}`;

async function emailDoUsuario(uid) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`auth HTTP ${r.status}`);
  const u = await r.json();
  return u?.email ? String(u.email).toLowerCase() : null;
}

function montarCarta({ nome, imovel, link }) {
  const lote = imovel.titulo || [imovel.endereco, imovel.cidade].filter(Boolean).join(', ') || 'o lote que você estava analisando';
  const onde = [imovel.cidade, imovel.estado].filter(Boolean).join('/');
  const paragrafos = [
    `Olá, ${nome || 'tudo bem'}!`,
    'Boa notícia: os documentos que faltavam no lote que você estava analisando já foram fornecidos pelo leiloeiro e estão anexados ao lote.',
    `${lote}${onde ? ` — ${onde}` : ''}`,
    `Com os documentos em mãos, você já pode gerar o relatório:\n${link}`,
    'Qualquer dúvida, é só responder este e-mail.',
    'Atenciosamente,\nEquipe BidPro Brasil',
  ];
  return {
    assunto: `Documentos do lote chegaram — já pode gerar o relatório (${imovel.cidade || 'BidPro'})`,
    text: paragrafos.join('\n\n'),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;line-height:1.6">${paragrafos
      .map((p) => `<p style="margin:0 0 14px;white-space:pre-wrap">${esc(p).replace(esc(link), `<a href="${esc(link)}" style="color:#0D63DB;font-weight:700">Abrir a análise do lote</a>`)}</p>`).join('')}</div>`,
  };
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return Response.json({ error: 'Supabase ausente' }, { status: 500 });
  const seco = new URL(req.url).searchParams.get('seco') === '1';
  const out = { lidos: 0, avisados: 0, encerrados: 0, falhas: 0, seco, itens: [] };
  try {
    const fila = await ler(`documentos_aguardando?pronto_em=not.is.null&avisado_em=is.null&order=pronto_em.asc&limit=${MAX}&select=imovel_id,user_id,pronto_em`);
    out.lidos = fila.length;
    for (const a of fila) {
      let travado = false;
      try {
        const [imovel] = await ler(`imoveis_leilao?id=eq.${a.imovel_id}&select=titulo,endereco,cidade,estado,ativo&limit=1`);
        // Lote que saiu do ar (leilão passou): não há relatório a gerar — encerra a linha sem e-mail.
        if (!imovel || imovel.ativo === false) {
          if (!seco) await sb(`documentos_aguardando?${filtroLinha(a)}&avisado_em=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ avisado_em: new Date().toISOString(), aviso_erro: 'lote encerrado: sem aviso' }) });
          out.encerrados++; continue;
        }
        const [perfil] = await ler(`perfis?id=eq.${a.user_id}&select=nome,ativo&limit=1`);
        const email = await emailDoUsuario(a.user_id);
        const link = `${BASE}/#/analise?imovel=${a.imovel_id}`;
        if (seco) { out.itens.push({ imovel_id: a.imovel_id, user_id: a.user_id, tem_email: !!email, lote: imovel.titulo || imovel.cidade }); continue; }
        if (!email) {
          await sb(`documentos_aguardando?${filtroLinha(a)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ aviso_erro: 'usuário sem e-mail' }) });
          out.falhas++; continue;
        }
        // Trava: só quem marcou envia.
        const rc = await sb(`documentos_aguardando?${filtroLinha(a)}&avisado_em=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ avisado_em: new Date().toISOString(), aviso_erro: null }) });
        if (!rc.ok || !(await rc.json().catch(() => [])).length) { console.error('[avisar-documentos] trava não pegou', a.imovel_id, rc.status); continue; }
        travado = true;
        const nome = String(perfil?.nome || '').trim().split(/\s+/)[0] || '';
        const c = montarCarta({ nome, imovel, link });
        const env = await enviarEmail({ to: email, subject: c.assunto, html: c.html, text: c.text, meta: { tipo: 'documentos_chegaram', userId: a.user_id } });
        if (env.ok || env.enfileirado) { out.avisados++; continue; }
        out.falhas++;
        const motivo = String(env.error || 'falha no envio').slice(0, 200);
        console.error('[avisar-documentos] envio falhou', a.imovel_id, motivo);
        // Suprimido não adianta repetir: fica marcado, com o motivo. O resto volta para a fila.
        await sb(`documentos_aguardando?${filtroLinha(a)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(env.suprimido ? { aviso_erro: `suprimido: ${motivo}` } : { avisado_em: null, aviso_erro: motivo }) });
      } catch (e) {
        out.falhas++;
        // Lançou depois de marcar: desfaz a marca, senão o cliente nunca seria avisado.
        if (travado) await sb(`documentos_aguardando?${filtroLinha(a)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ avisado_em: null, aviso_erro: String(e?.message || e).slice(0, 200) }) }).catch(() => {});
        console.error('[avisar-documentos]', a.imovel_id, String(e?.message || e).slice(0, 160));
      }
    }
    return Response.json({ ok: true, ...out });
  } catch (e) {
    console.error('[avisar-documentos] fila ilegível:', String(e?.message || e).slice(0, 160));
    return Response.json({ ok: false, erro: String(e?.message || e).slice(0, 160), ...out }, { status: 500 });
  }
}
