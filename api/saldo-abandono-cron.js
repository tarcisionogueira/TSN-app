/**
 * /api/saldo-abandono-cron — abandono de saldo a receber (pedido do dono).
 *
 * Regra: parceiro PJ com valores a receber que passa 90 dias SEM atualizar os dados E SEM
 * sacar → abandono; o valor fica para a empresa. Atualizar os dados OU sacar reseta o relógio.
 *
 * SEGURANÇA / EMBASAMENTO LEGAL (ver docs/BASE_LEGAL_ABANDONO_SALDO.md):
 *  - 90 dias NÃO se sustenta por prescrição (essa é de anos). Só por CLÁUSULA de caducidade +
 *    crédito condicionado aceita nos Termos, com AVISO PRÉVIO.
 *  - Por isso: (1) EXECUÇÃO travada por env ABANDONO_ATIVO=true (no-op enquanto off — ligue só
 *    após a cláusula entrar nos Termos + revisão jurídica); (2) AVISO aos 60 dias antes de
 *    qualquer reversão; (3) reversão só >= 90 dias E >= 15 dias após o aviso; (4) REVERSÍVEL.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { createClient } from '@supabase/supabase-js';

const PLANOS_PAGOS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
const DIA = 86400000;
const AVISO_DIAS = 60;           // avisa a partir de 60 dias de inatividade
const ABANDONO_DIAS = 90;        // reverte a partir de 90 dias
const CARENCIA_APOS_AVISO = 15;  // e só reverte >= 15 dias depois do aviso
const FROM = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';
const fmtBRL = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  // TRAVA DE SEGURANÇA: só executa quando explicitamente ligado (após cláusula nos Termos +
  // revisão jurídica). Enquanto desligado, é no-op — nenhum saldo é tocado.
  if (String(process.env.ABANDONO_ATIVO || '').toLowerCase() !== 'true') {
    return new Response(JSON.stringify({ ok: true, desativado: true, hint: 'Defina ABANDONO_ATIVO=true após a cláusula nos Termos + revisão jurídica.' }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const agora = Date.now();
  let verificados = 0, avisados = 0, revertidos = 0;

  try {
    const { data: parceiros } = await supabase.from('perfis')
      .select('id,nome,role,pj_dados_atualizados_em,abandono_avisado_em')
      .in('role', PLANOS_PAGOS).is('abandono_em', null);

    for (const p of (parceiros || [])) {
      const { data: su } = await supabase.from('saldo_usuarios').select('saldo_disponivel').eq('user_id', p.id).maybeSingle();
      const saldo = Number(su?.saldo_disponivel || 0);
      if (saldo <= 0) continue;

      // Última atividade = max(atualização de dados, último saque). Sem baseline → não age.
      const { data: ult } = await supabase.from('saldo_lancamentos')
        .select('criado_em').eq('user_id', p.id).eq('tipo', 'saque').order('criado_em', { ascending: false }).limit(1);
      const tsDados = p.pj_dados_atualizados_em ? new Date(p.pj_dados_atualizados_em).getTime() : 0;
      const tsSaque = ult?.[0]?.criado_em ? new Date(ult[0].criado_em).getTime() : 0;
      const ultAtividade = Math.max(tsDados, tsSaque);
      if (!ultAtividade) continue;
      verificados++;

      const diasInativo = (agora - ultAtividade) / DIA;
      const avisadoTs = p.abandono_avisado_em ? new Date(p.abandono_avisado_em).getTime() : 0;

      // Reativou (voltou a movimentar) → limpa o aviso e segue.
      if (diasInativo < AVISO_DIAS) {
        if (avisadoTs) await supabase.from('perfis').update({ abandono_avisado_em: null }).eq('id', p.id);
        continue;
      }

      let email = null;
      try { const u = await supabase.auth.admin.getUserById(p.id); email = u?.data?.user?.email || null; } catch { /* segue sem email */ }

      // REVERSÃO: >= 90 dias inativo E avisado há >= 15 dias.
      if (diasInativo >= ABANDONO_DIAS && avisadoTs && (agora - avisadoTs) >= CARENCIA_APOS_AVISO * DIA) {
        const r = await supabase.rpc('reverter_saldo_abandono', {
          p_user_id: p.id,
          p_motivo: `Saldo revertido por abandono: ${Math.floor(diasInativo)} dias sem atualização de dados nem saque (Termos de Uso).`,
        });
        if (!r.error && r.data?.ok) {
          revertidos++;
          if (email) { try { await enviarEmail({ from: FROM, to: email, subject: 'Saldo revertido por inatividade — BidPro Brasil',
            html: `<p>Olá!</p><p>Seu saldo de <strong>${fmtBRL(saldo)}</strong> foi revertido por abandono: ficou mais de 90 dias sem atualização dos dados da empresa nem solicitação de saque, conforme os Termos de Uso.</p><p>Se foi engano, fale com o suporte que reavaliamos.</p><p>BidPro Brasil</p>` }); } catch { /* não bloqueia */ } }
        }
        continue;
      }

      // AVISO PRÉVIO: >= 60 dias inativo e ainda não avisado.
      if (diasInativo >= AVISO_DIAS && !avisadoTs) {
        await supabase.from('perfis').update({ abandono_avisado_em: new Date().toISOString() }).eq('id', p.id);
        avisados++;
        if (email) { try { await enviarEmail({ from: FROM, to: email, subject: 'Você tem valores a receber — evite o abandono',
          html: `<p>Olá!</p><p>Você tem <strong>${fmtBRL(saldo)}</strong> a receber, mas sua conta está inativa há ${Math.floor(diasInativo)} dias.</p><p>Para não perder o valor por abandono (Termos de Uso), <strong>solicite um saque</strong> ou <strong>atualize os dados da sua empresa</strong> no seu perfil nos próximos dias.</p><p>BidPro Brasil</p>` }); } catch { /* não bloqueia */ } }
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, verificados, avisados, revertidos }), { headers: { 'Content-Type': 'application/json' } });
}
