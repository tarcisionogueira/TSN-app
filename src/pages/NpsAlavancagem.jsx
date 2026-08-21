/**
 * /nps — pesquisa de satisfação do CLIENTE de consórcio/home equity (F5 do plano
 * comercial). Página PÚBLICA: o token do e-mail é a credencial, sem login.
 * Três perguntas (decisão do dono, 21/08): conseguiu contratar? · nota 0-10 ·
 * comentário. Quem valida é o servidor; aqui a resposta de erro vira mensagem
 * educada (link inválido / já respondida), nunca tela quebrada.
 */
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Star, CheckCircle2, Loader2, HeartHandshake } from 'lucide-react';

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 18, padding: '28px 26px', boxShadow: '0 12px 40px rgba(15,23,42,0.08)' };

export default function NpsAlavancagem() {
  const loc = useLocation();
  const token = new URLSearchParams(loc.search).get('token') || '';
  const [contratou, setContratou] = useState(null);   // true | false | null
  const [nota, setNota] = useState(null);             // 0-10 | null
  const [comentario, setComentario] = useState('');
  const [estado, setEstado] = useState({ enviando: false, ok: false, erro: '' });

  const enviar = async () => {
    setEstado({ enviando: true, ok: false, erro: '' });
    try {
      const r = await fetch('/api/nps-alavancagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, contratou, nota, comentario: comentario.trim() || undefined }),
      });
      // `.ok` conferido ANTES do corpo — erro com JSON não pode virar "enviado".
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível registrar agora. Tente novamente.');
      setEstado({ enviando: false, ok: true, erro: '' });
    } catch (e) {
      setEstado({ enviando: false, ok: false, erro: e.message });
    }
  };

  const podeEnviar = !estado.enviando && contratou !== null && Number.isInteger(nota);
  const btnSeg = (ativo, cor, bg) => ({
    padding: '11px 18px', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer',
    border: ativo ? `2px solid ${cor}` : '1px solid #e2e8f0', color: cor, background: ativo ? bg : 'white',
  });

  if (!token) return (
    <div style={{ maxWidth: 480, margin: '70px auto', padding: '0 20px', textAlign: 'center' }}>
      <div style={card}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🔗</div>
        <div style={{ fontWeight: 900, fontSize: 18, color: '#111', marginBottom: 8 }}>Link incompleto</div>
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: 0 }}>
          Abra a pesquisa pelo link que enviamos no seu e-mail — ele é pessoal e único.
        </p>
      </div>
    </div>
  );

  if (estado.ok) return (
    <div style={{ maxWidth: 480, margin: '70px auto', padding: '0 20px', textAlign: 'center' }}>
      <div style={card}>
        <CheckCircle2 size={40} color="#15803d" style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 900, fontSize: 19, color: '#166534', marginBottom: 8 }}>Resposta registrada!</div>
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: 0 }}>
          Obrigado por dedicar esse minuto — é a sua opinião que garante a qualidade de quem
          atende em nome da BidPro Brasil.
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 520, margin: '46px auto', padding: '0 20px' }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <HeartHandshake size={22} color="#0D63DB" />
          <div style={{ fontWeight: 900, fontSize: 19, color: '#111' }}>Como foi seu atendimento?</div>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, margin: '0 0 18px' }}>
          Você pediu contato para consórcio ou home equity pela BidPro Brasil. São três
          perguntas rápidas — sua resposta vai direto para a nossa gestão.
        </p>

        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#334155', marginBottom: 8 }}>1. Você conseguiu contratar?</div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <button onClick={() => setContratou(true)} style={btnSeg(contratou === true, '#15803d', '#f0fdf4')}>Sim, contratei</button>
          <button onClick={() => setContratou(false)} style={btnSeg(contratou === false, '#b45309', '#fffbeb')}>Não contratei</button>
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#334155', marginBottom: 8 }}>
          2. Que nota você dá ao atendimento? <span style={{ color: '#94a3b8', fontWeight: 600 }}>(0 = péssimo · 10 = excelente)</span>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 18 }}>
          {Array.from({ length: 11 }, (_, n) => (
            <button key={n} onClick={() => setNota(n)}
              style={{ width: 38, height: 38, borderRadius: 9, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', border: nota === n ? '2px solid #0D63DB' : '1px solid #e2e8f0', color: nota === n ? '#0D63DB' : '#475569', background: nota === n ? '#eff6ff' : 'white' }}>
              {n}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#334155', marginBottom: 8 }}>
          3. Quer contar mais alguma coisa? <span style={{ color: '#94a3b8', fontWeight: 600 }}>(opcional)</span>
        </div>
        <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3} maxLength={1000}
          placeholder="Como foi a conversa, o que faltou, o que te surpreendeu…"
          style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }} />

        {estado.erro && (
          <div style={{ marginBottom: 12, padding: '9px 13px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, color: '#b91c1c', fontSize: 13 }}>{estado.erro}</div>
        )}

        <button onClick={enviar} disabled={!podeEnviar}
          style={{ width: '100%', padding: '13px 0', background: podeEnviar ? '#0D63DB' : '#cbd5e1', color: 'white', border: 'none', borderRadius: 11, fontWeight: 800, fontSize: 15, cursor: podeEnviar ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {estado.enviando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Star size={16} />}
          {estado.enviando ? 'Enviando…' : 'Enviar resposta'}
        </button>
      </div>
    </div>
  );
}
