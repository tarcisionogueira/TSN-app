import React, { useState, useMemo, useCallback } from 'react';
import {
  Save, Trash2, Printer, Bot, Sparkles, Loader2, Search, Building,
  AlertTriangle, TrendingUp, Calculator, FileText, MessageSquare,
  DollarSign, BarChart3, ChevronDown, ChevronUp, Zap, CheckCircle2,
  XCircle, UploadCloud, Link as LinkIcon, ShieldAlert, Plus, Minus,
  Info, Gavel, Home, LayoutGrid, Warehouse, Building2
} from 'lucide-react';
import { calcularMetricasCenario, calcularTetoLance, calcularSAC, calcularPrice, fmt, fmtPct } from '../utils/calculos';
import RiscoJuridico from './RiscoJuridico';
import Lancamentos from './Lancamentos';
import TabelaAmortizacao from './TabelaAmortizacao';
import RelatorioPDF from './RelatorioPDF';

const apiKey = import.meta.env.VITE_GEMINI_KEY || '';

const STATUS_OPTS = [
  { v: 'analise', l: 'Em Análise' }, { v: 'aprovado', l: 'Aprovado' },
  { v: 'arrematado', l: 'Arrematado' }, { v: 'em_reforma', l: 'Em Reforma' },
  { v: 'venda', l: 'À Venda' }, { v: 'alugado', l: 'Alugado' },
  { v: 'concluido', l: 'Concluído' }, { v: 'reprovado', l: 'Reprovado' },
];

