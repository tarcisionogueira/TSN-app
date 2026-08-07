import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, CheckCircle2, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';

/**
 * /continuar/:codigo — a tela que abre NO CELULAR depois de ler o QR do computador.
 *
 * Regra que molda tudo aqui: o telefone NÃO tem sessão e NÃO recebe nenhuma. O código do QR
 * autoriza uma coisa só — ENTREGAR foto. Por isso esta página não mostra dado do usuário além do
 * primeiro nome (para ele confirmar que é a conta certa), não lista documentos e não tem link
 * para o resto do app.
 *
 * A foto é REDUZIDA aqui antes de subir (canvas, lado maior 1600px, JPEG 0.85). Não é enfeite:
 * foto de celular moderno passa de 4 MB e estouraria o corpo da função serverless — e, em rede
 * móvel, o envio cru é justamente onde o cliente desiste.
 */

const MAX_LADO = 1600;
const rotulos = {
  documento: { titulo: 'Documento (RG ou CNH)', ajuda: 'Frente do documento, sem reflexo e com o texto legível.', capture: 'environment' },
  documento_verso: { titulo: 'Verso do documento', ajuda: 'Opcional — envie se o seu documento tiver dados no verso.', capture: 'environment' },
  selfie: { titulo: 'Selfie', ajuda: 'Rosto de frente, bem iluminado, sem óculos escuros ou boné.', capture: 'user' },
};

async function reduzir(file) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
  });
  // HEIC e afins podem não decodificar no canvas; nesse caso mandamos o original se for
  // um tipo aceito, e o servidor recusa com mensagem clara se não for.
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = dataUrl; });
  if (!img || !img.width) return dataUrl;
  const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85);
}

export default function ContinuarCaptura() {
  const { codigo } = useParams();
  const [estado, setEstado] = useState('carregando'); // carregando | pronto | invalido | concluido
  const [info, setInfo] = useState(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState('');
  const [feitos, setFeitos] = useState([]);
  const refs = useRef({});

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/captura-handoff?codigo=${encodeURIComponent(codigo || '')}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        setInfo(d || null);
        setEstado(d?.concluido ? 'concluido' : 'invalido');
        return;
      }
      setInfo(d);
      setFeitos(Array.isArray(d.itens) ? d.itens : []);
      setEstado(d.concluido ? 'concluido' : 'pronto');
    } catch { setEstado('invalido'); }
  }, [codigo]);

  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(tipo, file) {
    if (!file) return;
    setEnviando(tipo); setErro('');
    try {
      const imagem = await reduzir(file);
      const r = await fetch('/api/captura-handoff-envio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, tipo, imagem }),
      });
      const d = await r.json().catch(() => ({}));
      // Sem checar .ok, um 410 (código expirado) viraria "enviado ✓" na cara do cliente e ele
      // ficaria esperando o computador seguir — que nunca seguiria.
      if (!r.ok) { setErro(d?.error || 'Não consegui enviar a foto. Tente de novo.'); }
      else {
        setFeitos(prev => [...new Set([...prev, tipo])]);
        if (d.concluido) setEstado('concluido');
      }
    } catch { setErro('Falha de conexão. Verifique o sinal e tente de novo.'); }
    setEnviando('');
  }

  const caixa = { maxWidth: 460, margin: '0 auto', padding: '22px 18px 40px' };

  if (estado === 'carregando') {
    return <div style={{ ...caixa, textAlign: 'center', paddingTop: 80, color: '#64748b' }}>
      <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
      <div style={{ marginTop: 10, fontSize: 13 }}>Abrindo…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>;
  }

  if (estado === 'invalido') {
    const motivo = info?.motivo === 'expirado' ? 'Este código expirou (ele vale 15 minutos, por segurança).'
      : info?.motivo === 'cancelado' ? 'Este código foi cancelado no computador.'
      : 'Este código não é válido.';
    return <div style={{ ...caixa, textAlign: 'center', paddingTop: 70 }}>
      <AlertTriangle size={30} color="#f59e0b" />
      <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginTop: 10 }}>Não dá para continuar por aqui</div>
      <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginTop: 8 }}>{motivo}<br />Volte ao computador e gere um novo QR code.</p>
    </div>;
  }

  if (estado === 'concluido') {
    return <div style={{ ...caixa, textAlign: 'center', paddingTop: 70 }}>
      <CheckCircle2 size={38} color="#16a34a" />
      <div style={{ fontWeight: 900, fontSize: 16, color: '#166534', marginTop: 10 }}>Fotos enviadas!</div>
      <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, marginTop: 8 }}>
        Pode voltar para o computador — a tela de lá já seguiu sozinha. Você pode fechar esta página.
      </p>
    </div>;
  }

  const passos = (info?.passos || []).concat(
    (info?.passos || []).includes('documento') ? ['documento_verso'] : []
  );

  return (
    <div style={{ ...caixa }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <div style={{ background: '#0D63DB', borderRadius: 9, padding: '7px 9px' }}><ShieldCheck size={16} color="#fff" /></div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 15, color: '#111' }}>{info?.titulo || 'Enviar foto'}</div>
          {info?.nome && <div style={{ fontSize: 12, color: '#64748b' }}>Conta de {info.nome}</div>}
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6, margin: '0 0 16px' }}>
        Tire as fotos abaixo. Assim que terminar, a tela do computador segue sozinha.
      </p>

      {passos.map((tipo) => {
        const r = rotulos[tipo]; if (!r) return null;
        const feito = feitos.includes(tipo);
        const opcional = tipo === 'documento_verso';
        return (
          <div key={tipo} style={{ border: `1px solid ${feito ? '#86efac' : '#e2e8f0'}`, background: feito ? '#f0fdf4' : '#fff', borderRadius: 14, padding: 14, marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: '#111', marginBottom: 3 }}>
              {r.titulo}{opcional && <span style={{ color: '#94a3b8', fontWeight: 600 }}> · opcional</span>}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>{r.ajuda}</div>
            <input ref={el => { refs.current[tipo] = el; }} type="file" accept="image/*" capture={r.capture}
              style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; enviar(tipo, f); }} />
            <button onClick={() => refs.current[tipo]?.click()} disabled={!!enviando}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px',
                border: 'none', borderRadius: 11, cursor: enviando ? 'default' : 'pointer', fontWeight: 800, fontSize: 13.5,
                background: feito ? '#dcfce7' : '#0D63DB', color: feito ? '#166534' : '#fff', opacity: enviando && enviando !== tipo ? 0.6 : 1 }}>
              {enviando === tipo ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Enviando…</>
                : feito ? <><CheckCircle2 size={15} /> Enviada — tocar para refazer</>
                : <><Camera size={15} /> Tirar foto</>}
            </button>
          </div>
        );
      })}

      {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#dc2626' }}>{erro}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, color: '#94a3b8', marginTop: 16, textAlign: 'center' }}>
        <ShieldCheck size={11} /> Fotos protegidas conforme a LGPD, com acesso restrito
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
