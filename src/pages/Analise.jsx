import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  UploadCloud, FileText, Loader2, Sparkles, BarChart3, ShieldAlert,
  TrendingUp, Calculator, CheckCircle2, XCircle, AlertTriangle,
  Gavel, DollarSign, Printer, Save, ChevronDown, ChevronUp, Plus, Trash2, Info
} from 'lucide-react';
import { extrairDadosDocumento, analisarMercado, gerarParecer } from '../utils/claude';
import { calcularMetricasCenario, calcularTetoLance, calcularSAC, calcularPrice, fmt, fmtPct } from '../utils/calculos';
import { loadImoveis, saveImoveis, generateId } from '../utils/storage';
import TabelaAmortizacao from '../components/TabelaAmortizacao';
import RiscoJuridico from '../components/RiscoJuridico';
import Lancamentos from '../components/Lancamentos';
import { gerarPDF } from '../components/RelatorioPDF';

const VAZIO = {
  id: '', nome: '', tipo: 'apartamento', endereco: '', cidade: '', estado: '', cep: '',
  objetivoCompra: 'investimento', status: 'analise', origem: 'extrajudicial',
  somenteAVista: false, tabelaAmortizacao: 'sac', leiloeiro: '', dataLeilao: '',
  taxaLeiloeiroPercentual: 5, valorAvaliacao: 0, valorArrematacao: 0,
  areaM2: 0, areaTerrenoM2: 0, valorMercado: 0, valorLocacao: 0,
  manutencaoEstimada: 0, prazoReformaMeses: 3, debitosAssumidos: 0,
  iptuMensal: 0, condominioMensal: 0, itbiPercentual: 3,
  laudemio: 0, foreiro: 0, sinalPercentual: 5, prazoMeses: 360,
  cetAnual: 12, prazoVendaMeses: 12, observacoes: '', riscos: [], lancamentos: '',
};

const STATUS_OPTS = [
  ['analise','Em Análise'],['aprovado','Aprovado'],['arrematado','Arrematado'],
  ['em_reforma','Em Reforma'],['venda','À Venda'],['alugado','Alugado'],
  ['concluido','Concluído'],['reprovado','Reprovado'],
];

