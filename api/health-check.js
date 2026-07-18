export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DAILY_KEY = process.env.DAILY_API_KEY;
const APP_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.APP_FROM_EMAIL || 'noreply@bidprobrasil.com.br';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br';

async function enviarAlertaEmail(statusGeral, resumo, itens) {
  if (!RESEND_API_KEY || statusGeral === 'ok') return;
  const cor = statusGeral === 'erro' ? '#dc2626' : '#d97706';
  const emoji = statusGeral === 'erro' ? '🔴' : '⚠️';
  const linhas = itens
    .filter(i => i.status !== 'ok')
    .map(i => `<tr><td style="padding:8px;border-bottom:1px solid #f1f5f9;font-weight:600">${i.nome}</td><td style="padding:8px;border-bottom:1px solid #f1f5f9;color:${i.status==='erro'?'#dc2626':'#d97706'}">${i.status.toUpperCase()}</td><td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#64748b">${i.detalhe}</td></tr>`)
    .join('');
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <div style="background:${cor};color:white;padding:20px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">${emoji} Health Check — ${statusGeral.toUpperCase()}</h2>
      <p style="margin:8px 0 0;opacity:.9">${resumo}</p>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f8fafc"><th style="padding:8px;text-align:left;color:#64748b;font-size:12px">VERIFICAÇÃO</th><th style="padding:8px;text-align:left;color:#64748b;font-size:12px">STATUS</th><th style="padding:8px;text-align:left;color:#64748b;font-size:12px">DETALHE</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid #f1f5f9">
        <a href="${APP_URL}/#/admin" style="display:inline-block;background:#0D63DB;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Ver no Admin →</a>
      </div>
    </div>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject: `${emoji} BidPro Health Check — ${statusGeral.toUpperCase()}`, html }),
  });
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function check(nome, fn) {
  const t0 = Date.now();
  try {
    const resultado = await fn();
    return { nome, status: resultado.status || 'ok', detalhe: resultado.detalhe || '', ms: Date.now() - t0, corrigido: resultado.corrigido || false };
  } catch (e) {
    return { nome, status: 'erro', detalhe: String(e?.message || e), ms: Date.now() - t0, corrigido: false };
  }
}

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Cron Vercel usa Authorization: Bearer <CRON_SECRET>; chamada manual exige autenticação admin
  const { isCronAuthorized } = await import('./_auth.js');
  const isCron = isCronAuthorized(req);

  if (!isCron) {
    const user = await getUser(req);
    if (!user) return unauthorized();
    const role = await getUserRoleById(user.id);
    if (role !== 'admin') return forbidden();
  }

  if (!SUPABASE_SERVICE_KEY) return new Response(JSON.stringify({ error: 'SUPABASE_SERVICE_KEY não configurada' }), { status: 500 });

  const inicio = Date.now();
  const itens = [];

  // ── 1. Supabase: conexão básica ──
  itens.push(await check('Supabase — conexão', async () => {
    const r = await sb('perfis?select=count&limit=1', { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { status: 'ok', detalhe: 'Query perfis OK' };
  }));

  // ── 2. Supabase: tabelas críticas ──
  for (const tabela of ['sdr_leads', 'sdr_produtos', 'chamados', 'solicitacoes', 'health_check_logs']) {
    itens.push(await check(`Supabase — tabela ${tabela}`, async () => {
      const r = await sb(`${tabela}?select=count&limit=1`, { headers: { Prefer: 'count=exact' } });
      if (r.status === 404) throw new Error('Tabela não encontrada');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: 'ok', detalhe: `${tabela} acessível` };
    }));
  }

  // ── 3. Supabase: chamados de suporte sem resposta há mais de 7 dias ──
  // NÃO fecha automaticamente. Um chamado aberto é uma reclamação REAL do cliente
  // (ex.: "deu erro no meu relatório"). Fechar sozinho ESCONDE o problema e prejudica
  // o atendimento (era, inclusive, uma ação quebrada: gravava obs_interna, coluna que
  // não existe). Aqui só SINALIZA para um humano revisar na aba Suporte.
  itens.push(await check('Supabase — chamados presos', async () => {
    const limite = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const r = await sb(`chamados?select=id,titulo,criado_em&status=eq.aberto&criado_em=lt.${limite}&order=criado_em.asc&limit=50`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const presos = await r.json();
    if (presos.length === 0) return { status: 'ok', detalhe: 'Nenhum chamado sem resposta' };
    const antigo = presos[0]?.criado_em ? new Date(presos[0].criado_em).toLocaleDateString('pt-BR') : '';
    return { status: 'aviso', detalhe: `${presos.length} chamado(s) aberto(s) há +7 dias — REVISAR na aba Suporte (não fecho sozinho; mais antigo: ${antigo}).` };
  }));

  // ── 3b. Anomalias detectadas ao gerar RELATÓRIOS (o agente que aprende sinaliza) ──
  // Ex.: avaliação ausente no leiloeiro (desconto sai zerado), CNJ sem retorno no
  // documental. Só SINALIZA para revisão — não gera relatório (custo zero).
  itens.push(await check('Relatórios — anomalias detectadas', async () => {
    const r = await sb(`relatorio_anomalias?select=tipo,fonte&resolvido=eq.false&limit=200`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const an = await r.json();
    if (!Array.isArray(an) || an.length === 0) return { status: 'ok', detalhe: 'Nenhuma anomalia em relatórios' };
    const porTipo = {};
    for (const a of an) porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1;
    const resumo = Object.entries(porTipo).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t}: ${n}`).join(' · ');
    // Valor sentinela (ex.: R$999.999.999) é FALHA CRÍTICA de confiabilidade — escala p/ erro.
    const critico = !!porTipo['valor_sentinela'];
    return {
      status: critico ? 'erro' : 'aviso',
      detalhe: `${an.length} anomalia(s) — ${resumo}.${critico ? ' CRÍTICO: valor sentinela — confirmar o valor no edital antes de exibir.' : ' Revisar (sinalizado automaticamente pelo gerador).'}`,
    };
  }));

  // ── 3c. Uso — gaps de RLS que quebram a AÇÃO do usuário (proativo) ──
  // Detecta a classe do bug "new row violates row-level security policy": tabela de
  // dados do usuário (com coluna de dono) com RLS ligada mas SEM política de escrita
  // para ele — só admin ou nenhuma. Pega a regressão ANTES de o usuário topar com o
  // erro. Cobre AUTOMATICAMENTE qualquer tabela nova (RPC auditoria_uso no banco).
  itens.push(await check('Uso — RLS de escrita do usuário', async () => {
    const r = await sb('rpc/auditoria_uso', { method: 'POST', body: '{}' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const total = d?.total || 0;
    if (total === 0) return { status: 'ok', detalhe: 'Nenhuma tabela de usuário sem política de escrita' };
    const lista = (d.gaps || []).map(g => `${g.tabela}(${g.coluna_dono})`).join(', ');
    return { status: 'aviso', detalhe: `${total} tabela(s) com RLS mas SEM escrita do usuário — pode quebrar o uso: ${lista}. Adicionar política de INSERT/UPDATE do dono (ou incluir na allowlist se for só-servidor).` };
  }));

  // ── 3d. Uso — erros de runtime do cliente (proativo, além de RLS) ──
  // ErrorBoundary + handlers globais persistem em erros_cliente (dedup por
  // fingerprint). Aqui a saúde enxerga QUALQUER quebra que atingiu o usuário nas
  // últimas 24h — não só a classe RLS. Auto-limpa quando o erro para de ocorrer
  // (sai da janela de 24h). Escala p/ ERRO se for amplo ou atingir usuário logado.
  itens.push(await check('Uso — erros de runtime do cliente', async () => {
    const limite = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await sb(`erros_cliente?select=msg,rota,ocorrencias,user_id&resolvido=eq.false&ultima_em=gte.${limite}&order=ocorrencias.desc&limit=50`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const erros = await r.json();
    if (!Array.isArray(erros) || erros.length === 0) return { status: 'ok', detalhe: 'Nenhum erro de runtime do cliente nas últimas 24h' };
    const totalOcorr = erros.reduce((s, e) => s + (e.ocorrencias || 1), 0);
    const afetaLogado = erros.some(e => e.user_id);
    const pior = erros[0];
    // Amplo (muitas ocorrências do mesmo erro) OU atingindo usuário logado = crítico.
    const critico = (pior?.ocorrencias || 0) >= 25 || (afetaLogado && totalOcorr >= 10);
    const top = erros.slice(0, 3).map(e => `"${String(e.msg || '').slice(0, 60)}"${e.rota ? ` @${e.rota}` : ''} ×${e.ocorrencias}`).join(' · ');
    return {
      status: critico ? 'erro' : 'aviso',
      detalhe: `${erros.length} erro(s) distinto(s) / ${totalOcorr} ocorrência(s) em 24h${afetaLogado ? ' (afeta usuário logado)' : ''} — ${top}. Investigar em erros_cliente.`,
    };
  }));

  // ── 3e. Relatórios — FALHAS DE GERAÇÃO (status='erro') ──
  // Quando um gerador lança exceção, a análise fica com status='erro' (ex.: o
  // ReferenceError "mercado is not defined"). Isso NÃO aparecia na saúde — só o
  // cliente via "Erro ao gerar". Agora a saúde conta as falhas recentes de cada
  // gerador; uma MESMA mensagem repetida = regressão sistêmica → escala p/ ERRO
  // (teria pego este bug no mesmo dia). Timeout pontual fica como aviso leve.
  itens.push(await check('Relatórios — falhas de geração', async () => {
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const tabelas = { mercado: 'analises_mercado', documental: 'analises_documental', laudo: 'analises_laudo' };
    const contas = await Promise.all(Object.entries(tabelas).map(async ([nome, tab]) => {
      const r = await sb(`${tab}?select=erro&status=eq.erro&updated_at=gte.${desde}&limit=200`);
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${tab}`);
      const rows = await r.json();
      const porMsg = {};
      for (const x of rows) { const m = String(x.erro || '?').slice(0, 80); porMsg[m] = (porMsg[m] || 0) + 1; }
      return { nome, total: rows.length, porMsg };
    }));
    const total = contas.reduce((s, c) => s + c.total, 0);
    if (total === 0) return { status: 'ok', detalhe: 'Nenhuma falha de geração de relatório nas últimas 24h' };
    // Mesma mensagem repetida em 3+ relatórios = bug sistêmico de geração (não timeout pontual).
    const piorRepeticao = Math.max(0, ...contas.flatMap(c => Object.values(c.porMsg)));
    const resumo = contas.filter(c => c.total).map(c => {
      const top = Object.entries(c.porMsg).sort((a, b) => b[1] - a[1])[0];
      return `${c.nome}: ${c.total}${top ? ` ("${top[0]}" ×${top[1]})` : ''}`;
    }).join(' · ');
    return {
      status: piorRepeticao >= 3 ? 'erro' : 'aviso',
      detalhe: `${total} falha(s) de geração em 24h — ${resumo}.${piorRepeticao >= 3 ? ' Mesma mensagem repetida = provável bug de geração, investigar AGORA.' : ' Revisar (pode ser timeout pontual).'}`,
    };
  }));

  // ── 4. Supabase: clientes/leads sem consultor há >3 dias ──
  itens.push(await check('Comercial — clientes sem consultor', async () => {
    const limite = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const r = await sb(`sdr_leads?select=count&consultor_id=is.null&status=eq.novo&criado_em=lt.${limite}`, { headers: { Prefer: 'count=exact' } });
    const count = parseInt(r.headers?.get?.('content-range')?.split('/')?.[1] || '0');
    if (count === 0) return { status: 'ok', detalhe: 'Todos os leads têm consultor ou são recentes' };
    return { status: 'aviso', detalhe: `${count} lead(s) sem consultor há mais de 3 dias — atribuição manual necessária` };
  }));

  // ── 5. Daily.co — API ──
  if (DAILY_KEY) {
    itens.push(await check('Daily.co — API', async () => {
      const r = await fetch('https://api.daily.co/v1/', { headers: { Authorization: `Bearer ${DAILY_KEY}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: 'ok', detalhe: 'Daily.co API respondendo' };
    }));
  } else {
    itens.push({ nome: 'Daily.co — API', status: 'aviso', detalhe: 'DAILY_API_KEY não configurada', ms: 0, corrigido: false });
  }

  // ── 6. Anthropic/Claude — API ──
  const claudeKey = process.env.CLAUDE_KEY;
  if (claudeKey) {
    itens.push(await check('Claude — API', async () => {
      const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: 'ok', detalhe: 'Anthropic API respondendo' };
    }));
  } else {
    itens.push({ nome: 'Claude — API', status: 'aviso', detalhe: 'CLAUDE_KEY não configurada', ms: 0, corrigido: false });
  }

  // ── 7. APIs internas ──
  for (const path of ['/api/system-status']) {
    itens.push(await check(`API interna — ${path}`, async () => {
      const r = await fetch(`${APP_URL}${path}`);
      // 401/403 = servidor respondendo corretamente (rota protegida sem token)
      if (!r.ok && r.status !== 405 && r.status !== 401 && r.status !== 403) throw new Error(`HTTP ${r.status}`);
      return { status: 'ok', detalhe: `${path} respondendo` };
    }));
  }

  // ── Compila resultado ──
  const temErro  = itens.some(i => i.status === 'erro');
  const temAviso = itens.some(i => i.status === 'aviso');
  const statusGeral = temErro ? 'erro' : temAviso ? 'aviso' : 'ok';
  const corrigidos = itens.filter(i => i.corrigido).length;
  const erros = itens.filter(i => i.status === 'erro').length;
  const avisos = itens.filter(i => i.status === 'aviso').length;

  const resumo = statusGeral === 'ok'
    ? `Tudo OK — ${itens.length} verificações passaram em ${Date.now()-inicio}ms`
    : `${erros} erro(s), ${avisos} aviso(s) — ${corrigidos} corrigido(s) automaticamente`;

  // ── Salva no banco ──
  await sb('health_check_logs', {
    method: 'POST',
    body: JSON.stringify({ status: statusGeral, resumo, itens, duracao_ms: Date.now() - inicio }),
    headers: { Prefer: 'return=minimal' },
  });

  // ── Envia alerta por e-mail se há erro ou aviso ──
  await enviarAlertaEmail(statusGeral, resumo, itens);

  return new Response(JSON.stringify({ status: statusGeral, resumo, itens, duracao_ms: Date.now() - inicio }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
