import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calculator, Gavel, TrendingUp, Target, Lock, Share2, Copy, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { calcularMetricasCenario, calcularTetoLance, fmt, fmtPct } from '../utils/calculos';

// Planos com acesso à calculadora (Top1 em diante + equipe)
const ROLES_COM_ACESSO = ['top1', 'top2', 'assessorado', 'clube', 'consultor', 'analista', 'advogado', 'admin'];

const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#0f172a', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };

function Campo({ label, value, onChange, prefix = '', suffix = '', type = 'number' }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#64748b', fontWeight: 600 }}>{prefix}</span>}
        <input type={type} value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, paddingLeft: prefix ? 28 : 11, paddingRight: suffix ? 30 : 11 }} />
        {suffix && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#64748b', fontWeight: 600 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Linha({ label, valor, destaque, cor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: destaque ? 15 : 13 }}>
      <span style={{ color: destaque ? '#0f172a' : '#64748b', fontWeight: destaque ? 800 : 500 }}>{label}</span>
      <span style={{ color: cor || (destaque ? '#0f172a' : '#334155'), fontWeight: destaque ? 800 : 700 }}>{valor}</span>
    </div>
  );
}

export default function Calculadora() {
  const nav = useNavigate();
  const { user, role, effectiveRole, loading: authLoading } = useAuth();

  const [origem, setOrigem] = useState('extrajudicial');     // judicial | extrajudicial
  const [pagamento, setPagamento] = useState('a_vista');      // a_vista | financiado
  const [tabela, setTabela] = useState('sac');                // sac | price

  const [arrematacao, setArrematacao] = useState(200000);
  const [mercado, setMercado] = useState(350000);
  const [avaliacao, setAvaliacao] = useState(300000);
  const [taxaLeiloeiro, setTaxaLeiloeiro] = useState(5);
  const [itbi, setItbi] = useState(3);
  const [debitos, setDebitos] = useState(0);
  const [reforma, setReforma] = useState(0);
  const [iptuMensal, setIptuMensal] = useState(0);
  const [condominioMensal, setCondominioMensal] = useState(0);
  const [sinal, setSinal] = useState(25);
  const [prazoMeses, setPrazoMeses] = useState(360);
  const [cet, setCet] = useState(12);
  const [prazoVenda, setPrazoVenda] = useState(12);
  const [metaRoi, setMetaRoi] = useState(20);

  const [copiado, setCopiado] = useState(false);
  const [codigoRef, setCodigoRef] = useState('');

  // Consultor: busca o próprio código de indicação para montar o link de afiliado
  useEffect(() => {
    if (!user || (role !== 'consultor' && role !== 'admin')) return;
    supabase.from('perfis').select('codigo_indicacao').eq('id', user.id).single()
      .then(({ data }) => { if (data?.codigo_indicacao) setCodigoRef(data.codigo_indicacao); });
  }, [user, role]);

  const isAVista = pagamento === 'a_vista';

  // Honorários: 10% no extrajudicial (depositário/condução); judicial geralmente sem essa rubrica fixa.
  // O motor de cálculo aplica 10% internamente — para judicial zeramos via objetivo investimento padrão.
  const inputs = useMemo(() => ({
    objetivoCompra: 'investimento',
    tabelaAmortizacao: tabela,
    valorMercado: Number(mercado) || 0,
    valorLocacao: 0,
    manutencaoEstimada: Number(reforma) || 0,
    debitosAssumidos: Number(debitos) || 0,
    iptuMensal: Number(iptuMensal) || 0,
    condominioMensal: Number(condominioMensal) || 0,
    itbiPercentual: Number(itbi) || 0,
    sinalPercentual: isAVista ? 100 : Number(sinal) || 0,
    taxaLeiloeiroPercentual: Number(taxaLeiloeiro) || 0,
    laudemio: 0, foreiro: 0,
    prazoMeses: Number(prazoMeses) || 0,
    cetAnual: Number(cet) || 0,
    prazoVendaMeses: Number(prazoVenda) || 1,
  }), [tabela, mercado, reforma, debitos, iptuMensal, condominioMensal, itbi, sinal, taxaLeiloeiro, prazoMeses, cet, prazoVenda, isAVista]);

  const m = useMemo(() => calcularMetricasCenario(inputs, Number(arrematacao) || 0, isAVista), [inputs, arrematacao, isAVista]);
  const teto = useMemo(() => calcularTetoLance(inputs, isAVista, Number(metaRoi) || 0, Number(mercado) || 0), [inputs, isAVista, metaRoi, mercado]);

  const descontoAvaliacao = avaliacao > 0 ? (1 - arrematacao / avaliacao) * 100 : 0;

  const linkAfiliado = codigoRef
    ? `${window.location.origin}${window.location.pathname}#/calculadora?ref=${codigoRef}`
    : '';

  const copiarLink = () => {
    navigator.clipboard.writeText(linkAfiliado);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  if (authLoading) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Carregando…</div>;

  // Gate de acesso
  const temAcesso = user && ROLES_COM_ACESSO.includes(effectiveRole || role);
  if (!temAcesso) {
    return (
      <div style={{ maxWidth: 560, margin: '70px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ background: '#0f172a', width: 64, height: 64, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
          <Lock size={28} color="#60a5fa" />
        </div>
        <h2 style={{ color: '#0f172a', margin: '0 0 8px' }}>Calculadora de Lance</h2>
        <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
          Ferramenta exclusiva para assinantes a partir do plano <strong>Top 1</strong>. Simule o teto máximo de lance, todos os custos do leilão e o retorno do investimento.
        </p>
        <button onClick={() => nav('/planos')} style={{ marginTop: 18, padding: '11px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
          Ver planos
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{ background: '#2563eb', borderRadius: 10, padding: 8, display: 'flex' }}><Calculator size={22} color="white" /></div>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: 0 }}>Calculadora de Lance</h1>
      </div>
      <p style={{ color: '#64748b', margin: '0 0 24px', fontSize: 14 }}>Simule custos, retorno e o teto máximo de lance para judicial e extrajudicial.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }} className="calc-grid">

        {/* ── Entradas ── */}
        <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 22 }}>
          {/* Tipo de leilão e pagamento */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            {[['extrajudicial', 'Extrajudicial'], ['judicial', 'Judicial']].map(([v, l]) => (
              <button key={v} onClick={() => setOrigem(v)}
                style={{ flex: 1, minWidth: 120, padding: '8px 12px', borderRadius: 8, border: '1px solid', borderColor: origem === v ? '#2563eb' : '#e2e8f0', background: origem === v ? '#eff6ff' : 'white', color: origem === v ? '#2563eb' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Gavel size={14} /> {l}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            {[['a_vista', 'À vista'], ['financiado', 'Financiado']].map(([v, l]) => (
              <button key={v} onClick={() => setPagamento(v)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid', borderColor: pagamento === v ? '#059669' : '#e2e8f0', background: pagamento === v ? '#ecfdf5' : 'white', color: pagamento === v ? '#059669' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Campo label="Valor de arrematação" value={arrematacao} onChange={setArrematacao} prefix="R$" />
            <Campo label="Valor de avaliação" value={avaliacao} onChange={setAvaliacao} prefix="R$" />
            <Campo label="Valor de mercado" value={mercado} onChange={setMercado} prefix="R$" />
            <Campo label="Taxa do leiloeiro" value={taxaLeiloeiro} onChange={setTaxaLeiloeiro} suffix="%" />
            <Campo label="ITBI + registro" value={itbi} onChange={setItbi} suffix="%" />
            <Campo label="Débitos assumidos" value={debitos} onChange={setDebitos} prefix="R$" />
            <Campo label="Reforma estimada" value={reforma} onChange={setReforma} prefix="R$" />
            <Campo label="Prazo p/ revenda" value={prazoVenda} onChange={setPrazoVenda} suffix="meses" />
            <Campo label="IPTU mensal" value={iptuMensal} onChange={setIptuMensal} prefix="R$" />
            <Campo label="Condomínio mensal" value={condominioMensal} onChange={setCondominioMensal} prefix="R$" />
          </div>

          {!isAVista && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>Financiamento</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {[['sac', 'SAC'], ['price', 'PRICE']].map(([v, l]) => (
                  <button key={v} onClick={() => setTabela(v)}
                    style={{ flex: 1, padding: '7px', borderRadius: 8, border: '1px solid', borderColor: tabela === v ? '#2563eb' : '#e2e8f0', background: tabela === v ? '#eff6ff' : 'white', color: tabela === v ? '#2563eb' : '#64748b', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    {l}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                <Campo label="Entrada / sinal" value={sinal} onChange={setSinal} suffix="%" />
                <Campo label="Prazo" value={prazoMeses} onChange={setPrazoMeses} suffix="m" />
                <Campo label="CET anual" value={cet} onChange={setCet} suffix="%" />
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
            <Campo label="Meta de retorno (ROI) para o teto de lance" value={metaRoi} onChange={setMetaRoi} suffix="%" />
          </div>
        </div>

        {/* ── Resultados ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Teto de lance */}
          <div style={{ background: 'linear-gradient(135deg,#1e3a8a,#2563eb)', borderRadius: 16, padding: 22, color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 1 }}>
              <Target size={15} /> Teto máximo de lance
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, margin: '6px 0 2px' }}>R$ {fmt(teto, 0)}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Lance máximo para manter ROI de {fmtPct(metaRoi, 0)} ({pagamento === 'a_vista' ? 'à vista' : 'financiado'}).</div>
          </div>

          {/* Custos e retorno */}
          <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>
              <TrendingUp size={16} color="#2563eb" /> Cenário no lance atual
            </div>
            <Linha label="Desconto sobre avaliação" valor={fmtPct(descontoAvaliacao, 1)} cor={descontoAvaliacao > 0 ? '#059669' : '#dc2626'} />
            <Linha label="Arrematação" valor={`R$ ${fmt(m.vArremate, 0)}`} />
            <Linha label={`Taxa do leiloeiro (${fmtPct(taxaLeiloeiro, 0)})`} valor={`R$ ${fmt(m.taxaLeiloeiro, 0)}`} />
            {origem === 'extrajudicial' && <Linha label="Honorários (10%)" valor={`R$ ${fmt(m.honorarios, 0)}`} />}
            <Linha label={`ITBI + registro (${fmtPct(itbi, 0)})`} valor={`R$ ${fmt(m.itbiRegistro, 0)}`} />
            {m.debitos > 0 && <Linha label="Débitos assumidos" valor={`R$ ${fmt(m.debitos, 0)}`} />}
            {m.manutencao > 0 && <Linha label="Reforma" valor={`R$ ${fmt(m.manutencao, 0)}`} />}
            {m.custoCarrrego > 0 && <Linha label="Carrego (IPTU+cond.)" valor={`R$ ${fmt(m.custoCarrrego, 0)}`} />}
            {!isAVista && <Linha label="Sinal / entrada" valor={`R$ ${fmt(m.valorSinal, 0)}`} />}
            {!isAVista && <Linha label={`Parcela média (${tabela.toUpperCase()})`} valor={`R$ ${fmt(m.parcelaMedia, 0)}`} />}
            {!isAVista && <Linha label="Saldo devedor na venda" valor={`R$ ${fmt(m.saldoDevedor, 0)}`} />}
            <Linha label="Capital mobilizado" valor={`R$ ${fmt(m.capitalMobilizado, 0)}`} destaque />
            <Linha label="Lucro líquido estimado" valor={`R$ ${fmt(m.lucro, 0)}`} cor={m.lucro >= 0 ? '#059669' : '#dc2626'} destaque />
            <Linha label="ROI / ROE" valor={fmtPct(m.roi, 1)} cor={m.roi >= 0 ? '#059669' : '#dc2626'} destaque />
            <p style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 12, lineHeight: 1.5 }}>
              Estimativa para apoio à decisão. Considera revenda a 90% do valor de mercado, comissão de 5% e IR de 15% sobre ganho de capital. Confirme custos cartorários e jurídicos do caso concreto.
            </p>
          </div>

          {/* Link de afiliado para consultores */}
          {linkAfiliado && (
            <div style={{ background: '#ecfdf5', borderRadius: 16, border: '1px solid #a7f3d0', padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#065f46', marginBottom: 8, fontSize: 13 }}>
                <Share2 size={15} /> Seu link de afiliado para a calculadora
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input readOnly value={linkAfiliado} style={{ ...inp, fontSize: 12, background: 'white' }} />
                <button onClick={copiarLink}
                  style={{ padding: '0 14px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                  {copiado ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@media (max-width: 820px){ .calc-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
