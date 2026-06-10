import React, { useState, useEffect, useCallback } from 'react';
import Portfolio from './components/Portfolio';
import ImovelEditor from './components/ImovelEditor';
import { loadImoveis, saveImoveis, generateId } from './utils/storage';
import { Briefcase, LayoutDashboard, PlusCircle, ChevronLeft } from 'lucide-react';

const IMOVEL_PADRAO = {
  id: '', nome: '', endereco: '', editalLink: '', editalFile: null,
  matriculaTexto: '', editalTexto: '',
  objetivoCompra: 'investimento', tipoImovel: 'apartamento', status: 'analise',
  origem: 'extrajudicial', somenteAVista: false, tabelaAmortizacao: 'sac',
  taxaLeiloeiroPercentual: 5, valorAvaliacao: 0, valorArrematacao: 0,
  areaM2: 0, areaTerrenoM2: 0, valorMercado: 0, valorLocacao: 0,
  manutencaoEstimada: 0, prazoReformaMeses: 3, debitosAssumidos: 0,
  iptuMensal: 0, condominioMensal: 0, itbiPercentual: 3,
  laudemio: 0, foreiro: 0,
  sinalPercentual: 5, prazoMeses: 360, cetAnual: 12, prazoVendaMeses: 12,
  observacoes: '', riscos: [], lancamentos: [],
  aiAnalysis: '', createdAt: '', updatedAt: '',
};

export default function App() {
  const [imoveis, setImoveis] = useState([]);
  const [view, setView] = useState('portfolio'); // 'portfolio' | 'editor'
  const [imovelAtivo, setImovelAtivo] = useState(null);

  useEffect(() => { setImoveis(loadImoveis()); }, []);

  const salvarImovel = useCallback((data) => {
    const now = new Date().toISOString();
    setImoveis(prev => {
      const idx = prev.findIndex(i => i.id === data.id);
      const updated = idx >= 0
        ? prev.map(i => i.id === data.id ? { ...data, updatedAt: now } : i)
        : [...prev, { ...data, updatedAt: now }];
      saveImoveis(updated);
      return updated;
    });
    setImovelAtivo(data);
  }, []);

  const novoImovel = () => {
    const novo = { ...IMOVEL_PADRAO, id: generateId(), createdAt: new Date().toISOString() };
    setImovelAtivo(novo);
    setView('editor');
  };

  const abrirImovel = (imovel) => { setImovelAtivo(imovel); setView('editor'); };

  const excluirImovel = (id) => {
    setImoveis(prev => { const u = prev.filter(i => i.id !== id); saveImoveis(u); return u; });
    if (imovelAtivo?.id === id) { setView('portfolio'); setImovelAtivo(null); }
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", minHeight: '100vh', background: '#f1f5f9' }}>
      {/* Header */}
      <header style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {view === 'editor' && (
              <button onClick={() => setView('portfolio')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '4px 8px', borderRadius: 6 }}>
                <ChevronLeft size={16} /> Portfólio
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: '#2563eb', borderRadius: 8, padding: '6px 8px', display: 'flex' }}>
                <Briefcase size={20} color="white" />
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: 900, fontSize: 18, lineHeight: 1 }}>TSN ATIVOS</div>
                <div style={{ color: '#64748b', fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Aquisição em Leilão & Investimentos</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {view === 'portfolio' && (
              <button onClick={novoImovel} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <PlusCircle size={15} /> Novo Imóvel
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      {view === 'portfolio' ? (
        <Portfolio imoveis={imoveis} onAbrir={abrirImovel} onNovo={novoImovel} onExcluir={excluirImovel} />
      ) : (
        <ImovelEditor
          key={imovelAtivo?.id}
          imovel={imovelAtivo}
          onSalvar={salvarImovel}
          onExcluir={() => excluirImovel(imovelAtivo?.id)}
          onVoltar={() => setView('portfolio')}
        />
      )}
    </div>
  );
}
