import { useEffect, useRef, useState } from 'react';

// CAMPO DE VÁRIOS E-MAILS (25/09, pedido do dono: "como coloco os 3 e-mails do escritório?").
// Cada endereço vira uma etiqueta ao apertar Tab/Enter/vírgula/ponto e vírgula/espaço, ao sair do
// campo, ao terminar em ".com.br" — e ao terminar em ".com" se a pessoa não continuar com ".br"
// em ~0,9 s. Colar uma lista ("a@x.com; b@y.com.br") separa sozinho. Backspace com o campo vazio
// apaga a última etiqueta. Endereço inválido não vira etiqueta: fica no campo, em vermelho.
//
// O pai recebe em `onChange` a lista que SAIRIA agora = etiquetas + o texto digitado se ele já for
// um e-mail válido. Sem isso, clicar em "Enviar" logo depois de digitar mandaria sem o último
// endereço (o blur que o travaria chega depois do clique ler o estado).
// `valorInicial` só vale na montagem (remonte com `key` para trocar a lista vinda de fora).
export const RE_EMAIL_UNICO = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]{2,}$/;
const SEPARADORES = /[\s,;]+/;

export function separarEmails(v) {
  return [...new Set(String(v || '').split(SEPARADORES).map(s => s.trim().toLowerCase()).filter(Boolean))];
}

export default function CampoEmails({ valorInicial = [], onChange, placeholder = 'email@escritorio.com.br', autoFocus = false, style }) {
  const [emails, setEmails] = useState(() => separarEmails([].concat(valorInicial).join(',')).filter(e => RE_EMAIL_UNICO.test(e)));
  const [texto, setTexto] = useState('');
  const timer = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    const t = texto.trim().toLowerCase();
    const lista = RE_EMAIL_UNICO.test(t) && !emails.includes(t) ? [...emails, t] : emails;
    onChange?.(lista);
  }, [emails, texto]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);

  // Trava o que estiver digitado; o que não for e-mail válido fica no campo para corrigir.
  function travar(bruto = texto) {
    const partes = separarEmails(bruto);
    if (!partes.length) { setTexto(''); return; }
    const validos = partes.filter(p => RE_EMAIL_UNICO.test(p));
    const invalidos = partes.filter(p => !RE_EMAIL_UNICO.test(p));
    if (validos.length) setEmails(prev => [...new Set([...prev, ...validos])]);
    setTexto(invalidos.join(' '));
  }

  function aoDigitar(v) {
    clearTimeout(timer.current);
    if (SEPARADORES.test(v)) { travar(v); return; }         // colou uma lista ou digitou separador
    if (/\.com\.br$/i.test(v) && RE_EMAIL_UNICO.test(v)) { travar(v); return; }
    setTexto(v);
    if (/\.com$/i.test(v) && RE_EMAIL_UNICO.test(v)) timer.current = setTimeout(() => travar(v), 900);
  }

  function aoTeclar(e) {
    if (['Enter', 'Tab', ',', ';'].includes(e.key) && texto.trim()) {
      if (e.key !== 'Tab' || RE_EMAIL_UNICO.test(texto.trim())) e.preventDefault(); // Tab com e-mail válido trava e fica no campo
      travar();
    } else if (e.key === 'Backspace' && !texto && emails.length) {
      setEmails(prev => prev.slice(0, -1));
    }
  }

  const invalido = texto.trim() && !RE_EMAIL_UNICO.test(texto.trim());
  return (
    <div onClick={() => input.current?.focus()}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '6px 8px', borderRadius: 8, border: `1px solid ${invalido ? '#fca5a5' : '#e2e8f0'}`, background: 'white', cursor: 'text', minHeight: 38, boxSizing: 'border-box', width: '100%', ...style }}>
      {emails.map(e => (
        <span key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 14, padding: '2px 8px', fontSize: 12.5, fontWeight: 600, maxWidth: '100%', overflowWrap: 'anywhere' }}>
          {e}
          <button type="button" aria-label={`Remover ${e}`} onClick={(ev) => { ev.stopPropagation(); setEmails(prev => prev.filter(x => x !== e)); }}
            style={{ background: 'none', border: 'none', color: '#1e40af', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
        </span>
      ))}
      <input ref={input} value={texto} autoFocus={autoFocus} onChange={e => aoDigitar(e.target.value)} onKeyDown={aoTeclar} onBlur={() => travar()}
        placeholder={emails.length ? 'outro e-mail…' : placeholder} inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        style={{ flex: '1 1 160px', minWidth: 120, border: 'none', outline: 'none', fontSize: 13, padding: '4px 2px', background: 'transparent', color: invalido ? '#b91c1c' : '#111' }} />
    </div>
  );
}
