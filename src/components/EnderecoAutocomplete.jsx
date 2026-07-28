import React from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

/**
 * Autocomplete de endereço estilo Google (o mesmo do Plans & Billing do Anthropic).
 * Você digita "alameda dourada 71" e escolhe o endereço completo; ao selecionar, chama
 * onSelect({ logradouro, numero, bairro, cidade, uf, cep, lat, lng, formatado }).
 *
 * Reusável: consulta do Índice, checkout/cobrança, cadastro de endereço do usuário.
 * A chave do Google fica no servidor (proxy /api/endereco-autocomplete). sessiontoken
 * agrupa a busca + o detalhe numa única sessão de cobrança do Google (economia).
 *
 * Props: onSelect(endereco), onType(textoDigitado), placeholder, defaultValue, disabled, inputStyle.
 * onType (opcional) recebe o texto CRU a cada tecla — para casos em que o valor digitado à mão
 * também precisa valer (ex.: contrato, onde o endereço é obrigatório mesmo sem escolher a sugestão).
 */
export default function EnderecoAutocomplete({ onSelect, onType, placeholder = 'Digite o endereço (rua e número)…', defaultValue = '', disabled = false, inputStyle = {} }) {
  const [q, setQ] = React.useState(defaultValue);
  const [sugestoes, setSugestoes] = React.useState([]);
  const [aberto, setAberto] = React.useState(false);
  const [carregando, setCarregando] = React.useState(false);
  const [indice, setIndice] = React.useState(-1);
  const tokenRef = React.useRef(null);
  const timerRef = React.useRef(null);
  const boxRef = React.useRef(null);

  const novoToken = () => {
    try { tokenRef.current = crypto.randomUUID(); } catch { tokenRef.current = String(Date.now()) + Math.random().toString(16).slice(2); }
  };

  React.useEffect(() => {
    const fora = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const buscar = (texto) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!texto || texto.trim().length < 3) { setSugestoes([]); setAberto(false); return; }
    if (!tokenRef.current) novoToken();
    timerRef.current = setTimeout(async () => {
      setCarregando(true);
      try {
        const r = await apiCall('/api/endereco-autocomplete', { method: 'POST', body: JSON.stringify({ q: texto, sessiontoken: tokenRef.current }) });
        const d = await r.json().catch(() => ({}));
        setSugestoes(Array.isArray(d.sugestoes) ? d.sugestoes : []);
        setAberto(true); setIndice(-1);
      } catch { setSugestoes([]); }
      setCarregando(false);
    }, 320);
  };

  const escolher = async (s) => {
    setQ(s.texto); setAberto(false); setSugestoes([]);
    setCarregando(true);
    try {
      const r = await apiCall('/api/endereco-autocomplete', { method: 'POST', body: JSON.stringify({ place_id: s.id, sessiontoken: tokenRef.current }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok && d.endereco) onSelect?.(d.endereco);
    } catch { /* silencioso: usuário pode preencher manual */ }
    setCarregando(false);
    tokenRef.current = null; // encerra a sessão de cobrança do Google
  };

  const onKey = (e) => {
    if (!aberto || !sugestoes.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndice((i) => Math.min(i + 1, sugestoes.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndice((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && indice >= 0) { e.preventDefault(); escolher(sugestoes[indice]); }
    else if (e.key === 'Escape') setAberto(false);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <MapPin size={16} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          value={q} disabled={disabled}
          onChange={(e) => { setQ(e.target.value); buscar(e.target.value); onType?.(e.target.value); }}
          onFocus={() => { if (sugestoes.length) setAberto(true); }}
          onKeyDown={onKey}
          placeholder={placeholder}
          style={{ width: '100%', padding: '11px 36px 11px 36px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', ...inputStyle }}
        />
        {carregando && <Loader2 size={16} color="#0D63DB" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', animation: 'spin 1s linear infinite' }} />}
      </div>
      {aberto && sugestoes.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          {sugestoes.map((s, i) => (
            <div key={s.id} onMouseDown={(e) => { e.preventDefault(); escolher(s); }}
              onMouseEnter={() => setIndice(i)}
              style={{ padding: '10px 14px', cursor: 'pointer', background: i === indice ? '#eff6ff' : 'white', borderTop: i ? '1px solid #f1f5f9' : 'none', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <MapPin size={15} color="#0D63DB" style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.principal}</div>
                {s.secundario && <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.secundario}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
