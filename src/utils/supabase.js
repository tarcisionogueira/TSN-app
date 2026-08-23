import { createClient } from '@supabase/supabase-js';
import { storageAuthSeguro } from './storageSeguro.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zuwfiwokkdytvjixiwac.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// ─── Erro do Supabase NUNCA mais em silêncio ─────────────────────────────────
// Família de bug que mais apareceu na varredura de 02/08: uma consulta pede uma coluna que
// não existe (`perfis.email`, `sdr_leads.respostas`, `arrematacoes.user_id`), o PostgREST
// devolve 400, o `error` não é checado no call-site e a tela renderiza VAZIA/ZERADA sem
// avisar ninguém — foi assim que o painel de Assinaturas ficou "tudo 0" e o Dashboard passou
// dias mostrando MRR R$ 0,00. Corrigir call-site por call-site não escala: aqui o próprio
// cliente reporta qualquer resposta ruim para `erros_cliente`, que a verificação de saúde e o
// Cliente 360 já leem. Custo ~zero: só age no caminho de ERRO, com dedup e teto por sessão
// (reportarErroCliente), e nunca interfere na resposta devolvida ao chamador.
const STATUS_IGNORADOS = new Set([
  401, 403, // sessão expirada / RLS negando — esperado em tela pública, viraria ruído
  406,      // .single() sem linhas: fluxo normal do app
  409,      // conflito de upsert tratado pelo call-site
]);

// ─── SIMULAÇÃO É SÓ LEITURA ──────────────────────────────────────────────────
// Ao simular um papel (admin inspecionando "como o explorador vê"), a SESSÃO continua sendo a
// do admin: o token é o dele e `auth.uid()` é o dele. Só a tela finge. Então qualquer botão
// clicado por engano durante a inspeção escreveria na conta REAL do admin — aceitar o programa
// de parceiros, consumir cota, carimbar uma data. A ferramenta de olhar não pode alterar o que
// veio olhar.
//
// A trava mora aqui porque este `fetch` é o gargalo por onde passa TUDO que o cliente manda ao
// Supabase — mesma razão pela qual o relato de erro já vive neste ponto. Guardar isso tela a
// tela seria a lista que envelhece: o próximo botão nasceria fora dela.
//
// Ler a flag do `sessionStorage` (a mesma chave que o AuthContext grava) evita ciclo de import
// entre o cliente e o contexto que o consome.
//
// PATCH/PUT/DELETE são bloqueados sempre; POST em tabela é inserção. POST em `/rpc/` passa,
// porque é ASSIM que a maioria das leituras acontece — exceto os nomes de verbo claramente
// mutador. A régua é por PREFIXO e propositalmente generosa: aqui um falso positivo apenas
// deixa a tela simulada mais vazia, e vazio é exatamente o estado de conta nova que se quer
// mostrar. Um falso NEGATIVO, não: escreve de verdade.
const RPC_QUE_ESCREVEM = /^(aceitar|consumir|debitar|creditar|gerar|criar|atualizar|marcar|registrar|vincular|salvar|definir|aplicar|distribuir|recalcular|enfileirar|limpar|resolver|excluir|remover|cancelar|encerrar|iniciar|finalizar|aprovar|recusar|upsert|set)_/i;

// Flag de simulação EM MEMÓRIA (22/08): não pode depender só do sessionStorage. Com storage
// bloqueado/cheio (Firefox com site-data off, cota estourada — a MESMA população que a
// blindagem de storage atende), o `getItem` LANÇA e o catch devolvia null = "não está
// simulando" → PATCH/POST/DELETE passavam gravando como ADMIN. É o falso NEGATIVO que o
// comentário acima diz ser o único inaceitável. O AuthContext chama `marcarSimulacao` ao
// entrar/sair da simulação e ao restaurar na montagem, então o bloqueio vale mesmo sem storage.
let _simRoleMem = null;
export function marcarSimulacao(role) { _simRoleMem = role || null; }

