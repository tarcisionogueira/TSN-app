import React from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, MessageSquare } from 'lucide-react';

function abrirFeedback() {
  window.dispatchEvent(new CustomEvent('tsn:open-feedback'));
}

export default function Footer() {
  return (
    <footer style={{ background: '#0f172a', color: '#94a3b8', padding: '40px 20px 28px', marginTop: 40 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ background: '#2563eb', borderRadius: 8, padding: '6px 8px' }}><Briefcase size={16} color="white" /></div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: 'white' }}>TSN ATIVOS</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
            </div>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            Análise de imóveis em leilão com viabilidade financeira e segurança jurídica.
          </p>
          <p style={{ fontSize: 11, marginTop: 14, color: '#64748b' }}>
            Nogueira Empreendimentos LTDA · CNPJ 02.311.492/0001-61<br />Feira de Santana — BA
          </p>
        </div>

        <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'white', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Legal</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Link to="/termos" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13 }}>Termos de Uso</Link>
              <Link to="/privacidade" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: 13 }}>Política de Privacidade (LGPD)</Link>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'white', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Suporte</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={abrirFeedback}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '8px 14px', color: '#94a3b8', fontSize: 13, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#2563eb'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#334155'}
              >
                <MessageSquare size={14} />
                Entrar em Contato
              </button>
            </div>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 1100, margin: '28px auto 0', paddingTop: 18, borderTop: '1px solid #1e293b', fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        © {new Date().getFullYear()} TSN Ativos. Todos os direitos reservados.
      </div>
    </footer>
  );
}
