import React, { useEffect, useState, useRef } from 'react';
import { buscarTodasCidades } from '../data/cidades';

// Autocomplete de cidade que JÁ resolve a UF a partir da base do IBGE ("Cidade - UF").
// Substitui o campo livre de cidade + o campo separado de UF (que o cliente deixava
// vazio, gravando cidade sem estado e quebrando os filtros da Busca). Ao escolher,
// devolve onSelect({ cidade, uf }). Sem digitação livre de UF, sem erro de grafia.
// Remove acentos de forma robusta (faixa Unicode dos diacríticos combinantes, via
// escape — não depende de caracteres combinantes literais no fonte, que podem se
// corromper). Assim "vitória" e "vitoria" batem igual.
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function CidadeAutocomplete({ value = '', onSelect, placeholder = 'Digite a cidade…', style }) {
  const [q, setQ] = useState(value);
  const [todas, setTodas] = useState([]);
  const [sugestoes, setSugestoes] = useState([]);
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => { buscarTodasCidades().then(l => setTodas(Array.isArray(l) ? l : [])); }, []);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => {
    const t = norm(q).trim();
    if (t.length < 2) { setSugestoes([]); return; }
    // RANKING: sem ordenar, "Vitória - ES" ficava fora do top 8 (perdia para
    // "Manoel Vitorino", "Porto Vitória" etc.) e o cliente achava que o acento
    // "quebrava" a busca. Prioriza nome exato > começa com > contém no nome > contém.
    const scored = [];
    for (const c of todas) {
      const nc = norm(c);
      const nomeCidade = norm(c.split(' - ')[0]); // parte antes da UF
      let score;
      if (nomeCidade === t) score = 0;
      else if (nomeCidade.startsWith(t)) score = 1;
      else if (nc.startsWith(t)) score = 2;
      else if (nomeCidade.includes(t)) score = 3;
      else if (nc.includes(t)) score = 4;
      else continue;
      scored.push({ c, score });
    }
    scored.sort((a, b) => a.score - b.score || a.c.localeCompare(b.c, 'pt-BR'));
    setSugestoes(scored.slice(0, 8).map(s => s.c));
  }, [q, todas]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const escolher = (item) => {
    const m = item.match(/^(.*?)\s*-\s*([A-Za-z]{2})$/);
    const cidade = m ? m[1].trim() : item.trim();
    const uf = m ? m[2].toUpperCase() : '';
    setQ(item);
    setAberto(false);
    onSelect?.({ cidade, uf });
  };

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <input value={q} onFocus={() => setAberto(true)} onChange={e => { setQ(e.target.value); setAberto(true); onSelect?.({ cidade: e.target.value, uf: '' }); }}
        placeholder={placeholder}
        style={{ width: '100%', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, background: 'white', color: '#111', boxSizing: 'border-box' }} />
      {aberto && sugestoes.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', maxHeight: 240, overflowY: 'auto' }}>
          {sugestoes.map(item => (
            <button key={item} type="button" onMouseDown={() => escolher(item)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'white', cursor: 'pointer', fontSize: 13.5, color: '#334155' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
