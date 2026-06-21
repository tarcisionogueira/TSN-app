import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';

const SESSION_KEY = 'tsn_contrato_dismissed';

export default function ContratoObrigatorio({ userId }) {
  const navigate = useNavigate();
  const [pendentes, setPendentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');

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

  if (loading || pendentes.length === 0) return null;

  const now = new Date();
  const expired = pendentes.some(p => p.expira_em && new Date(p.expira_em) <= now);

  if (expired) {
    // Full-screen blocker — cannot be dismissed
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.95)',
        zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: '#fff', borderRadius: 16, padding: 40,
          maxWidth: 480, width: '100%', textAlign: 'center',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📄</div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '0 0 12px' }}>
            Assinatura de contrato necessária
          </h2>
          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: '0 0 28px' }}>
            Seu prazo de 30 dias para assinar o contrato encerrou. Para continuar usando a plataforma, assine o contrato pendente.
          </p>
          <button
            onClick={() => navigate('/contratos')}
            style={{
              width: '100%', padding: '14px', background: '#2563eb',
              color: 'white', border: 'none', borderRadius: 10,
              fontWeight: 800, fontSize: 15, cursor: 'pointer',
            }}>
            Ir para assinatura →
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
            flex: 2, padding: '10px', background: '#2563eb',
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
