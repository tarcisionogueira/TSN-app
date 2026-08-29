/**
 * NÚCLEO DO CONVITE DA BASE PARA A AULA AO VIVO — compartilhado por dois disparos:
 *   • /api/convidar-live      → o admin aperta o botão (com teste e prévia contada)
 *   • /api/convidar-live-cron → o disparo agendado, que roda sem ninguém acordado
 *
 * Por que compartilhado, e não duas cópias: são o MESMO e-mail, para a MESMA lista, com as
 * MESMAS três exclusões. Duas cópias garantiriam que a primeira melhoria feita numa nunca
 * chegasse na outra — é como o HTML de produto acabou centralizado em `_produto-email.js`.
 *
 * TRÊS EXCLUSÕES, e nenhuma é detalhe:
 *   1. equipe e admin nunca entram (o cron de retenção já nudou o próprio dono uma vez);
 *   2. quem optou por não receber e-mail (`alertas_email.ativo = false`);
 *   3. QUEM JÁ ESTÁ INSCRITO nesta aula — essa pessoa já recebe o lembrete da véspera e do
 *      dia por `live-lembrete-cron`. Mandar "garanta sua vaga" para quem já tem vaga é a
 *      forma mais barata de parecer robô para o cliente que mais se engajou.
 *
 * DEDUP: `live_convite_envio`, com claim ANTES do envio e UNIQUE por (evento, pessoa, edição).
 * Ver `supabase/migrations/live_convite_base_dedup_por_edicao.sql` para o porquê da `edicao`
 * estar na chave — a aula é semanal, e sem ela o convite valeria uma vez na vida.
 *
 * LEITURA QUE FALHA, FALHA ALTO: as consultas de destinatário, opt-out e inscritos NÃO caem
 * em lista vazia quando o PostgREST erra — `sbLer` lança. Um `catch → []` no opt-out mandaria
 * e-mail para quem pediu para não receber; nos inscritos, convidaria de novo quem já tem vaga.
 * É a forma de falha nº 1/nº 2 do CLAUDE.md, e aqui custaria reputação com o cliente.
 */
import { enviarEmail } from './_email.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { emailsDoLote, capaEmail } from './_produto-email.js';
import { linkRastreado } from './_link-email.js';
import { utmEmail } from './_utm.js';
import { escapeHtml } from './_sanitize.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';

const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
const CAP = 3000;   // teto de segurança por disparo (a base hoje é pequena; evita runaway)
const CONC = 5;     // ritmo tranquilo no Resend
export const TIPO_EMAIL = 'convite_live';

const hdr = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const esc = (s) => escapeHtml(String(s ?? ''));

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init, headers: { ...hdr, ...(init.headers || {}) }, signal: AbortSignal.timeout(20000),
});

