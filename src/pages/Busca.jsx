import React, { useState, useCallback } from 'react';
import { Search, Loader2, Filter, MapPin, ChevronDown, ChevronUp, Globe, Info, ExternalLink } from 'lucide-react';
import PropertyCard from '../components/PropertyCard';
import { buscarImoveis, buscarLeiloeirosEstado } from '../utils/claude';
import { saveBuscaRecente, loadBuscasRecentes } from '../utils/storage';

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const JUCE = {
  SP:'https://www.jucesp.sp.gov.br/Servicos/LeiloeirosPublicosOficiais',
  RJ:'https://www.jucerj.rj.gov.br/index.php/relacao-de-leiloeiros',
  MG:'https://www.jucemg.mg.gov.br/leiloeiros',
  BA:'https://www.juceb.ba.gov.br/servicos/leiloeiros',
  PR:'https://www.jucepar.pr.gov.br/Pagina/Leiloeiros',
  RS:'https://www.jucergs.rs.gov.br',
  PE:'https://www.jucepe.pe.gov.br',
};

const PLATAFORMAS = [
  { nome: 'Caixa Econômica Federal', url: 'https://venda-imoveis.caixa.gov.br', desc: 'Maior acervo de imóveis no país' },
  { nome: 'Sold Leilões', url: 'https://www.sold.com.br', desc: 'Judicial e extrajudicial' },
  { nome: 'Biasi Leilões', url: 'https://www.biasi.com.br', desc: 'Referência nacional' },
  { nome: 'Zukerman Leilões', url: 'https://www.zukerman.com.br', desc: 'Foco SP/RJ' },
  { nome: 'REM Leilões', url: 'https://www.remleiloes.com.br', desc: 'Multi-estado' },
  { nome: 'Frazão Leilões', url: 'https://www.frazaoleiloes.com.br', desc: 'Nordeste' },
  { nome: 'Resale', url: 'https://www.resale.com.br', desc: 'Creditas Imóveis' },
  { nome: 'Leilão Judicial Online', url: 'https://www.leilaojudicialonline.com.br', desc: 'Processos judiciais' },
];

