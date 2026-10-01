// Catálogo da IA vendedora do WhatsApp (01/10): preços vêm do banco, curso grátis/inativo não
// vira oferta, e-book diz que inclui 1 mês do Investidor Pro, todos os links levam o UTM da IA.
import { montarCatalogoWa } from '../../api/whatsapp-responder.js';
const t = montarCatalogoWa({
  planos: [{ plano_key: 'top2', nome: 'Investidor Pro', preco: '89.90', preco_anual: '899.00', ativo: true },
           { plano_key: 'assessorado', nome: 'Assessoria', preco: '6000', preco_vista: '5000.00', honorarios_exito_pct: '10.00', ativo: true }],
  ebooks: [{ id: 'e1', titulo: 'Lucre Antes de Arrematar', preco: 29.9, ativo: true, concede_plano: 'top2', concede_meses: 1 }],
  cursos: [{ id: 'c1', titulo: 'Comece aqui', preco: '0', ativo: true }],
});
const ok = (c, m) => { if (!c) { console.error('FALHOU:', m, '\n' + t); process.exit(1); } };
ok(t.includes('R$ 89,90/mês') && t.includes('R$ 899,00/ano'), 'preço do plano');
ok(t.includes('R$ 5.000,00 à vista') && t.includes('10% de êxito'), 'assessoria');
ok(t.includes('inclui 1 mês do Investidor Pro'), 'e-book com mês do sistema');
ok(t.includes('nenhum disponível ainda') && !t.includes('Comece aqui'), 'curso grátis não é oferta');
ok((t.match(/utm_medium=ia/g) || []).length === 3, 'todo link com UTM da IA');
console.log('✓ catálogo do WhatsApp: preços do banco, curso grátis fora, links rastreados');