function bloqueadoNaSimulacao(input, init) {
  try {
    let simulando = _simRoleMem;
    if (!simulando) { try { simulando = sessionStorage.getItem('tsn_sim_role'); } catch { /* storage off: cai na flag de memória */ } }
    if (!simulando) return null;
    const url = typeof input === 'string' ? input : (input?.url || '');
    if (!url.includes('/rest/v1/')) return null;              // auth e storage não passam por aqui
    const metodo = String(init?.method || (typeof input === 'object' ? input?.method : '') || 'GET').toUpperCase();
    const caminho = (url.split('/rest/v1/')[1] || '').split('?')[0];
    const ehRpc = caminho.startsWith('rpc/');
    const nomeRpc = ehRpc ? caminho.slice(4) : '';
    if (metodo === 'GET' || metodo === 'HEAD') return null;
    if (ehRpc && !RPC_QUE_ESCREVEM.test(nomeRpc)) return null;
    return ehRpc ? `rpc/${nomeRpc}` : `${metodo} ${caminho}`;
  } catch { return null; }
}

async function fetchComRelato(input, init) {
  // Bloqueio ANTES da rede: nada sai da máquina. Devolve 200 com corpo vazio — a forma que o
  // postgrest-js entende como "não há linhas", que é o estado correto de uma conta nova. E
  // avisa no console, para que a escrita barrada não vire um mistério de tela parada.
  const alvoBloqueado = bloqueadoNaSimulacao(input, init);
  if (alvoBloqueado) {
    console.warn('[simulação] escrita BLOQUEADA (modo só-visualização):', alvoBloqueado);
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  const res = await fetch(input, init);
  try {
    if (!res.ok && !STATUS_IGNORADOS.has(res.status)) {
      const url = typeof input === 'string' ? input : (input?.url || '');
      // Login/cadastro têm erro de negócio esperado (senha errada, e-mail duplicado).
      if (!url.includes('/auth/v1/')) {
        const alvo = decodeURIComponent((url.split('/rest/v1/')[1] || url).split('?')[0]) || 'supabase';
        const corpo = await res.clone().text().catch(() => '');
        let detalhe = corpo.slice(0, 200);
        try { const j = JSON.parse(corpo); detalhe = j?.message || j?.hint || j?.error || detalhe; } catch { /* texto puro */ }
        const { reportarErroCliente } = await import('./reportarErro.js'); // dinâmico: evita ciclo
        reportarErroCliente({ msg: `Supabase ${res.status} em "${alvo}": ${detalhe}` });
      }
    }
  } catch { /* observabilidade nunca quebra a chamada real */ }
  return res;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: fetchComRelato },
  // Sessão gravada por escrita SEGURA (23/08): o storage padrão do SDK usa
  // localStorage.setItem cru — com a cota estourada pelos caches de relatório, o
  // login/refresh LANÇAVA QuotaExceededError no cliente (visto em erros_cliente,
  // stack no chunk do AuthContext). O adapter limpa caches descartáveis e, em
  // último caso, mantém a sessão em memória — nunca quebra o fluxo de auth.
  auth: { storage: storageAuthSeguro },
});

// ─── AUTH ────────────────────────────────────────────────────────────────────

// O helper `signUp` legado foi REMOVIDO em 10/08. Ninguém o importava (confirmado por grep),
// gravava `role: 'aluno'` — papel de uma encarnação antiga do produto, que não existe mais — e
// checava só o `error`, então herdava o defeito do e-mail duplicado: com "Confirm email" ligado,
// e-mail já cadastrado devolve 200 com `identities: []` e nenhum e-mail é enviado. Foi o
// verificador de padrões (`scripts/verificar-padroes-perigosos.mjs`, regra
// `signup-sem-guard-duplicado`) que o encontrou na PRIMEIRA execução. Cadastro se faz por
// `Login.jsx`, `Checkout.jsx`, `ConviteEquipe.jsx` ou `Promo.jsx` — todos com o guard.

