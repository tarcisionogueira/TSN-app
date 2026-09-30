/**
 * Ferramentas (tool use) da "Inteligência Admin" (api/admin-chat.js).
 *
 * Pedido do dono (22/09): a IA do chat administrativo, além do CNJ DataJud (já injetado pelo
 * front como contexto), também consultar o DJEN direto por processo, identificar arrematações
 * de clientes em andamento pra facilitar a comunicação, e — só quando EXPLICITAMENTE pedido —
 * emitir alerta/notificação. Mensalidade não cobrada e movimentação de processo dos
 * assessorados viram consultas que a própria IA pode rodar, sem o admin escrever SQL.
 *
 * Todas as consultas são leitura (service_role, sem exposição a anon/authenticated — este
 * módulo só é importado por api/admin-chat.js, que já exige role==='admin'). A única ESCRITA
 * (emitir_alerta) tem duas etapas: sem `confirmar:true` só devolve a prévia (nenhum envio);
 * só envia de verdade quando o admin confirma na mensagem seguinte e a IA re-chama com
 * confirmar:true — ver `system` em admin-chat.js.
 */
import { enviarWebPush } from './_webpush.js';
import { auditLog } from './_audit.js';
import { buscarDjen, buscarProcessosCNJ, buscarProcessosPorParte } from './_cnj.js';
import { preverAndamento, estatisticaFluxo, justicaDoNumero } from './_previsao-processo.js';
import { buscarJurisprudencia } from './_jurisprudencia.js';
import { aprenderDaConsulta } from './_aprendizado-processual.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = 'mailto:alertas@bidprobrasil.com.br';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function sbJson(path) {
  const r = await sb(path);
  if (!r.ok) return { erro: `consulta falhou (${r.status})` };
  return r.json();
}

