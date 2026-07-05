import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { Loader2, Target, X } from 'lucide-react';

// Triagem do investidor — modal ONE-TIME no 1º acesso do cliente. Define o perfil-base
// que direciona os agentes e prioriza o enriquecimento pelas cidades de interesse.
// Não aparece para equipe/admin nem depois de respondida (perfis.triagem_em).
const PERFIS = [
  ['revenda', '🔁 Comprar para revender', 'Arremato e revendo (flip) — foco em margem e liquidez de saída.'],
  ['locacao', '🏠 Comprar para alugar', 'Arremato e coloco para locação — foco em renda e yield.'],
  ['uso_proprio', '🔑 Comprar para uso', 'Para morar ou usar no meu negócio — foco em economia e adequação.'],
  ['incorporacao', '🏗️ Comprar para incorporar', 'Terreno/imóvel para construir e vender — foco em potencial construtivo.'],
];
const FAIXAS = [
  ['ate_150k', 'Até R$ 150 mil'],
  ['150_400k', 'R$ 150 a 400 mil'],
  ['400k_1mi', 'R$ 400 mil a 1 milhão'],
  ['acima_1mi', 'Acima de R$ 1 milhão'],
];
const PAGAMENTO = [
  ['a_vista', 'À vista'],
  ['financiado', 'Financiado'],
  ['avaliando', 'Ainda avaliando'],
];
const CONSORCIO = [
  ['tem', 'Já tenho consórcio'],
  ['quero', 'Tenho interesse em consórcio'],
  ['nao', 'Não'],
];
const EXPERIENCIA = [
  ['primeira', 'Primeira vez'],
  ['1_2', 'Já arrematei 1–2'],
  ['recorrente', 'Investidor recorrente'],
];

const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];

export default function TriagemPerfil({ userId }) {
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [f, setF] = useState({ perfil_investidor: '', faixa_capital: '', forma_pagamento: '', consorcio_interesse: '', experiencia_leilao: '', cidade: '', uf: '', raio_km: '50' });

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    supabase.from('perfis').select('role, triagem_em, perfil_investidor').eq('id', userId).single()
      .then(({ data }) => {
        if (!vivo || !data) return;
        // Só cliente e só quem ainda não respondeu.
        if (ROLES_CLIENTE.includes(data.role) && !data.triagem_em && !data.perfil_investidor) setMostrar(true);
      });
    return () => { vivo = false; };
  }, [userId]);

  if (!mostrar) return null;

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const podeSalvar = f.perfil_investidor && f.faixa_capital && f.forma_pagamento && f.consorcio_interesse && f.experiencia_leilao;

  const salvar = async () => {
    setSalvando(true);
    const cidades = f.cidade.trim()
      ? [{ cidade: f.cidade.trim(), uf: f.uf.trim().toUpperCase(), raio_km: Number(f.raio_km) || 50 }]
      : [];
    await supabase.from('perfis').update({
      perfil_investidor: f.perfil_investidor,
      faixa_capital: f.faixa_capital,
      forma_pagamento: f.forma_pagamento,
      consorcio_interesse: f.consorcio_interesse,
      experiencia_leilao: f.experiencia_leilao,
      cidades_interesse: cidades,
      triagem_em: new Date().toISOString(),
    }).eq('id', userId);
    setSalvando(false);
    setMostrar(false);
  };

  const depois = () => setMostrar(false); // fecha na sessão; volta a perguntar no próximo acesso

  const grupo = (titulo, campo, opts, cols = 2) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 8 }}>{titulo}</div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
        {opts.map(([v, label, desc]) => {
          const sel = f[campo] === v;
          return (
            <button key={v} onClick={() => set(campo, v)}
              style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                border: sel ? '2px solid #0D63DB' : '1px solid #e2e8f0', background: sel ? '#eff6ff' : 'white' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: sel ? '#0D63DB' : '#111' }}>{label}</div>
              {desc && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, lineHeight: 1.4 }}>{desc}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 18, padding: 24, width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Target size={19} color="#0D63DB" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#111' }}>Vamos personalizar suas análises</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>Rápido (30s). Isso direciona os relatórios ao seu objetivo e prioriza os imóveis nas suas cidades.</div>
          </div>
          <button onClick={depois} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ marginTop: 16 }}>
          {grupo('1. Qual seu objetivo principal ao arrematar?', 'perfil_investidor', PERFIS, 2)}
          {grupo('2. Faixa de capital para arrematar', 'faixa_capital', FAIXAS, 2)}
          {grupo('3. Forma de pagamento pretendida', 'forma_pagamento', PAGAMENTO, 3)}
          {grupo('4. Consórcio (nós te conectamos a um parceiro)', 'consorcio_interesse', CONSORCIO, 3)}
          {grupo('5. Sua experiência com leilão', 'experiencia_leilao', EXPERIENCIA, 3)}

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 8 }}>6. Cidade/região de interesse (opcional)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={f.cidade} onChange={e => set('cidade', e.target.value)} placeholder="Cidade"
                style={{ flex: 2, minWidth: 140, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
              <input value={f.uf} onChange={e => set('uf', e.target.value.slice(0, 2))} placeholder="UF" maxLength={2}
                style={{ width: 60, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, textTransform: 'uppercase' }} />
              <select value={f.raio_km} onChange={e => set('raio_km', e.target.value)}
                style={{ width: 120, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}>
                <option value="25">Raio 25 km</option>
                <option value="50">Raio 50 km</option>
                <option value="100">Raio 100 km</option>
                <option value="200">Raio 200 km</option>
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={depois} style={{ flex: 1, padding: '11px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Agora não</button>
          <button onClick={salvar} disabled={!podeSalvar || salvando}
            style={{ flex: 2, padding: '11px', background: podeSalvar ? '#0D63DB' : '#e2e8f0', color: podeSalvar ? 'white' : '#94a3b8', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: podeSalvar ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {salvando ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</> : 'Salvar e personalizar'}
          </button>
        </div>
      </div>
    </div>
  );
}
