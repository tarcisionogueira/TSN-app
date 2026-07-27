/**
 * /api/pj-revalidacao-cron — reconferência PERIÓDICA da PJ dos parceiros (mensal).
 *
 * Regra do dono: uma vez o cadastro APROVADO, o parceiro saca à vontade (não revalida a
 * cada saque). Este cron roda 1x/mês e reconfere, de graça (dado aberto da Receita/QSA —
 * ver api/_pj-socio.js), se o parceiro AINDA é sócio do CNPJ e se o CNPJ segue ATIVO.
 *
 * Divergência = marca pj_revalidacao_pendente (RPC marcar_revalidacao_pj): o próximo repasse
 * fica RETIDO e o "popup" do Perfil volta a aparecer, pedindo para o parceiro atualizar os
 * dados do CNPJ e revalidar. Quando bate de novo, a pendência se limpa sozinha.
 *
 * Critério (fail-OPEN — nunca bloqueia por instabilidade de API):
 *  - CNPJ com situação cadastral != ATIVA (baixado/inapto/suspenso) → divergiu (vale p/ todos).
 *  - CPF que ANTES constava no quadro societário (validação via auto_qsa / snapshot 'match')
 *    e AGORA não consta mais → divergiu (regressão de sócio).
 *  - Consulta indisponível (API fora) → NÃO mexe (tenta no próximo mês).
 *  - Aprovado manualmente sem match de QSA + CNPJ ativo → mantém (não gera falso positivo).
 *
 * Autorizado por CRON_SECRET. Idempotente.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { cpfDoRegistro } from './_cpf.js';
import { verificarSocioQSA } from './_pj-socio.js';
import { createClient } from '@supabase/supabase-js';

const PLANOS_PAGOS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let verificados = 0, divergentes = 0, reafirmados = 0, indisponiveis = 0;
  const flags = [];
  try {
    // Parceiros com PJ já validada (só esses têm o que reconferir).
    const { data: parceiros } = await supabase.from('perfis')
      .select('id,nome,cpf,cpf_enc,cpf_hash,cnpj,role,pj_validada_via,pj_socio_qsa,pj_revalidacao_pendente')
      .not('pj_validada_em', 'is', null)
      .not('cnpj', 'is', null);

    for (const p of (parceiros || [])) {
      if (!PLANOS_PAGOS.includes(p.role)) continue;   // só parceiro-cliente saca via PJ
      verificados++;
      let cpf = '';
      try { cpf = await cpfDoRegistro(p); } catch { cpf = ''; }

      const r = await verificarSocioQSA({ cnpj: p.cnpj, cpf, nome: p.nome });
      // Consulta indisponível (API fora / CNPJ não resolvido) → não altera nada neste ciclo.
      if (!r.ok) { indisponiveis++; continue; }

      const situacao = String(r.snapshot?.situacao || '').toUpperCase();
      const cnpjIrregular = !!situacao && !situacao.startsWith('ATIVA');
      // Só conta como "regressão de sócio" quem foi validado COM match no QSA.
      const eraMatch = p.pj_validada_via === 'auto_qsa' || p.pj_socio_qsa?.resultado === 'match';
      const qsaRegrediu = eraMatch && !r.matched;

      const divergiu = cnpjIrregular || qsaRegrediu;
      const motivo = cnpjIrregular
        ? `CNPJ ${situacao || 'com situação cadastral irregular'}`
        : (qsaRegrediu ? 'O CPF do parceiro não consta mais no quadro societário do CNPJ' : null);

      await supabase.rpc('marcar_revalidacao_pj', {
        p_user_id: p.id, p_divergiu: divergiu, p_motivo: motivo, p_snapshot: r.snapshot || null,
      });

      if (divergiu) { divergentes++; flags.push({ user_id: p.id, motivo }); }
      else reafirmados++;
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, verificados, divergentes, reafirmados, indisponiveis, flags }),
    { headers: { 'Content-Type': 'application/json' } });
}