// ─── Definições (schema Anthropic tool use) ──────────────────────────────────
export const ADMIN_CHAT_TOOLS = [
  {
    name: 'buscar_djen',
    description: 'Consulta o DJEN (Diário de Justiça Eletrônico Nacional, API pública do CNJ) direto por número de processo — publicações/movimentações recentes que o DataJud pode não trazer. Use quando o admin perguntar sobre publicações, editais ou andamento recente de um processo específico.',
    input_schema: {
      type: 'object',
      properties: { numero_processo: { type: 'string', description: 'Número CNJ do processo (com ou sem pontuação), ex: 5006360-95.2023.8.08.0021' } },
      required: ['numero_processo'],
    },
  },
  {
    name: 'verificar_arremate_processo',
    description: 'Verifica se um número de processo corresponde a um lote do acervo com arrematação/análise de cliente em andamento — identifica QUAL cliente comprou/analisou aquele imóvel, para facilitar contato direto em vez de responder genericamente.',
    input_schema: {
      type: 'object',
      properties: { numero_processo: { type: 'string', description: 'Número CNJ do processo' } },
      required: ['numero_processo'],
    },
  },
  {
    name: 'buscar_arremates_cliente',
    description: 'Busca as arrematações (compras confirmadas) de um cliente PELO NOME — use sempre que o admin mencionar um cliente/assessorado pelo nome sem informar o número do processo (ex.: "o Marcos arrematou, verifica o processo dele"). Devolve os lotes arrematados e o número de processo de cada um, que você pode então usar em buscar_djen para checar se o auto foi expedido.',
    input_schema: {
      type: 'object',
      properties: { nome: { type: 'string', description: 'Nome (completo ou parcial) do cliente' } },
      required: ['nome'],
    },
  },
  {
    name: 'checar_mensalidades_atrasadas',
    description: 'Lista assinaturas (mensalidades) com renovação ativa cuja data de cobrança já passou sem um pagamento aprovado correspondente — sinal de falha de cobrança recorrente no Mercado Pago.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'checar_movimentacao_processos_assessorados',
    description: 'Lista processos monitorados de clientes do plano "assessorado" com movimentação processual nos últimos 14 dias (ou nunca movimentados) — para saber quem precisa ser avisado sobre novidade no processo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'emitir_alerta',
    description: 'Envia uma notificação push no sistema para um usuário específico ou um grupo (role). SÓ chame com confirmar:true quando o admin já tiver pedido EXPLICITAMENTE o envio (ex.: "manda", "avisa", "confirma o envio"). Na primeira vez, chame com confirmar:false para mostrar a prévia (título/corpo/destino) antes de enviar de verdade.',
    input_schema: {
      type: 'object',
      properties: {
        destino_tipo: { type: 'string', enum: ['usuario', 'role'], description: 'Enviar para 1 usuário (user_id) ou para todos com um role' },
        user_id: { type: 'string', description: 'UUID do usuário (quando destino_tipo=usuario)' },
        role: { type: 'string', description: 'Role alvo, ex: assessorado, admin, analista (quando destino_tipo=role)' },
        titulo: { type: 'string', description: 'Título da notificação (até 100 caracteres)' },
        mensagem: { type: 'string', description: 'Corpo da notificação (até 200 caracteres)' },
        confirmar: { type: 'boolean', description: 'false = só mostra a prévia, não envia. true = envia de verdade (só depois do admin confirmar).' },
      },
      required: ['destino_tipo', 'titulo', 'mensagem', 'confirmar'],
    },
  },
  {
    name: 'buscar_edital_processo',
    description: 'Busca no RADAR DE EDITAIS da própria plataforma (editais de leilão publicados no DJEN, ~2 mil, base nossa e grátis) pelo número do processo: datas da 1ª e 2ª praça, leiloeiro e site do leilão, avaliação, lance mínimo, endereço e matrícula do imóvel, cartório, débitos e ocupação declarados no edital. Use SEMPRE que a pergunta envolver leilão/praça/edital/avaliação de um processo — responde o que o DataJud não tem.',
    input_schema: { type: 'object', properties: { numero_processo: { type: 'string', description: 'Número CNJ (com ou sem pontuação)' } }, required: ['numero_processo'] },
  },
  {
    name: 'consultar_datajud',
    description: 'Consulta o DataJud (CNJ) pelo NÚMERO do processo — vai direto ao tribunal indicado pelo número (+ superior): classe, assuntos, órgão e últimos movimentos, com parecer de risco. O DataJud público NÃO tem partes: para procurar processos de uma pessoa/empresa use buscar_processos_por_parte.',
    input_schema: {
      type: 'object',
      properties: { numero_processo: { type: 'string', description: 'Número CNJ do processo' } },
      required: ['numero_processo'],
    },
  },
  {
    name: 'buscar_processos_por_parte',
    description: 'Varre TODOS os tribunais (DJEN/Comunica CNJ, uma chamada) atrás de processos em que a pessoa ou empresa aparece como parte — use quando o admin der NOME/RAZÃO SOCIAL, CPF ou CNPJ (nunca para número de processo). CNPJ: resolve a razão social na Receita e busca por ela. CPF: procura o nome na base da plataforma; se não achar, peça o nome (não há fonte aberta CPF→nome). Devolve processos com tribunal, classe, órgão, polo da parte, últimas publicações e riscos; avisa de homônimo (o DJEN não mostra documento).',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome completo ou razão social' },
        cpf: { type: 'string', description: 'CPF da parte' },
        cnpj: { type: 'string', description: 'CNPJ da parte' },
        meses: { type: 'number', description: 'Janela de publicações em meses (padrão 12, máx. 36)' },
      },
    },
  },
  {
    name: 'consultar_cnpj',
    description: 'Dados abertos da Receita Federal de uma EMPRESA (parte do processo: executada, credora, construtora, banco): razão social, situação cadastral e data, endereço, atividade principal, capital social e sócios (QSA). Fonte gratuita (BrasilAPI; reserva minhareceita.org). NÃO serve para CPF.',
    input_schema: { type: 'object', properties: { cnpj: { type: 'string', description: 'CNPJ com ou sem pontuação' } }, required: ['cnpj'] },
  },
  {
    name: 'buscar_jurisprudencia',
    description: 'Pesquisa JURISPRUDÊNCIA (STJ, TST, TJs, TRTs, TRFs — sites .jus.br) sobre um tema jurídico e devolve até 5 decisões com tribunal, número, tese em linguagem simples e LINK verificável. Use quando o admin pedir jurisprudência, precedentes, "como os tribunais decidem", ou quando a resposta depender de entendimento dos tribunais (ex.: prazo de impugnação da arrematação, imissão na posse com ocupante, débitos de IPTU/condomínio do arrematante, preço vil). Custa uma pesquisa na web (cache de 30 dias por tema).',
    input_schema: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Tema jurídico objetivo, ex.: "responsabilidade do arrematante por débitos de condomínio anteriores à arrematação"' },
        contexto: { type: 'string', description: 'Contexto opcional do caso (tribunal, fase, tipo de leilão)' },
      },
      required: ['tema'],
    },
  },
];
// ─── Executores ───────────────────────────────────────────────────────────