export default function ImovelEditor({ imovel, onSalvar, onExcluir, onVoltar }) {
  const [d, setD] = useState(imovel || {});
  const [tab, setTab] = useState('dados');
  const [cenario, setCenario] = useState('financiado');
  const [showFluxo, setShowFluxo] = useState(false);
  const [showSACPrice, setShowSACPrice] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [isAutoFill, setIsAutoFill] = useState(false);
  const [isSearchVenda, setIsSearchVenda] = useState(false);
  const [isSearchLoc, setIsSearchLoc] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: '' });
  const [saved, setSaved] = useState(false);

  const up = useCallback((name, value) => {
    setD(prev => ({ ...prev, [name]: value }));
  }, []);

  const upN = useCallback((e) => {
    const { name, value } = e.target;
    const isText = ['nome','endereco','editalLink','origem','tipoImovel','objetivoCompra','observacoes','status','tabelaAmortizacao'].includes(name);
    setD(prev => ({ ...prev, [name]: isText ? value : (parseFloat(value) || 0) }));
  }, []);

  const isAVista = cenario === 'aVista' || d.somenteAVista;
  const isUsoProprio = d.objetivoCompra === 'uso_proprio';
  const META = isUsoProprio ? 0 : 40;

  const metricas = useMemo(() => calcularMetricasCenario(d, d.valorArrematacao || 0, isAVista), [d, isAVista]);
  const teto = useMemo(() => calcularTetoLance(d, isAVista, META, d.valorMercado || 0), [d, isAVista, META]);
  const metricasTeto = useMemo(() => calcularMetricasCenario(d, teto, isAVista), [d, teto, isAVista]);

  const isViavel = isUsoProprio ? true : metricas.roi >= META;
  const roiLabel = isAVista ? 'ROI' : 'ROE';

  const sacTabela = useMemo(() => {
    if (!d.prazoMeses || !d.valorArrematacao || !d.sinalPercentual) return [];
    const principal = (d.valorArrematacao || 0) * (1 - (d.sinalPercentual || 0) / 100);
    return calcularSAC(principal, d.cetAnual || 0, d.prazoMeses || 0);
  }, [d.valorArrematacao, d.sinalPercentual, d.cetAnual, d.prazoMeses]);

  const priceTabela = useMemo(() => {
    if (!d.prazoMeses || !d.valorArrematacao || !d.sinalPercentual) return [];
    const principal = (d.valorArrematacao || 0) * (1 - (d.sinalPercentual || 0) / 100);
    return calcularPrice(principal, d.cetAnual || 0, d.prazoMeses || 0);
  }, [d.valorArrematacao, d.sinalPercentual, d.cetAnual, d.prazoMeses]);

  const fluxo = useMemo(() => {
    const pVenda = Number(d.prazoVendaMeses) || 12;
    const pReforma = Math.min(Number(d.prazoReformaMeses) || 3, pVenda);
    const parcelaReforma = d.manutencaoEstimada > 0 ? (d.manutencaoEstimada / pReforma) : 0;
    const debitos = Number(d.debitosAssumidos) || 0;
    const iptu = Number(d.iptuMensal) || 0;
    const cond = Number(d.condominioMensal) || 0;
    const laudemio = Number(d.laudemio) || 0;
    const foreiro = Number(d.foreiro) || 0;

    const saidaM0 = (isAVista ? metricas.vArremate : metricas.valorSinal)
      + metricas.taxaLeiloeiro + metricas.honorarios + metricas.itbiRegistro
      + laudemio + foreiro;

    let saldo = -saidaM0;
    const linhas = [{ mes: 0, entrada: 0, saida: saidaM0, descricao: 'Investimento Inicial (Arrematação, ITBI, Honorários, Leiloeiro)', saldo }];
    let totalSaidas = saidaM0;

    for (let i = 1; i <= pVenda; i++) {
      let saida = iptu + cond;
      const parts = [];
      if (iptu + cond > 0) parts.push('Carrego (IPTU+Cond)');
      if (!isAVista && i <= (d.prazoMeses || 0)) {
        saida += metricas.parcelaMedia;
        parts.push('Parcela Financiamento');
      }
      if (i === 1 && debitos > 0) { saida += debitos; parts.push('Quitação Débitos'); }
      if (i <= pReforma && parcelaReforma > 0) { saida += parcelaReforma; parts.push(`Reforma (${i}/${pReforma})`); }
      const entrada = i === pVenda ? metricas.receitaLiquida : 0;
      saldo += entrada - saida;
      totalSaidas += saida;
      linhas.push({ mes: i, entrada, saida, descricao: parts.join(' + ') || 'Manutenção mensal', saldo });
    }
    return { linhas, totalSaidas, totalEntradas: metricas.receitaLiquida };
  }, [d, metricas, isAVista]);

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 3500);
  };

  const handleSave = () => {
    onSalvar({ ...d });
    setSaved(true);
    showMsg('Imóvel salvo com sucesso!', 'success');
    setTimeout(() => setSaved(false), 2000);
  };

  const autoFill = async () => {
    if (!d.endereco && !d.editalLink && !d.editalTexto) {
      showMsg('Preencha endereço ou link do edital primeiro.', 'error'); return;
    }
    setIsAutoFill(true);
    const prompt = `Extraia dados técnicos do imóvel/leilão. Endereço: "${d.endereco}". Link: "${d.editalLink || ''}". Texto do edital: "${(d.editalTexto || '').substring(0, 2000)}".
    Retorne APENAS JSON com os campos encontrados. Se não encontrar um campo, não o inclua.`;
    const schema = {
      type: "OBJECT", properties: {
        nome: { type: "STRING" }, valorAvaliacao: { type: "NUMBER" }, valorArrematacao: { type: "NUMBER" },
        areaM2: { type: "NUMBER" }, areaTerrenoM2: { type: "NUMBER" }, debitosAssumidos: { type: "NUMBER" },
        iptuMensal: { type: "NUMBER" }, condominioMensal: { type: "NUMBER" },
        origem: { type: "STRING", enum: ["extrajudicial", "judicial"] },
        taxaLeiloeiroPercentual: { type: "NUMBER" }, somenteAVista: { type: "BOOLEAN" },
        tipoImovel: { type: "STRING", enum: ["casa", "apartamento", "terreno", "comercial"] },
        laudemio: { type: "NUMBER" }, foreiro: { type: "NUMBER" },
        riscos: { type: "ARRAY", items: { type: "STRING" } }
      }
    };
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { responseMimeType: "application/json", responseSchema: schema } })
      });
      const data = await r.json();
      const ext = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      setD(prev => ({
        ...prev, ...ext,
        valorMercado: ext.valorAvaliacao ? ext.valorAvaliacao * 1.2 : prev.valorMercado,
        riscos: ext.riscos ? ext.riscos.map(r => ({ id: Date.now() + Math.random(), texto: r, tipo: 'alerta' })) : prev.riscos,
      }));
      showMsg('Dados extraídos com IA com sucesso!', 'success');
    } catch { showMsg('Falha ao extrair dados. Preencha manualmente.', 'error'); }
    finally { setIsAutoFill(false); }
  };

  const buscarMercado = async () => {
    setIsSearchVenda(true);
    const prompt = `Busque preço médio de VENDA de ${d.tipoImovel} em "${d.endereco}". Retorne JSON: {"precoMedioM2": number, "amostras": number}`;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { precoMedioM2: { type: "NUMBER" }, amostras: { type: "INTEGER" } }, required: ["precoMedioM2"] } } })
      });
      const data = await r.json();
      const ext = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      const vm = Math.round((d.areaM2 || 60) * (ext.precoMedioM2 || 3000));
      setD(prev => ({ ...prev, valorMercado: vm }));
      showMsg(`Mercado: R$ ${fmt(ext.precoMedioM2, 0)}/m² · ${ext.amostras || '?'} amostras`, 'success');
    } catch { showMsg('Não foi possível buscar dados de mercado.', 'error'); }
    finally { setIsSearchVenda(false); }
  };

  const buscarLocacao = async () => {
    setIsSearchLoc(true);
    const prompt = `Busque valor médio de LOCAÇÃO mensal de ${d.tipoImovel} com ${d.areaM2}m² em "${d.endereco}". Retorne JSON: {"valorLocacaoMensal": number, "amostras": number}`;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { valorLocacaoMensal: { type: "NUMBER" }, amostras: { type: "INTEGER" } }, required: ["valorLocacaoMensal"] } } })
      });
      const data = await r.json();
      const ext = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      setD(prev => ({ ...prev, valorLocacao: Math.round(ext.valorLocacaoMensal || (prev.valorMercado * 0.007)) }));
      showMsg(`Locação: R$ ${fmt(ext.valorLocacaoMensal, 0)}/mês · ${ext.amostras || '?'} amostras`, 'success');
    } catch { showMsg('Não foi possível buscar dados de locação.', 'error'); }
    finally { setIsSearchLoc(false); }
  };

  const gerarAnalise = async () => {
    setIsAILoading(true);
    const mFocus = metricas;
    const prompt = `
Atue como Gestor Analítico Sênior da TSN Ativos. Redija um PARECER EXECUTIVO completo para o imóvel abaixo.

DADOS DO IMÓVEL:
- Tipo: ${d.tipoImovel} | Objetivo: ${d.objetivoCompra}
- Endereço: ${d.endereco}
- Avaliação: R$ ${fmt(d.valorAvaliacao)} | Mercado: R$ ${fmt(d.valorMercado)}
- Lance Base: R$ ${fmt(d.valorArrematacao)} | Área: ${d.areaM2}m²
- Capital Mobilizado: R$ ${fmt(mFocus.capitalMobilizado)} | Lucro: R$ ${fmt(mFocus.lucro)}
- Retorno: ${fmtPct(mFocus.roi)} | Teto de Disputa: R$ ${fmt(teto, 0)}
- Yield Locação: ${fmtPct(mFocus.yieldMensal)}/mês (${fmtPct(mFocus.yieldAnual)}/ano)
- Riscos identificados: ${(d.riscos || []).map(r => r.texto).join(', ') || 'Nenhum identificado'}
- Observações da Gestão: "${d.observacoes || 'Sem observações.'}"

Gere EXATAMENTE 4 seções separadas pela tag "SEÇÃO:" em maiúsculas:

SEÇÃO: POSICIONAMENTO ESTRATÉGICO
(2 parágrafos: autoridade TSN Ativos + análise do ativo e sua posição de mercado)

SEÇÃO: DEFESA DA ARREMATAÇÃO
(${isViavel ? `Defenda o lance. Lucro R$ ${fmt(mFocus.lucro)}, retorno ${fmtPct(mFocus.roi)}. Oriente teto de disputa R$ ${fmt(teto, 0)}.` : `Lance reprovado: retorno ${fmtPct(mFocus.roi)} abaixo dos 40% mínimos. Justifique recusa e quando seria viável.`})

SEÇÃO: PROJEÇÃO DE LOCAÇÃO
(${d.tipoImovel === 'terreno' ? 'Não aplicável para terreno. Alternativas: construção para venda, venda do lote.' : `Analise yield de ${fmtPct(mFocus.yieldAnual)}/ano. Sustentação de parcelas. Payback.`})

SEÇÃO: AMOSTRAS DE MERCADO
(Busque até 10 comparativos de VENDA e 5 de LOCAÇÃO na mesma localização. Liste com portal, endereço e valor. Ao final: preço médio/m² consolidado e total de amostras encontradas.)
`;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] })
      });
      const data = await r.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      setD(prev => ({ ...prev, aiAnalysis: txt }));
      showMsg('Parecer gerado com sucesso!', 'success');
    } catch { showMsg('Falha ao gerar análise. Tente novamente.', 'error'); }
    finally { setIsAILoading(false); }
  };

  const handlePrint = () => {
    RelatorioPDF({ d, metricas, metricasTeto, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTabela, priceTabela });
  };

  const TABS = [
    { id: 'dados', label: 'Identificação', icon: FileText },
    { id: 'mercado', label: 'Mercado', icon: TrendingUp },
    { id: 'custos', label: 'Arrematação', icon: Gavel },
    { id: 'financeiro', label: 'Financiamento', icon: Calculator },
    { id: 'riscos', label: 'Riscos Jurídicos', icon: ShieldAlert },
    { id: 'lancamentos', label: 'Lançamentos', icon: DollarSign },
    { id: 'analise', label: 'Análise IA', icon: Bot },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px', display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20, alignItems: 'start' }}>

      {/* PAINEL ESQUERDO - FORMULÁRIO */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Tabs */}
        <div style={{ background: 'white', borderRadius: '16px 16px 0 0', border: '1px solid #e2e8f0', borderBottom: 'none', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #e2e8f0' }}>
            {TABS.slice(0, 4).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: '10px 4px', border: 'none', background: tab === t.id ? '#2563eb' : 'transparent', color: tab === t.id ? 'white' : '#64748b', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                <t.icon size={14} />{t.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid #e2e8f0' }}>
            {TABS.slice(4).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: '10px 4px', border: 'none', background: tab === t.id ? '#2563eb' : 'transparent', color: tab === t.id ? 'white' : '#64748b', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transition: 'all 0.15s' }}>
                <t.icon size={14} />{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Form content */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', padding: 20, borderRadius: '0 0 16px 16px' }}>
          {tab === 'dados' && <TabDados d={d} upN={upN} up={up} autoFill={autoFill} isAutoFill={isAutoFill} />}
          {tab === 'mercado' && <TabMercado d={d} upN={upN} buscarMercado={buscarMercado} buscarLocacao={buscarLocacao} isSearchVenda={isSearchVenda} isSearchLoc={isSearchLoc} isUsoProprio={isUsoProprio} />}
          {tab === 'custos' && <TabCustos d={d} upN={upN} up={up} />}
          {tab === 'financeiro' && <TabFinanceiro d={d} upN={upN} up={up} sacTabela={sacTabela} priceTabela={priceTabela} showSACPrice={showSACPrice} setShowSACPrice={setShowSACPrice} />}
          {tab === 'riscos' && <RiscoJuridico riscos={d.riscos || []} onChange={r => up('riscos', r)} />}
          {tab === 'lancamentos' && <Lancamentos lancamentos={d.lancamentos || []} onChange={l => up('lancamentos', l)} />}
          {tab === 'analise' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button onClick={gerarAnalise} disabled={isAILoading}
                style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }}>
                {isAILoading ? <Loader2 size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={16} />}
                {isAILoading ? 'Gerando Parecer...' : 'Gerar Parecer com IA'}
              </button>
              {d.aiAnalysis && (
                <button onClick={handlePrint}
                  style={{ width: '100%', padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}>
                  <Printer size={15} /> Imprimir Relatório PDF
                </button>
              )}
              {d.aiAnalysis && (
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, fontSize: 12, lineHeight: 1.7, color: '#334155', maxHeight: 400, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {d.aiAnalysis}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Ações */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={handleSave}
            style={{ flex: 1, padding: '12px', background: saved ? '#10b981' : '#0f172a', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.3s' }}>
            {saved ? <CheckCircle2 size={16} /> : <Save size={16} />} {saved ? 'Salvo!' : 'Salvar'}
          </button>
          {d.aiAnalysis && (
            <button onClick={handlePrint}
              style={{ padding: '12px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <Printer size={15} /> PDF
            </button>
          )}
        </div>

        {msg.text && (
          <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: msg.type === 'error' ? '#fee2e2' : '#d1fae5', color: msg.type === 'error' ? '#dc2626' : '#065f46', fontSize: 12, fontWeight: 600 }}>
            {msg.text}
          </div>
        )}
      </div>

      {/* PAINEL DIREITO - RESULTADOS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Riscos no topo se houver */}
        {(d.riscos || []).some(r => r.tipo === 'bloqueante') && (
          <div style={{ background: '#fef2f2', border: '2px solid #dc2626', borderRadius: 14, padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <ShieldAlert size={24} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 900, color: '#b91c1c', fontSize: 15, marginBottom: 4 }}>⚠ RISCO JURÍDICO BLOQUEANTE IDENTIFICADO</div>
              {(d.riscos || []).filter(r => r.tipo === 'bloqueante').map(r => (
                <div key={r.id} style={{ color: '#dc2626', fontSize: 12, marginBottom: 2 }}>• {r.texto}</div>
              ))}
            </div>
          </div>
        )}

        {/* Seletor de Cenário */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Cenário:</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['aVista', 'À Vista', '#2563eb'], ['financiado', 'Alavancado', '#10b981']].map(([v, l, c]) => (
              <button key={v} onClick={() => setCenario(v)}
                disabled={v === 'financiado' && d.somenteAVista}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: cenario === v ? c : '#f1f5f9', color: cenario === v ? 'white' : '#64748b', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: v === 'financiado' && d.somenteAVista ? 0.4 : 1 }}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Status:</span>
            <select name="status" value={d.status || 'analise'} onChange={upN}
              style={{ fontSize: 12, fontWeight: 700, border: '1px solid #e2e8f0', borderRadius: 8, padding: '4px 8px', background: '#f8fafc', color: '#334155' }}>
              {STATUS_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        </div>

        {/* Cards de KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Capital Mobilizado', value: `R$ ${fmt(metricas.capitalMobilizado, 0)}`, sub: '100% do aporte', color: '#ef4444', bg: '#fef2f2', icon: DollarSign },
            { label: isUsoProprio ? 'Economia de Compra' : 'Lucro Líquido', value: `R$ ${fmt(metricas.lucro, 0)}`, sub: `${fmtPct(metricas.roi)} ${roiLabel}`, color: metricas.roi >= META ? '#10b981' : '#ef4444', bg: metricas.roi >= META ? '#d1fae5' : '#fef2f2', icon: TrendingUp },
            { label: 'Yield Locação', value: fmtPct(metricas.yieldMensal) + '/mês', sub: fmtPct(metricas.yieldAnual) + ' a.a.', color: '#8b5cf6', bg: '#ede9fe', icon: BarChart3 },
            { label: 'Teto de Disputa', value: `R$ ${fmt(teto, 0)}`, sub: isUsoProprio ? 'Max sem perder equity' : 'Max com 40% lucro', color: '#f59e0b', bg: '#fef3c7', icon: Gavel },
          ].map((k, i) => (
            <div key={i} style={{ background: 'white', borderRadius: 14, border: `1px solid #e2e8f0`, padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.3 }}>{k.label}</span>
                <div style={{ background: k.bg, borderRadius: 8, padding: 6 }}><k.icon size={14} color={k.color} /></div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Viabilidade Badge */}
        <div style={{ background: isViavel ? '#d1fae5' : '#fee2e2', border: `2px solid ${isViavel ? '#10b981' : '#ef4444'}`, borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isViavel ? <CheckCircle2 size={28} color="#10b981" /> : <XCircle size={28} color="#ef4444" />}
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, color: isViavel ? '#065f46' : '#b91c1c' }}>
                {isViavel ? (isUsoProprio ? 'Imóvel Aprovado para Uso Próprio' : 'Operação Viável — Aprovada') : 'Operação Reprovada — Retorno Insuficiente'}
              </div>
              <div style={{ fontSize: 12, color: isViavel ? '#047857' : '#dc2626', marginTop: 2 }}>
                {isUsoProprio
                  ? `Economia de R$ ${fmt(metricas.lucro, 0)} vs compra direta no mercado (${fmtPct(metricas.roi)})`
                  : `Retorno ${fmtPct(metricas.roi)} ${roiLabel} · ${isViavel ? 'Atinge a trava mínima de 40%' : 'Abaixo dos 40% exigidos pela TSN Ativos'}`
                }
              </div>
            </div>
          </div>
          {!isUsoProprio && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>TETO MÁXIMO</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#f59e0b' }}>R$ {fmt(teto, 0)}</div>
            </div>
          )}
        </div>

        {/* Tabela de custos detalhada */}
        <TabelaDetalhada metricas={metricas} metricasTeto={metricasTeto} teto={teto} isAVista={isAVista} isUsoProprio={isUsoProprio} d={d} />

        {/* Fluxo de caixa */}
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <button onClick={() => setShowFluxo(!showFluxo)} style={{ width: '100%', padding: '14px 18px', background: '#0f172a', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BarChart3 size={16} /> Fluxo de Caixa Mensal</span>
            {showFluxo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showFluxo && <FluxoCaixa fluxo={fluxo} isUsoProprio={isUsoProprio} />}
        </div>

        {/* Tabelas SAC/Price */}
        {!d.somenteAVista && (
          <TabelaAmortizacao sacTabela={sacTabela} priceTabela={priceTabela} d={d} />
        )}
      </div>
    </div>
  );
}

// ---- Sub-tabs ----

function TabDados({ d, upN, up, autoFill, isAutoFill }) {
  const TIPO_ICONS = { casa: Home, apartamento: Building2, terreno: LayoutGrid, comercial: Warehouse };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Nome / Referência" name="nome" value={d.nome || ''} onChange={upN} placeholder="Ex: Apt 302 - Ed. Palmeiras" />
      <Field label="Objetivo da Compra" name="objetivoCompra" value={d.objetivoCompra || 'investimento'} onChange={upN} type="select" options={[['investimento','Investimento (Revenda/Locação)'],['uso_proprio','Uso Próprio (Moradia/Sede)']]} />
      <Field label="Endereço Completo" name="endereco" value={d.endereco || ''} onChange={upN} type="textarea" rows={2} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Tipo de Imóvel" name="tipoImovel" value={d.tipoImovel || 'apartamento'} onChange={upN} type="select" options={[['casa','Casa'],['apartamento','Apartamento'],['terreno','Terreno/Lote'],['comercial','Comercial']]} />
        <Field label="Link do Edital" name="editalLink" value={d.editalLink || ''} onChange={upN} placeholder="https://..." />
      </div>
      <Field label="Observações da Gestão" name="observacoes" value={d.observacoes || ''} onChange={upN} type="textarea" rows={3} placeholder="Anotações de visita, restrições, oportunidades..." />
      <Field label="Texto do Edital (cole aqui)" name="editalTexto" value={d.editalTexto || ''} onChange={upN} type="textarea" rows={3} placeholder="Cole o texto do edital ou matrícula para análise automática..." />
      <button onClick={autoFill} disabled={isAutoFill}
        style={{ width: '100%', padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}>
        {isAutoFill ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Extraindo dados...</> : <><Zap size={14} /> Auto-Preencher com IA</>}
      </button>
    </div>
  );
}

function TabMercado({ d, upN, buscarMercado, buscarLocacao, isSearchVenda, isSearchLoc, isUsoProprio }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="Área Privativa (m²)" name="areaM2" value={d.areaM2 || 0} onChange={upN} type="number" />
        <Field label="Área Terreno (m²)" name="areaTerrenoM2" value={d.areaTerrenoM2 || 0} onChange={upN} type="number" />
        <Field label="Avaliação Edital (R$)" name="valorAvaliacao" value={d.valorAvaliacao || 0} onChange={upN} type="number" />
      </div>
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Field label={isUsoProprio ? "Valor de Mercado (R$)" : "Preço de Venda / VGV (R$)"} name="valorMercado" value={d.valorMercado || 0} onChange={upN} type="number" bold />
        <button onClick={buscarMercado} disabled={isSearchVenda}
          style={{ width: '100%', padding: '8px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12 }}>
          {isSearchVenda ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Buscando...</> : <><Search size={13} /> Buscar Vendas na Região</>}
        </button>
      </div>
      {!isUsoProprio && d.tipoImovel !== 'terreno' && (
        <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="Locação Mensal (R$)" name="valorLocacao" value={d.valorLocacao || 0} onChange={upN} type="number" bold />
          <button onClick={buscarLocacao} disabled={isSearchLoc}
            style={{ width: '100%', padding: '8px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12 }}>
            {isSearchLoc ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Buscando...</> : <><Building size={13} /> Buscar Locação na Região</>}
          </button>
        </div>
      )}
    </div>
  );
}

function TabCustos({ d, upN, up }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Origem" name="origem" value={d.origem || 'extrajudicial'} onChange={upN} type="select" options={[['extrajudicial','Extrajudicial'],['judicial','Judicial']]} />
        <Field label="Taxa Leiloeiro (%)" name="taxaLeiloeiroPercentual" value={d.taxaLeiloeiroPercentual || 5} onChange={upN} type="number" />
      </div>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12 }}>
        <Field label="Lance / Arrematação Base (R$)" name="valorArrematacao" value={d.valorArrematacao || 0} onChange={upN} type="number" bold />
      </div>
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 10 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: '#166534', display: 'block', marginBottom: 6 }}>Honorários Jurídicos TSN (fixo 10%)</label>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#15803d' }}>R$ {fmt((d.valorArrematacao || 0) * 0.10, 0)}</div>
        <div style={{ fontSize: 10, color: '#86efac', marginTop: 2 }}>Calculado automaticamente sobre o lance</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="ITBI + Registro (%)" name="itbiPercentual" value={d.itbiPercentual || 3} onChange={upN} type="number" />
        <Field label="Débitos Assumidos (R$)" name="debitosAssumidos" value={d.debitosAssumidos || 0} onChange={upN} type="number" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Laudêmio (R$)" name="laudemio" value={d.laudemio || 0} onChange={upN} type="number" />
        <Field label="Foreiro (R$)" name="foreiro" value={d.foreiro || 0} onChange={upN} type="number" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="IPTU Mensal (R$)" name="iptuMensal" value={d.iptuMensal || 0} onChange={upN} type="number" />
        <Field label="Condomínio (R$)" name="condominioMensal" value={d.condominioMensal || 0} onChange={upN} type="number" />
        <Field label="Prazo p/ Venda (meses)" name="prazoVendaMeses" value={d.prazoVendaMeses || 12} onChange={upN} type="number" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label={d.tipoImovel === 'terreno' ? 'Limpeza/Muro (R$)' : 'Reforma/Retrofit (R$)'} name="manutencaoEstimada" value={d.manutencaoEstimada || 0} onChange={upN} type="number" />
        <Field label="Prazo Reforma (meses)" name="prazoReformaMeses" value={d.prazoReformaMeses || 3} onChange={upN} type="number" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff7ed', borderRadius: 10, border: '1px solid #fed7aa' }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#c2410c' }}>Somente À Vista?</label>
        <select name="somenteAVista" value={d.somenteAVista ? 'sim' : 'nao'} onChange={e => up('somenteAVista', e.target.value === 'sim')}
          style={{ fontSize: 12, fontWeight: 700, border: '1px solid #fed7aa', borderRadius: 8, padding: '4px 8px', background: 'white' }}>
          <option value="nao">Permite Financiamento</option>
          <option value="sim">Exclusivamente à Vista</option>
        </select>
      </div>
    </div>
  );
}

function TabFinanceiro({ d, upN, up, sacTabela, priceTabela }) {
  const sacTotal = sacTabela.reduce((s, r) => s + r.parcela, 0);
  const priceTotal = priceTabela.reduce((s, r) => s + r.parcela, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: d.somenteAVista ? 0.5 : 1, pointerEvents: d.somenteAVista ? 'none' : 'auto' }}>
      {d.somenteAVista && <div style={{ background: '#f1f5f9', borderRadius: 8, padding: 10, textAlign: 'center', fontSize: 12, color: '#64748b', fontWeight: 700 }}>⚡ Edital exige pagamento exclusivamente à vista</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Sinal / Entrada (%)" name="sinalPercentual" value={d.sinalPercentual || 5} onChange={upN} type="number" />
        <Field label="Prazo Financiamento (meses)" name="prazoMeses" value={d.prazoMeses || 360} onChange={upN} type="number" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="CET / Juros a.a. (%)" name="cetAnual" value={d.cetAnual || 12} onChange={upN} type="number" />
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5 }}>Tabela de Amortização</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['sac','SAC'],['price','PRICE']].map(([v, l]) => (
              <button key={v} onClick={() => up('tabelaAmortizacao', v)}
                style={{ flex: 1, padding: '8px', border: 'none', borderRadius: 8, background: (d.tabelaAmortizacao || 'sac') === v ? '#0f172a' : '#f1f5f9', color: (d.tabelaAmortizacao || 'sac') === v ? 'white' : '#64748b', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      {sacTabela.length > 0 && (
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>COMPARATIVO SAC vs PRICE</div>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#e2e8f0' }}>
              <th style={{ padding: '5px 8px', textAlign: 'left' }}>Tabela</th>
              <th style={{ padding: '5px 8px', textAlign: 'right' }}>1ª Parcela</th>
              <th style={{ padding: '5px 8px', textAlign: 'right' }}>Últ. Parcela</th>
              <th style={{ padding: '5px 8px', textAlign: 'right' }}>Total Pago</th>
            </tr></thead>
            <tbody>
              <tr><td style={{ padding: '5px 8px', fontWeight: 700 }}>SAC</td>
                <td style={{ padding: '5px 8px', textAlign: 'right' }}>R$ {fmt(sacTabela[0]?.parcela, 0)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right' }}>R$ {fmt(sacTabela[sacTabela.length-1]?.parcela, 0)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>R$ {fmt(sacTotal, 0)}</td>
              </tr>
              <tr><td style={{ padding: '5px 8px', fontWeight: 700 }}>PRICE</td>
                <td style={{ padding: '5px 8px', textAlign: 'right' }}>R$ {fmt(priceTabela[0]?.parcela, 0)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right' }}>R$ {fmt(priceTabela[priceTabela.length-1]?.parcela, 0)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#dc2626', fontWeight: 700 }}>R$ {fmt(priceTotal, 0)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 10, color: '#94a3b8' }}>
            Diferença total: R$ {fmt(Math.abs(priceTotal - sacTotal), 0)} ({priceTotal > sacTotal ? 'SAC mais barato' : 'PRICE mais barato'})
          </div>
        </div>
      )}
    </div>
  );
}

function TabelaDetalhada({ metricas: m, metricasTeto: mt, teto, isAVista, isUsoProprio, d }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', padding: '14px 18px', background: '#0f172a', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700 }}>
        <span>Detalhamento Financeiro Completo</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#f8fafc' }}>
              <tr>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: '#475569', borderBottom: '2px solid #e2e8f0' }}>Item</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#475569', borderBottom: '2px solid #e2e8f0' }}>% do Aporte</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#2563eb', borderBottom: '2px solid #e2e8f0' }}>Lance Base</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#f59e0b', borderBottom: '2px solid #e2e8f0' }}>Teto (R$ {fmt(teto, 0)})</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Arrematação', isAVista ? m.vArremate : m.valorSinal, isAVista ? mt.vArremate : mt.valorSinal, true],
                ['Honorários Jurídicos (10%)', m.honorarios, mt.honorarios, true],
                ['Taxa Leiloeiro', m.taxaLeiloeiro, mt.taxaLeiloeiro, true],
                ['ITBI + Registro', m.itbiRegistro, mt.itbiRegistro, true],
                ['Laudêmio', m.laudemio, mt.laudemio, true],
                ['Foreiro', m.foreiro, mt.foreiro, true],
                ['Débitos Assumidos', m.debitos, mt.debitos, true],
                ['Reforma / Retrofit', m.manutencao, mt.manutencao, true],
                !isAVista && ['Parcelas Banco (período)', m.parcelasPagas, mt.parcelasPagas, true],
                ['Carrego (IPTU/Cond)', m.custoCarrrego, mt.custoCarrrego, true],
              ].filter(Boolean).filter(r => r[1] > 0 || r[2] > 0).map(([label, base, tetoV, isSaida], i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  <td style={{ padding: '9px 14px', color: '#334155' }}>{label}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: '#94a3b8', fontSize: 11 }}>{m.capitalMobilizado > 0 ? fmtPct(base / m.capitalMobilizado * 100) : '-'}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>- R$ {fmt(base)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: '#92400e', fontWeight: 600 }}>- R$ {fmt(tetoV)}</td>
                </tr>
              ))}
              <tr style={{ background: '#fef2f2', borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                <td style={{ padding: '10px 14px', color: '#0f172a' }}>TOTAL APORTADO (A)</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#0f172a' }}>100%</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#dc2626', fontSize: 14 }}>R$ {fmt(m.capitalMobilizado)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#92400e', fontSize: 14 }}>R$ {fmt(mt.capitalMobilizado)}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: '9px 14px', color: '#334155' }}>{isUsoProprio ? 'Valor de Mercado' : 'Venda Bruta (90%)'}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right' }}></td>
                <td style={{ padding: '9px 14px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>+ R$ {fmt(m.valorRef)}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right', color: '#065f46', fontWeight: 600 }}>+ R$ {fmt(mt.valorRef)}</td>
              </tr>
              {!isUsoProprio && <tr><td style={{ padding: '9px 14px', color: '#334155' }}>(-) Comissões + IR</td>
                <td></td>
                <td style={{ padding: '9px 14px', textAlign: 'right', color: '#dc2626' }}>- R$ {fmt(m.comissao + m.ir)}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right', color: '#dc2626' }}>- R$ {fmt(mt.comissao + mt.ir)}</td>
              </tr>}
              {!isAVista && <tr><td style={{ padding: '9px 14px', color: '#334155' }}>(-) Quitação Banco</td>
                <td></td>
                <td style={{ padding: '9px 14px', textAlign: 'right', color: '#dc2626' }}>- R$ {fmt(m.saldoDevedor)}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right', color: '#dc2626' }}>- R$ {fmt(mt.saldoDevedor)}</td>
              </tr>}
              <tr style={{ background: '#f0fdf4', borderTop: '2px solid #e2e8f0', fontWeight: 800 }}>
                <td style={{ padding: '10px 14px', color: '#065f46' }}>RECEITA LÍQUIDA NA CONTA (B)</td>
                <td></td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#10b981', fontSize: 14 }}>R$ {fmt(m.receitaLiquida)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#047857', fontSize: 14 }}>R$ {fmt(mt.receitaLiquida)}</td>
              </tr>
              <tr style={{ background: '#eff6ff', fontWeight: 900, fontSize: 14 }}>
                <td style={{ padding: '12px 14px', color: '#1e40af' }}>{isUsoProprio ? 'ECONOMIA REAL (B - A)' : 'LUCRO REAL LÍQUIDO (B - A)'}</td>
                <td></td>
                <td style={{ padding: '12px 14px', textAlign: 'right', color: m.lucro >= 0 ? '#10b981' : '#dc2626', fontSize: 16 }}>R$ {fmt(m.lucro)}</td>
                <td style={{ padding: '12px 14px', textAlign: 'right', color: mt.lucro >= 0 ? '#047857' : '#dc2626', fontSize: 16 }}>R$ {fmt(mt.lucro)}</td>
              </tr>
              <tr style={{ background: '#f0f9ff', fontWeight: 900 }}>
                <td style={{ padding: '10px 14px', color: '#0c4a6e' }}>RETORNO TOTAL ({isAVista ? 'ROI' : 'ROE'})</td>
                <td></td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#2563eb', fontSize: 16 }}>{fmtPct(m.roi)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: '#f59e0b', fontSize: 16 }}>{fmtPct(mt.roi)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FluxoCaixa({ fluxo, isUsoProprio }) {
  return (
    <div style={{ overflowX: 'auto', padding: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr>
            {['Mês','Descrição','Entradas','Saídas','Saldo'].map(h => (
              <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Mês' || h === 'Descrição' ? 'left' : 'right', fontWeight: 700, color: '#475569', borderBottom: '2px solid #e2e8f0' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fluxo.linhas.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={{ padding: '8px 12px', fontWeight: 700, color: '#334155' }}>Mês {row.mes}</td>
              <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 11 }}>{row.descricao}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>{row.entrada > 0 ? `+ R$ ${fmt(row.entrada)}` : '—'}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>{row.saida > 0 ? `- R$ ${fmt(row.saida)}` : '—'}</td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: row.saldo >= 0 ? '#10b981' : '#dc2626', background: row.saldo >= 0 ? '#f0fdf4' : '#fef2f2' }}>R$ {fmt(row.saldo)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot style={{ background: '#0f172a', color: 'white' }}>
          <tr><td colSpan={3} style={{ padding: '10px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>Total Aportado (Saídas)</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#fca5a5', fontWeight: 700 }}>- R$ {fmt(fluxo.totalSaidas)}</td>
            <td></td></tr>
          <tr><td colSpan={3} style={{ padding: '10px 12px', fontWeight: 700, textTransform: 'uppercase', fontSize: 11 }}>{isUsoProprio ? 'Patrimônio Formado' : 'Receita na Conta'}</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6ee7b7', fontWeight: 700 }}>+ R$ {fmt(fluxo.totalEntradas)}</td>
            <td></td></tr>
          <tr><td colSpan={4} style={{ padding: '10px 12px', fontWeight: 900, textTransform: 'uppercase', fontSize: 11 }}>Resultado Final</td>
            <td style={{ padding: '10px 12px', textAlign: 'right', color: (fluxo.totalEntradas - fluxo.totalSaidas) >= 0 ? '#6ee7b7' : '#fca5a5', fontWeight: 900, fontSize: 14 }}>R$ {fmt(fluxo.totalEntradas - fluxo.totalSaidas)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Field({ label, name, value, onChange, type = 'text', options = [], rows = 2, placeholder = '', bold = false }) {
  const style = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#f8fafc', color: '#0f172a', fontWeight: bold ? 800 : 500 };
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {type === 'select' ? (
        <select name={name} value={value} onChange={onChange} style={style}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : type === 'textarea' ? (
        <textarea name={name} value={value} onChange={onChange} rows={rows} placeholder={placeholder} style={{ ...style, resize: 'vertical', minHeight: rows * 22 }} />
      ) : (
        <input name={name} type={type} value={value} onChange={onChange} placeholder={placeholder} style={style} />
      )}
    </div>
  );
}