export default function Analise() {
  const location = useLocation();
  const imovelInicial = location.state?.imovel;

  const [d, setD] = useState(() => {
    if (imovelInicial) {
      return {
        ...VAZIO, id: generateId(), nome: imovelInicial.titulo || '',
        tipo: imovelInicial.tipo || 'apartamento',
        endereco: imovelInicial.endereco || '',
        cidade: imovelInicial.cidade || '', estado: imovelInicial.estado || '',
        valorAvaliacao: imovelInicial.valorAvaliacao || 0,
        valorArrematacao: imovelInicial.valorMinimo || 0,
        areaM2: imovelInicial.areaM2 || 0, leiloeiro: imovelInicial.leiloeiro || '',
        dataLeilao: imovelInicial.dataLeilao || '',
        origem: imovelInicial.modalidade || 'extrajudicial',
        somenteAVista: !imovelInicial.pagamento?.includes('financiado'),
      };
    }
    return { ...VAZIO, id: generateId() };
  });

  const [textoDoc, setTextoDoc] = useState('');
  const [cenario, setCenario] = useState('financiado');
  const [mercado, setMercado] = useState(null);
  const [parecer, setParecer] = useState('');
  const [loadDoc, setLoadDoc] = useState(false);
  const [loadMercado, setLoadMercado] = useState(false);
  const [loadParecer, setLoadParecer] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showFluxo, setShowFluxo] = useState(false);
  const [activeTab, setActiveTab] = useState('dados');
  const [msg, setMsg] = useState({ text: '', type: '' });

  const up = useCallback((name, val) => setD(p => ({ ...p, [name]: val })), []);
  const upN = useCallback((e) => {
    const { name, value } = e.target;
    const texts = ['nome','tipo','endereco','cidade','estado','cep','objetivoCompra','origem','status','tabelaAmortizacao','leiloeiro','dataLeilao','observacoes'];
    setD(p => ({ ...p, [name]: texts.includes(name) ? value : (parseFloat(value) || 0) }));
  }, []);

  const isAVista = cenario === 'aVista' || d.somenteAVista;
  const isUsoProprio = d.objetivoCompra === 'uso_proprio';
  const META = isUsoProprio ? 0 : 40;

  const metricas = useMemo(() => calcularMetricasCenario(d, d.valorArrematacao || 0, isAVista), [d, isAVista]);
  const teto = useMemo(() => calcularTetoLance(d, isAVista, META, d.valorMercado || 0), [d, isAVista, META]);
  const metricasTeto = useMemo(() => calcularMetricasCenario(d, teto, isAVista), [d, teto, isAVista]);
  const isViavel = isUsoProprio ? true : metricas.roi >= META;

  const sacTab = useMemo(() => {
    const principal = (d.valorArrematacao || 0) * (1 - (d.sinalPercentual || 0) / 100);
    return calcularSAC(principal, d.cetAnual || 0, d.prazoMeses || 0);
  }, [d.valorArrematacao, d.sinalPercentual, d.cetAnual, d.prazoMeses]);

  const priceTab = useMemo(() => {
    const principal = (d.valorArrematacao || 0) * (1 - (d.sinalPercentual || 0) / 100);
    return calcularPrice(principal, d.cetAnual || 0, d.prazoMeses || 0);
  }, [d.valorArrematacao, d.sinalPercentual, d.cetAnual, d.prazoMeses]);

  const fluxo = useMemo(() => {
    const pVenda = Number(d.prazoVendaMeses) || 12;
    const pRef = Math.min(Number(d.prazoReformaMeses) || 3, pVenda);
    const parcelaRef = d.manutencaoEstimada > 0 ? (d.manutencaoEstimada / pRef) : 0;
    let saldo = -(isAVista ? metricas.vArremate : metricas.valorSinal) - metricas.taxaLeiloeiro - metricas.honorarios - metricas.itbiRegistro - (d.laudemio || 0) - (d.foreiro || 0);
    const saidaM0 = -saldo;
    const linhas = [{ mes: 0, entrada: 0, saida: saidaM0, descricao: 'Investimento Inicial', saldo }];
    let totalSaidas = saidaM0;
    for (let i = 1; i <= pVenda; i++) {
      let saida = (d.iptuMensal || 0) + (d.condominioMensal || 0);
      const parts = [];
      if (saida > 0) parts.push('Carrego');
      if (!isAVista && i <= (d.prazoMeses || 0)) { saida += metricas.parcelaMedia; parts.push('Parcela Banco'); }
      if (i === 1 && d.debitosAssumidos > 0) { saida += d.debitosAssumidos; parts.push('Débitos'); }
      if (i <= pRef && parcelaRef > 0) { saida += parcelaRef; parts.push('Reforma'); }
      const entrada = i === pVenda ? metricas.receitaLiquida : 0;
      saldo += entrada - saida;
      totalSaidas += saida;
      linhas.push({ mes: i, entrada, saida, descricao: parts.join(' + ') || 'Manutenção', saldo });
    }
    return { linhas, totalSaidas, totalEntradas: metricas.receitaLiquida };
  }, [d, metricas, isAVista]);

  const showMsg = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg({ text: '', type: '' }), 3500); };

  const extrairDoc = async () => {
    if (!textoDoc.trim()) { showMsg('Cole o texto do edital ou matrícula acima.', 'error'); return; }
    setLoadDoc(true);
    try {
      const ext = await extrairDadosDocumento(textoDoc);
      if (ext) {
        setD(p => ({
          ...p, ...ext,
          valorMercado: ext.valorMercado || (ext.valorAvaliacao ? ext.valorAvaliacao * 1.15 : p.valorMercado),
          riscos: ext.riscos ? ext.riscos.map(r => ({ id: Date.now() + Math.random(), texto: r, tipo: r.toLowerCase().includes('usufruto') || r.toLowerCase().includes('bloqueio') || r.toLowerCase().includes('impedimento') ? 'bloqueante' : 'alerta' })) : p.riscos,
        }));
        showMsg('Dados extraídos com sucesso!');
      }
    } catch { showMsg('Erro ao extrair dados.', 'error'); }
    setLoadDoc(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type === 'text/plain') {
      const text = await file.text();
      setTextoDoc(text);
    } else {
      showMsg('Por enquanto, use arquivos .txt ou cole o texto abaixo. Suporte a PDF em breve.', 'error');
    }
  };

  const analisarMercadoClick = async () => {
    if (!d.endereco && !d.cidade) { showMsg('Preencha o endereço ou cidade.', 'error'); return; }
    setLoadMercado(true);
    try {
      const res = await analisarMercado({
        endereco: d.endereco || d.cidade, tipoImovel: d.tipo, areaM2: d.areaM2,
        cidade: d.cidade, estado: d.estado,
        isCondominio: (d.endereco || '').toLowerCase().includes('condomínio') || (d.endereco || '').toLowerCase().includes('residencial'),
      });
      setMercado(res);
      if (res?.precoMedioM2 && d.areaM2) setD(p => ({ ...p, valorMercado: Math.round(res.precoMedioM2 * d.areaM2 * 0.9) }));
      if (res?.aluguelMedio) setD(p => ({ ...p, valorLocacao: Math.round(res.aluguelMedio) }));
      showMsg('Análise de mercado concluída!');
    } catch { showMsg('Erro na análise de mercado.', 'error'); }
    setLoadMercado(false);
  };

  const gerarParecerClick = async () => {
    setLoadParecer(true);
    try {
      const txt = await gerarParecer({ ...d, _cenario: isAVista ? 'À Vista' : 'Alavancado', _teto: teto }, metricas, mercado);
      setParecer(txt);
      setD(p => ({ ...p, parecer: txt }));
      showMsg('Parecer gerado!');
    } catch { showMsg('Erro ao gerar parecer.', 'error'); }
    setLoadParecer(false);
  };

  const salvar = () => {
    const imoveis = loadImoveis();
    const idx = imoveis.findIndex(i => i.id === d.id);
    const entry = { ...d, parecer, mercado, updatedAt: new Date().toISOString() };
    const updated = idx >= 0 ? imoveis.map(i => i.id === d.id ? entry : i) : [...imoveis, entry];
    saveImoveis(updated);
    setSaved(true); showMsg('Imóvel salvo no portfólio!');
    setTimeout(() => setSaved(false), 2000);
  };

  const imprimirPDF = () => gerarPDF({ d, metricas, metricasTeto, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTab, priceTab, mercado, parecer });

  const F = ({ label, name, value, type = 'text', opts = [], rows = 2, ph = '', bold = false }) => {
    const s = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#f8fafc', color: '#0f172a', fontWeight: bold ? 800 : 500, boxSizing: 'border-box' };
    return (
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
        {type === 'select' ? <select name={name} value={value} onChange={upN} style={s}>{opts.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
          : type === 'textarea' ? <textarea name={name} value={value} onChange={upN} rows={rows} placeholder={ph} style={{ ...s, resize: 'vertical' }} />
          : <input name={name} type={type} value={value} onChange={upN} placeholder={ph} style={s} />}
      </div>
    );
  };

  const TABS = [
    { id: 'dados', label: 'Identificação' }, { id: 'valores', label: 'Valores' },
    { id: 'financiamento', label: 'Financiamento' }, { id: 'riscos', label: 'Riscos' },
    { id: 'lancamentos', label: 'Lançamentos' },
  ];

  const riscosBloqueantes = (d.riscos || []).filter(r => r.tipo === 'bloqueante');

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px', display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>

      {/* PAINEL ESQUERDO */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Documento */}
        <div style={{ background: '#0f172a', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b' }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={15} color="#60a5fa" /> Edital / Matrícula
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b' }}>Cole o texto ou faça upload do TXT</p>
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea value={textoDoc} onChange={e => setTextoDoc(e.target.value)} rows={5}
              placeholder="Cole aqui o texto do edital, matrícula ou qualquer documento do imóvel..."
              style={{ width: '100%', padding: '10px', border: '1px solid #334155', borderRadius: 8, background: '#1e293b', color: '#e2e8f0', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <UploadCloud size={14} /> Upload TXT
                <input type="file" accept=".txt" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
              <button onClick={extrairDoc} disabled={loadDoc || !textoDoc.trim()}
                style={{ flex: 1, padding: '8px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: !textoDoc.trim() ? 0.5 : 1 }}>
                {loadDoc ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> : <Sparkles size={13}/>}
                Extrair com IA
              </button>
            </div>
          </div>
        </div>

        {/* Tabs do formulário */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', overflowX: 'auto' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ flex: '0 0 auto', padding: '10px 14px', border: 'none', background: activeTab === t.id ? '#2563eb' : 'transparent', color: activeTab === t.id ? 'white' : '#64748b', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ padding: 16 }}>
            {activeTab === 'dados' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="Status" name="status" value={d.status||'analise'} type="select" opts={STATUS_OPTS} />
                  <F label="Objetivo" name="objetivoCompra" value={d.objetivoCompra} type="select" opts={[['investimento','Investimento'],['uso_proprio','Uso Próprio']]} />
                </div>
                <F label="Nome / Referência" name="nome" value={d.nome||''} ph="Ex: Apt 302 Torre Norte" />
                <F label="Tipo de Imóvel" name="tipo" value={d.tipo} type="select" opts={[['casa','Casa'],['apartamento','Apartamento'],['terreno','Terreno'],['comercial','Comercial']]} />
                <F label="Endereço Completo" name="endereco" value={d.endereco||''} type="textarea" rows={2} />
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                  <F label="Cidade" name="cidade" value={d.cidade||''} />
                  <F label="Estado" name="estado" value={d.estado||''} ph="UF" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="Leiloeiro" name="leiloeiro" value={d.leiloeiro||''} />
                  <F label="Data do Leilão" name="dataLeilao" value={d.dataLeilao||''} type="date" />
                </div>
                <F label="Observações" name="observacoes" value={d.observacoes||''} type="textarea" rows={3} ph="Anotações de visita, pontos de atenção..." />
              </div>
            )}
            {activeTab === 'valores' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="Área Privativa (m²)" name="areaM2" value={d.areaM2||0} type="number" />
                  <F label="Área Terreno (m²)" name="areaTerrenoM2" value={d.areaTerrenoM2||0} type="number" />
                </div>
                <F label="Avaliação Edital (R$)" name="valorAvaliacao" value={d.valorAvaliacao||0} type="number" />
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12 }}>
                  <F label="Lance / Arrematação Base (R$)" name="valorArrematacao" value={d.valorArrematacao||0} type="number" bold />
                </div>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12 }}>
                  <F label="Preço de Mercado / VGV (R$)" name="valorMercado" value={d.valorMercado||0} type="number" bold />
                  <button onClick={analisarMercadoClick} disabled={loadMercado}
                    style={{ width: '100%', marginTop: 8, padding: '8px', background: '#10b981', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {loadMercado ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> : <BarChart3 size={13}/>}
                    Buscar Comparativos de Mercado
                  </button>
                </div>
                <F label="Locação Mensal Ref. (R$)" name="valorLocacao" value={d.valorLocacao||0} type="number" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="IPTU Mensal (R$)" name="iptuMensal" value={d.iptuMensal||0} type="number" />
                  <F label="Condomínio (R$)" name="condominioMensal" value={d.condominioMensal||0} type="number" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="Reforma/Retrofit (R$)" name="manutencaoEstimada" value={d.manutencaoEstimada||0} type="number" />
                  <F label="Prazo Reforma (meses)" name="prazoReformaMeses" value={d.prazoReformaMeses||3} type="number" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <F label="ITBI+Reg (%)" name="itbiPercentual" value={d.itbiPercentual||3} type="number" />
                  <F label="Laudêmio (R$)" name="laudemio" value={d.laudemio||0} type="number" />
                  <F label="Foreiro (R$)" name="foreiro" value={d.foreiro||0} type="number" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="Débitos Assumidos (R$)" name="debitosAssumidos" value={d.debitosAssumidos||0} type="number" />
                  <F label="Taxa Leiloeiro (%)" name="taxaLeiloeiroPercentual" value={d.taxaLeiloeiroPercentual||5} type="number" />
                </div>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Honorários Jurídicos TSN (fixo 10%)</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#15803d' }}>R$ {fmt((d.valorArrematacao||0)*0.10, 0)}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="Prazo p/ Venda (meses)" name="prazoVendaMeses" value={d.prazoVendaMeses||12} type="number" />
                  <F label="Modalidade" name="origem" value={d.origem||'extrajudicial'} type="select" opts={[['extrajudicial','Extrajudicial'],['judicial','Judicial']]} />
                </div>
              </div>
            )}
            {activeTab === 'financiamento' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: d.somenteAVista ? 0.6 : 1, pointerEvents: d.somenteAVista ? 'none' : 'auto' }}>
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#c2410c' }}>Somente À Vista</label>
                  <select value={d.somenteAVista ? 'sim' : 'nao'} onChange={e => up('somenteAVista', e.target.value === 'sim')}
                    style={{ fontSize: 12, fontWeight: 700, border: '1px solid #fed7aa', borderRadius: 8, padding: '4px 8px', background: 'white' }}>
                    <option value="nao">Permite Financiamento</option>
                    <option value="sim">Exclusivamente à Vista</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <F label="Sinal (%)" name="sinalPercentual" value={d.sinalPercentual||5} type="number" />
                  <F label="Prazo (meses)" name="prazoMeses" value={d.prazoMeses||360} type="number" />
                </div>
                <F label="CET / Juros a.a. (%)" name="cetAnual" value={d.cetAnual||12} type="number" />
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Tabela de Amortização</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[['sac','SAC'],['price','PRICE']].map(([v,l]) => (
                      <button key={v} onClick={() => up('tabelaAmortizacao', v)}
                        style={{ flex: 1, padding: '9px', border: 'none', borderRadius: 8, background: (d.tabelaAmortizacao||'sac') === v ? '#0f172a' : '#f1f5f9', color: (d.tabelaAmortizacao||'sac') === v ? 'white' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {sacTab.length > 0 && (
                    <div style={{ marginTop: 10, background: '#f8fafc', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>Comparativo</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {[['SAC', sacTab[0]?.parcela, sacTab[sacTab.length-1]?.parcela], ['PRICE', priceTab[0]?.parcela, priceTab[priceTab.length-1]?.parcela]].map(([n, p1, pu]) => (
                          <div key={n} style={{ background: 'white', borderRadius: 6, padding: '8px 10px' }}>
                            <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 4 }}>{n}</div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>1ª: <b>R$ {fmt(p1||0, 0)}</b></div>
                            <div style={{ fontSize: 10, color: '#64748b' }}>Últ.: <b>R$ {fmt(pu||0, 0)}</b></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeTab === 'riscos' && <RiscoJuridico riscos={d.riscos||[]} onChange={r => up('riscos', r)} />}
            {activeTab === 'lancamentos' && <Lancamentos lancamentos={d.lancamentos||[]} onChange={l => up('lancamentos', l)} />}
          </div>
        </div>

        {/* Ações */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={salvar}
            style={{ flex: 1, padding: '12px', background: saved ? '#10b981' : '#0f172a', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.3s' }}>
            {saved ? <CheckCircle2 size={16}/> : <Save size={16}/>} {saved ? 'Salvo!' : 'Salvar'}
          </button>
          {parecer && (
            <button onClick={imprimirPDF}
              style={{ padding: '12px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <Printer size={15}/> PDF
            </button>
          )}
        </div>

        {msg.text && <div style={{ padding: '10px 14px', borderRadius: 8, background: msg.type === 'error' ? '#fee2e2' : '#d1fae5', color: msg.type === 'error' ? '#dc2626' : '#065f46', fontSize: 12, fontWeight: 600 }}>{msg.text}</div>}
      </div>

      {/* PAINEL DIREITO — RESULTADOS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Alerta bloqueante */}
        {riscosBloqueantes.length > 0 && (
          <div style={{ background: '#fef2f2', border: '2px solid #dc2626', borderRadius: 14, padding: '14px 18px', display: 'flex', gap: 12 }}>
            <ShieldAlert size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }}/>
            <div>
              <div style={{ fontWeight: 900, color: '#b91c1c', fontSize: 14, marginBottom: 6 }}>⚠ RISCO JURÍDICO BLOQUEANTE — PARALISAR ANÁLISE</div>
              {riscosBloqueantes.map(r => <div key={r.id} style={{ color: '#dc2626', fontSize: 12, marginBottom: 3 }}>• {r.texto}</div>)}
            </div>
          </div>
        )}

        {/* Selector cenário */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Cenário:</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['aVista','À Vista','#2563eb'],['financiado','Alavancado','#10b981']].map(([v,l,c]) => (
              <button key={v} onClick={() => setCenario(v)} disabled={v==='financiado'&&d.somenteAVista}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: cenario===v?c:'#f1f5f9', color: cenario===v?'white':'#64748b', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: v==='financiado'&&d.somenteAVista?0.4:1 }}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <select name="status" value={d.status||'analise'} onChange={upN}
              style={{ fontSize: 12, fontWeight: 700, border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', background: '#f8fafc' }}>
              {STATUS_OPTS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Capital Aportado', value: `R$ ${fmt(metricas.capitalMobilizado,0)}`, sub: 'Total mobilizado (A)', color: '#ef4444', bg: '#fef2f2', icon: DollarSign },
            { label: isUsoProprio?'Economia Real':'Lucro Líquido', value: `R$ ${fmt(metricas.lucro,0)}`, sub: `${fmtPct(metricas.roi)} ${isAVista?'ROI':'ROE'}`, color: metricas.roi>=META?'#10b981':'#ef4444', bg: metricas.roi>=META?'#d1fae5':'#fef2f2', icon: TrendingUp },
            { label: 'Yield Locação', value: fmtPct(metricas.yieldMensal)+'/mês', sub: fmtPct(metricas.yieldAnual)+' a.a.', color: '#8b5cf6', bg: '#ede9fe', icon: BarChart3 },
            { label: 'Teto de Disputa', value: `R$ ${fmt(teto,0)}`, sub: isUsoProprio?'Max. sem perder equity':'Max. com 40% margem', color: '#f59e0b', bg: '#fef3c7', icon: Gavel },
          ].map((k,i) => (
            <div key={i} style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.3 }}>{k.label}</span>
                <div style={{ background: k.bg, borderRadius: 8, padding: 6 }}><k.icon size={14} color={k.color}/></div>
              </div>
              <div style={{ fontSize: 17, fontWeight: 900, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Viabilidade */}
        <div style={{ background: isViavel?'#d1fae5':'#fee2e2', border: `2px solid ${isViavel?'#10b981':'#ef4444'}`, borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isViavel ? <CheckCircle2 size={28} color="#10b981"/> : <XCircle size={28} color="#ef4444"/>}
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: isViavel?'#065f46':'#b91c1c' }}>
                {isViavel ? (isUsoProprio?'Aprovado para Uso Próprio':'Operação Viável — Aprovada') : 'Operação Reprovada — Retorno Insuficiente'}
              </div>
              <div style={{ fontSize: 12, color: isViavel?'#047857':'#dc2626', marginTop: 2 }}>
                {isUsoProprio ? `Economia de R$ ${fmt(metricas.lucro,0)} vs mercado (${fmtPct(metricas.roi)} de desconto efetivo)` : `Retorno ${fmtPct(metricas.roi)} ${isAVista?'ROI':'ROE'} · ${isViavel?'Atinge os 40% mínimos exigidos':'Abaixo dos 40% mínimos da TSN Ativos'}`}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>TETO</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#f59e0b' }}>R$ {fmt(teto,0)}</div>
          </div>
        </div>

        {/* Análise de Mercado */}
        {mercado && (
          <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '18px 20px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={15} color="#10b981"/> Avaliação Mercadológica
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
              {[
                ['Preço Médio/m²', `R$ ${fmt(mercado.precoMedioM2||0,0)}`, '#2563eb'],
                ['Aluguel Médio', `R$ ${fmt(mercado.aluguelMedio||0,0)}/mês`, '#8b5cf6'],
                ['Yield Bruto', fmtPct(mercado.yieldBruto||0), '#10b981'],
                ['Yield Líquido', fmtPct(mercado.yieldLiquido||0), '#f59e0b'],
              ].map(([l,v,c]) => (
                <div key={l} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{l}</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            {mercado.comentario && <p style={{ fontSize: 12, color: '#475569', lineHeight: 1.7, margin: '0 0 12px', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>{mercado.comentario}</p>}
            {mercado.vendas?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 8 }}>Amostras de Venda ({mercado.totalAmostrasVenda} encontradas)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {mercado.vendas.slice(0,6).map((v,i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#f8fafc', borderRadius: 6, fontSize: 11 }}>
                      <span style={{ color: '#334155' }}>{v.descricao} <span style={{ color: '#94a3b8' }}>({v.fonte})</span></span>
                      <span style={{ fontWeight: 700, color: '#10b981', flexShrink: 0 }}>R$ {fmt(v.valor,0)} · R$ {fmt(v.valorM2,0)}/m²</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {mercado.locacoes?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 8 }}>Amostras de Locação</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {mercado.locacoes.map((l,i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#f8fafc', borderRadius: 6, fontSize: 11 }}>
                      <span style={{ color: '#334155' }}>{l.descricao} <span style={{ color: '#94a3b8' }}>({l.fonte})</span></span>
                      <span style={{ fontWeight: 700, color: '#8b5cf6' }}>R$ {fmt(l.valorMensal,0)}/mês</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tabela Financeira */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ background: '#0f172a', padding: '14px 18px' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'white' }}>Detalhamento Financeiro</h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>{['Item','% Aporte','Lance Base','Teto (R$ '+fmt(teto,0)+')'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: h==='Item'?'left':'right', fontWeight: 700, color: '#475569', borderBottom: '2px solid #e2e8f0' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {[
                  ['Arrematação/Sinal', isAVista?metricas.vArremate:metricas.valorSinal, isAVista?metricasTeto.vArremate:metricasTeto.valorSinal],
                  ['Honorários Jurídicos (10%)', metricas.honorarios, metricasTeto.honorarios],
                  ['Taxa Leiloeiro', metricas.taxaLeiloeiro, metricasTeto.taxaLeiloeiro],
                  ['ITBI + Registro', metricas.itbiRegistro, metricasTeto.itbiRegistro],
                  d.laudemio>0 && ['Laudêmio', metricas.laudemio, metricasTeto.laudemio],
                  d.foreiro>0 && ['Foreiro', metricas.foreiro, metricasTeto.foreiro],
                  d.debitosAssumidos>0 && ['Débitos Assumidos', metricas.debitos, metricasTeto.debitos],
                  ['Reforma/Retrofit', metricas.manutencao, metricasTeto.manutencao],
                  !isAVista && ['Parcelas Banco', metricas.parcelasPagas, metricasTeto.parcelasPagas],
                  ['Carrego (IPTU/Cond)', metricas.custoCarrrego, metricasTeto.custoCarrrego],
                ].filter(Boolean).filter(r=>r[1]>0||r[2]>0).map(([label,base,tetoV],i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i%2===0?'white':'#fafafa' }}>
                    <td style={{ padding: '9px 14px', color: '#334155' }}>{label}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: '#94a3b8', fontSize: 11 }}>{metricas.capitalMobilizado>0?fmtPct(base/metricas.capitalMobilizado*100):'-'}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>- R$ {fmt(base)}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: '#92400e', fontWeight: 600 }}>- R$ {fmt(tetoV)}</td>
                  </tr>
                ))}
                <tr style={{ background: '#fef2f2', fontWeight: 800 }}>
                  <td style={{ padding: '10px 14px' }}>TOTAL APORTADO (A)</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#94a3b8' }}>100%</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#dc2626', fontSize: 14 }}>R$ {fmt(metricas.capitalMobilizado)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#92400e', fontSize: 14 }}>R$ {fmt(metricasTeto.capitalMobilizado)}</td>
                </tr>
                {[
                  [isUsoProprio?'Valor de Mercado':'Venda Bruta (90%)', metricas.valorRef, metricasTeto.valorRef, '#10b981'],
                  !isUsoProprio && ['(-) Comissão + IR', -(metricas.comissao+metricas.ir), -(metricasTeto.comissao+metricasTeto.ir), '#dc2626'],
                  !isAVista && ['(-) Quitação Banco', -metricas.saldoDevedor, -metricasTeto.saldoDevedor, '#dc2626'],
                ].filter(Boolean).map(([label,base,tetoV,color],i) => (
                  <tr key={'r'+i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '9px 14px', color: '#334155' }}>{label}</td><td/>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: color, fontWeight: 600 }}>{base>0?'+ ':'- '}R$ {fmt(Math.abs(base))}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', color: color, fontWeight: 600 }}>{tetoV>0?'+ ':'- '}R$ {fmt(Math.abs(tetoV))}</td>
                  </tr>
                ))}
                <tr style={{ background: '#d1fae5', fontWeight: 900, fontSize: 14 }}>
                  <td style={{ padding: '10px 14px', color: '#065f46' }}>RESULTADO (B - A)</td><td/>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: metricas.lucro>=0?'#10b981':'#dc2626', fontSize: 16 }}>R$ {fmt(metricas.lucro)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: metricasTeto.lucro>=0?'#047857':'#dc2626', fontSize: 16 }}>R$ {fmt(metricasTeto.lucro)}</td>
                </tr>
                <tr style={{ background: '#dbeafe', fontWeight: 900 }}>
                  <td style={{ padding: '10px 14px', color: '#1e40af' }}>RETORNO ({isAVista?'ROI':'ROE'})</td><td/>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#2563eb', fontSize: 16 }}>{fmtPct(metricas.roi)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#f59e0b', fontSize: 16 }}>{fmtPct(metricasTeto.roi)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Fluxo */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <button onClick={() => setShowFluxo(!showFluxo)} style={{ width: '100%', padding: '14px 18px', background: '#1e293b', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BarChart3 size={15}/> Fluxo de Caixa Mensal</span>
            {showFluxo ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
          </button>
          {showFluxo && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ background: '#f8fafc' }}>
                  <tr>{['Mês','Descrição','Entradas','Saídas','Saldo'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: h==='Mês'||h==='Descrição'?'left':'right', fontWeight: 700, color: '#475569', borderBottom: '2px solid #e2e8f0' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {fluxo.linhas.map((row,i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i%2===0?'white':'#fafafa' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700 }}>Mês {row.mes}</td>
                      <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 11 }}>{row.descricao}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{row.entrada>0?`+ R$ ${fmt(row.entrada)}`:'—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>{row.saida>0?`- R$ ${fmt(row.saida)}`:'—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: row.saldo>=0?'#10b981':'#dc2626', background: row.saldo>=0?'#f0fdf4':'#fef2f2' }}>R$ {fmt(row.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ background: '#0f172a', color: 'white', fontWeight: 700 }}>
                  <tr><td colSpan={3} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase' }}>Total Saídas</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#fca5a5' }}>- R$ {fmt(fluxo.totalSaidas)}</td><td/></tr>
                  <tr><td colSpan={4} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, textTransform: 'uppercase', color: '#6ee7b7' }}>Resultado Final</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: (fluxo.totalEntradas-fluxo.totalSaidas)>=0?'#6ee7b7':'#fca5a5', fontSize: 14 }}>= R$ {fmt(fluxo.totalEntradas-fluxo.totalSaidas)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* SAC/Price */}
        {!d.somenteAVista && <TabelaAmortizacao sacTabela={sacTab} priceTabela={priceTab} d={d}/>}

        {/* Parecer IA */}
        <div style={{ background: '#0f172a', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: '#1e293b', borderRadius: 10, padding: 10 }}><Sparkles size={18} color="#34d399"/></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'white' }}>Parecer Executivo — Defesa da Arrematação</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Gerado por Claude com busca de mercado em tempo real</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={gerarParecerClick} disabled={loadParecer}
                style={{ padding: '9px 18px', background: '#10b981', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                {loadParecer ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> : <Sparkles size={14}/>}
                {loadParecer ? 'Gerando...' : 'Gerar Parecer'}
              </button>
              {parecer && <button onClick={imprimirPDF}
                style={{ padding: '9px 14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Printer size={14}/> PDF
              </button>}
            </div>
          </div>
          {parecer && (
            <div style={{ padding: '18px 20px', fontSize: 13, lineHeight: 1.8, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
              {parecer}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