async function verificarArremateProcesso({ numero_processo }) {
  const num = String(numero_processo || '').trim();
  if (!num) return { erro: 'numero_processo obrigatório' };
  // RPC em vez de filtro direto: a coluna guarda o número em DOIS formatos (596 linhas só
  // dígitos, 21 com pontuação CNJ) — `buscar_lote_por_processo` normaliza os dois lados antes
  // de comparar, senão um filtro exato perderia silenciosamente as linhas do formato diferente.
  const r = await sb(`rpc/buscar_lote_por_processo`, { method: 'POST', body: JSON.stringify({ p_numero: num }) });
  if (!r.ok) return { erro: `consulta falhou (${r.status})` };
  const lotes = await r.json();
  if (!lotes.length) return { encontrado: false, observacao: 'Nenhum lote do acervo tem este número de processo.' };

  const resultados = [];
  for (const lote of lotes) {
    // `casos` é a fonte de verdade de arremate (status_etapa/arrematado_em) — achado ao testar
    // com dado real (22/09): analises_mercado/documental/laudo.arrematado fica FALSE mesmo em
    // cliente com arremate formal e caso aberto (ex.: Marcos Araujo, caso d86f357b, imóvel de
    // Feira de Santana/BA), então usar só esse campo perde o cliente. analises_* ainda entra
    // como sinal secundário (cliente que está analisando/em andamento, sem caso formal ainda).
    const [casos, mercado, documental, laudo] = await Promise.all([
      sbJson(`casos?imovel_id=eq.${lote.id}&select=id,cliente_id,status_etapa,arrematado_em`),
      sbJson(`analises_mercado?imovel_id=eq.${lote.id}&select=user_id,status,arrematado&limit=10`),
      sbJson(`analises_documental?imovel_id=eq.${lote.id}&select=user_id,status,arrematado&limit=10`),
      sbJson(`analises_laudo?imovel_id=eq.${lote.id}&select=user_id,status,arrematado&limit=10`),
    ]);
    const analises = [...(mercado || []), ...(documental || []), ...(laudo || [])];
    const userIds = new Set();
    for (const c of Array.isArray(casos) ? casos : []) if (c?.cliente_id) userIds.add(c.cliente_id);
    for (const a of analises) if (a?.user_id) userIds.add(a.user_id);
    let clientes = [];
    if (userIds.size) {
      const perfis = await sbJson(`perfis?id=in.(${[...userIds].join(',')})&select=id,nome,role`);
      clientes = (Array.isArray(perfis) ? perfis : []).map((p) => {
        const caso = (Array.isArray(casos) ? casos : []).find((c) => c.cliente_id === p.id);
        return {
          nome: p.nome, role: p.role,
          arrematado: !!caso?.arrematado_em || analises.some((a) => a.user_id === p.id && a.arrematado),
          caso_id: caso?.id || null,
          status_etapa: caso?.status_etapa || null,
          arrematado_em: caso?.arrematado_em || null,
        };
      });
    }
    resultados.push({ imovel_id: lote.id, titulo: lote.titulo, cidade: lote.cidade, estado: lote.estado, ativo: lote.ativo, clientes });
  }
  return { encontrado: true, lotes: resultados };
}

