import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { formatarCodigo, normalizarCodigo } from '../lib/codigo-validacao.js';

// Página PÚBLICA de validação de documento assinado (12/11). O código vem do rodapé/QR do PDF.
// Mostra o que foi assinado, por quem e quando (CPF/CNPJ mascarado) — nunca o token do link.
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const cartao = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 14 };

export default function ValidarDocumento() {
  const { codigo: doLink } = useParams();
  const navigate = useNavigate();
  const [digitado, setDigitado] = useState(doLink ? formatarCodigo(doLink) || doLink : '');
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const consultar = async (entrada) => {
    setErro(''); setInfo(null);
    const c = normalizarCodigo(entrada);
    if (!c) { setErro('Código inválido. Ele tem 16 letras e números, no formato XXXX-XXXX-XXXX-XXXX.'); return; }
    setCarregando(true);
    try {
      const r = await fetch(`/api/validar-documento?c=${c}`);
      const j = await r.json().catch(() => ({}));
      if (r.status === 404 || !j.encontrado) { setErro('Nenhum documento assinado com este código. Confira os caracteres digitados.'); return; }
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
      setInfo(j);
      if (doLink !== c) navigate(`/validar/${c}`, { replace: true });
    } catch (e) { setErro(e.message || 'Não foi possível consultar agora.'); } finally { setCarregando(false); }
  };

  useEffect(() => { if (doLink) consultar(doLink); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '28px 16px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck size={24} color="#0D63DB" /> Validar documento assinado</h1>
        <form style={cartao} onSubmit={(e) => { e.preventDefault(); consultar(digitado); }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Código de validação (rodapé do documento)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={digitado} onChange={(e) => setDigitado(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck={false}
              style={{ flex: '1 1 220px', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 16, letterSpacing: 1 }} />
            <button disabled={carregando} style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#0D63DB', color: '#fff', fontWeight: 700 }}>
              {carregando ? <Loader2 size={16} className="animate-spin" /> : 'Validar'}
            </button>
          </div>
        </form>
        {erro && <div style={{ ...cartao, borderColor: '#fecaca', color: '#b91c1c', display: 'flex', gap: 8 }}><AlertCircle size={18} /> {erro}</div>}
        {info && (
          <div style={{ ...cartao, borderColor: info.situacao === 'assinado' ? '#86efac' : '#fde68a' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800, color: info.situacao === 'assinado' ? '#15803d' : '#a16207' }}>
              {info.situacao === 'assinado' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
              {info.situacao === 'assinado' ? 'Documento autêntico — assinado por todas as partes' : `Documento autêntico — ${info.assinaturas} de ${info.total} assinatura(s)`}
            </div>
            <h2 style={{ fontSize: 17, margin: '12px 0 4px' }}>{info.titulo}</h2>
            <div style={{ fontSize: 12, color: '#64748b' }}>Código {formatarCodigo(info.codigo)}{info.criado_em ? ` · criado em ${dataHora(info.criado_em)}` : ''}</div>
            <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Assinaturas</h3>
            {info.partes.map((p, i) => (
              <div key={i} style={{ borderTop: '1px solid #e2e8f0', padding: '8px 0', fontSize: 13 }}>
                <b>{p.nome}</b>{p.documento ? ` · ${p.documento}` : ''} — {p.assinou ? `assinou em ${dataHora(p.assinado_em)}` : 'pendente'}
                {p.hash && <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>Hash SHA-256: {p.hash}</div>}
                {p.testemunha && <div style={{ fontSize: 12, color: '#475569' }}>Testemunha: {p.testemunha.assinou ? `${p.testemunha.nome || 'assinou'} · ${dataHora(p.testemunha.em)}` : 'pendente'}</div>}
              </div>
            ))}
            <p style={{ fontSize: 11, color: '#64748b', marginBottom: 0 }}>Assinaturas eletrônicas nos termos da MP 2.200-2/2001 e da Lei 14.063/2020. Dados pessoais exibidos de forma parcial (LGPD).</p>
          </div>
        )}
      </div>
    </div>
  );
}
