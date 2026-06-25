import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calculator, Gavel, TrendingUp, Target, Lock, Share2, Copy, Check, Info } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { calcularMetricasCenario, calcularTetoLance, fmt, fmtPct } from '../utils/calculos';

const ROLES_COM_ACESSO = ['top1', 'top2', 'assessorado', 'clube', 'consultor', 'analista', 'advogado', 'admin'];

// ITBI + registro: fixo no pior cenário (média 5-6%; usamos 5% conservador)
const ITBI_FIXO = 5;
// Honorários advocatícios: aplicados em todas as modalidades
const HONORARIOS_PCT = 10; // já embutido no motor (vArremate * 0.10)
// Taxa do leiloeiro: padrão de mercado
const TAXA_LEILOEIRO_PADRAO = 5;

const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#111111', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };

function fmtInput(v) {
  const n = Number(String(v).replace(/\D/g, ''));
  if (!n && n !== 0) return '';
  return n.toLocaleString('pt-BR');
}

function Campo({ label, value, onChange, prefix = '', suffix = '', type = 'number', placeholder = '' }) {
  const isMoney = prefix === 'R$';
  const [displayVal, setDisplayVal] = React.useState(isMoney ? fmtInput(value) : String(value || ''));
  React.useEffect(() => {
    if (!isMoney) return;
    const raw = Number(String(value).replace(/\D/g, ''));
    const formatted = raw ? fmtInput(raw) : (value === '' ? '' : fmtInput(value));
    setDisplayVal(formatted);
  }, [value, isMoney]);

  const handleChange = (e) => {
    const raw = e.target.value;
    if (isMoney) {
      const digits = raw.replace(/\D/g, '');
      setDisplayVal(digits ? Number(digits).toLocaleString('pt-BR') : '');
      onChange(digits || '');
    } else {
      onChange(raw);
    }
  };

  return (
    <div>
      <label style={lbl}>{label}</label>
      <div style={{ position: 'relative' }}>
        {prefix && <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#64748b', fontWeight: 600, pointerEvents: 'none' }}>{prefix}</span>}
        <input
          type={isMoney ? 'text' : type}
          value={isMoney ? displayVal : (value || '')}
          onChange={handleChange}
          placeholder={placeholder}
          inputMode={isMoney ? 'numeric' : undefined}
          style={{ ...inp, paddingLeft: prefix ? 28 : 11, paddingRight: suffix ? 34 : 11 }} />
        {suffix && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#64748b', fontWeight: 600, pointerEvents: 'none' }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Linha({ label, valor, destaque, cor, sublabel }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div>
        <span style={{ color: destaque ? '#111111' : '#64748b', fontWeight: destaque ? 800 : 500, fontSize: destaque ? 14 : 13 }}>{label}</span>
        {sublabel && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{sublabel}</div>}
      </div>
      <span style={{ color: cor || (destaque ? '#111111' : '#334155'), fontWeight: destaque ? 800 : 700, fontSize: destaque ? 14 : 13, marginLeft: 12, textAlign: 'right' }}>{valor}</span>
    </div>
  );
}

export default function Calculadora() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, role, effectiveRole, loading: authLoading } = useAuth();

  // Captura e persiste o código de referência do consultor
  const refAtualUrl = searchParams.get('ref') || '';
  useEffect(() => {
    if (refAtualUrl) sessionStorage.setItem('tsn_ref_codigo', refAtualUrl);
  }, [refAtualUrl]);

  // Mini formulário de captura do lead (quando vem de link de consultor)
  const [leadCpf, setLeadCpf] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadEnviando, setLeadEnviando] = useState(false);
  const [leadMsg, setLeadMsg] = useState('');

  async function submeterLead(e) {
    e.preventDefault();
    if (!leadEmail.trim()) return;
    setLeadEnviando(true);
    setLeadMsg('');
    try {
      const ref = refAtualUrl || sessionStorage.getItem('tsn_ref_codigo') || '';
      const res = await fetch('/api/verificar-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: leadCpf, email: leadEmail }),
      });
      const d = await res.json();
      if (ref) sessionStorage.setItem('tsn_ref_codigo', ref);
      if (d.temConta) {
        // Já tem conta → vai para login
        nav(`/login?email=${encodeURIComponent(leadEmail)}${ref ? `&ref=${ref}` : ''}`);
      } else {
        // Sem conta → cadastro com dados pré-preenchidos
        nav(`/login?modo=cadastro&email=${encodeURIComponent(leadEmail)}${leadCpf ? `&cpf=${encodeURIComponent(leadCpf)}` : ''}${ref ? `&ref=${ref}` : ''}`);
      }
    } catch {
      setLeadMsg('Erro de conexão. Tente novamente.');
    }
    setLeadEnviando(false);
  }

  const [origem, setOrigem] = useState('extrajudicial');
  const [pagamento, setPagamento] = useState('a_vista');
  const [tabela, setTabela] = useState('sac');

  // Valores iniciam zerados para o usuário preencher
  const [arrematacao, setArrematacao] = useState('');
  const [mercado, setMercado] = useState('');
  const [avaliacao, setAvaliacao] = useState('');

  const [debitos, setDebitos] = useState(0);
  const [reforma, setReforma] = useState(0);
  const [iptuMensal, setIptuMensal] = useState(0);
  const [condominioMensal, setCondominioMensal] = useState(0);
  const [sinal, setSinal] = useState(25);
  const [prazoMeses, setPrazoMeses] = useState(360);
  const [cet, setCet] = useState(15);   // 15% padrão, editável
  const [prazoVenda, setPrazoVenda] = useState(12);
  const [metaRoi, setMetaRoi] = useState(30);  // 30% padrão

  const [copiado, setCopiado] = useState(false);
  const [codigoRef, setCodigoRef] = useState('');

  useEffect(() => {
    if (!user || (role !== 'consultor' && role !== 'admin')) return;
    supabase.from('perfis').select('codigo_indicacao').eq('id', user.id).single()
      .then(({ data }) => { if (data?.codigo_indicacao) setCodigoRef(data.codigo_indicacao); });
  }, [user, role]);

  // Judicial: ao mudar para judicial, ajusta defaults do CPC 895
  useEffect(() => {
    if (origem === 'judicial') {
      setSinal(25);
      setPrazoMeses(30);
      setCet(0);   // CPC 895 não tem juros (correção pelo IPCA/SELIC a critério do juiz)
    } else {
      setPrazoMeses(360);
      setCet(15);
    }
  }, [origem]);

  const isAVista = pagamento === 'a_vista';

  const inputs = useMemo(() => ({
    objetivoCompra: 'investimento',
    tabelaAmortizacao: tabela,
    valorMercado: Number(mercado) || 0,
    valorLocacao: 0,
    manutencaoEstimada: Number(reforma) || 0,
    debitosAssumidos: Number(debitos) || 0,
    iptuMensal: Number(iptuMensal) || 0,
    condominioMensal: Number(condominioMensal) || 0,
    itbiPercentual: ITBI_FIXO,           // fixo no pior cenário
    sinalPercentual: isAVista ? 100 : Number(sinal) || 0,
    taxaLeiloeiroPercentual: TAXA_LEILOEIRO_PADRAO,
    laudemio: 0, foreiro: 0,
    prazoMeses: Number(prazoMeses) || 0,
    cetAnual: Number(cet) || 0,
    prazoVendaMeses: Number(prazoVenda) || 1,
  }), [tabela, mercado, reforma, debitos, iptuMensal, condominioMensal, sinal, prazoMeses, cet, prazoVenda, isAVista]);

  const vArr = Number(arrematacao) || 0;
  const vMerc = Number(mercado) || 0;
  const vAval = Number(avaliacao) || 0;

  const m = useMemo(() => calcularMetricasCenario(inputs, vArr, isAVista), [inputs, vArr, isAVista]);
  const teto = useMemo(() => calcularTetoLance(inputs, isAVista, Number(metaRoi) || 0, vMerc), [inputs, isAVista, metaRoi, vMerc]);

  const descontoAvaliacao = vAval > 0 && vArr > 0 ? (1 - vArr / vAval) * 100 : 0;

  // Custos do leilão = leiloeiro + honorários + ITBI+registro (sem débitos/reforma — esses são do imóvel)
  const custosLeilao = m.taxaLeiloeiro + m.honorarios + m.itbiRegistro;

  // Desembolso imediato na arrematação (o que precisa ter disponível no dia)
  const sinalOuArrematacao = isAVista ? vArr : (m.valorSinal || 0);
  const desembolsoArrematacao = sinalOuArrematacao + custosLeilao + (m.debitos || 0) + (m.manutencao || 0);

  // Entrada no caixa = receita líquida na venda
  const entradaCaixa = m.receitaLiquida;

  const nomeTabela = tabela === 'sac' ? 'SAC' : tabela === 'price' ? 'PRICE' : 'Hipoteca';

  const linkAfiliado = codigoRef
    ? `${window.location.origin}${window.location.pathname}#/calculadora?ref=${codigoRef}`
    : '';

  const copiarLink = () => {
    navigator.clipboard.writeText(linkAfiliado);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  if (authLoading) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Carregando…</div>;

  const temDados = vArr > 0 && vMerc > 0;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{ background: '#0D63DB', borderRadius: 10, padding: 8, display: 'flex' }}><Calculator size={22} color="white" /></div>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#111111', margin: 0 }}>Calculadora de Lance</h1>
      </div>
      <p style={{ color: '#64748b', margin: '0 0 24px', fontSize: 14 }}>Simule o teto de lance, custos e retorno para leilões judicial e extrajudicial.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }} className="calc-grid">

        {/* ── Entradas ── */}
        <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 22 }}>

          {/* Tipo de leilão */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[['extrajudicial', 'Extrajudicial'], ['judicial', 'Judicial']].map(([v, l]) => (
              <button key={v} onClick={() => setOrigem(v)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid', borderColor: origem === v ? '#0D63DB' : '#e2e8f0', background: origem === v ? '#eff6ff' : 'white', color: origem === v ? '#0D63DB' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Gavel size={14} /> {l}
              </button>
            ))}
          </div>

          {/* Pagamento */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {[['a_vista', 'À vista'], ['financiado', origem === 'judicial' ? 'Parcelado (CPC 895)' : 'Financiado']].map(([v, l]) => (
              <button key={v} onClick={() => setPagamento(v)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid', borderColor: pagamento === v ? '#059669' : '#e2e8f0', background: pagamento === v ? '#ecfdf5' : 'white', color: pagamento === v ? '#059669' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
          {origem === 'judicial' && pagamento === 'financiado' && (
            <div style={{ marginBottom: 14, padding: '8px 12px', background: '#eff6ff', borderRadius: 8, fontSize: 12, color: '#084BA6', fontWeight: 600 }}>
              CPC Art. 895: 25% de entrada + 30 parcelas mensais. Correção monetária a critério judicial.
            </div>
          )}
          {origem === 'judicial' && pagamento === 'a_vista' && (
            <div style={{ marginBottom: 14, padding: '8px 12px', background: '#fef3c7', borderRadius: 8, fontSize: 12, color: '#92400e', fontWeight: 600 }}>
              Pagamento à vista no prazo fixado pelo juiz (geralmente 24h–15 dias após a arrematação).
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Campo label="Valor de arrematação" value={arrematacao} onChange={setArrematacao} prefix="R$" placeholder="0" />
            <Campo label="Valor de avaliação" value={avaliacao} onChange={setAvaliacao} prefix="R$" placeholder="0" />
            <Campo label="Valor de mercado" value={mercado} onChange={setMercado} prefix="R$" placeholder="0" />
            <Campo label="Prazo p/ revenda" value={prazoVenda} onChange={setPrazoVenda} suffix="meses" />
            <Campo label="Débitos assumidos" value={debitos} onChange={setDebitos} prefix="R$" placeholder="0" />
            <Campo label="Reforma estimada" value={reforma} onChange={setReforma} prefix="R$" placeholder="0" />
            <Campo label="IPTU mensal" value={iptuMensal} onChange={setIptuMensal} prefix="R$" placeholder="0" />
            <Campo label="Condomínio mensal" value={condominioMensal} onChange={setCondominioMensal} prefix="R$" placeholder="0" />
          </div>

          {/* Parcelamento / Financiamento */}
          {!isAVista && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {origem === 'judicial' ? 'Parcelamento CPC 895' : 'Financiamento'}
              </div>
              {origem === 'extrajudicial' && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {[['sac', 'SAC'], ['price', 'PRICE']].map(([v, l]) => (
                    <button key={v} onClick={() => setTabela(v)}
                      style={{ flex: 1, padding: '7px', borderRadius: 8, border: '1px solid', borderColor: tabela === v ? '#0D63DB' : '#e2e8f0', background: tabela === v ? '#eff6ff' : 'white', color: tabela === v ? '#0D63DB' : '#64748b', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      {l}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                <Campo
                  label={origem === 'judicial' ? 'Entrada (mín. 25%)' : 'Entrada / sinal'}
                  value={sinal} onChange={setSinal} suffix="%" />
                <Campo
                  label={origem === 'judicial' ? 'Parcelas (máx. 30)' : 'Prazo'}
                  value={prazoMeses} onChange={setPrazoMeses} suffix={origem === 'judicial' ? 'x' : 'm'} />
                <Campo
                  label={origem === 'judicial' ? 'Correção anual' : 'CET anual'}
                  value={cet} onChange={setCet} suffix="%" />
              </div>
              {origem === 'extrajudicial' && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                  <strong>CET real:</strong> use o simulador de financiamento habitacional da sua instituição financeira e informe o valor acima.
                </div>
              )}
              {origem === 'judicial' && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 8, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                  Correção = 0% se o juiz não determinar índice; informe a taxa esperada (ex: SELIC ~10,5%) para projeção conservadora.
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
            <Campo label="Meta de retorno (ROI) para o teto de lance" value={metaRoi} onChange={setMetaRoi} suffix="%" />
          </div>
        </div>

        {/* ── Resultados ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Teto de lance */}
          <div style={{ background: temDados ? 'linear-gradient(135deg,#1e3a8a,#0D63DB)' : '#f1f5f9', borderRadius: 16, padding: 22, color: temDados ? 'white' : '#94a3b8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 1 }}>
              <Target size={15} /> Teto máximo de lance
            </div>
            <div style={{ fontSize: temDados ? 32 : 22, fontWeight: 900, margin: '6px 0 2px' }}>
              {temDados ? `R$ ${fmt(teto, 0)}` : '—'}
            </div>
            {temDados
              ? <div style={{ fontSize: 12, opacity: 0.85 }}>Para manter ROI de {fmtPct(metaRoi, 0)} ({isAVista ? 'à vista' : origem === 'judicial' ? 'CPC 895' : `financiado ${nomeTabela}`}).</div>
              : <div style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>Preencha <strong>Arrematação</strong> e <strong>Valor de mercado</strong> para calcular.</div>
            }
          </div>

          {/* Cenário atual */}
          {temDados && (
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#111111', marginBottom: 14 }}>
                <TrendingUp size={16} color="#0D63DB" /> Cenário no lance atual
              </div>

              <Linha label="Desconto sobre avaliação" valor={vAval > 0 ? fmtPct(descontoAvaliacao, 1) : '—'} cor={descontoAvaliacao > 0 ? '#059669' : '#dc2626'} />
              <Linha label="Valor de arrematação" valor={`R$ ${fmt(vArr, 0)}`} />
              <Linha
                label="Custos do leilão"
                valor={`R$ ${fmt(custosLeilao, 0)}`}
                sublabel="Comissão do leiloeiro + honorários + ITBI e registro"
              />
              {m.debitos > 0 && <Linha label="Débitos assumidos" valor={`R$ ${fmt(m.debitos, 0)}`} />}
              {m.manutencao > 0 && <Linha label="Reforma estimada" valor={`R$ ${fmt(m.manutencao, 0)}`} />}
              {m.custoCarrrego > 0 && <Linha label="Carrego (IPTU + cond.)" valor={`R$ ${fmt(m.custoCarrrego, 0)}`} />}

              {/* Necessidade de caixa — o que precisa ter disponível */}
              <div style={{ margin: '12px 0 4px', padding: '12px 14px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#084BA6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Necessidade de caixa</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#084BA6', fontWeight: 600 }}>
                    {isAVista ? 'Total na arrematação' : 'Total no ato (sinal + custos)'}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: '#1e3a8a' }}>R$ {fmt(desembolsoArrematacao, 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#084BA6', fontWeight: 600 }}>Parcela mensal a suportar</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: '#1e3a8a' }}>
                    {isAVista ? '—' : `R$ ${fmt(m.parcelaMedia, 0)}`}
                  </span>
                </div>
              </div>

              {!isAVista && (
                <>
                  <Linha label="Sinal / entrada" valor={`R$ ${fmt(m.valorSinal, 0)}`} />
                  <Linha
                    label={origem === 'judicial' ? 'Parcela (CPC 895)' : `Parcela (${nomeTabela})`}
                    valor={`R$ ${fmt(m.parcelaMedia, 0)}`} />
                  <Linha label="Saldo p/ quitação" valor={`R$ ${fmt(m.saldoDevedor, 0)}`} sublabel={origem === 'judicial' ? 'Saldo restante das parcelas' : 'Saldo devedor ao vender'} />
                </>
              )}

              <div style={{ marginTop: 4 }} />
              <Linha label="Capital mobilizado" valor={`R$ ${fmt(m.capitalMobilizado, 0)}`} destaque />
              <Linha label="Entrada no caixa (venda)" valor={`R$ ${fmt(entradaCaixa, 0)}`} destaque cor="#0D63DB" />
              <Linha label="Lucro líquido" valor={`R$ ${fmt(m.lucro, 0)}`} destaque cor={m.lucro >= 0 ? '#059669' : '#dc2626'} />
              <Linha label="ROI / ROE" valor={fmtPct(m.roi, 1)} destaque cor={m.roi >= 0 ? '#059669' : '#dc2626'} />

              {/* Aviso conservador */}
              <div style={{ marginTop: 14, padding: '10px 12px', background: '#fef9c3', borderRadius: 8, display: 'flex', gap: 8 }}>
                <Info size={14} color="#a16207" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11, color: '#a16207', margin: 0, lineHeight: 1.5 }}>
                  <strong>Estimativa conservadora.</strong> Os valores reais podem divergir conforme custos cartorários específicos, honorários negociados, condições jurídicas do imóvel e variações de mercado. Os percentuais de cada custo não são exibidos aqui — consulte nosso analista para o detalhamento completo.
                </p>
              </div>
            </div>
          )}

          {/* Link de afiliado — consultores e admin */}
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

      {/* ── Upsell Investidor Pro ── */}
      {(() => {
        const r = effectiveRole || role;
        const isPago = ['top2','assessorado','clube','consultor','analista','advogado','admin'].includes(r);
        const refAtivo = refAtualUrl || sessionStorage.getItem('tsn_ref_codigo') || '';
        const temRef = !!refAtivo;

        if (isPago) return null;

        const isExplorador = user && r === 'explorador';
        const checkoutUrl = `/checkout?plano=top2${refAtivo ? `&ref=${refAtivo}` : ''}`;
        const irAssinar = () => nav(user ? checkoutUrl : `/login?plano=top2${refAtivo ? `&ref=${refAtivo}` : ''}`);

        return (
          <div style={{ marginTop: 32, background: 'linear-gradient(135deg,#1e3a5f 0%,#084BA6 100%)', borderRadius: 16, padding: '28px 32px', color: 'white', border: '1px solid #3b82f6' }}>
            {temRef && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0D63DB', borderRadius: 20, padding: '4px 14px', fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 14 }}>
                🎯 ACESSO EXCLUSIVO PELO SEU CONSULTOR
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                  ⭐ Investidor Pro — R$ 49,90/mês
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 900, lineHeight: 1.25 }}>
                  {isExplorador
                    ? 'Desbloqueie análises completas com o Investidor Pro'
                    : temRef
                      ? 'Gostou da calculadora? Acesse a plataforma completa.'
                      : 'Invista com mais segurança e inteligência'}
                </h3>
                <p style={{ color: '#93c5fd', fontSize: 13, lineHeight: 1.7, margin: '0 0 18px' }}>
                  Relatório de viabilidade, análise jurídica do edital e matrícula, análise processual do imóvel e análises ilimitadas — tudo em uma plataforma.
                </p>
                <button onClick={irAssinar}
                  style={{ padding: '12px 24px', background: 'white', color: '#084BA6', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap', alignSelf: 'flex-start' }}>
                  Assinar Investidor Pro →
                </button>
              </div>

              {/* Destaques do plano */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
                {[
                  'Relatório de viabilidade completo',
                  'Análise jurídica de edital e matrícula',
                  'Análise processual do imóvel',
                  'Alertas de risco automáticos',
                  'Até 15 relatórios/mês (mercado + documental)',
                ].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#bfdbfe' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'rgba(134,239,172,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="9" height="9" viewBox="0 0 9 9"><polyline points="1,5 3.5,7.5 8,1.5" stroke="#86efac" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    {f}
                  </div>
                ))}
              </div>
            </div>

            {/* Formulário lead — apenas quando vem de link de consultor */}
            {temRef && (
              <form onSubmit={submeterLead} style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', marginBottom: 2 }}>Ou deixe seu contato para receber mais informações:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input value={leadCpf} onChange={e => setLeadCpf(e.target.value)} placeholder="CPF (opcional)"
                    style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #3b82f6', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: 13, boxSizing: 'border-box' }} />
                  <input required type="email" value={leadEmail} onChange={e => setLeadEmail(e.target.value)} placeholder="seu@email.com *"
                    style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #3b82f6', background: 'rgba(255,255,255,0.08)', color: 'white', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                {leadMsg && <div style={{ fontSize: 12, color: '#fca5a5' }}>{leadMsg}</div>}
                <button type="submit" disabled={leadEnviando}
                  style={{ padding: '11px', background: '#10b981', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: leadEnviando ? 0.7 : 1 }}>
                  {leadEnviando ? 'Enviando…' : 'Quero receber mais informações →'}
                </button>
              </form>
            )}
          </div>
        );
      })()}

      <style>{`@media (max-width: 820px){ .calc-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