async function buscarArrematesCliente({ nome }) {
  const termo = String(nome || '').trim();
  if (!termo) return { erro: 'nome obrigatório' };
  const perfis = await sbJson(`perfis?nome=ilike.*${encodeURIComponent(termo)}*&select=id,nome,role&limit=5`);
  if (perfis?.erro) return perfis;
  if (!perfis.length) return { encontrado: false, observacao: `Nenhum cliente encontrado com o nome "${termo}".` };

  const clientes = [];
  for (const p of perfis) {
    // `casos` é a fonte de verdade de arremate — ver o comentário em verificarArremateProcesso
    // (achado 22/09: analises_*.arrematado fica FALSE mesmo com caso formal arrematado).
    // analises_*.arrematado=true entra como sinal secundário (raro, mas cobre o caso de um
    // fluxo antigo que marcava só lá).
    const [casos, mercado, documental, laudo] = await Promise.all([
      sbJson(`casos?cliente_id=eq.${p.id}&status_etapa=eq.arrematado&select=id,imovel_id,status_etapa,arrematado_em&order=arrematado_em.desc&limit=10`),
      sbJson(`analises_mercado?user_id=eq.${p.id}&arrematado=eq.true&select=imovel_id,status,updated_at&order=updated_at.desc&limit=10`),
      sbJson(`analises_documental?user_id=eq.${p.id}&arrematado=eq.true&select=imovel_id,status,updated_at&order=updated_at.desc&limit=10`),
      sbJson(`analises_laudo?user_id=eq.${p.id}&arrematado=eq.true&select=imovel_id,status,updated_at&order=updated_at.desc&limit=10`),
    ]);
    const casoPorImovel = Object.fromEntries((Array.isArray(casos) ? casos : []).map((c) => [c.imovel_id, c]));
    const imovelIds = new Set(Object.keys(casoPorImovel));
    for (const a of [...(mercado || []), ...(documental || []), ...(laudo || [])]) if (a?.imovel_id) imovelIds.add(a.imovel_id);
    let lotes = [];
    if (imovelIds.size) {
      const ls = await sbJson(`imoveis_leilao?id=in.(${[...imovelIds].join(',')})&select=id,titulo,cidade,estado,numero_processo,data_leilao,ativo`);
      lotes = (Array.isArray(ls) ? ls : []).map((l) => ({ ...l, caso_id: casoPorImovel[l.id]?.id || null, arrematado_em: casoPorImovel[l.id]?.arrematado_em || null }));
    }
    clientes.push({ id: p.id, nome: p.nome, role: p.role, arrematacoes: lotes });
  }
  const semArremate = clientes.every((c) => !c.arrematacoes.length);
  return { encontrado: true, clientes, observacao: semArremate ? 'Cliente(s) encontrado(s), mas sem arrematação (caso com status_etapa=arrematado) registrada no sistema.' : undefined };
}

async function checarMensalidadesAtrasadas() {
  const assinaturas = await sbJson(
    `mp_assinaturas?renovar=eq.true&status=eq.authorized&proxima_cobranca=lt.${new Date().toISOString().slice(0, 10)}&select=user_id,plano_key,proxima_cobranca,valor_contratado&order=proxima_cobranca.asc&limit=30`
  );
  if (assinaturas?.erro) return assinaturas;
  if (!assinaturas.length) return { total: 0, observacao: 'Nenhuma mensalidade com cobrança em atraso.' };

  const userIds = [...new Set(assinaturas.map((a) => a.user_id).filter(Boolean))];
  const [perfis, pagamentos] = await Promise.all([
    sbJson(`perfis?id=in.(${userIds.join(',')})&select=id,nome`),
    sbJson(`mp_pagamentos?user_id=in.(${userIds.join(',')})&status=eq.approved&select=user_id,criado_em&order=criado_em.desc&limit=200`),
  ]);
  const nomePorId = Object.fromEntries((Array.isArray(perfis) ? perfis : []).map((p) => [p.id, p.nome]));

  const semCobrancaRecente = assinaturas.filter((a) => {
    const corte = new Date(new Date(a.proxima_cobranca).getTime() - 2 * 86400000);
    return !(Array.isArray(pagamentos) ? pagamentos : []).some((pg) => pg.user_id === a.user_id && new Date(pg.criado_em) > corte);
  });

  return {
    total: semCobrancaRecente.length,
    mensalidades: semCobrancaRecente.map((a) => ({
      cliente: nomePorId[a.user_id] || a.user_id,
      plano: a.plano_key,
      proxima_cobranca: a.proxima_cobranca,
      valor: a.valor_contratado,
      dias_atraso: Math.floor((Date.now() - new Date(a.proxima_cobranca).getTime()) / 86400000),
    })),
  };
}