export async function signIn({ email, senha }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export function getRole(user) {
  return user?.user_metadata?.role || 'aluno';
}

export function isAdmin(user) {
  return getRole(user) === 'admin';
}

// ─── PERFIL ──────────────────────────────────────────────────────────────────

export async function getPerfil(userId) {
  const { data, error } = await supabase
    .from('perfis')
    .select('*')
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function upsertPerfil(perfil) {
  const { error } = await supabase.from('perfis').upsert(perfil);
  if (error) throw error;
}

// ─── CURSOS (admin) ──────────────────────────────────────────────────────────

export async function listarCursos() {
  const { data, error } = await supabase
    .from('cursos')
    .select('*, modulos(*, licoes(*))')
    .order('ordem');
  if (error) throw error;
  return data || [];
}

export async function salvarCurso(curso) {
  const { data, error } = await supabase
    .from('cursos')
    .upsert(curso)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function salvarModulo(modulo) {
  const { data, error } = await supabase
    .from('modulos')
    .upsert(modulo)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function salvarLicao(licao) {
  const { data, error } = await supabase
    .from('licoes')
    .upsert(licao)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarCurso(id) {
  const { error } = await supabase.from('cursos').delete().eq('id', id);
  if (error) throw error;
}

// ─── PROGRESSO ───────────────────────────────────────────────────────────────

export async function getProgresso(userId) {
  const { data, error } = await supabase
    .from('progresso')
    .select('licao_id, concluido')
    .eq('user_id', userId);
  if (error) throw error;
  return Object.fromEntries((data || []).map(p => [p.licao_id, p.concluido]));
}

export async function marcarProgresso(userId, licaoId, concluido) {
  const { error } = await supabase
    .from('progresso')
    .upsert({ user_id: userId, licao_id: licaoId, concluido, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ─── PERGUNTAS ───────────────────────────────────────────────────────────────

export async function listarPerguntas(licaoId) {
  // `perguntas.user_id` referencia `auth.users`, não `perfis` — o embed `perfis(nome)`
  // devolvia 400 e, como esta função dá `throw`, derrubava o Q&A da lição inteira (08/08).
  const { data, error } = await supabase
    .from('perguntas')
    .select('*')
    .eq('licao_id', licaoId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const ids = [...new Set((data || []).map(p => p.user_id).filter(Boolean))];
  let nomes = new Map();
  if (ids.length) {
    const { data: ps } = await supabase.from('perfis').select('id, nome').in('id', ids);
    nomes = new Map((ps || []).map(p => [p.id, p.nome]));
  }
  return (data || []).map(p => ({ ...p, perfis: { nome: nomes.get(p.user_id) || null } }));
}

export async function fazerPergunta(userId, licaoId, texto) {
  const { data, error } = await supabase
    .from('perguntas')
    .insert({ user_id: userId, licao_id: licaoId, texto })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function responderPergunta(perguntaId, resposta) {
  const { error } = await supabase
    .from('perguntas')
    .update({ resposta, respondido_em: new Date().toISOString() })
    .eq('id', perguntaId);
  if (error) throw error;
}

// ─── COMPRAS ─────────────────────────────────────────────────────────────────

export async function getCompras(userId) {
  const { data, error } = await supabase
    .from('compras')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function registrarCompra(compra) {
  const { data, error } = await supabase
    .from('compras')
    .insert(compra)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── IMÓVEIS (portfólio cloud) ───────────────────────────────────────────────

export async function listarImoveisUser(userId) {
  const { data, error } = await supabase
    .from('imoveis')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function salvarImovel(imovel) {
  const { data, error } = await supabase
    .from('imoveis')
    .upsert({ ...imovel, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarImovel(id) {
  const { error } = await supabase.from('imoveis').delete().eq('id', id);
  if (error) throw error;
}

// ─── LANÇAMENTOS ─────────────────────────────────────────────────────────────

export async function listarLancamentos(imovelId) {
  const { data, error } = await supabase
    .from('lancamentos')
    .select('*')
    .eq('imovel_id', imovelId)
    .order('data', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function salvarLancamento(lancamento) {
  const { data, error } = await supabase
    .from('lancamentos')
    .upsert(lancamento)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletarLancamento(id) {
  const { error } = await supabase.from('lancamentos').delete().eq('id', id);
  if (error) throw error;
}

// ─── PROMOÇÕES ───────────────────────────────────────────────────────────────

export async function listarPromocoes() {
  const { data, error } = await supabase
    .from('promocoes')
    .select('*')
    .eq('ativo', true)
    .gte('validade', new Date().toISOString().slice(0, 10));
  if (error) throw error;
  return data || [];
}

export async function salvarPromocao(promocao) {
  const { data, error } = await supabase
    .from('promocoes')
    .upsert(promocao)
    .select()
    .single();
  if (error) throw error;
  return data;
}
