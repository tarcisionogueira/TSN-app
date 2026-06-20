export const config = { runtime: 'edge' };

function gerarEmailHTML(userName, imoveis, filtroDesc, userId, baseUrl) {
  const unsubToken = btoa(`${userId}:unsubscribe`);
  const unsubLink = `${baseUrl}/#/cancelar-alertas?token=${unsubToken}`;
  const prefLink = `${baseUrl}/#/buscar`;
  const formatBRL = (v) => v ? `R$ ${Number(v).toLocaleString('pt-BR')}` : '—';

  const cardsHTML = imoveis.slice(0, 5).map(im => {
    const desconto = im.desconto_percentual ? Math.round(im.desconto_percentual) : null;
    const margem = im.valor_avaliacao && im.lance_minimo
      ? im.valor_avaliacao - im.lance_minimo
      : null;
    const margemPct = margem && im.valor_avaliacao
      ? Math.round((margem / im.valor_avaliacao) * 100)
      : null;

    return `
    <div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,0.08);border-left:4px solid #2563eb;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <span style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">${im.tipo || 'Imóvel'}</span>
          <h3 style="margin:4px 0 0;font-size:18px;color:#0f172a;">${im.cidade || ''}${im.cidade && im.estado ? ', ' : ''}${im.estado || ''}</h3>
        </div>
        ${desconto ? `<div style="background:#dcfce7;color:#059669;font-size:24px;font-weight:800;padding:8px 16px;border-radius:8px;">${desconto}% OFF</div>` : ''}
      </div>
      <div style="margin-top:16px;display:flex;gap:24px;flex-wrap:wrap;">
        <div>
          <div style="font-size:12px;color:#94a3b8;margin-bottom:2px;">Avaliação</div>
          <div style="font-size:16px;color:#475569;text-decoration:line-through;">${formatBRL(im.valor_avaliacao)}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#94a3b8;margin-bottom:2px;">Lance mínimo</div>
          <div style="font-size:20px;font-weight:700;color:#2563eb;">${formatBRL(im.lance_minimo)}</div>
        </div>
      </div>
      ${margem ? `<div style="margin-top:12px;background:#f0fdf4;border-radius:8px;padding:10px 14px;font-size:14px;color:#059669;">
        💰 Margem estimada: ${formatBRL(margem)}${margemPct ? ` (${margemPct}%)` : ''}
      </div>` : ''}
      ${im.modalidade ? `<div style="margin-top:10px;font-size:13px;color:#64748b;">Modalidade: <strong>${im.modalidade}</strong></div>` : ''}
      ${im.data_leilao ? `<div style="font-size:13px;color:#64748b;margin-top:4px;">📅 Leilão: ${new Date(im.data_leilao).toLocaleDateString('pt-BR')}</div>` : ''}
      ${im.link_edital ? `<a href="${im.link_edital}" style="display:inline-block;margin-top:16px;background:#2563eb;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;">Ver oportunidade →</a>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oportunidades TSN Ativos</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:32px 32px 24px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.02em;">TSN Ativos</div>
      <div style="font-size:14px;color:#94a3b8;margin-top:6px;">Oportunidades selecionadas para você</div>
    </div>
    <!-- Body -->
    <div style="background:#fff;padding:32px;border-radius:0 0 0 0;">
      <h2 style="margin:0 0 8px;font-size:22px;color:#0f172a;">Olá, ${userName}!</h2>
      <p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.6;">
        Encontramos <strong>${imoveis.length} imóvel${imoveis.length > 1 ? 'eis' : ''}</strong> que combinam com o seu perfil de investimento${filtroDesc ? ` (<em>${filtroDesc}</em>)` : ''}.
      </p>
      ${cardsHTML}
      <div style="text-align:center;margin-top:24px;">
        <a href="https://tsnativos.com.br/busca" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:16px;">Ver todos os imóveis →</a>
      </div>
    </div>
    <!-- Footer -->
    <div style="background:#f8fafc;padding:24px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="color:#94a3b8;font-size:12px;line-height:1.8;margin:0 0 12px;">
        Você recebe este email porque pesquisou imóveis em leilão na plataforma TSN Ativos.
        <br>TSN Ativos · Assessoria em Imóveis de Leilão · Brasil
      </p>
      <p style="margin:0;">
        <a href="${prefLink}" style="color:#2563eb;font-size:12px;text-decoration:none;margin:0 12px;">Alterar preferências de busca</a>
        &nbsp;·&nbsp;
        <a href="${unsubLink}" style="color:#94a3b8;font-size:12px;text-decoration:none;margin:0 12px;">Cancelar recebimento</a>
      </p>
    </div>
  </div>
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'TSN Ativos <alertas@tsnAtivos.com.br>',
      to: userEmail,
      subject: `${imoveis.length} oportunidade${imoveis.length > 1 ? 's' : ''} no seu perfil de busca`,
      html,
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
