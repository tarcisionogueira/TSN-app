export const config = { runtime: 'edge' };

function gerarEmailHTML(userName, imoveis, filtroDesc, userId, baseUrl) {
  const unsubToken = btoa(`${userId}:unsubscribe`);
  const unsubLink = `${baseUrl}/#/cancelar-alertas?token=${unsubToken}`;
  const buscaLink = `${baseUrl}/#/buscar`;
  const formatBRL = (v) => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` : '—';

  const cardsHTML = imoveis.slice(0, 5).map((im, i) => {
    const desconto = im.desconto_percentual ? Math.round(im.desconto_percentual) : null;
    const margem = im.valor_avaliacao && im.valor_minimo
      ? im.valor_avaliacao - im.valor_minimo
      : null;
    const margemPct = margem && im.valor_avaliacao
      ? Math.round((margem / im.valor_avaliacao) * 100)
      : null;
    const tipoLabel = {
      apartamento: 'Apartamento', casa: 'Casa', terreno: 'Terreno',
      comercial: 'Comercial', imovel: 'Imóvel',
    }[im.tipo] || 'Imóvel';
    const modalLabel = {
      judicial: 'Leilão Judicial', extrajudicial: 'Leilão Extrajudicial',
      venda_direta: 'Venda Direta',
    }[im.modalidade] || im.modalidade || '';
    const localizacao = [im.bairro, im.cidade, im.estado].filter(Boolean).join(', ');
    const verLink = im.url_lote || im.link_edital || buscaLink;

    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        <td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <!-- Card header stripe -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#0D63DB;padding:4px 20px;"></td>
            </tr>
          </table>
          <!-- Card body -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:20px 20px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <span style="font-size:11px;font-weight:700;color:#0D63DB;text-transform:uppercase;letter-spacing:0.08em;">${tipoLabel}${modalLabel ? ' · ' + modalLabel : ''}</span>
                      <div style="font-size:15px;font-weight:700;color:#111111;margin-top:4px;line-height:1.3;">${im.titulo ? im.titulo.slice(0, 80) : localizacao}</div>
                      <div style="font-size:13px;color:#64748b;margin-top:2px;">📍 ${localizacao || 'Local não informado'}</div>
                    </td>
                    ${desconto ? `<td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:12px;">
                      <span style="display:inline-block;background:#dcfce7;color:#16a34a;font-size:18px;font-weight:800;padding:6px 12px;border-radius:8px;line-height:1.2;">${desconto}%<br><span style="font-size:10px;font-weight:600;">OFF</span></span>
                    </td>` : ''}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:28px;">
                      <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Avaliação</div>
                      <div style="font-size:14px;color:#94a3b8;text-decoration:line-through;margin-top:2px;">${formatBRL(im.valor_avaliacao)}</div>
                    </td>
                    <td>
                      <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Lance mínimo</div>
                      <div style="font-size:22px;font-weight:800;color:#0D63DB;margin-top:2px;line-height:1.1;">${formatBRL(im.valor_minimo || im.lance_minimo)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ${margem ? `<tr>
              <td style="padding:0 20px 12px;">
                <div style="background:#f0f9ff;border-radius:8px;padding:10px 14px;font-size:13px;color:#0369a1;">
                  💰 Margem estimada: <strong>${formatBRL(margem)}</strong>${margemPct ? ` (${margemPct}% de desconto)` : ''}
                </div>
              </td>
            </tr>` : ''}
            ${im.forma_pagamento === 'financiado' ? `<tr>
              <td style="padding:0 20px 12px;">
                <span style="font-size:12px;color:#059669;background:#ecfdf5;padding:3px 10px;border-radius:20px;font-weight:600;">✓ Aceita financiamento / FGTS</span>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding:0 20px 20px;">
                <a href="${verLink}" style="display:inline-block;background:#0D63DB;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:0.01em;">Ver oportunidade →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
  }).join('');

  const filtroTexto = filtroDesc ? `<em style="color:#64748b;">${filtroDesc}</em>` : 'seu perfil de busca';
  const qtd = imoveis.length;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Oportunidades TSN Ativos</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

          <!-- HEADER -->
          <tr>
            <td style="background:#111111;border-radius:16px 16px 0 0;padding:36px 40px 28px;text-align:center;">
              <div style="font-size:32px;font-weight:900;color:#ffffff;letter-spacing:-0.03em;line-height:1;">TSN<span style="color:#0D63DB;">.</span></div>
              <div style="font-size:13px;color:#94a3b8;margin-top:6px;letter-spacing:0.05em;text-transform:uppercase;">Ativos Imobiliários</div>
            </td>
          </tr>

          <!-- HERO BAND -->
          <tr>
            <td style="background:#0D63DB;padding:20px 40px;text-align:center;">
              <div style="font-size:13px;font-weight:700;color:#bfdbfe;text-transform:uppercase;letter-spacing:0.1em;">Alerta de oportunidades</div>
              <div style="font-size:26px;font-weight:900;color:#ffffff;margin-top:4px;line-height:1.2;">${qtd} imóvel${qtd > 1 ? 'eis encontrado' + (qtd > 1 ? 's' : '') : ' encontrado'}</div>
              <div style="font-size:13px;color:#bfdbfe;margin-top:6px;">com base em ${filtroTexto}</div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background:#f8fafc;padding:32px 24px;">

              <p style="margin:0 0 24px;font-size:16px;color:#334155;line-height:1.7;">
                Olá, <strong style="color:#111111;">${userName}</strong>!<br>
                Identificamos imóveis que correspondem ao seu perfil de investimento. Confira as oportunidades abaixo antes que sejam arrematadas.
              </p>

              ${cardsHTML}

              <!-- CTA principal -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                <tr>
                  <td style="text-align:center;padding:8px 0 24px;">
                    <a href="${buscaLink}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:0.01em;">Buscar mais imóveis →</a>
                  </td>
                </tr>
              </table>

              <!-- Separator -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid #e2e8f0;padding-top:24px;">
                    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;text-align:center;">
                      Nossa equipe está disponível para orientar você em cada etapa —<br>da análise jurídica até a arrematação.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#111111;border-radius:0 0 16px 16px;padding:28px 40px;text-align:center;">
              <div style="font-size:18px;font-weight:900;color:#ffffff;letter-spacing:-0.02em;margin-bottom:12px;">TSN<span style="color:#0D63DB;">.</span> <span style="font-weight:400;font-size:13px;color:#94a3b8;">Ativos Imobiliários</span></div>
              <p style="color:#64748b;font-size:12px;line-height:1.8;margin:0 0 16px;">
                Você recebe este email porque salvou um filtro de busca na plataforma TSN Ativos.<br>
                © ${new Date().getFullYear()} TSN Ativos · Assessoria em Imóveis de Leilão · Brasil
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:0 8px;">
                    <a href="${buscaLink}" style="color:#0D63DB;font-size:12px;text-decoration:none;font-weight:600;">Alterar preferências</a>
                  </td>
                  <td style="color:#374151;font-size:12px;padding:0 4px;">·</td>
                  <td style="padding:0 8px;">
                    <a href="${unsubLink}" style="color:#4b5563;font-size:12px;text-decoration:none;">Cancelar alertas</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 });

  const { userId, userEmail, userName, imoveis, filtroDesc } = await req.json();
  if (!userEmail || !imoveis?.length) return new Response(JSON.stringify({ error: 'dados insuficientes' }), { status: 400 });

  const baseUrl = process.env.APP_BASE_URL || 'https://tsnAtivos.com.br';
  const html = gerarEmailHTML(userName || 'Investidor', imoveis, filtroDesc, userId, baseUrl);

  const qtd = imoveis.length;
  const subject = qtd === 1
    ? `1 oportunidade encontrada para o seu perfil de busca`
    : `${qtd} oportunidades encontradas para o seu perfil de busca`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.APP_FROM_EMAIL || 'TSN Ativos <alertas@tsnAtivos.com.br>',
      to: userEmail,
      subject,
      html,
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
