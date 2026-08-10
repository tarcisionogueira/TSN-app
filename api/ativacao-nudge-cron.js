/**
 * GET/POST /api/ativacao-nudge-cron — o SEGUNDO TOQUE para quem se cadastrou e nunca gerou
 * nada. No máximo DOIS e-mails na vida: D+2 e D+7.
 *
 * POR QUE EXISTE (09/08): dos 30 exploradores, 27 têm um único dia de atividade — o do
 * cadastro. Ninguém os procura. Os crons de nome parecido fazem outra coisa:
 * `saldo-abandono-cron` é sobre saldo esquecido, `retencao-avisos-cron` é sobre APAGAR
 * documento, e `enviar-alertas-cron` só alcança quem criou filtro salvo (quase ninguém fez).
 * Resultado: das 90 amostras grátis disponíveis (3 por conta), 3 foram usadas.
 *
 * DESLIGADO POR PADRÃO, e o interruptor vive no BANCO (`app_config.ativacao_nudge_ativo`),
 * não num env var: ligar e desligar vira uma linha de SQL, sem redeploy, e dá para desligar
 * às pressas se algo sair errado no meio de um envio. O env `ATIVACAO_NUDGE_ATIVO=0` continua
 * valendo como freio de mão — se estiver setado como '0', nada sai, mesmo com o banco ligado.
 * Desligado = DRY-RUN: apura quem receberia, devolve a lista e não envia nem grava nada.
 * A polaridade é o inverso da do `retencao-avisos-cron` (ligado por padrão) de propósito:
 * aquele já foi autorizado e roda há semanas; este manda e-mail novo para cliente.
 *
 * ?limite=N — libera em LOTE. O primeiro envio de uma cadência nova é também o teste dela:
 * vale mandar para 5 pessoas, olhar entrega/abertura/clique, e só então soltar o resto. Sem o
 * parâmetro, processa todo mundo elegível.
 *
 * ?backlog=1 — as janelas D+2/D+7 têm um dia cada, porque o cron é diário. Na primeira
 * execução isso deixaria de fora justamente os 27 que já se cadastraram há semanas. Com
 * backlog, quem passou da janela entra UMA vez, na etapa 'd2'. Use uma vez e só.
 *
 * DEDUP é estrutural: `ativacao_nudge` tem unique (user_id, etapa). Rodar dez vezes não
 * reenvia. A linha é gravada ANTES do envio (reserva a vaga) e só depois marcada com o
 * resultado — preferimos perder um nudge a mandar dois.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { assinarUnsub } from './cancelar-alertas.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM         = process.env.APP_ALERTS_FROM || process.env.EMAIL_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
// Freio de mão do painel: '0' desliga tudo, independente do banco.
const FREIO_ENV    = process.env.ATIVACAO_NUDGE_ATIVO === '0';

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const SEL = 'id,titulo,cidade,estado,tipo,valor_minimo,valor_avaliacao,desconto_percentual';

/**
 * Três imóveis para a pessoa. Vai afunilando: cidade de interesse → estado → Brasil. O
 * e-mail nunca sai vazio nem sai com "não encontramos nada na sua região", que é a pior
 * mensagem possível para quem ainda não conhece a plataforma.
 */
async function escolherImoveis(cidade, uf) {
  const base = `imoveis_leilao?select=${SEL}&ativo=eq.true&desconto_percentual=gte.25&order=desconto_percentual.desc&limit=3`;
  const tentativas = [
    cidade ? `${base}&cidade=ilike.${encodeURIComponent(cidade)}` : null,
    uf ? `${base}&estado=eq.${encodeURIComponent(uf)}` : null,
    base,
  ].filter(Boolean);

  for (const url of tentativas) {
    try {
      const r = await sb(url);
      if (!r.ok) continue;
      const linhas = await r.json().catch(() => []);
      if (Array.isArray(linhas) && linhas.length) return linhas;
    } catch { /* tenta o próximo escopo */ }
  }
  return [];
}