async function checarMovimentacaoProcessosAssessorados() {
  const monitorados = await sbJson(`processos_monitorados?ativo=eq.true&select=numero_processo,rotulo,caso_id&limit=200`);
  if (monitorados?.erro) return monitorados;
  const comCaso = monitorados.filter((m) => m.caso_id);
  if (!comCaso.length) return { total: 0, observacao: 'Nenhum processo monitorado vinculado a um caso de cliente.' };

  const casoIds = [...new Set(comCaso.map((m) => m.caso_id))];
  const casos = await sbJson(`casos?id=in.(${casoIds.join(',')})&select=id,cliente_id,status_etapa`);
  const clienteIdPorCaso = Object.fromEntries((Array.isArray(casos) ? casos : []).map((c) => [c.id, { cliente_id: c.cliente_id, status_etapa: c.status_etapa }]));

  const clienteIds = [...new Set(Object.values(clienteIdPorCaso).map((c) => c.cliente_id).filter(Boolean))];
  const perfis = await sbJson(`perfis?id=in.(${clienteIds.join(',')})&role=eq.assessorado&select=id,nome`);
  const nomeAssessorado = Object.fromEntries((Array.isArray(perfis) ? perfis : []).map((p) => [p.id, p.nome]));

  const relevantes = comCaso.filter((m) => nomeAssessorado[clienteIdPorCaso[m.caso_id]?.cliente_id]);
  if (!relevantes.length) return { total: 0, observacao: 'Nenhum processo monitorado pertence a cliente do plano assessorado.' };

  const numeros = relevantes.map((m) => m.numero_processo);
  const movs = await sbJson(`processo_movimentos?numero_processo=in.(${numeros.map((n) => `"${n}"`).join(',')})&select=numero_processo,data&order=data.desc&limit=2000`);
  const porProcesso = {};
  for (const mv of Array.isArray(movs) ? movs : []) {
    if (!porProcesso[mv.numero_processo]) porProcesso[mv.numero_processo] = { ultimo: mv.data, recentes: 0 };
    if (new Date(mv.data) > new Date(Date.now() - 14 * 86400000)) porProcesso[mv.numero_processo].recentes++;
  }

  const linhas = relevantes.map((m) => {
    const cliente = nomeAssessorado[clienteIdPorCaso[m.caso_id]?.cliente_id];
    const info = porProcesso[m.numero_processo];
    return {
      numero_processo: m.numero_processo, cliente, rotulo: m.rotulo,
      status_etapa: clienteIdPorCaso[m.caso_id]?.status_etapa,
      ultimo_movimento: info?.ultimo || null,
      movimentos_ultimos_14_dias: info?.recentes || 0,
    };
  }).filter((l) => l.movimentos_ultimos_14_dias > 0 || !l.ultimo_movimento)
    .sort((a, b) => (b.ultimo_movimento || '').localeCompare(a.ultimo_movimento || ''));

  return { total: linhas.length, processos: linhas.slice(0, 20) };
}

