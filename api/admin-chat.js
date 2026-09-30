// Node, não Edge (30/09): a Edge corta a função que não começa a responder em ~25 s, e o chat encadeia
// DataJud + DJEN + radar + várias rodadas de IA — a tela recebia "não conseguimos falar com o servidor"
// sem nenhum 5xx no log. No Node a resposta precisa sair do export nomeado POST (default é ignorado).
export const config = { runtime: 'nodejs', maxDuration: 120 };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { ADMIN_CHAT_TOOLS, executarFerramentaAdmin } from './_admin-chat-tools.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.json();
}

// MEMÓRIA OPERACIONAL (30/09, dono: "um agente que aprenda com as perguntas — em operações de leilão
// elas são similares"). Cada troca vai para `admin_chat_memoria` com o RASTRO de ferramentas; a próxima
// pergunta parecida recebe esses casos no prompt e já sabe por onde começar. Nada disso pode derrubar
// o chat: falha na memória é registrada no log e a conversa segue sem ela.
async function sbRpc(nome, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${nome} HTTP ${r.status}`);
  return r.json();
}
async function sbGravar(tabela, corpo, filtro = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}${filtro}`, {
    method: filtro ? 'PATCH' : 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`${tabela} HTTP ${r.status}`);
  return r.json(); // linhas afetadas — vazio = não alcançou nada (forma nº 3)
}
export function blocoDeCasos(casos) {
  if (!Array.isArray(casos) || !casos.length) return '';
  const linhas = casos.map((c, i) => {
    const caminho = (Array.isArray(c.ferramentas) ? c.ferramentas : [])
      .map((f) => `${f.nome}(${String(f.entrada || '').slice(0, 120)})${f.ok === false ? ' ✗' : ''}`).join(' → ') || 'respondido sem ferramenta';
    return `${i + 1}. ${c.util ? '[👍 aprovado pelo admin] ' : ''}Pergunta: "${String(c.pergunta).slice(0, 300)}"\n   Caminho: ${caminho}\n   Resposta dada (resumo): ${String(c.resposta || '').replace(/\s+/g, ' ').slice(0, 300)}`;
  });
  return `## Aprendizado — perguntas parecidas já feitas nesta operação
Use o CAMINHO que funcionou como ponto de partida (mesmas ferramentas, na mesma ordem), adaptando
nomes/números à pergunta atual. Os dados das respostas antigas podem estar DESATUALIZADOS — nunca os
repita como fato sem consultar de novo; o que vale aprender é por onde buscar.
${linhas.join('\n')}`;
}