// Marca do e-mail. Feita em HTML PURO, de propósito: a maioria dos clientes bloqueia imagem
// por padrão, e um cabeçalho que depende de PNG aparece vazio justamente na primeira impressão.
// Cores oficiais de docs/MARCA.md — azul #0D63DB → #0B4BA6, o "B" branco no quadrado azul.
function cabecalho() {
  const home = `${BASE}/?utm_source=email_ativacao&utm_medium=email&utm_campaign=ativacao`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0D63DB;background-image:linear-gradient(135deg,#0D63DB 0%,#0B4BA6 100%);border-radius:14px 14px 0 0;">
    <tr><td align="center" style="padding:22px 20px;">
      <a href="${home}" style="text-decoration:none;display:inline-block;" target="_blank">
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="background:#ffffff;border-radius:9px;width:34px;height:34px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:900;color:#0D63DB;line-height:34px;">B</td>
            <td style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:900;color:#ffffff;letter-spacing:-.2px;white-space:nowrap;">
              BidPro <span style="font-weight:400;letter-spacing:2px;font-size:12px;opacity:.85;">BRASIL</span>
            </td>
          </tr>
        </table>
      </a>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#dbeafe;margin-top:9px;letter-spacing:.2px;">
        Inteligência para arrematar imóveis em leilão
      </div>
    </td></tr>
  </table>`;
}

function cardImovel(im) {
  const url = `${BASE}/#/imovel/${im.id}?utm_source=email_ativacao&utm_medium=email&utm_campaign=ativacao`;
  const desc = Math.round(Number(im.desconto_percentual) || 0);
  // O card SEMPRE foi um link (o `<a>` envolve tudo) — o que faltava era PARECER clicável.
  // Sem pista visual, o leitor lê como cartaz e não clica: a barra azul à esquerda e o
  // "Ver relatório →" existem para isso, não para enfeite.
  return `<tr><td style="padding:0 0 12px;">
    <a href="${url}" target="_blank" style="display:block;text-decoration:none;border:1px solid #e2e8f0;border-left:4px solid #0D63DB;border-radius:12px;padding:14px 16px;background:#ffffff;">
      <div style="font-size:14px;font-weight:700;color:#0f172a;line-height:1.4;">${esc(im.titulo || 'Imóvel em leilão')}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;">${esc(im.cidade || '')}${im.estado ? ' · ' + esc(im.estado) : ''}</div>
      <div style="margin-top:8px;font-size:15px;font-weight:800;color:#0D63DB;">${brl(im.valor_minimo)}
        ${desc >= 25 ? `<span style="font-size:12px;font-weight:700;color:#059669;margin-left:8px;">${desc}% abaixo da avaliação</span>` : ''}
      </div>
      <div style="margin-top:9px;font-size:12.5px;font-weight:700;color:#0D63DB;">Ver relatório deste imóvel &rarr;</div>
    </a></td></tr>`;
}

// Exportado para `scripts/previa-nudge.mjs`: o dono precisa VER o e-mail exatamente como o
// cliente vai receber antes de autorizar o disparo. Prévia que reimplementa o template não
// prova nada — tem de ser a mesma função que envia.
export function corpo({ nome, etapa, imoveis, cidade, unsubUrl }) {
  const saudacao = nome ? `Olá, ${esc(String(nome).split(' ')[0])}!` : 'Olá!';
  const ondeTxt = cidade ? ` em ${esc(cidade)} e região` : '';

  const abertura = etapa === 'd2'
    ? `<p style="font-size:14px;line-height:1.7;color:#334155;">Você criou sua conta na BidPro Brasil e tem <strong>3 análises gratuitas</strong> esperando —
       sem cartão e sem prazo para usar. Cada uma mostra o valor de mercado da região, o desconto real,
       os custos de arrematação e o retorno estimado do imóvel.</p>
       <p style="font-size:14px;line-height:1.7;color:#334155;">Separamos três oportunidades${ondeTxt} para você começar:</p>`
    : `<p style="font-size:14px;line-height:1.7;color:#334155;">Suas <strong>3 análises gratuitas</strong> continuam disponíveis.</p>
       <p style="font-size:14px;line-height:1.7;color:#334155;">A conta que costuma surpreender é a do desconto real: o lance inicial já vem abaixo da
       avaliação, mas é depois de somar ITBI, comissão do leiloeiro e reforma que dá para saber se o
       negócio fecha. É exatamente isso que o relatório calcula. Veja três imóveis${ondeTxt}:</p>`;

  const cta = `${BASE}/#/buscar?utm_source=email_ativacao&utm_medium=email&utm_campaign=ativacao`;

  const home = `${BASE}/?utm_source=email_ativacao&utm_medium=email&utm_campaign=ativacao`;
  // Estrutura em TABELA e estilo INLINE: é o que sobrevive ao Outlook e ao Gmail. Nada de
  // flexbox/grid aqui — o que renderiza bem no navegador costuma quebrar no cliente de e-mail.
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:22px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;margin:0 auto;">
      <tr><td>${cabecalho()}</td></tr>
      <tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 24px;color:#0f172a;">
        <p style="font-size:15px;font-weight:700;margin:0 0 12px;">${saudacao}</p>
        ${abertura}
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:18px 0 8px;">${imoveis.map(cardImovel).join('')}</table>
        <div style="text-align:center;margin:22px 0 6px;">
          <a href="${cta}" target="_blank" style="display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">Ver mais imóveis</a>
        </div>
        <p style="text-align:center;font-size:12px;color:#94a3b8;margin:0;">Clique em qualquer imóvel acima para abrir a página dele.</p>
      </td></tr>
      <tr><td style="padding:16px 24px 0;text-align:center;">
        <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0;">
          <a href="${home}" target="_blank" style="color:#64748b;text-decoration:none;font-weight:700;">BidPro Brasil</a> ·
          Você recebe este e-mail porque criou uma conta na plataforma.<br>
          <a href="${unsubUrl}" style="color:#94a3b8;">Não quero mais receber</a>.
        </p>
      </td></tr>
    </table>
  </div>`;
}

export const GET = handler;
export const POST = handler;

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let backlog = false, limite = 0;
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    backlog = q.get('backlog') === '1';
    limite = Math.max(0, Number(q.get('limite') || 0) || 0);
  } catch { /* url malformada */ }

  // Interruptor no banco. Falha de leitura => DESLIGADO: se não dá para ter certeza de que
  // foi autorizado, não manda e-mail para cliente.
  let ligadoNoBanco = false;
  try {
    const r = await sb('app_config?key=eq.ativacao_nudge_ativo&select=value');
    const linhas = await r.json().catch(() => []);
    ligadoNoBanco = String(linhas?.[0]?.value ?? '').toLowerCase() === 'true';
  } catch { ligadoNoBanco = false; }
  const ATIVO = ligadoNoBanco && !FREIO_ENV;

  const candRes = await sb('rpc/ativacao_nudge_candidatos', { method: 'POST', body: JSON.stringify({ p_backlog: backlog }) });
  if (!candRes.ok) {
    return new Response(JSON.stringify({ error: 'RPC falhou', detalhe: await candRes.text().catch(() => '') }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const candidatos = await candRes.json().catch(() => []);
  const todos = Array.isArray(candidatos) ? candidatos : [];
  const lista = limite > 0 ? todos.slice(0, limite) : todos;

  const resumo = {
    ativo: ATIVO, freio_env: FREIO_ENV, backlog,
    elegiveis: todos.length, candidatos: lista.length,
    // Se o lote cortou gente, DIZ quantos ficaram — truncar em silêncio se lê como
    // "acabou a fila" quando na verdade sobrou fila.
    ...(limite > 0 && todos.length > lista.length ? { adiados_pelo_lote: todos.length - lista.length } : {}),
    d2: 0, d7: 0, enviados: 0, falhas: 0, sem_imovel: 0,
  };

  // DRY-RUN: devolve QUEM receberia, para conferência antes de autorizar. Só o primeiro nome
  // e o domínio do e-mail — a lista trafega em log/resposta e não precisa do endereço inteiro.
  if (!ATIVO) {
    resumo.previa = lista.map((c) => ({
      etapa: c.etapa, dias: c.dias,
      quem: `${String(c.nome || '(sem nome)').split(' ')[0]} @${String(c.email || '').split('@')[1] || '?'}`,
      cidade: c.cidade || null, uf: c.uf || null,
    }));
    for (const c of lista) { if (c.etapa === 'd2') resumo.d2++; else resumo.d7++; }
    return new Response(JSON.stringify({ ok: true, dry_run: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
  }

  for (const c of lista) {
    if (c.etapa === 'd2') resumo.d2++; else resumo.d7++;
    try {
      const imoveis = await escolherImoveis(c.cidade, c.uf);
      // Sem imóvel não existe e-mail que valha a pena — e, principalmente, não queimamos a
      // única chance daquela etapa. A pessoa segue elegível no próximo run.
      if (!imoveis.length) { resumo.sem_imovel++; continue; }

      // RESERVA A VAGA ANTES DE ENVIAR. Se o processo morrer entre gravar e enviar, a pessoa
      // perde este nudge — e é isso que queremos: perder um é melhor que mandar dois.
      const insRes = await sb('ativacao_nudge', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: c.user_id, etapa: c.etapa, imoveis: imoveis.map((i) => i.id) }),
      });
      if (!insRes.ok) continue; // 409 = outra execução já pegou este; segue a vida
      const linha = (await insRes.json().catch(() => []))[0];
      if (!linha) continue;

      const unsubUrl = `${BASE}/api/cancelar-alertas?token=${assinarUnsub(c.user_id)}`;
      const r = await enviarEmail({
        from: FROM,
        to: c.email,
        subject: c.etapa === 'd2'
          ? 'Suas 3 análises gratuitas estão esperando'
          : 'O desconto que aparece no leilão não é o desconto real',
        html: corpo({ nome: c.nome, etapa: c.etapa, imoveis, cidade: c.cidade, unsubUrl }),
        // List-Unsubscribe: o cliente de e-mail mostra o "descadastrar" nativo. Sem isso,
        // quem não quer mais receber marca como SPAM — e aí o domínio inteiro paga.
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        meta: { tipo: 'ativacao', userId: c.user_id },
      });

      if (r?.ok) resumo.enviados++; else resumo.falhas++;
      await sb(`ativacao_nudge?id=eq.${linha.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ email_ok: !!r?.ok }),
      });
    } catch (e) {
      resumo.falhas++;
      console.error('[ativacao-nudge] falha em', c.etapa, e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
}
