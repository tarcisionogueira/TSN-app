export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

function gerarEmailHTML(userName, imoveis, filtros, filtroDesc, userId, baseUrl) {
  const unsubToken = btoa(`${userId}:unsubscribe`);

  // UTM params identificam tráfego vindo de alertas de email no GA4
  // GA4 lê a query string ANTES do #, não dentro do hash (SPA routing)
  // Relatório GA4: Aquisição → Tráfego → utm_source = "email_alerta"
  const utm = `utm_source=email_alerta&utm_medium=email&utm_campaign=alerta_imoveis`;

  // Link busca: UTMs na query string real + filtros no hash (lidos pelo SPA)
  const filtroParams = new URLSearchParams();
  if (filtros?.estado) filtroParams.set('estado', filtros.estado);
  if (filtros?.cidades?.length) filtroParams.set('cidades', filtros.cidades.join(','));
  if (filtros?.tipo) filtroParams.set('tipo', filtros.tipo);
  if (filtros?.modalidade) filtroParams.set('modalidade', filtros.modalidade);
  if (filtros?.valorMin) filtroParams.set('valorMin', filtros.valorMin);
  if (filtros?.valorMax) filtroParams.set('valorMax', filtros.valorMax);
  if (filtros?.pagamento?.length) filtroParams.set('pagamento', filtros.pagamento.join(','));
  const buscaLink = `${baseUrl}?${utm}&utm_content=logo#/buscar?${filtroParams.toString()}`;

  const unsubLink = `${baseUrl}?${utm}&utm_content=unsub#/cancelar-alertas?token=${unsubToken}`;

  const formatBRL = (v) => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  const TIPO_LABEL = {
    apartamento: 'Apartamento', casa: 'Casa', terreno: 'Terreno/Lote',
    comercial: 'Comercial', rural: 'Rural', galpao: 'Galpão',
    sala: 'Sala Comercial', vaga: 'Vaga', imovel: 'Imóvel',
  };
  const MODAL_LABEL = {
    primeiro_leilao: '1ª Praça', segundo_leilao: '2ª Praça',
    venda_direta: 'Venda Direta', licitacao_aberta: 'Licitação Aberta',
    judicial: 'Judicial', extrajudicial: 'Extrajudicial',
  };
  const PGTO_LABEL = {
    financiado: '✓ Financiado',
    hipotecado: '⚠ Hipotecado',
    a_vista: '💵 À Vista',
  };
  const PGTO_COLOR = {
    financiado: { bg: '#dcfce7', color: '#15803d' },
    hipotecado: { bg: '#fef3c7', color: '#92400e' },
    a_vista:    { bg: '#f1f5f9', color: '#475569' },
  };

  const cardsHTML = imoveis.slice(0, 6).map((im) => {
    const desconto = im.desconto_percentual ? Number(im.desconto_percentual).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
    const tipoLabel = TIPO_LABEL[im.tipo] || 'Imóvel';
    const modalLabel = MODAL_LABEL[im.modalidade] || im.modalidade || '';
    const localizacao = [im.bairro, im.cidade, im.estado].filter(Boolean).join(', ');
    const descricaoSnippet = im.descricao ? im.descricao.replace(/\s+/g, ' ').trim().slice(0, 140) + (im.descricao.length > 140 ? '…' : '') : '';

    // Deep-link: UTMs na query string real + login com redirect para o imóvel
    // utm_content identifica qual card foi clicado (visível no GA4 por imóvel)
    const imovelPath = encodeURIComponent(`/imovel/${im.id}`);
    const imovelLink = `${baseUrl}?${utm}&utm_content=imovel_${im.id}#/login?next=${imovelPath}`;

    const pgto = im.forma_pagamento;
    const pgtoBadge = pgto && PGTO_LABEL[pgto]
      ? `<span style="display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${PGTO_COLOR[pgto].bg};color:${PGTO_COLOR[pgto].color};">${PGTO_LABEL[pgto]}</span>`
      : '';

    const fotoHTML = im.link_foto
      ? `<a href="${imovelLink}" style="display:block;text-decoration:none;">
          <img src="${im.link_foto}" alt="${tipoLabel}" width="560" style="width:100%;max-height:220px;object-fit:cover;display:block;border-radius:0;" />
        </a>`
      : `<div style="width:100%;height:80px;background:linear-gradient(135deg,#1e3a5f 0%,#0D63DB 100%);display:flex;align-items:center;justify-content:center;">
          <span style="color:rgba(255,255,255,0.3);font-size:32px;">🏠</span>
        </div>`;

    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
      <tr><td style="background:#fff;border-radius:12px;overflow:hidden;">

        <!-- FOTO -->
        ${fotoHTML}

        <!-- CORPO DO CARD -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:18px 20px 4px;">
              <!-- Tipo + Modalidade -->
              <div style="margin-bottom:6px;">
                <span style="font-size:10px;font-weight:700;color:#0D63DB;text-transform:uppercase;letter-spacing:0.08em;background:#eff6ff;padding:2px 8px;border-radius:20px;">${tipoLabel}</span>
                ${modalLabel ? `<span style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;background:#f1f5f9;padding:2px 8px;border-radius:20px;margin-left:4px;">${modalLabel}</span>` : ''}
                ${desconto ? `<span style="font-size:11px;font-weight:800;color:#fff;background:#16a34a;padding:2px 8px;border-radius:20px;margin-left:4px;">-${desconto}% OFF</span>` : ''}
              </div>
              <!-- Título -->
              <div style="font-size:15px;font-weight:700;color:#111;line-height:1.35;margin-bottom:4px;">${im.titulo ? im.titulo.slice(0, 90) : (tipoLabel + ' em ' + (im.cidade || ''))}</div>
              <!-- Localização -->
              <div style="font-size:12px;color:#64748b;margin-bottom:10px;">📍 ${localizacao || 'Local não informado'}</div>
            </td>
          </tr>

          <!-- VALORES -->
          <tr>
            <td style="padding:0 20px 14px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:24px;">
                    <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Avaliação</div>
                    <div style="font-size:13px;color:#94a3b8;text-decoration:line-through;">${formatBRL(im.valor_avaliacao)}</div>
                  </td>
                  <td>
                    <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Lance mínimo</div>
                    <div style="font-size:22px;font-weight:900;color:#0D63DB;line-height:1.1;">${formatBRL(im.valor_minimo || im.lance_minimo)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DESCRIÇÃO -->
          ${descricaoSnippet ? `<tr>
            <td style="padding:0 20px 14px;">
              <div style="font-size:12px;color:#475569;line-height:1.6;background:#f8fafc;border-left:3px solid #0D63DB;padding:8px 12px;border-radius:0 6px 6px 0;">${descricaoSnippet}</div>
            </td>
          </tr>` : ''}

          <!-- PAGAMENTO + CTA -->
          <tr>
            <td style="padding:0 20px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">${pgtoBadge}</td>
                  <td style="text-align:right;vertical-align:middle;">
                    <a href="${imovelLink}" style="display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:700;">Ver imóvel →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>`;
  }).join('');

  const filtroTexto = filtroDesc ? `<em style="color:#bfdbfe;">${filtroDesc}</em>` : 'seu perfil de busca';
  const qtd = imoveis.length;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Oportunidades BidPro Brasil</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

  <!-- HEADER: Logo → busca com filtros ativados -->
  <tr>
    <td style="background:#111111;border-radius:16px 16px 0 0;padding:28px 40px 24px;text-align:center;">
      <a href="${buscaLink}" style="text-decoration:none;display:inline-block;">
        <div style="display:inline-flex;align-items:center;gap:10px;">
          <!-- Ícone B -->
          <div style="background:#0D63DB;border-radius:8px;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff;font-family:Arial,sans-serif;">B</div>
          <div style="text-align:left;">
            <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.02em;line-height:1;">Bid<span style="color:#0D63DB;">Pro</span></div>
            <div style="font-size:9px;color:#94a3b8;letter-spacing:0.15em;text-transform:uppercase;">BRASIL</div>
          </div>
        </div>
      </a>
    </td>
  </tr>

  <!-- HERO BAND -->
  <tr>
    <td style="background:#0D63DB;padding:20px 40px;text-align:center;">
      <div style="font-size:11px;font-weight:700;color:#bfdbfe;text-transform:uppercase;letter-spacing:0.12em;">🔔 Alerta de Oportunidades</div>
      <div style="font-size:26px;font-weight:900;color:#ffffff;margin-top:6px;line-height:1.2;">${qtd} ${qtd === 1 ? 'imóvel encontrado' : 'imóveis encontrados'}</div>
      <div style="font-size:13px;color:#bfdbfe;margin-top:5px;">com base em ${filtroTexto}</div>
    </td>
  </tr>

  <!-- CORPO -->
  <tr>
    <td style="background:#f8fafc;padding:28px 20px;">

      <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.7;text-align:center;">
        Olá, <strong style="color:#111111;">${userName}</strong>! Encontramos imóveis com oportunidade que correspondem ao seu perfil de investimento.
      </p>

      ${cardsHTML}

      <!-- CTA ver todos -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
        <tr>
          <td style="text-align:center;padding:8px 0 28px;">
            <a href="${buscaLink}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:15px 40px;border-radius:10px;font-size:15px;font-weight:700;">Ver todos com filtros ativos →</a>
          </td>
        </tr>
      </table>

      <div style="border-top:1px solid #e2e8f0;padding-top:20px;font-size:13px;color:#64748b;line-height:1.7;text-align:center;">
        Nossa equipe está disponível para orientar você em cada etapa — da análise jurídica até a arrematação.
      </div>

    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td style="background:#111111;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
      <div style="font-size:13px;font-weight:700;color:#ffffff;margin-bottom:4px;">BidPro Brasil</div>
      <div style="font-size:11px;color:#64748b;line-height:1.8;margin-bottom:14px;">
        Você recebe este email porque salvou um filtro de busca na plataforma.<br>
        © ${new Date().getFullYear()} BidPro Brasil · Assessoria em Imóveis de Leilão
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td><a href="${buscaLink}" style="color:#0D63DB;font-size:12px;text-decoration:none;font-weight:600;">Ver meus filtros</a></td>
          <td style="color:#374151;font-size:12px;padding:0 10px;">·</td>
          <td><a href="${unsubLink}" style="color:#64748b;font-size:12px;text-decoration:none;">Cancelar alertas</a></td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`email-alerta:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const authUser = await getAuthUser(req);
  if (!authUser?.id) return unauthorized('Faça login para receber alertas.');

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 });

  const { userId, userEmail, userName, imoveis, filtros, filtroDesc } = await req.json();
  if (!userEmail || !imoveis?.length) return new Response(JSON.stringify({ error: 'dados insuficientes' }), { status: 400 });

  // Garante que o e-mail destino pertence ao usuário autenticado
  if (authUser.email !== userEmail) {
    return new Response(JSON.stringify({ error: 'E-mail não corresponde ao usuário autenticado' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  const baseUrl = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
  const html = gerarEmailHTML(userName || 'Investidor', imoveis, filtros || {}, filtroDesc, userId, baseUrl);

  const qtd = imoveis.length;
  const subject = qtd === 1
    ? `🔔 1 oportunidade encontrada para o seu perfil`
    : `🔔 ${qtd} oportunidades encontradas para o seu perfil`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.APP_FROM_EMAIL || 'BidPro Brasil <noreply@bidprobrasil.com.br>',
      to: userEmail,
      subject,
      html,
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