// Minimização de PII: mascara CPF e telefone no texto livre das conversas antes de
// mandar para a IA (o admin ainda vê nome/status pelos campos estruturados).
const redigirPII = (t) => String(t || '')
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
  .replace(/\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[TEL]');

export async function POST(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'CLAUDE_KEY não configurada' }), { status: 500 });

  let reqBody;
  try {
    reqBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  // HISTÓRICO (30/09, dono: "manter um histórico por um período para retomar uma conversa"): lista as
  // conversas do próprio admin (12 meses; 👍 fica 24) e devolve uma inteira para continuar.
  if (reqBody.acao === 'sessoes' || reqBody.acao === 'sessao') {
    try {
      const dados = reqBody.acao === 'sessoes'
        ? await sbRpc('admin_chat_sessoes', { p_user: user.id, p_dias: 365 })
        : await sbRpc('admin_chat_sessao', { p_user: user.id, p_sessao: String(reqBody.sessao || '').slice(0, 64) });
      return new Response(JSON.stringify({ ok: true, dados }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      console.error('[admin-chat] histórico indisponível:', e?.message || e);
      return new Response(JSON.stringify({ error: 'não consegui carregar o histórico agora' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
  }
  // 👍/👎 numa resposta: 👍 vira exemplo prioritário, 👎 nunca é reaproveitado.
  if (reqBody.feedback) {
    const { id, util } = reqBody.feedback;
    if (!/^[0-9a-f-]{36}$/i.test(String(id || '')) || typeof util !== 'boolean') {
      return new Response(JSON.stringify({ error: 'feedback inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    try {
      const linhas = await sbGravar('admin_chat_memoria', { util }, `?id=eq.${id}`);
      if (!linhas.length) return new Response(JSON.stringify({ error: 'conversa não encontrada' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      console.error('[admin-chat] feedback não gravado:', e?.message || e);
      return new Response(JSON.stringify({ error: 'não consegui gravar a avaliação agora' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
  }
  const reqBodyMensagem = String(reqBody.mensagem || '').slice(0, 4000); // limite anti-abuso/prompt-injection
  const mensagem = reqBodyMensagem;
  const historico = (Array.isArray(reqBody.historico) ? reqBody.historico : []).slice(-20); // no máx. 20 turnos
  const { contexto_cnj, filtro_chamados, gerar_relatorio } = reqBody;

  const isUUID = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

  let contextoBlocos = [];

  // 1. Contexto CNJ se houver busca ativa
  if (contexto_cnj) {
    contextoBlocos.push(`## Processos CNJ encontrados\n\`\`\`json\n${JSON.stringify(contexto_cnj, null, 2).slice(0, 6000)}\n\`\`\``);
  }

  // 2. Conversas de usuários — carrega com filtros
  if (filtro_chamados) {
    const { usuario_id, chamado_id } = filtro_chamados;
    // Coerção a inteiro no intervalo [1,20] — evita string com caracteres extras
    // (ex.: "20&order=role.desc") virar NaN ou parâmetro injetado na URL PostgREST.
    const ultimos_n = Math.min(Math.max(1, parseInt(filtro_chamados.ultimos_n, 10) || 5), 20);
    let q;
    if (chamado_id && isUUID(chamado_id)) {
      // Conversa específica
      const msgs = await sbGet(`chamados_mensagens?chamado_id=eq.${encodeURIComponent(chamado_id)}&order=criado_em.asc&select=autor_tipo,autor_nome,conteudo,criado_em`);
      const chamado = await sbGet(`chamados?id=eq.${encodeURIComponent(chamado_id)}&select=user_email,user_nome,titulo,status,criado_em`);
      contextoBlocos.push(`## Conversa #${chamado_id.slice(0,8).toUpperCase()}\nCliente: ${chamado[0]?.user_nome || chamado[0]?.user_email || '?'}\nStatus: ${chamado[0]?.status}\n\n${msgs.map(m => `[${new Date(m.criado_em).toLocaleString('pt-BR')}] ${m.autor_tipo === 'cliente' ? 'Cliente' : 'Assistente'}: ${redigirPII(m.conteudo)}`).join('\n')}`);
    } else if (usuario_id && isUUID(usuario_id)) {
      // Todos os chamados de um usuário
      const chamados = await sbGet(`chamados?user_id=eq.${encodeURIComponent(usuario_id)}&order=criado_em.desc&limit=10&select=id,titulo,status,criado_em,user_nome`);
      const detalhes = await Promise.all(chamados.slice(0, 3).map(async c => {
        const msgs = await sbGet(`chamados_mensagens?chamado_id=eq.${c.id}&order=criado_em.asc&select=autor_tipo,conteudo&limit=20`);
        return `### Chamado "${c.titulo}" (${c.status})\n${msgs.map(m => `${m.autor_tipo === 'cliente' ? 'Cliente' : 'Assistente'}: ${redigirPII(m.conteudo)}`).join('\n')}`;
      }));
      contextoBlocos.push(`## Histórico do usuário ${chamados[0]?.user_nome || usuario_id}\n${detalhes.join('\n\n')}`);
    } else {
      // Últimos N chamados geral
      const chamados = await sbGet(`chamados?order=criado_em.desc&limit=${ultimos_n}&select=id,titulo,status,user_nome,user_email,criado_em`);
      contextoBlocos.push(`## Últimos ${chamados.length} atendimentos\n${chamados.map(c => `- #${c.id.slice(0,8).toUpperCase()} | ${c.user_nome || c.user_email} | "${c.titulo}" | ${c.status} | ${new Date(c.criado_em).toLocaleDateString('pt-BR')}`).join('\n')}`);
    }
  }

  const contextoStr = contextoBlocos.join('\n\n');

  let casos = [];
  try { casos = await sbRpc('admin_chat_casos_parecidos', { p_texto: mensagem, p_limite: 4 }); }
  catch (e) { console.error('[admin-chat] memória indisponível (segue sem ela):', e?.message || e); }
  const aprendizado = blocoDeCasos(casos);

  const system = `Você é o assistente de inteligência administrativa da BidPro Brasil, plataforma de análise de imóveis em leilão.

Você tem acesso privilegiado a:
- Processos judiciais consultados no CNJ DataJud (contexto injetado quando houver busca ativa)
- Ferramentas para consultar o DJEN direto por processo, identificar clientes com arrematação/análise
  em andamento naquele processo, mensalidades com cobrança em atraso e movimentação recente de
  processos de clientes do plano assessorado — use-as proativamente sempre que a pergunta do admin
  se beneficiar, sem precisar que ele peça a consulta por extenso.
- RADAR DE EDITAIS (buscar_edital_processo): editais de leilão do DJEN com praças, leiloeiro, avaliação,
  lance, matrícula, cartório, débitos e ocupação — consulte SEMPRE que a pergunta tocar em leilão/praça/edital
- DataJud pelo NÚMERO (consultar_datajud: vai direto ao tribunal do número). Para pessoa/empresa
  (nome, razão social, CPF ou CNPJ) use buscar_processos_por_parte, que varre TODOS os tribunais pelo
  DJEN — é o ÚNICO caso em que se varre todos. Busca por nome pode trazer homônimo: diga isso.
- Dados de EMPRESA na Receita
  (consultar_cnpj: situação, endereço, sócios) para partes pessoa jurídica
- Histórico de atendimentos e conversas de todos os usuários da plataforma
- Dados das integrações (PGFN, Receita Federal, etc.) quando disponíveis

REGRA DE OURO — NUNCA peça ao admin para consultar, confirmar ou "contatar o cartório" sobre algo que
suas ferramentas alcançam (DataJud, DJEN, radar de editais, CNPJ, arremates). Consulte você mesmo e
responda com o resultado. Quando o admin disser que "consultou o CNJ aqui pela plataforma", REPITA a
consulta (consultar_datajud e buscar_djen) — não presuma o que ele viu. Diga de qual fonte veio cada
afirmação (ex.: "DJEN, 16/09: …", "DataJud, último movimento: …"). Se uma fonte falhar ou não trouxer
nada, diga isso com todas as letras — ausência na fonte não é prova de que o ato não existiu.

IMPORTANTE — quando o admin mencionar um cliente PELO NOME (ex.: "o Marcos arrematou, verifica o
processo dele") em vez de dar o número do processo direto, NUNCA peça o número do processo antes
de tentar achar sozinho: chame primeiro buscar_arremates_cliente com o nome. Ela devolve o(s) lote(s)
arrematados e o numero_processo de cada um — só peça o número ao admin se essa busca não achar nada.
A partir do numero_processo encontrado, encadeie buscar_djen (para checar publicações/expedição de
auto) e verificar_arremate_processo se precisar confirmar outros clientes ligados ao mesmo processo.

Seu papel é responder perguntas do administrador sobre:
- Situação jurídica de processos e partes (CNJ DataJud e DJEN)
- Quais clientes têm arrematação/análise em andamento ligada a um processo (facilita contato direto)
- Mensalidades não cobradas e movimentação de processos de assessorados
- Padrões nas conversas de suporte (problemas recorrentes, dúvidas frequentes)
- Insights sobre usuários específicos
- Geração de relatórios gerenciais

ALERTA/NOTIFICAÇÃO (ferramenta emitir_alerta): só chame com confirmar:true depois que o admin
pedir EXPLICITAMENTE o envio numa mensagem (ex.: "manda", "avisa o cliente", "confirma o envio").
Na primeira menção ao alerta, chame SEMPRE com confirmar:false — isso só mostra uma prévia, não
envia nada — e pergunte ao admin se pode confirmar. Nunca envie alerta sem esse passo de confirmação
explícita numa mensagem anterior do admin.

${gerar_relatorio ? 'O administrador solicitou um RELATÓRIO FORMAL. Estruture a resposta com: título, data, sumário executivo, dados detalhados, conclusões e recomendações.' : ''}

Seja preciso, direto e use os dados disponíveis. NUNCA invente dados que não estejam no contexto.
${aprendizado ? `\n${aprendizado}` : ''}`;

  const messages = [
    // Whitelist de role + content string truncado (evita injeção via histórico forjado).
    ...historico
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) })),
    { role: 'user', content: contextoStr ? `${contextoStr}\n\n---\nPergunta: ${mensagem}` : mensagem },
  ];

  // Loop de tool use: a IA pode encadear várias ferramentas (ex.: achar o processo no DJEN e
  // já verificar se tem cliente com arremate) antes da resposta final em texto. Teto de 6
  // rodadas — suficiente para qualquer combinação das ferramentas atuais, evita loop sem fim
  // se o modelo insistir em chamar ferramenta depois de já ter o que precisa.
  const rastro = contexto_cnj ? [{ nome: 'cnj_datajud (busca automática da tela)', entrada: 'número/parte citados na pergunta', ok: true, resumo: `${contexto_cnj?.processos?.length || 0} processo(s)` }] : [];
  const inicio = Date.now();
  for (let rodada = 0; rodada < 6; rodada++) {
    // Prazo interno (a função tem 120 s): passados 80 s, a próxima rodada vem SEM ferramentas e a IA
    // responde com o que já apurou — melhor que a conexão cair sem resposta nenhuma.
    const semTempo = Date.now() - inicio > 80000 || rodada === 5;
    const r = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, messages,
        system: semTempo ? `${system}\n\nO TEMPO ACABOU: responda AGORA só com o que as consultas já trouxeram e diga o que ficou sem verificar.` : system,
        tools: ADMIN_CHAT_TOOLS, ...(semTempo ? { tool_choice: { type: 'none' } } : {}) }),
    }, { timeoutMs: 30000, retries: 1 });
    const data = await r.json();
    if (!r.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Erro' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    if (data.stop_reason !== 'tool_use') {
      const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      let memoriaId = null;
      try {
        const [linha] = await sbGravar('admin_chat_memoria', {
          user_id: user.id, sessao: String(reqBody.sessao || '').slice(0, 64) || null,
          pergunta: mensagem, resposta: texto.slice(0, 8000), ferramentas: rastro,
        });
        memoriaId = linha?.id || null;
      } catch (e) { console.error('[admin-chat] conversa não gravada na memória:', e?.message || e); }
      return new Response(JSON.stringify({ resposta: texto, memoria_id: memoriaId, casos_usados: casos.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    messages.push({ role: 'assistant', content: data.content });
    const usos = data.content.filter(b => b.type === 'tool_use');
    const resultados = await Promise.all(usos.map(async (uso) => {
      const saida = await executarFerramentaAdmin(uso.name, uso.input, { adminUser: user });
      const conteudo = JSON.stringify(saida);
      rastro.push({ nome: uso.name, entrada: JSON.stringify(uso.input || {}).slice(0, 300), ok: !(saida && (saida.erro || saida.error)), resumo: redigirPII(conteudo).slice(0, 300) });
      return { type: 'tool_result', tool_use_id: uso.id, content: conteudo };
    }));
    messages.push({ role: 'user', content: resultados });
  }

  return new Response(JSON.stringify({ error: 'Muitas chamadas de ferramenta em sequência — reformule a pergunta.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
