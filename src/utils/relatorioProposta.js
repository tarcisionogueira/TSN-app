import { apiCall } from './apiCall';
import { supabase } from './supabase';

// RELATÓRIO GARANTIDO NA PROPOSTA (30/09, pedido do dono: "ao enviar uma proposta a um leiloeiro,
// garanta que o relatório em caso de veículo ou os relatórios em caso de imóvel sejam gerados
// automaticamente caso não tenham sido gerados"). Os relatórios são de QUEM propõe (user_id),
// como em qualquer geração pela tela. A equipe passa pelo gate de leilão encerrado no servidor
// (ehEquipe, api/_leilao-encerrado.js) — a proposta de compra direta é justamente pós-leilão.

async function uidAtual() {
  const { data: { user } = {} } = await supabase.auth.getUser();
  return user?.id || null;
}

/** Veículo: 'pronto' | 'gerando' (disparou agora ou já estava) | { erro }. Nunca lança. */
export async function garantirRelatorioVeiculo(veiculoId, aoTerminar) {
  try {
    const uid = await uidAtual();
    if (!uid || !veiculoId) return { erro: 'sem sessão' };
    const { data, error } = await supabase.from('analises_veiculo').select('status').eq('user_id', uid).eq('veiculo_id', veiculoId).maybeSingle();
    if (error) return { erro: 'não consegui conferir se o relatório existe' };
    if (data?.status === 'concluida') return 'pronto';
    if (data?.status === 'gerando') return 'gerando';
    apiCall('/api/gerar-analise-veiculo', { method: 'POST', body: JSON.stringify({ veiculoId }) })
      .then(async (r) => { const d = await r.json().catch(() => ({})); aoTerminar?.(r.ok ? 'pronto' : { erro: d?.error || `HTTP ${r.status}` }); })
      .catch(() => { /* padrao-ok: dispare-e-esqueça — o servidor segue gerando mesmo se esta conexão cair */ });
    return 'gerando';
  } catch (e) { return { erro: String(e?.message || e).slice(0, 80) }; }
}

/** Imóvel: quais relatórios (mercado, documental) faltam para quem propõe. null = não consegui ler. */
export async function relatoriosImovelFaltando(imovelId) {
  try {
    const uid = await uidAtual();
    if (!uid || !imovelId) return null;
    // Só mercadológico e documental: o parecer final está DESLIGADO no produto (LAUDO_NOVO_ATIVO =
    // false em Analise.jsx; `analises_laudo` vazia) — cobrá-lo mandaria toda proposta à geração.
    const ler = (t) => supabase.from(t).select('status').eq('user_id', uid).eq('imovel_id', String(imovelId)).maybeSingle();
    const [m, d] = await Promise.all([ler('analises_mercado'), ler('analises_documental')]);
    if (m.error || d.error) return null;
    const ok = (r) => ['concluida', 'gerando', 'processando'].includes(r.data?.status);
    return [!ok(m) && 'mercado', !ok(d) && 'documental'].filter(Boolean);
  } catch (e) { console.warn('[proposta] não consegui conferir os relatórios do imóvel:', e?.message || e); return null; }
}
