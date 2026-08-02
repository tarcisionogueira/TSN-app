import { createClient } from '@supabase/supabase-js';

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

async function fetchComRelato(input, init) {
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
});

// ─── AUTH ────────────────────────────────────────────────────────────────────

export async function signUp({ email, senha, nome, cpf, telefone, endereco }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: {
      data: { nome, cpf, telefone, endereco, role: 'aluno' },
    },
  });
  if (error) throw error;
  return data;
}

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
  const { data, error } = await supabase
    .from('perguntas')
    .select('*, perfis(nome)')
    .eq('licao_id', licaoId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
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
