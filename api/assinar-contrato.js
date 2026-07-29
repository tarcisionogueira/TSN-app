export const config = { runtime: 'edge' };

import { enviarEmail } from './_email.js';

// Finalização da assinatura eletrônica de contrato (link público).
// Feito no servidor para ter prova jurídica idônea (Lei 14.063/2020):
//  - IP capturado no servidor (x-forwarded-for), não confiável se vindo do cliente
//  - carimbo de tempo do servidor
//  - hash SHA-256 que INCLUI o conteúdo do contrato (detecta adulteração)
//  - gravação via service key (o cliente não altera a tabela direto)

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const { token, tipo_pessoa, dados, assinatura, docs_identidade, testemunha, geo } = body || {};
  if (!token || !assinatura || !dados) {
    return new Response(JSON.stringify({ error: 'Dados de assinatura incompletos' }), { status: 400, headers });
  }
  // Pontos de autenticação (padrão ZapSign): dispositivo pelo user-agent do SERVIDOR (mais confiável
  // que o enviado pelo cliente); localização aproximada só se o cliente consentiu (navigator.geolocation).
  const userAgent = req.headers.get('user-agent')?.slice(0, 400) || null;
  const geoOk = geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lng))
    ? { lat: Number(geo.lat), lng: Number(geo.lng) } : null;
  // Formato estrito do token (o default do banco é hex de 40 chars) — evita valores
  // gigantes/caracteres inesperados injetados no filtro PostgREST deste endpoint público.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(token))) {
    return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 400, headers });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  // Carrega o contrato pelo token (service key — ignora RLS)
  const r = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}&select=id,conteudo,status,expira_em,titulo,criado_por,assinante_email,contrato_grupo_id`);
  const rows = await r.json().catch(() => []);
  const contrato = Array.isArray(rows) ? rows[0] : null;
  if (!contrato) return new Response(JSON.stringify({ error: 'Contrato não encontrado' }), { status: 404, headers });
  // RASTREIO DO FLUXO (pedido do dono: "o Cliente 360 deve rastrear para avaliar o fluxo"). O
  // signatário é ANÔNIMO (sem sessão → o tracker do app não o pega); então registramos os ERROS
  // de assinatura na linha do tempo de QUEM CRIOU o contrato — assim o struggle fica VISÍVEL no
  // Cliente 360 (antes, só o SUCESSO era registrado; falhas sumiam). Best-effort, nunca bloqueia.
  const trackErro = (motivo, extra) => {
    try {
      if (!contrato?.criado_por) return;
      sb('rpc/registrar_atividade', { method: 'POST', body: JSON.stringify({
        p_user_id: contrato.criado_por, p_evento: 'contrato_assinatura_erro',
        p_detalhe: `Assinante não conseguiu assinar "${contrato.titulo || 'contrato'}": ${motivo}`,
        p_meta: { contrato_id: contrato.id, token, motivo, ...(extra || {}) },
      }) }).catch(() => {});
    } catch { /* best-effort */ }
  };
  if (!['aguardando', 'aguardando_assinatura'].includes(contrato.status)) {
    trackErro('contrato não está mais disponível', { status: contrato.status });
    return new Response(JSON.stringify({ error: 'Este contrato não está mais disponível para assinatura' }), { status: 409, headers });
  }
  if (contrato.expira_em && new Date(contrato.expira_em) < new Date()) {
    trackErro('link expirado', { expira_em: contrato.expira_em });
    return new Response(JSON.stringify({ error: 'Link de assinatura expirado' }), { status: 410, headers });
  }

  const assinado_em = new Date().toISOString();
  // Hash inclui o CONTEÚDO do contrato → vincula a assinatura ao texto assinado
  const hash = await sha256((contrato.conteudo || '') + JSON.stringify(dados) + assinatura + token + assinado_em);

  const patch = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'assinado',
      tipo_pessoa: tipo_pessoa || null,
      dados_signatario: dados,
      assinatura,
      assinado_em,
      assinante_ip: ip,
      assinante_user_agent: userAgent,
      assinante_geo: geoOk,
      assinatura_hash: hash,
      docs_identidade: docs_identidade || null,
      // Testemunha (quando o contrato exige assinatura de testemunha)
      ...(testemunha && testemunha.assinatura ? {
        nome_testemunha: String(testemunha.nome || '').slice(0, 160),
        cpf_testemunha: String(testemunha.cpf || '').replace(/\D/g, '').slice(0, 11),
        assinatura_testemunha: testemunha.assinatura,
        testemunha_em: assinado_em,
      } : {}),
    }),
  });
  if (!patch.ok) {
    const txt = await patch.text().catch(() => '');
    trackErro('falha ao gravar a assinatura', { detalhe: txt.slice(0, 160) });
    return new Response(JSON.stringify({ error: 'Falha ao registrar assinatura', detalhe: txt.slice(0, 200) }), { status: 500, headers });
  }

  // ENFORCEMENT: libera o acesso — marca o "contrato pendente" (que bloqueia a plataforma via
  // ContratoObrigatorio) como assinado. Best-effort: não falha a assinatura se isto falhar.
  sb(`contratos_pendentes?contrato_link_id=eq.${contrato.id}&status=eq.aguardando`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'assinado', assinado_em }),
  }).catch(() => {});

  // Trilha de auditoria (best-effort)
  sb('audit_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ acao: 'contrato_assinado', ip, sucesso: true, detalhes: { contrato_id: contrato.id, token, hash } }),
  }).catch(() => {});

  // NOTIFICA a cada assinatura (pedido do dono): avisa quem CRIOU o contrato que uma parte
  // assinou e, quando TODAS as partes do grupo assinam, que o contrato está completo. Também
  // registra na linha do tempo (Cliente 360). Tudo best-effort — nunca bloqueia a assinatura.
  try {
    const quem = dados?.nome || dados?.razao_social || contrato.assinante_email || 'Uma parte';
    const titulo = contrato.titulo || 'Contrato';
    const gid = contrato.contrato_grupo_id;
    // Situação do grupo: quantas partes já assinaram / total.
    let assinadas = 1, total = 1;
    if (gid) {
      const gr = await sb(`contratos_link?contrato_grupo_id=eq.${encodeURIComponent(gid)}&select=status`).then(x => x.json()).catch(() => []);
      if (Array.isArray(gr) && gr.length) { total = gr.length; assinadas = gr.filter(x => x.status === 'assinado').length; }
    }
    const completo = assinadas >= total;
    // E-mail do criador (equipe) p/ notificar.
    let criadorEmail = null, criadorNome = null;
    if (contrato.criado_por) {
      const p = await sb(`perfis?id=eq.${encodeURIComponent(contrato.criado_por)}&select=email,nome`).then(x => x.json()).catch(() => []);
      criadorEmail = p?.[0]?.email || null; criadorNome = p?.[0]?.nome || null;
    }
    if (criadorEmail) {
      const origin = req.headers.get('origin') || process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
      await enviarEmail({
        to: criadorEmail,
        subject: completo ? `✅ Contrato totalmente assinado: ${titulo}` : `✍️ Assinatura registrada (${assinadas}/${total}): ${titulo}`,
        html: `<p>Olá${criadorNome ? ' ' + criadorNome : ''}!</p>
               <p><strong>${quem}</strong> assinou o contrato <strong>${titulo}</strong>.</p>
               <p>Progresso: <strong>${assinadas} de ${total}</strong> parte(s) assinaram.${completo ? ' O contrato está <strong>totalmente assinado</strong>.' : ''}</p>
               <p><a href="${origin}#/contratos" style="display:inline-block;padding:10px 18px;background:#0D63DB;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Ver contratos</a></p>
               <p>BidPro Brasil</p>`,
        meta: { tipo: 'contrato' },
      }).catch(() => {});
      // Linha do tempo (Cliente 360) do criador.
      sb('rpc/registrar_atividade', { method: 'POST', body: JSON.stringify({
        p_user_id: contrato.criado_por,
        p_evento: completo ? 'contrato_assinado_completo' : 'contrato_assinado_parcial',
        p_detalhe: `${quem} assinou "${titulo}" (${assinadas}/${total})`,
        p_meta: { contrato_id: contrato.id, grupo_id: gid, assinadas, total },
      }) }).catch(() => {});
    }

    // ENTREGA DO DOCUMENTO ASSINADO (pedido do dono): quando TODAS as partes assinaram, CADA parte
    // recebe por e-mail o link do documento devidamente assinado (abre em modo leitura pelo token,
    // sem precisar de conta). Vale para grupo (várias partes) e para contrato de parte única.
    if (completo) {
      const origin = req.headers.get('origin') || process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
      let partes = [];
      if (gid) {
        partes = await sb(`contratos_link?contrato_grupo_id=eq.${encodeURIComponent(gid)}&select=assinante_email,token`).then(x => x.json()).catch(() => []);
      } else {
        partes = [{ assinante_email: contrato.assinante_email, token }];
      }
      if (Array.isArray(partes)) {
        await Promise.all(partes.filter(p => p?.assinante_email && p?.token).map(p =>
          enviarEmail({
            to: p.assinante_email,
            subject: `📄 Documento assinado por todas as partes: ${titulo}`,
            html: `<p>Olá!</p>
                   <p>O contrato <strong>${titulo}</strong> foi assinado por TODAS as partes e agora tem validade jurídica (MP 2.200-2/2001 e Lei 14.063/2020).</p>
                   <p>Acesse o documento devidamente assinado, com as informações de assinatura ao final:</p>
                   <p><a href="${origin}#/c/${p.token}" style="display:inline-block;padding:11px 20px;background:#0D63DB;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Ver documento assinado</a></p>
                   <p>Ou copie o link: ${origin}#/c/${p.token}</p>
                   <p>BidPro Brasil</p>`,
            meta: { tipo: 'contrato' },
          }).catch(() => {})
        ));
      }
    }
  } catch { /* notificação é best-effort */ }

  return new Response(JSON.stringify({ ok: true, assinado_em, hash }), { status: 200, headers });
}
