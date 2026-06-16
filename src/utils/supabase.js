import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://zuwfiwokkdytvjixiwac.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
