import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useVezDoModal } from '../utils/filaModais';

const SESSION_KEY = 'tsn_contrato_dismissed';

export default function ContratoObrigatorio({ userId }) {
  const navigate = useNavigate();
  const [pendentes, setPendentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');
  const [erroLink, setErroLink] = useState('');

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    async function load() {
      try {
        const { data } = await supabase
          .from('contratos_pendentes')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'aguardando');
        setPendentes(data || []);
      } catch (e) {
        // silently ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userId]);

  // FILA DE MODAIS (15/08). Contrato tem a MAIOR prioridade: o ramo `expired` é um bloqueio de
  // tela inteira que não se fecha, e enfileirá-lo atrás de um vídeo de boas-vindas seria pôr o
  // opcional na frente do que trava a conta. O `dismissed` entra na conta de QUERER: um popup
  // que a pessoa já dispensou não pode continuar segurando a vez de quem vem atrás — seria uma
  // fila parada por alguém que nem está mais na tela.
  const now = new Date();
  const expired = pendentes.some(p => p.expira_em && new Date(p.expira_em) <= now);
  const quer = !loading && pendentes.length > 0 && (expired || !dismissed);
  const minhaVez = useVezDoModal('contrato', quer);
  if (!minhaVez) return null;

  // 07/11: "Ir para assinatura" levava a /contratos — tela da equipe, sob o MESMO bloqueio. O cliente ficava preso.
  // Agora abre o link de assinatura dele (/c/<token>, fora do MainLayout). Sem link, o erro aparece e o
  // atendimento fica ao alcance (o bloqueio fica ABAIXO do painel do chat, z-index 9990).
  async function irParaAssinatura() {
    setErroLink('');
    const { data: token, error } = await supabase.rpc('meu_link_contrato_pendente');
    if (error || !token) {
      setErroLink('Não encontrei o link do seu contrato. Fale com o atendimento que enviamos de novo.');
      return;
    }
    navigate(`/c/${token}`);
  }

  if (expired) {
    // Full-screen blocker — cannot be dismissed
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.95)',
        zIndex: 9985,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: '#fff', borderRadius: 16, padding: 40,
          maxWidth: 480, width: '100%', textAlign: 'center',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📄</div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: '0 0 12px' }}>
            Assinatura de contrato necessária
          </h2>
          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: '0 0 28px' }}>
            Seu prazo de 30 dias para assinar o contrato encerrou. Para continuar usando a plataforma, assine o contrato pendente.
          </p>
          <button
            onClick={irParaAssinatura}
            style={{
              width: '100%', padding: '14px', background: '#0D63DB',
              color: 'white', border: 'none', borderRadius: 10,
              fontWeight: 800, fontSize: 15, cursor: 'pointer',
            }}>
            Ir para assinatura →
          </button>
          {erroLink && <p role="alert" style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600, margin: '12px 0 0' }}>{erroLink}</p>}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}
            style={{ width: '100%', marginTop: 10, padding: '12px', background: 'white', color: '#0D63DB', border: '2px solid #0D63DB', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            Falar com o atendimento
          </button>
        </div>
      </div>
    );
  }

  // Popup (not expired)
  if (dismissed) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      background: '#1e3a5f', color: '#fff',
      borderRadius: 14, padding: '20px 24px',
      zIndex: 9000, maxWidth: 340, width: 'calc(100% - 48px)',
      boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
    }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
        📄 Contrato pendente de assinatura
      </div>
      <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 16px' }}>
        Você tem um contrato aguardando sua assinatura. Assine para garantir acesso contínuo à plataforma.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => navigate('/contratos')}
          style={{
            flex: 2, padding: '10px', background: '#0D63DB',
            color: 'white', border: 'none', borderRadius: 8,
            fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}>
          Assinar agora →
        </button>
        <button
          onClick={() => { sessionStorage.setItem(SESSION_KEY, '1'); setDismissed(true); }}
          style={{
            flex: 1, padding: '10px', background: 'transparent',
            color: '#94a3b8', border: '1px solid #334155', borderRadius: 8,
            fontWeight: 600, fontSize: 12, cursor: 'pointer',
          }}>
          Lembrar depois
        </button>
      </div>
    </div>
  );
}
