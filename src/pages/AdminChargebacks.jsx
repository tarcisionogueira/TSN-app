import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, FileText, Copy, RefreshCw, ArrowLeft } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

const STATUS_COR = {
  aberto: { bg: '#fef2f2', cor: '#b91c1c', label: 'Aberto' },
  defesa_enviada: { bg: '#eff6ff', cor: '#1d4ed8', label: 'Defesa enviada' },
  ganho: { bg: '#f0fdf4', cor: '#15803d', label: 'Ganho' },
  perdido: { bg: '#f8fafc', cor: '#64748b', label: 'Perdido' },
};

export default function AdminChargebacks() {
  const nav = useNavigate();
  const [aba, setAba] = useState('chargebacks');
  const [dados, setDados] = useState({ chargebacks: [], aceites: [] });
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);

  const carregar = async () => {
    setLoading(true); setErro('');
    try {
      const r = await apiCall('/api/admin-chargebacks');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erro');
      setDados(d);
    } catch (e) { setErro(e.message); }
    setLoading(false);
  };
  useEffect(() => { carregar(); }, []);

  const fmtR = (v) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtD = (d) => d ? new Date(d).toLocaleString('pt-BR') : '—';
  const copiar = (cb) => { try { navigator.clipboard.writeText(JSON.stringify(cb.dossie, null, 2)); } catch (_) {} };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 80px' }}>
      <button onClick={() => nav('/painel')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', fontSize: 14, cursor: 'pointer', marginBottom: 16, padding: 0 }}><ArrowLeft size={16} /> Voltar</button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <ShieldAlert size={24} color="#b91c1c" /> Chargebacks & Aceites
        </h1>
        <button onClick={carregar} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}><RefreshCw size={14} /> Atualizar</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[['chargebacks', `Chargebacks (${dados.chargebacks.length})`], ['aceites', `Aceites (${dados.aceites.length})`]].map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)}
            style={{ padding: '8px 18px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', background: aba === k ? '#0D63DB' : '#f1f5f9', color: aba === k ? 'white' : '#64748b' }}>
            {label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#64748b' }}>Carregando…</p>}
      {erro && <p style={{ color: '#b91c1c' }}>Erro: {erro}</p>}

      {!loading && aba === 'chargebacks' && (
        dados.chargebacks.length === 0
          ? <p style={{ color: '#64748b' }}>Nenhum chargeback registrado. 🎉</p>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dados.chargebacks.map(cb => {
                const sc = STATUS_COR[cb.status] || STATUS_COR.aberto;
                const temDossie = !!cb.dossie?.aceite;
                return (
                  <div key={cb.id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, background: 'white', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 800, color: '#111', fontSize: 14 }}>{cb.user_email || '—'} · {fmtR(cb.valor)}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{cb.gateway?.toUpperCase()} · {cb.plano_key || '—'} · {fmtD(cb.aberto_em)}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ background: temDossie ? '#f0fdf4' : '#fffbeb', color: temDossie ? '#15803d' : '#b45309', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{temDossie ? '✅ Dossiê pronto' : '⚠️ Sem evidência'}</span>
                        <span style={{ background: sc.bg, color: sc.cor, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{sc.label}</span>
                        <button onClick={() => setAberto(aberto === cb.id ? null : cb.id)} style={{ padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><FileText size={13} /> Dossiê</button>
                      </div>
                    </div>
                    {aberto === cb.id && (
                      <div style={{ borderTop: '1px solid #f1f5f9', padding: '14px 18px', background: '#f8fafc' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                          <button onClick={() => copiar(cb)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}><Copy size={12} /> Copiar dossiê (JSON)</button>
                        </div>
                        <pre style={{ fontSize: 12, color: '#334155', background: 'white', border: '1px solid #eef2f7', borderRadius: 10, padding: '12px 14px', overflow: 'auto', margin: 0, maxHeight: 320 }}>{JSON.stringify(cb.dossie, null, 2)}</pre>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Motivo: {cb.motivo || '—'} · Defesa: {cb.defesa_status || '—'} {cb.gateway === 'asaas' && <em>(Asaas: enviar o dossiê pelo painel/contestação)</em>}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
      )}

      {!loading && aba === 'aceites' && (
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 14, background: 'white' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                {['Data', 'E-mail', 'Plano', 'Valor', 'Gateway', 'Versão', 'IP', 'Dispositivo'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', fontWeight: 700, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.aceites.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{fmtD(a.aceito_em)}</td>
                  <td style={{ padding: '9px 12px' }}>{a.user_email || '—'}</td>
                  <td style={{ padding: '9px 12px' }}>{a.plano_key}</td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{fmtR(a.valor)}</td>
                  <td style={{ padding: '9px 12px' }}>{a.gateway || '—'}</td>
                  <td style={{ padding: '9px 12px' }}>{a.termos_versao || '—'}</td>
                  <td style={{ padding: '9px 12px' }}>{a.ip || '—'}</td>
                  <td style={{ padding: '9px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.user_agent}>{a.user_agent || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