export default function Busca() {
  const [filtros, setFiltros] = useState({
    tipo: '', estado: '', cidade: '', valorMin: '', valorMax: '',
    modalidade: '', pagamento: [], dataInicio: '', dataFim: '',
  });
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingLeiloeiros, setLoadingLeiloeiros] = useState(false);
  const [leiloeiros, setLeiloeiros] = useState(null);
  const [erro, setErro] = useState('');
  const [buscaFeita, setBuscaFeita] = useState(false);
  const [showFiltros, setShowFiltros] = useState(true);
  const [showJuce, setShowJuce] = useState(false);

  const up = (name, val) => setFiltros(p => ({ ...p, [name]: val }));
  const togglePagamento = (v) => up('pagamento', filtros.pagamento.includes(v) ? filtros.pagamento.filter(x => x !== v) : [...filtros.pagamento, v]);

  const buscar = async () => {
    if (!filtros.estado && !filtros.cidade && !filtros.tipo) {
      setErro('Informe pelo menos o estado, cidade ou tipo de imóvel.'); return;
    }
    setErro(''); setLoading(true); setBuscaFeita(true);
    saveBuscaRecente(filtros);
    try {
      const res = await buscarImoveis(filtros);
      setResultados(res);
      if (res.length === 0) setErro('Nenhum resultado encontrado. Tente ampliar os filtros.');
    } catch (e) {
      setErro('Erro na busca. Verifique a chave de API e tente novamente.');
      console.error(e);
    }
    setLoading(false);
  };

  const buscarLeiloeiros = async () => {
    if (!filtros.estado) { setErro('Selecione um estado para buscar os leiloeiros credenciados.'); return; }
    setLoadingLeiloeiros(true);
    try {
      const res = await buscarLeiloeirosEstado(filtros.estado);
      setLeiloeiros(res);
    } catch { setErro('Não foi possível buscar os leiloeiros.'); }
    setLoadingLeiloeiros(false);
  };

  const SelectField = ({ label, name, opts, value }) => (
    <div>
      <label style={lbl}>{label}</label>
      <select value={value} onChange={e => up(name, e.target.value)} style={inp}>
        <option value="">Todos</option>
        {opts.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  const lbl = { fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };
  const inp = { width: '100%', padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#0f172a', boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px', display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, alignItems: 'start' }}>

      {/* SIDEBAR */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <button onClick={() => setShowFiltros(!showFiltros)} style={{ width: '100%', padding: '14px 18px', background: '#0f172a', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Filter size={15}/> Filtros de Busca</span>
            {showFiltros ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
          </button>
          {showFiltros && (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SelectField label="Tipo de Imóvel" name="tipo" value={filtros.tipo} opts={[['casa','Casa'],['apartamento','Apartamento'],['terreno','Terreno/Lote'],['comercial','Comercial']]} />
              <SelectField label="Modalidade" name="modalidade" value={filtros.modalidade} opts={[['judicial','Judicial'],['extrajudicial','Extrajudicial']]} />
              <SelectField label="Estado (UF)" name="estado" value={filtros.estado} opts={ESTADOS.map(e=>[e,e])} />
              <div>
                <label style={lbl}>Cidade</label>
                <input value={filtros.cidade} onChange={e => up('cidade', e.target.value)} placeholder="Ex: São Paulo" style={inp} />
              </div>
              <div>
                <label style={lbl}>Faixa de Valor (R$)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input type="number" value={filtros.valorMin} onChange={e => up('valorMin', e.target.value)} placeholder="Mínimo" style={inp} />
                  <input type="number" value={filtros.valorMax} onChange={e => up('valorMax', e.target.value)} placeholder="Máximo" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Forma de Pagamento</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[['aVista','À Vista'],['financiado','Financiado'],['hipotecado','Hipotecado']].map(([v,l]) => (
                    <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#334155' }}>
                      <input type="checkbox" checked={filtros.pagamento.includes(v)} onChange={() => togglePagamento(v)} style={{ width: 15, height: 15 }} />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label style={lbl}>Período do Leilão</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input type="date" value={filtros.dataInicio} onChange={e => up('dataInicio', e.target.value)} style={inp} />
                  <input type="date" value={filtros.dataFim} onChange={e => up('dataFim', e.target.value)} style={inp} />
                </div>
              </div>
              {erro && <div style={{ padding: '8px 12px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{erro}</div>}
              <button onClick={buscar} disabled={loading}
                style={{ width: '100%', padding: '11px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {loading ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }}/> Buscando...</> : <><Search size={15}/> Buscar Agora</>}
              </button>
            </div>
          )}
        </div>

        {/* Leiloeiros por Estado */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <button onClick={() => setShowJuce(!showJuce)} style={{ width: '100%', padding: '12px 16px', background: '#f8fafc', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: 13, color: '#334155' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Globe size={14}/> Leiloeiros Credenciados</span>
            {showJuce ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
          </button>
          {showJuce && (
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 11, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                Leiloeiros oficiais são registrados nas Juntas Comerciais estaduais (JUCESP, JUCERJ, etc.).
              </p>
              {filtros.estado && JUCE[filtros.estado] && (
                <a href={JUCE[filtros.estado]} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                  <ExternalLink size={12}/> Ver lista JUCE{filtros.estado}
                </a>
              )}
              <button onClick={buscarLeiloeiros} disabled={loadingLeiloeiros || !filtros.estado}
                style={{ padding: '8px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: !filtros.estado ? 0.5 : 1 }}>
                {loadingLeiloeiros ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> : <Search size={13}/>}
                {filtros.estado ? `Buscar leiloeiros no ${filtros.estado}` : 'Selecione um estado'}
              </button>
              {leiloeiros && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                  {(leiloeiros.leiloeiros || []).map((l, i) => (
                    <div key={i} style={{ padding: '8px 10px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{l.nome}</div>
                      {l.especialidade && <div style={{ fontSize: 10, color: '#64748b' }}>{l.especialidade}</div>}
                      {l.site && <a href={l.site} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#2563eb', textDecoration: 'none' }}>{l.site}</a>}
                    </div>
                  ))}
                  {leiloeiros.fonteJunta && <a href={leiloeiros.fonteJunta} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#94a3b8', textDecoration: 'none' }}>Fonte: Junta Comercial</a>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>Busca de Imóveis em Leilão</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              {buscaFeita ? `${resultados.length} imóvel(is) encontrado(s)` : 'Configure os filtros e inicie a busca por IA'}
            </p>
          </div>
          {loading && <Loader2 size={20} color="#2563eb" style={{ animation: 'spin 1s linear infinite' }}/>}
        </div>

        {!buscaFeita && (
          <>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '14px 18px', display: 'flex', gap: 10 }}>
              <Info size={16} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }}/>
              <div style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
                <strong>Como funciona a busca:</strong> A IA pesquisa leilões ativos em plataformas como Caixa Econômica, Sold, Biasi, Zukerman, REM, Frazão e leiloeiros credenciados pelas Juntas Comerciais estaduais. Configure os filtros ao lado e clique em <strong>Buscar Agora</strong>.
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 12px' }}>Principais Plataformas de Leilão</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {PLATAFORMAS.map(p => (
                  <a key={p.nome} href={p.url} target="_blank" rel="noopener noreferrer"
                    style={{ background: 'white', borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 14px', textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 4, transition: 'border-color 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#2563eb'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.nome} <ExternalLink size={11} color="#94a3b8"/>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.desc}</div>
                  </a>
                ))}
              </div>
            </div>
          </>
        )}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: 180, background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', animation: 'pulse 1.5s ease-in-out infinite' }}/>
            ))}
          </div>
        )}

        {!loading && resultados.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {resultados.map(im => <PropertyCard key={im.id} imovel={im} />)}
          </div>
        )}

        {buscaFeita && !loading && resultados.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 14, border: '1px solid #e2e8f0' }}>
            <Search size={40} color="#94a3b8" style={{ margin: '0 auto 16px' }}/>
            <h3 style={{ color: '#334155', fontWeight: 800, margin: '0 0 8px' }}>Nenhum resultado encontrado</h3>
            <p style={{ color: '#94a3b8', fontSize: 14 }}>Tente ampliar os filtros ou alterar a localização.</p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        @media (max-width: 768px) {
          div[style*='gridTemplateColumns: 300px'] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
