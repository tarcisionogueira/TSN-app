import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, CheckCircle2, Clock, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import AssinaturaCanvas from '../components/AssinaturaCanvas';

// SHA-256 nativo (Web Crypto) para gerar o hash de comprovação do aceite
async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const STATUS_INFO = {
  rascunho:              { label: 'Em preparação', cor: '#64748b', bg: '#f1f5f9' },
  aguardando_assinatura: { label: 'Aguardando sua assinatura', cor: '#d97706', bg: '#fef3c7' },
  assinado:              { label: 'Assinado', cor: '#059669', bg: '#dcfce7' },
  cancelado:             { label: 'Cancelado', cor: '#dc2626', bg: '#fee2e2' },
};

export default function Contratos() {
  const nav = useNavigate();
  const { user, effectiveUserId, loading: authLoading } = useAuth();
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(null);   // contrato no modal
  const [assinatura, setAssinatura] = useState('');
  const [aceite, setAceite] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!effectiveUserId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('contratos')
      .select('*')
      .eq('cliente_id', effectiveUserId)
      .neq('status', 'rascunho')
      .order('criado_em', { ascending: false });
    setContratos(data || []);
    setLoading(false);
  }, [effectiveUserId]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrir = (c) => { setAberto(c); setAssinatura(''); setAceite(false); setErro(''); };

  const assinar = async () => {
    setErro('');
    if (!assinatura) { setErro('Assine no campo indicado para continuar.'); return; }
    if (!aceite)     { setErro('Marque o aceite dos termos do contrato.'); return; }
    setSalvando(true);
    try {
      const carimbo = new Date().toISOString();
      const hash = await sha256(aberto.conteudo + '|' + assinatura + '|' + carimbo);
      const nome = user?.user_metadata?.nome || user?.email || '';
      const { error } = await supabase
        .from('contratos')
        .update({
          status: 'assinado',
          assinatura_data: assinatura,
          assinante_nome: nome,
          assinatura_hash: hash,
          assinado_em: carimbo,
        })
        .eq('id', aberto.id);
      if (error) throw error;
      setAberto(null);
      await carregar();
    } catch (e) {
      setErro('Não foi possível registrar a assinatura. ' + (e.message || ''));
    }
    setSalvando(false);
  };

  if (authLoading || loading) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Carregando…</div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <h2 style={{ color: '#0f172a' }}>Acesso restrito</h2>
        <p style={{ color: '#64748b' }}>Faça login para ver seus contratos.</p>
        <button onClick={() => nav('/login')} style={{ padding: '10px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>Entrar</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 20px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: '0 0 4px' }}>Meus Contratos</h1>
      <p style={{ color: '#64748b', margin: '0 0 24px', fontSize: 14 }}>Contratos de assessoria, clube de negócios e demais produtos.</p>

      {contratos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 16, border: '1px solid #e2e8f0' }}>
          <FileText size={40} color="#94a3b8" style={{ margin: '0 auto 14px' }} />
          <h3 style={{ color: '#334155', margin: '0 0 6px' }}>Nenhum contrato ainda</h3>
          <p style={{ color: '#94a3b8', fontSize: 13 }}>Quando um contrato for emitido para você, ele aparecerá aqui para leitura e assinatura.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {contratos.map(c => {
            const si = STATUS_INFO[c.status] || STATUS_INFO.rascunho;
            return (
              <div key={c.id} style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>{c.titulo}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    {c.produto && <span style={{ textTransform: 'capitalize' }}>{c.produto}</span>}
                    {c.valor > 0 && <span> · R$ {Number(c.valor).toFixed(2)}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: si.bg, color: si.cor, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {c.status === 'assinado' ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                  {si.label}
                </span>
                <button onClick={() => abrir(c)}
                  style={{ padding: '8px 16px', background: c.status === 'aguardando_assinatura' ? '#2563eb' : '#f1f5f9', color: c.status === 'aguardando_assinatura' ? 'white' : '#475569', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {c.status === 'aguardando_assinatura' ? 'Ler e assinar' : 'Visualizar'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de leitura/assinatura */}
      {aberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setAberto(null)}>
          <div style={{ background: 'white', borderRadius: 18, width: '100%', maxWidth: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>{aberto.titulo}</h3>
              <button onClick={() => setAberto(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>

            <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.7, color: '#334155', background: '#f8fafc', borderRadius: 10, padding: 16, border: '1px solid #f1f5f9' }}>
                {aberto.conteudo}
              </div>

              {aberto.status === 'assinado' ? (
                <div style={{ marginTop: 18, padding: 16, background: '#dcfce7', borderRadius: 10, border: '1px solid #86efac' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#166534', marginBottom: 8 }}>
                    <ShieldCheck size={16} /> Contrato assinado
                  </div>
                  {aberto.assinatura_data && <img src={aberto.assinatura_data} alt="Assinatura" style={{ maxHeight: 90, background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 6 }} />}
                  <div style={{ fontSize: 11, color: '#15803d', marginTop: 8, lineHeight: 1.6 }}>
                    <div><strong>Assinante:</strong> {aberto.assinante_nome}</div>
                    <div><strong>Data:</strong> {aberto.assinado_em ? new Date(aberto.assinado_em).toLocaleString('pt-BR') : '—'}</div>
                    <div style={{ wordBreak: 'break-all' }}><strong>Hash SHA-256:</strong> {aberto.assinatura_hash}</div>
                  </div>
                </div>
              ) : aberto.requer_assinatura && aberto.status === 'aguardando_assinatura' ? (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Assinatura do contratante</div>
                  <AssinaturaCanvas onChange={setAssinatura} />
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14, fontSize: 12.5, color: '#475569', cursor: 'pointer' }}>
                    <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2 }} />
                    Li e concordo com os termos deste contrato, e reconheço esta assinatura eletrônica como válida.
                  </label>
                  {erro && <div style={{ marginTop: 10, padding: '8px 12px', background: '#fee2e2', color: '#dc2626', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{erro}</div>}
                </div>
              ) : (
                <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>Este contrato não requer assinatura.</div>
              )}
            </div>

            {aberto.status === 'aguardando_assinatura' && aberto.requer_assinatura && (
              <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button onClick={() => setAberto(null)} style={{ padding: '10px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>Cancelar</button>
                <button onClick={assinar} disabled={salvando}
                  style={{ padding: '10px 22px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={15} /> {salvando ? 'Registrando…' : 'Assinar contrato'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