/** GET que NÃO transforma erro em lista vazia — quem chama decide o que fazer com a falha. */
async function sbLer(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura falhou (${r.status}) em ${path.split('?')[0]}`);
  const linhas = await r.json();
  if (!Array.isArray(linhas)) throw new Error(`corpo inesperado em ${path.split('?')[0]}`);
  return linhas;
}

const FUSO = 'America/Bahia';
const dataBR = (iso, opts) => new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, ...opts });
/** A EDIÇÃO é a data local da aula — a mesma unidade que o cliente enxerga no convite. */
const edicaoDe = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: FUSO });

/**
 * Carrega a próxima edição da aula. A data vem de `live_proxima`, a MESMA função que a landing
 * e o admin usam — calcular a recorrência aqui criaria uma segunda verdade sobre quando é a aula.
 * Devolve `null` quando a aula não existe ou está inativa (quem chama decide o status HTTP).
 */
export async function carregarEdicao(slug) {
  const r = await sb('rpc/live_proxima', { method: 'POST', body: JSON.stringify({ p_slug: slug }) });
  if (!r.ok) throw new Error(`live_proxima falhou (${r.status})`);
  const aula = await r.json().catch(() => null);
  if (!aula?.id || !aula?.data_hora) return null;

  const edicao = edicaoDe(aula.data_hora);
  const diaSemana = dataBR(aula.data_hora, { weekday: 'long' }).split('-')[0];
  const hora = dataBR(aula.data_hora, { hour: '2-digit', minute: '2-digit' }).replace(':00', 'h');
  const assunto = `${diaSemana.charAt(0).toUpperCase()}${diaSemana.slice(1)}, ${hora}: eu avalio um imóvel de leilão ao vivo com você`.slice(0, 120);
  return { aula, edicao, assunto };
}

export function corpoConviteLive({ aula, nome, link }) {
  const primeiro = nome ? String(nome).split(' ')[0] : '';
  const cor = aula.cor || '#0D63DB';
  const capa = capaEmail(aula.capa_url);
  const topicos = String(aula.descricao || '')
    .split('\n').map((l) => l.replace(/^\s*[•\-*]\s*/, '').trim()).filter(Boolean).slice(0, 6);
  const diaLongo = dataBR(aula.data_hora, { weekday: 'long', day: '2-digit', month: 'long' });
  const hora = dataBR(aula.data_hora, { hour: '2-digit', minute: '2-digit' });
  const diaCurto = dataBR(aula.data_hora, { day: '2-digit', month: '2-digit' });
  const dur = Number(aula.duracao_min) > 0 ? `${aula.duracao_min} minutos · ` : '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:22px 28px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;">BidPro Brasil</div>
    <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Leilão &amp; Investimentos</div>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="font-size:11px;font-weight:800;color:${esc(cor)};text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;">Aula ao vivo · ${esc(diaCurto)}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;line-height:1.3;">${esc(aula.titulo || 'Aula ao vivo')}</h2>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7;">${primeiro ? `Olá, <strong>${esc(primeiro)}</strong>! ` : ''}${esc(aula.subtitulo || '')} Sem slide, sem teoria: a tela ao vivo.</p>
    ${capa ? `<a href="${link}"><img src="${esc(capa)}" alt="" style="width:100%;max-height:280px;object-fit:cover;border-radius:12px;margin-bottom:18px;display:block;"></a>` : ''}
    <div style="background:#f1f5f9;border-left:3px solid ${esc(cor)};border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <div style="font-size:14px;color:#0f172a;font-weight:700;text-transform:capitalize;">${esc(diaLongo)} · ${esc(hora)}</div>
      <div style="font-size:13px;color:#64748b;margin-top:3px;">Horário de Brasília · ${esc(dur)}online e gratuito</div>
    </div>
    ${topicos.length ? `<p style="margin:0 0 8px;color:#0f172a;font-size:14px;font-weight:700;">O que a gente vai fazer:</p>
    <ul style="margin:0 0 22px;padding-left:20px;color:#475569;font-size:14px;line-height:1.9;">
      ${topicos.map((t) => `<li>${esc(t)}</li>`).join('')}
    </ul>` : ''}
    <div style="text-align:center;margin:8px 0 6px;">
      <a href="${link}" style="display:inline-block;background:${esc(cor)};color:#fff;text-decoration:none;padding:14px 30px;border-radius:10px;font-weight:800;font-size:15px;">
        Garantir minha vaga &rarr;
      </a>
    </div>
    <p style="text-align:center;font-size:12px;color:#94a3b8;margin:12px 0 0;">Leva 20 segundos. Você recebe o link da sala por e-mail.</p>
    ${aula.apresentador ? `<div style="border-top:1px solid #e2e8f0;margin:24px 0 0;padding-top:18px;">
      <p style="margin:0;color:#64748b;font-size:13px;line-height:1.7;">
        <strong style="color:#0f172a;">${esc(aula.apresentador)}</strong>${aula.apresentador_cargo ? `<br>${esc(aula.apresentador_cargo)}` : ''}
      </p>
    </div>` : ''}
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:22px;">BidPro Brasil · Convite para aula ao vivo · <a href="{{UNSUB}}" style="color:#94a3b8;">Cancelar e-mails</a></p>
  </div>
</div></body></html>`;
}

/** Monta o e-mail pronto para um destinatário (o `{{UNSUB}}` já resolvido). */
export function montarConvite({ aula, edicao, slug, userId, nome, conteudo = 'convite-base' }) {
  const link = linkRastreado(userId, TIPO_EMAIL, `/aula/${slug}?${utmEmail('aula-' + edicao, conteudo)}`);
  return corpoConviteLive({ aula, nome, link })
    .replace('{{UNSUB}}', `${BASE}/api/cancelar-alertas?token=${assinarUnsub(userId || '')}`);
}

/**
 * Dispara o convite. `seco: true` conta quem receberia sem enviar nem gravar — é o que permite
 * conferir o alcance antes de gastar a única chance de causar boa impressão numa base pequena.
 * LANÇA quando uma leitura falha; quem chama traduz para 502 em vez de "convidei zero com sucesso".
 */
