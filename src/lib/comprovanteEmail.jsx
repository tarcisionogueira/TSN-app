/**
 * Prova de posse do e-mail antes de criar conta já confirmada (19/10, pendência 251).
 *
 * `pedirComprovanteEmail(email)` abre um modal que envia um código de 6 dígitos (api/codigo-email.js),
 * pede o código e devolve o comprovante assinado — ou `null` se a pessoa cancelar. O comprovante vale
 * 30 min no servidor; aqui fica guardado 25 min por e-mail, para que uma nova tentativa (cartão recusado,
 * erro de rede) não peça outro código. Imperativo de propósito: monta-se sozinho no <body>, então cada
 * tela de cadastro só ganha uma linha antes do fetch, em vez de um modal em cada `return`.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const cache = new Map(); // email → { comprovante, exp }
const norm = (e) => String(e || '').trim().toLowerCase();

export function esquecerComprovanteEmail(email) { cache.delete(norm(email)); }

async function chamar(corpo) {
  try {
    const r = await fetch('/api/codigo-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, ...j };
  } catch (e) {
    return { ok: false, error: 'Sem conexão. Confira a internet e tente de novo.' };
  }
}

function ModalCodigo({ email, onFim }) {
  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState('Enviando o código…');
  const [erro, setErro] = useState('');
  const [espera, setEspera] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const input = useRef(null);

  const enviar = async () => {
    setErro(''); setMsg('Enviando o código…');
    const r = await chamar({ acao: 'enviar', email });
    if (r.ok) { setMsg(`Enviamos um código de 6 números para ${email}. Confira também o spam.`); setEspera(45); }
    else { setMsg(''); setErro(r.error || 'Não foi possível enviar o código.'); if (r.aguarde) setEspera(r.aguarde); }
    input.current?.focus();
  };
  useEffect(() => { enviar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (espera <= 0) return undefined;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const confirmar = async (ev) => {
    ev?.preventDefault();
    if (codigo.length !== 6 || ocupado) return;
    setOcupado(true); setErro('');
    const r = await chamar({ acao: 'verificar', email, codigo });
    setOcupado(false);
    if (r.ok && r.comprovante) { onFim(r.comprovante); return; }
    setErro(r.error || 'Código incorreto.');
    if (r.expirado) setCodigo('');
  };

  const btn = { width: '100%', padding: 12, borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none' };
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={confirmar} style={{ background: '#fff', borderRadius: 16, maxWidth: 400, width: '100%', padding: 24, color: '#0f172a', fontFamily: 'inherit' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 900 }}>Confirme o seu e-mail</h3>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#475569', lineHeight: 1.5 }}>{msg || ' '}</p>
        <input ref={input} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Código de 6 números"
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 28, letterSpacing: 8, textAlign: 'center', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, marginBottom: 12 }} />
        {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        <button type="submit" disabled={codigo.length !== 6 || ocupado} style={{ ...btn, background: '#0D63DB', color: '#fff', opacity: codigo.length !== 6 || ocupado ? 0.6 : 1, marginBottom: 8 }}>
          {ocupado ? 'Conferindo…' : 'Confirmar e continuar'}
        </button>
        <button type="button" onClick={enviar} disabled={espera > 0} style={{ ...btn, background: '#f1f5f9', color: '#334155', marginBottom: 8, opacity: espera > 0 ? 0.6 : 1 }}>
          {espera > 0 ? `Reenviar código em ${espera}s` : 'Reenviar código'}
        </button>
        <button type="button" onClick={() => onFim(null)} style={{ ...btn, background: 'transparent', color: '#64748b' }}>
          Corrigir o e-mail
        </button>
      </form>
    </div>
  );
}

let aberto = null;
export function pedirComprovanteEmail(email) {
  const e = norm(email);
  const c = cache.get(e);
  if (c && c.exp > Date.now()) return Promise.resolve(c.comprovante);
  if (aberto) return aberto; // duplo clique: o mesmo modal
  aberto = new Promise((resolve) => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    const fim = (comprovante) => {
      if (comprovante) cache.set(e, { comprovante, exp: Date.now() + 25 * 60 * 1000 });
      aberto = null;
      setTimeout(() => { root.unmount(); div.remove(); }, 0);
      resolve(comprovante || null);
    };
    root.render(<ModalCodigo email={e} onFim={fim} />);
  });
  return aberto;
}