async function emitirAlerta(input, { adminUser }) {
  const { destino_tipo, user_id, role, titulo, mensagem, confirmar } = input;
  const tit = String(titulo || '').slice(0, 100);
  const corpo = String(mensagem || '').slice(0, 200);
  if (!tit || !corpo) return { erro: 'titulo e mensagem obrigatórios' };
  if (destino_tipo === 'usuario' && !/^[0-9a-f-]{36}$/i.test(String(user_id || ''))) return { erro: 'user_id inválido' };
  if (destino_tipo === 'role' && !role) return { erro: 'role obrigatório para destino_tipo=role' };

  if (!confirmar) {
    return {
      previa: true,
      destino: destino_tipo === 'usuario' ? `usuário ${user_id}` : `todos com role "${role}"`,
      titulo: tit, mensagem: corpo,
      observacao: 'Isto é só uma PRÉVIA — nada foi enviado. Peça confirmação explícita ao admin antes de chamar de novo com confirmar:true.',
    };
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return { erro: 'VAPID keys não configuradas — envio indisponível' };

  let query = 'push_subscriptions?select=endpoint,p256dh,auth,user_id';
  if (destino_tipo === 'usuario') query += `&user_id=eq.${encodeURIComponent(user_id)}`;
  else {
    const perfis = await sbJson(`perfis?role=eq.${encodeURIComponent(role)}&select=id`);
    const ids = (Array.isArray(perfis) ? perfis : []).map((p) => p.id);
    if (!ids.length) return { enviados: 0, observacao: `Nenhum usuário com role "${role}".` };
    query += `&user_id=in.(${ids.join(',')})`;
  }
  const subs = await sbJson(query);
  if (subs?.erro) return subs;
  if (!subs.length) return { enviados: 0, observacao: 'Destino sem notificação push cadastrada (app não instalado/permitido no dispositivo).' };

  const payload = { title: tit, body: corpo, url: '/', tag: 'admin-ia', icon: '/logo.svg' };
  const resultados = await Promise.all(subs.map(async (s) => {
    try {
      const r = await enviarWebPush(s, payload, { publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE, subject: VAPID_SUBJECT });
      if (r.status === 410 || r.status === 404) { await sb(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }); return { ok: false }; }
      return r;
    } catch (e) { console.error('[admin-chat-tools] envio de push falhou:', e.message); return { ok: false }; }
  }));
  const enviados = resultados.filter((r) => r.ok).length;

  auditLog({ acao: 'admin_ia_alerta_emitido', user_id: adminUser?.id, detalhes: { destino_tipo, user_id, role, titulo: tit, enviados, total: subs.length } });

  return { enviados, total: subs.length, enviado_de_verdade: true };
}

// ─── Fontes complementares (30/09) ────────────────────────────────────────
async function buscarEditalProcesso({ numero_processo }) {
  const num = String(numero_processo || '').replace(/\D/g, '');
  if (num.length < 15) return { erro: 'número de processo incompleto' };
  const r = await sb('rpc/edital_por_processo', { method: 'POST', body: JSON.stringify({ p_numero: num }) });
  if (!r.ok) return { erro: `consulta ao radar de editais falhou (${r.status})` };
  const editais = await r.json();
  return editais.length
    ? { encontrado: true, editais }
    : { encontrado: false, observacao: 'Nenhum edital deste processo no radar (o radar cobre editais de leilão publicados no DJEN desde a sua criação).' };
}

async function buscarPorParte({ nome, cpf, cnpj, meses }) {
  const dias = Math.round(Math.max(1, Math.min(Number(meses) || 12, 36)) * 30.5);
  let alvo = String(nome || '').trim();
  let documento = null;
  let origemNome = alvo ? 'informado pelo admin' : null;
  const dCnpj = String(cnpj || '').replace(/\D/g, '');
  const dCpf = String(cpf || '').replace(/\D/g, '');
  if (!alvo && dCnpj.length === 14) {
    const c = await consultarCnpj({ cnpj: dCnpj });
    if (!c.encontrado) return { erro: c.erro || 'CNPJ não encontrado na Receita — informe a razão social' };
    alvo = c.razao_social; documento = dCnpj; origemNome = `razão social na Receita (${c.fonte})`;
  } else if (!alvo && dCpf.length === 11) {
    const fmt = `${dCpf.slice(0, 3)}.${dCpf.slice(3, 6)}.${dCpf.slice(6, 9)}-${dCpf.slice(9)}`;
    const p = await sbJson(`perfis?or=(cpf.eq.${dCpf},cpf.eq.${encodeURIComponent(fmt)})&select=nome&limit=1`);
    if (p?.erro) return p;
    if (!p?.[0]?.nome) return { precisa_nome: true, observacao: 'Não há fonte aberta que converta CPF em nome e este CPF não está na base da plataforma. Peça o NOME COMPLETO da pessoa para varrer os tribunais.' };
    alvo = p[0].nome; documento = dCpf; origemNome = 'cadastro da plataforma';
  } else if (dCpf.length === 11 || dCnpj.length === 14) {
    documento = dCpf || dCnpj;
  }
  if (!alvo) return { erro: 'informe nome/razão social, CPF ou CNPJ' };
  const r = await buscarProcessosPorParte({ nome: alvo, documento, dias });
  return {
    buscado: alvo, origem_do_nome: origemNome, janela: r.janela, total: r.total,
    processos: (r.processos || []).slice(0, 25).map((x) => ({
      numero: x.numero, tribunal: x.tribunal, classe: x.classe, orgao: x.orgao, polo_da_parte: x.polo_da_parte,
      ultima_publicacao: x.ultima_atualizacao, publicacoes: x.publicacoes, riscos: x.riscos.map((k) => k.categoria),
      documento_confere_no_texto: x.cpf_no_texto, ultimas: x.movimentos.slice(0, 3),
    })),
    aviso: r.aviso, erros: r.erros,
  };
}