export async function dispararConvite({ aula, edicao, assunto, slug, seco = false }) {
  const perfis = await sbLer(`perfis?select=id,nome&role=in.(${ROLES_CLIENTE.join(',')})&ativo=eq.true&order=id.asc&limit=${CAP}`);
  if (!perfis.length) return { enviados: 0, destinatarios: 0, motivo: 'sem clientes', edicao, assunto };

  // Listas de exclusão buscadas inteiras (são pequenas) — evita montar `in.(...)` gigante na URL.
  const optOut = new Set((await sbLer('alertas_email?ativo=eq.false&select=user_id')).map((o) => o.user_id));
  const inscritos = new Set((await sbLer(`live_inscricoes?evento_id=eq.${aula.id}&select=user_id`)).map((i) => i.user_id).filter(Boolean));
  const jaConvidados = new Set((await sbLer(`live_convite_envio?evento_id=eq.${aula.id}&edicao=eq.${edicao}&select=user_id`)).map((c) => c.user_id));

  const alvos = perfis.filter((p) => !optOut.has(p.id) && !inscritos.has(p.id) && !jaConvidados.has(p.id));
  const recorte = {
    clientes: perfis.length,
    opt_out: perfis.filter((p) => optOut.has(p.id)).length,
    ja_inscritos: perfis.filter((p) => inscritos.has(p.id)).length,
    ja_convidados: perfis.filter((p) => jaConvidados.has(p.id)).length,
  };

  if (seco) return { seco: true, edicao, assunto, aula: aula.titulo, receberiam: alvos.length, ...recorte };
  if (!alvos.length) return { enviados: 0, destinatarios: 0, edicao, assunto, motivo: 'ninguém elegível', ...recorte };

  const emailMap = await emailsDoLote(alvos.map((p) => p.id));
  const lista = alvos.filter((p) => emailMap.has(p.id));
  const semEmail = alvos.length - lista.length;

  let enviados = 0, falhas = 0, jaClamados = 0;
  for (let i = 0; i < lista.length; i += CONC) {
    const bloco = lista.slice(i, i + CONC);
    const res = await Promise.all(bloco.map(async (p) => {
      // CLAIM PRIMEIRO. O UNIQUE (evento_id, user_id, edicao) é o que impede o envio duplo se
      // o botão for apertado duas vezes, se o cron repetir, ou se uma execução morrer no meio.
      const rIns = await sb('live_convite_envio', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ evento_id: aula.id, user_id: p.id, edicao }),
      });
      if (rIns.status === 409) return 'ja_clamado';
      if (!rIns.ok) return 'falha';
      const [linha] = await rIns.json().catch(() => []);

      const html = montarConvite({ aula, edicao, slug, userId: p.id, nome: p.nome });
      const env = await enviarEmail({
        from: FROM, to: emailMap.get(p.id), subject: assunto, html,
        meta: { tipo: TIPO_EMAIL, userId: p.id },
      });
      // Desfecho REAL no claim. Sem isto, "convidado" significaria apenas "tentei".
      if (linha?.id) {
        const rUp = await sb(`live_convite_envio?id=eq.${linha.id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ email_ok: !!env?.ok }),
        }).catch(() => null);
        if (!rUp?.ok) console.error('[convite-live] claim sem desfecho gravado', linha.id);
      }
      return env?.ok ? 'ok' : 'falha';
    }));
    for (const r of res) {
      if (r === 'ok') enviados++;
      else if (r === 'ja_clamado') jaClamados++;
      else falhas++;
    }
  }

  return { edicao, assunto, aula: aula.titulo, destinatarios: alvos.length, enviados, falhas, sem_email: semEmail, ja_clamados: jaClamados, ...recorte };
}

/** Leitura de um interruptor em `app_config`. `value` é TEXT, mas parte do acervo foi gravada
 *  com aspas em volta (herança de quando o valor vinha de JSON) — daí o `replace`. */
export async function lerConfig(chave) {
  const r = await sb(`app_config?key=eq.${encodeURIComponent(chave)}&select=value`);
  if (!r.ok) throw new Error(`app_config ${chave} falhou (${r.status})`);
  const [linha] = await r.json();
  return linha ? String(linha.value).replace(/^"|"$/g, '') : null;
}

export async function gravarConfig(chave, valor) {
  const r = await sb('app_config?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    // `value` é TEXT: grava o valor CRU. `JSON.stringify` aqui gravaria `"2026-09-02"`, com
    // aspas, e a comparação com a edição do dia falharia calada — o cron nunca dispararia.
    body: JSON.stringify({ key: chave, value: String(valor) }),
  });
  return r.ok;
}
