/**
 * /api/saldo-abandono-cron — abandono de saldo a receber (pedido do dono).
 *
 * Atrelado à DIVERGÊNCIA cadastral do parceiro (revalidação pendente — CPF saiu do quadro
 * societário / CNPJ irregular). Ao identificar a divergência, o relógio de 90 dias começa
 * (perfis.abandono_inicio_em, setado pela revalidação). Este cron faz a CADÊNCIA DE AVISOS,
 * cobrando a atualização dos dados e lembrando a cláusula contratual (Termos, Seção 8):
 *   • Aviso 1 — IMEDIATO (no 1º ciclo após a identificação da divergência).
 *   • Aviso 2 — aos ~30 dias.
 *   • Aviso 3 — aos ~60 dias.
 *   • Aos 90 dias, persistindo → CADUCIDADE (valor fica para a empresa). REVERSÍVEL.
 * Atualizar os dados / revalidar / sacar INTERROMPE a contagem (limpa o relógio).
 *
 * SEGURANÇA: os AVISOS rodam sempre (reforço do resguardo jurídico). A REVERSÃO (tirar o
 * dinheiro) é gated por env ABANDONO_ATIVO=true — enquanto off, avisa mas não reverte.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { createClient } from '@supabase/supabase-js';

const PLANOS_PAGOS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
const DIA = 86400000;
const AVISO2_DIAS = 30;
const AVISO3_DIAS = 60;
const ABANDONO_DIAS = 90;
const FROM = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';
const fmtBRL = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Textos dos 3 avisos + reversão (cobram atualização e lembram a cláusula — Termos Seção 8).
function emailAviso(n, saldo, diasRestantes) {
  const rodape = '<p>Para resolver, entre no seu perfil, <strong>atualize os dados da empresa (CNPJ/razão social)</strong> e clique em “Verificar automaticamente”. Qualquer atualização ou saque interrompe a contagem.</p><p style="color:#64748b;font-size:13px">Conforme os Termos de Uso (Seção 8 — crédito condicionado e caducidade por inatividade), persistindo a pendência por 90 dias sem atualização dos dados nem saque, os valores caducam em favor da BidPro Brasil.</p><p>BidPro Brasil</p>';
  if (n === 1) return { subject: 'Ação necessária: atualize os dados da sua empresa — BidPro Brasil',
    html: `<p>Olá!</p><p>Identificamos uma <strong>divergência cadastral</strong> na sua empresa (PJ) e, por isso, seu repasse de <strong>${fmtBRL(saldo)}</strong> está retido.</p>${rodape}` };
  if (n === 2) return { subject: 'Lembrete: sua empresa ainda está com pendência cadastral — BidPro Brasil',
    html: `<p>Olá!</p><p>Continua pendente a atualização dos dados da sua empresa. Seu repasse de <strong>${fmtBRL(saldo)}</strong> segue retido. Faltam cerca de <strong>${diasRestantes} dias</strong> para o prazo de abandono.</p>${rodape}` };
  return { subject: 'Último aviso: risco de perda do saldo por abandono — BidPro Brasil',
    html: `<p>Olá!</p><p><strong>Último aviso.</strong> Persistindo a pendência cadastral da sua empresa, seu saldo de <strong>${fmtBRL(saldo)}</strong> será considerado em abandono em cerca de <strong>${diasRestantes} dias</strong> e caducará em favor da BidPro Brasil, conforme os Termos.</p>${rodape}` };
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const reversaoAtiva = String(process.env.ABANDONO_ATIVO || '').toLowerCase() === 'true';
  const agora = Date.now();
  let verificados = 0, avisos = 0, revertidos = 0;

  try {
    // Parceiros com divergência em curso (relógio iniciado) e ainda não abandonados.
    const { data: parceiros } = await supabase.from('perfis')
      .select('id,nome,role,pj_revalidacao_pendente,abandono_inicio_em,abandono_avisos')
      .in('role', PLANOS_PAGOS).is('abandono_em', null).not('abandono_inicio_em', 'is', null);

    for (const p of (parceiros || [])) {
      // Resolveu (não está mais pendente) → limpa o relógio e segue. (Reforço; o RPC já limpa.)
      if (!p.pj_revalidacao_pendente) {
        await supabase.from('perfis').update({ abandono_inicio_em: null, abandono_avisos: 0, abandono_avisado_em: null }).eq('id', p.id);
        continue;
      }
      verificados++;

      const { data: su } = await supabase.from('saldo_usuarios').select('saldo_disponivel').eq('user_id', p.id).maybeSingle();
      const saldo = Number(su?.saldo_disponivel || 0);
      const dias = (agora - new Date(p.abandono_inicio_em).getTime()) / DIA;
      const jaAvisou = p.abandono_avisos || 0;
      const restam = Math.max(0, Math.ceil(ABANDONO_DIAS - dias));

      let email = null;
      try { const u = await supabase.auth.admin.getUserById(p.id); email = u?.data?.user?.email || null; } catch { /* segue sem email */ }

      // REVERSÃO (gated): 90+ dias, os 3 avisos enviados e há saldo.
      if (reversaoAtiva && dias >= ABANDONO_DIAS && jaAvisou >= 3 && saldo > 0) {
        const r = await supabase.rpc('reverter_saldo_abandono', {
          p_user_id: p.id,
          p_motivo: `Saldo revertido por abandono: divergência cadastral não resolvida em ${Math.floor(dias)} dias, após 3 avisos (Termos, Seção 8).`,
        });
        if (!r.error && r.data?.ok) {
          revertidos++;
          if (email) { try { await enviarEmail({ from: FROM, to: email, subject: 'Saldo revertido por abandono — BidPro Brasil',
            html: `<p>Olá!</p><p>Seu saldo de <strong>${fmtBRL(saldo)}</strong> foi revertido por abandono: a divergência cadastral da sua empresa não foi resolvida em 90 dias, mesmo após 3 avisos, conforme os Termos de Uso (Seção 8).</p><p>Se foi engano, fale com o suporte que reavaliamos.</p><p>BidPro Brasil</p>` }); } catch { /* não bloqueia */ } }
        }
        continue;
      }

      // CADÊNCIA DE AVISOS (sempre): 1 imediato, 2 aos ~30d, 3 aos ~60d.
      let nivel = 0;
      if (jaAvisou < 1) nivel = 1;
      else if (jaAvisou < 2 && dias >= AVISO2_DIAS) nivel = 2;
      else if (jaAvisou < 3 && dias >= AVISO3_DIAS) nivel = 3;
      if (nivel === 0) continue;

      await supabase.from('perfis').update({ abandono_avisos: nivel, abandono_avisado_em: new Date().toISOString() }).eq('id', p.id);
      avisos++;
      if (email) {
        const e = emailAviso(nivel, saldo, restam);
        try { await enviarEmail({ from: FROM, to: email, subject: e.subject, html: e.html }); } catch { /* não bloqueia */ }
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, verificados, avisos, revertidos, reversao_ativa: reversaoAtiva }), { headers: { 'Content-Type': 'application/json' } });
}
