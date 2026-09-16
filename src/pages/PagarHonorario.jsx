import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { termoDoProduto, versaoTermoProduto } from '../utils/termos';
import PagamentoServico from '../components/PagamentoServico';
import { AZUL, VERDE } from '../utils/marca';

const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Checkout dos honorários de êxito de uma arrematação — nossa própria página (Transparente),
// não um link hospedado do Mercado Pago. Quem chega aqui é sempre o próprio arrematante,
// autenticado (a rota exige login em App.jsx; quem não estiver logado é mandado ao /login e
// volta pra cá sozinho — mesmo mecanismo de qualquer outra rota privada do BidPro).
export default function PagarHonorario() {
  const { arrematacaoId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [arr, setArr] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [aceite, setAceite] = useState(false);
  const [ofertarPro, setOfertarPro] = useState(false);
  const [pago, setPago] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancel = false;
    (async () => {
      const { data, error } = await supabase.from('arrematacoes')
        .select('id,arrematante_id,valor_arrematado,honorarios_valor,honorarios_status')
        .eq('id', arrematacaoId).maybeSingle();
      if (cancel) return;
      if (error) { setErro('Não foi possível carregar esta cobrança agora. Tente novamente em instantes.'); setCarregando(false); return; }
      if (!data || data.arrematante_id !== user.id) { setErro('Esta cobrança não foi encontrada para esta conta.'); setCarregando(false); return; }
      setArr(data);
      setCarregando(false);
    })();
    return () => { cancel = true; };
  }, [user, authLoading, arrematacaoId]);

  const registrarAceite = async () => {
    try {
      await apiCall('/api/registrar-aceite', {
        method: 'POST',
        body: JSON.stringify({
          plano_key: 'assessorado', valor: arr.honorarios_valor,
          termos_versao: versaoTermoProduto('assessorado'), gateway: 'mercadopago',
        }),
      });
    } catch { /* padrao-ok: registro de aceite é best-effort — nunca bloqueia o pagamento já feito */ }
  };

  const handlePago = async () => {
    await registrarAceite();
    setPago(true);
  };

  const wrap = { minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' };
  const card = { background: 'white', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: 460, width: '100%' };

  if (authLoading || carregando) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center', color: '#64748b' }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: AZUL }} />
          <div style={{ marginTop: 12 }}>Carregando...</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
        </div>
      </div>
    );
  }

  if (erro) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <AlertCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px' }} />
          <div style={{ color: '#dc2626', fontWeight: 700 }}>{erro}</div>
        </div>
      </div>
    );
  }

  const jaPago = pago || ['pago', 'distribuido'].includes(arr.honorarios_status);
  if (jaPago) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle2 size={48} color={VERDE} style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 19, fontWeight: 800, color: VERDE }}>Honorários pagos!</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
            Obrigado. A equipe já foi avisada e o próximo passo (procuração) segue automaticamente.
          </div>
        </div>
      </div>
    );
  }

  const termo = termoDoProduto('assessorado', { valorLabel: fmtBRL(arr.honorarios_valor), modelo: 'parcelado' });
  const termoPro = termoDoProduto('top2', { modelo: 'recorrente' });

  return (
    <div style={wrap}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Honorários de êxito</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>BidPro Brasil</div>
        </div>

        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '14px 16px', fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.55 }}>
          Você agora é <strong>assessorado(a)</strong> da BidPro Brasil. O valor abaixo são os
          <strong> honorários de êxito (10%)</strong> referentes à sua arrematação de{' '}
          <strong>{fmtBRL(arr.valor_arrematado)}</strong>.
        </div>

        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Valor a pagar</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(arr.honorarios_valor)}</div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
            Li e aceito os <strong>termos de adesão como Assessorado</strong>.
            <details style={{ marginTop: 4 }}>
              <summary style={{ color: AZUL, cursor: 'pointer', fontWeight: 600 }}>Ver termo (versão {termo.versao})</summary>
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#64748b', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                {termo.texto}
              </p>
            </details>
          </span>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '12px 14px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={ofertarPro} onChange={e => setOfertarPro(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: 12, color: '#581c87', lineHeight: 1.5 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, marginBottom: 3 }}>
              <Sparkles size={13} /> Quero também ser Investidor Pro
            </span>
            Busca de imóveis em leilão, relatórios mercadológico, documental e laudo de viabilidade,
            e demais recursos do plano. Autorizo o cartão agora; a <strong>1ª mensalidade só é
            cobrada em 30 dias</strong>. Disponível apenas pagando com cartão nesta tela.
            <details style={{ marginTop: 4 }}>
              <summary style={{ color: '#7c3aed', cursor: 'pointer', fontWeight: 600 }}>Ver termo (versão {termoPro.versao})</summary>
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#64748b', background: 'white', border: '1px solid #e9d5ff', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                {termoPro.texto}
              </p>
            </details>
          </span>
        </label>

        {!aceite ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
            Aceite os termos acima para continuar com o pagamento.
          </div>
        ) : (
          <PagamentoServico
            servico={{ nome: 'Honorários de êxito', valor: arr.honorarios_valor, proposito: 'honorario_exito' }}
            extra={{ arrematacao_id: arr.id, tambem_pro: ofertarPro }}
            onPago={handlePago}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 10.5, color: '#94a3b8' }}>
          <ShieldCheck size={12} /> Pagamento processado pelo Mercado Pago
        </div>
      </div>
    </div>
  );
}