async function consultarDatajud({ numero_processo }) {
  if (!numero_processo) return { erro: 'informe numero_processo (para pessoa/empresa use buscar_processos_por_parte)' };
  const r = await buscarProcessosCNJ({ numero_processo, nacional: true });
  const processos = (r.processos || []).slice(0, 8).map((p) => {
    const txt = JSON.stringify(p);
    return txt.length > 1800 ? { ...Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v !== 'object')), movimentos: (p.movimentos || []).slice(0, 8) } : p;
  });
  // Previsão do próximo andamento (30/09): ritmo do processo + base real da plataforma + etapa legal.
  let previsao = null;
  const alvo = (r.processos || [])[0];
  {
    // DataJud fora: série já gravada do processo; sem ela, a referência da base (dita como tal).
    let movs = alvo?.movimentos || [];
    if (!movs.length) {
      const dig = String(numero_processo).replace(/\D/g, '');
      const hist = await sbJson(`processo_movimentos?numero_processo=in.(${dig},${encodeURIComponent(numero_processo)})&select=data,codigo,descricao&order=data.desc&limit=200`);
      if (Array.isArray(hist)) movs = hist;
    }
    // A leitura ensina o agente documental/processual (série, desfecho do arremate, lição).
    if (alvo?.movimentos?.length) await aprenderDaConsulta({ numero: numero_processo, origem: 'chat_operacional', processo: { numero: alvo.numero, tribunal: alvo.tribunal, classe: alvo.classe, movimentos: alvo.movimentos } }).catch((e) => console.warn('[admin-chat-tools] aprendizado:', e?.message || e));
    const est = await estatisticaFluxo(justicaDoNumero(numero_processo));
    const pv = preverAndamento({ movimentos: movs, estat: est.linhas, justica: est.justica });
    if (pv.disponivel) previsao = { resumo: pv.resumo, status: pv.status, proximo_despacho: pv.proximo_despacho, proxima_janela: pv.proxima_janela, entre_despachos: pv.entre_despachos, fluxo_provavel: pv.fluxo_provavel, etapa_arrematacao: pv.etapa_arrematacao, aviso: pv.aviso };
  }
  return { total: r.total || 0, processos, parecer: r.parecer?.texto || r.parecer || null, previsao, erros: r.erros || undefined, tribunais_consultados: (r.tribunais_consultados || []).length };
}

