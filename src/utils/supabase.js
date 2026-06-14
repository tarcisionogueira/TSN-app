// Fase 2 — Supabase (instale com: npm install @supabase/supabase-js)
// Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env
export const supabaseEnabled = false; // habilitado quando credenciais forem configuradas

export const PLANOS = {
  gratuito: {
    nome: 'Gratuito', preco: 0,
    features: ['Busca de imóveis em leilão', 'Favoritar até 5 imóveis', 'Visualizar editais públicos'],
    cor: '#64748b',
  },
  analista: {
    nome: 'Analista', preco: 197,
    features: ['Tudo do Gratuito', 'Análise financeira completa', 'Avaliação mercadológica', 'Relatório PDF', 'Favoritos ilimitados', 'Até 10 análises/mês'],
    cor: '#2563eb', destaque: true,
  },
  profissional: {
    nome: 'Profissional', preco: 497,
    features: ['Tudo do Analista', 'Laudo jurídico com IA', 'Acesso multi-usuário', 'Alertas de novos leilões', 'Análises ilimitadas', 'Suporte prioritário'],
    cor: '#7c3aed',
  },
};