async function consultarCnpj({ cnpj }) {
  const d = String(cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return { erro: 'CNPJ deve ter 14 dígitos (CPF não é consultável em fonte aberta)' };
  const ler = async (url) => {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (r.status === 404) return { naoExiste: true };
      if (!r.ok) return { falha: `HTTP ${r.status}` };
      return { dado: await r.json() };
    } catch (e) { return { falha: String(e?.message || e).slice(0, 60) }; }
  };
  let r = await ler(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
  let fonte = 'brasilapi';
  if (!r.dado && !r.naoExiste) { r = await ler(`https://minhareceita.org/${d}`); fonte = 'minhareceita'; }
  if (r.naoExiste) return { encontrado: false, observacao: 'CNPJ não encontrado na base da Receita.' };
  if (!r.dado) return { erro: `fontes da Receita indisponíveis agora (${r.falha}) — não significa que o CNPJ não existe` };
  const x = r.dado;
  return {
    encontrado: true, fonte,
    razao_social: x.razao_social || null, nome_fantasia: x.nome_fantasia || null,
    situacao: x.descricao_situacao_cadastral || null, data_situacao: x.data_situacao_cadastral || null,
    motivo_situacao: x.descricao_motivo_situacao_cadastral || null,
    abertura: x.data_inicio_atividade || null, natureza: x.natureza_juridica || null, porte: x.porte || x.descricao_porte || null,
    capital_social: x.capital_social ?? null, atividade: x.cnae_fiscal_descricao || null,
    endereco: [x.logradouro, x.numero, x.bairro, x.municipio, x.uf].filter(Boolean).join(', ') || null,
    socios: (x.qsa || []).slice(0, 12).map((q) => ({ nome: q.nome_socio || q.nome || '', qualificacao: q.qualificacao_socio || q.codigo_qualificacao_socio || null, desde: q.data_entrada_sociedade || null })),
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────
export async function executarFerramentaAdmin(nome, input, ctx) {
  try {
    switch (nome) {
      case 'buscar_djen': {
        const r = await buscarDjen(input);
        if (r?.erro || !r?.publicacoes?.length) return r;
        await aprenderDaConsulta({ numero: input?.numero_processo, origem: 'chat_operacional', publicacoes: r.publicacoes }).catch((e) => console.warn('[admin-chat-tools] aprendizado DJEN:', e?.message || e));
        // 30/09 (caso Marcos): com o DataJud do TRT5 fora, o chat ficava sem previsão alguma. As
        // publicações bastam para o ritmo do processo e a etapa da arrematação — dito como tal.
        const { historico_datas: hist = [], ...resto } = r;
        try {
          const est = await estatisticaFluxo(justicaDoNumero(input?.numero_processo));
          const pubs = hist.length ? hist.map((h, i) => r.publicacoes[i] || h) : r.publicacoes;
          const pv = preverAndamento({ publicacoes: pubs, estat: est.linhas, justica: est.justica });
          if (pv.disponivel) resto.previsao = { resumo: pv.resumo, status: pv.status, proxima_janela: pv.proxima_janela, entre_despachos: pv.entre_despachos, etapa_arrematacao: pv.etapa_arrematacao, aviso: 'Calculada só pelas PUBLICAÇÕES do DJEN (atos internos do juiz/secretaria não aparecem aqui).' };
        } catch (e) { console.warn('[admin-chat-tools] previsão DJEN:', e?.message || e); }
        return resto;
      }
      case 'buscar_edital_processo': return await buscarEditalProcesso(input);
      case 'consultar_datajud': return await consultarDatajud(input);
      case 'buscar_processos_por_parte': return await buscarPorParte(input);
      case 'buscar_jurisprudencia': return await buscarJurisprudencia({ tema: String(input?.tema || '').slice(0, 200), contexto: String(input?.contexto || '').slice(0, 400), userId: ctx?.adminUser?.id || null, prazoMs: 45000 });
      case 'consultar_cnpj': return await consultarCnpj(input);
      case 'verificar_arremate_processo': return await verificarArremateProcesso(input);
      case 'buscar_arremates_cliente': return await buscarArrematesCliente(input);
      case 'checar_mensalidades_atrasadas': return await checarMensalidadesAtrasadas();
      case 'checar_movimentacao_processos_assessorados': return await checarMovimentacaoProcessosAssessorados();
      case 'emitir_alerta': return await emitirAlerta(input, ctx);
      default: return { erro: `ferramenta desconhecida: ${nome}` };
    }
  } catch (e) {
    console.error(`[admin-chat-tools] ${nome} falhou:`, e.message);
    return { erro: `falha interna ao executar ${nome}` };
  }
}
