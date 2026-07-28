import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Calculator, Gavel, TrendingUp, Target, Lock, Share2, Copy, Check, Info } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { calcularMetricasCenario, calcularTetoLance, fluxoLocacao, calcularTIR, fmt, fmtPct } from '../utils/calculos';

const ROLES_COM_ACESSO = ['top2', 'assessorado', 'clube', 'consultor', 'analista', 'advogado', 'admin'];

// ITBI + registro: fixo no pior cenário (média 5-6%; usamos 5% conservador)
const ITBI_FIXO = 5;
// Honorários BidPro: taxa de ÊXITO do escritório sobre o arremate (partilhada com
// jurídico/analista quando ativos; sem eles, integral ao admin). Aplica-se a TODO
// arremate — judicial E extrajudicial. NÃO é sucumbência.
const HONORARIOS_PCT = 10; // o motor aplica 10% por padrão em ambas as origens
// Taxa do leiloeiro: padrão de mercado
const TAXA_LEILOEIRO_PADRAO = 5;

const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#111111', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };

function fmtInput(v) {
  if (v === '' || v == null) return '';
  const n = Number(v);
  if (isNaN(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Campo({ label, value, onChange, prefix = '', suffix = '', type = 'number', placeholder = '' }) {
  const isMoney = prefix === 'R$';
  const [displayVal, setDisplayVal] = React.useState(isMoney ? fmtInput(value) : String(value || ''));
  React.useEffect(() => {
    if (!isMoney) return;
    setDisplayVal(value === '' || value == null ? '' : fmtInput(value));
  }, [value, isMoney]);

  const handleChange = (e) => {
    const raw = e.target.value;
    if (isMoney) {
      // Modelo "centavos": cada dígito digitado é centavo → mostra sempre 2 casas
      const digits = raw.replace(/\D/g, '');
      const reais = digits ? Number(digits) / 100 : '';
      setDisplayVal(reais === '' ? '' : fmtInput(reais));
      onChange(reais === '' ? '' : reais);
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
  // Imóvel vindo da tela do imóvel ("Simular na Calculadora"): pré-preenche os
  // valores e, do raio-X jurídico (ficha_juridica), os débitos assumidos e o
  // custo estimado de desocupação. Vazio quando aberta direto pelo menu.
  const locCalc = useLocation();
  const imPre = locCalc.state?.imovel || null;
  const fjPre = imPre?.fichaJuridica || imPre?.ficha_juridica || null;
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
      if (!res.ok) {
        // Não confiar em corpo de erro como se fosse "sem conta" (roteava errado no 429/5xx).
        setLeadMsg(res.status === 429 ? 'Muitas tentativas. Aguarde um instante e tente de novo.' : 'Não foi possível verificar agora. Tente novamente.');
        setLeadEnviando(false);
        return;
      }
      const d = await res.json().catch(() => ({}));
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

  const [origem, setOrigem] = useState(/judicial/i.test(imPre?.modalidade || '') ? 'judicial' : 'extrajudicial');
  const [pagamento, setPagamento] = useState('a_vista');
  const [tabela, setTabela] = useState('sac');

  // Valores pré-preenchidos do imóvel (quando veio da tela do imóvel); senão vazios.
  const [arrematacao, setArrematacao] = useState(imPre?.valorMinimo ? String(imPre.valorMinimo) : '');
  const [mercado, setMercado] = useState(imPre?.valorMercado ? String(imPre.valorMercado) : '');
  const [avaliacao, setAvaliacao] = useState(imPre?.valorAvaliacao ? String(imPre.valorAvaliacao) : '');

  const [debitos, setDebitos] = useState(Number(fjPre?.debitosAssumidos) || 0);
  const [reforma, setReforma] = useState(Number(fjPre?.desocupacaoCusto) || 0);
  const [iptuMensal, setIptuMensal] = useState(0);
  const [condominioMensal, setCondominioMensal] = useState(0);
  const [sinal, setSinal] = useState(25);
  const [prazoMeses, setPrazoMeses] = useState(360);
  const [cet, setCet] = useState(15);   // 15% padrão, editável
  const [prazoVenda, setPrazoVenda] = useState(12);
  const [metaRoi, setMetaRoi] = useState(30);  // 30% padrão (revenda)
  // Objetivo: revenda (flip) ou aluguel (hold + renda). Rafael/investidor que aluga
  // quer ver yield e renda mensal, não o lucro de revenda.
  const [objetivo, setObjetivo] = useState(/aluguel|locac/i.test(imPre?.objetivo || '') ? 'aluguel' : 'revenda');
  const [aluguel, setAluguel] = useState(imPre?.valorLocacao ? String(imPre.valorLocacao) : '');
  // Aluguel esperado sugerido = 0,5% do valor de mercado (regra de bolso do setor,
  // "renda livre ao arrematante"), EDITÁVEL: só auto-preenche enquanto o usuário
  // não digitar um valor próprio. Se veio pré-preenchido do imóvel, já conta como editado.
  const [aluguelEditado, setAluguelEditado] = useState(!!imPre?.valorLocacao);
  const [horizonteAnos, setHorizonteAnos] = useState(5);
  const [metaYield, setMetaYield] = useState(8); // meta de yield líquido a.a. (aluguel)

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

  // Aluguel esperado sugerido = 0,5% do valor de mercado por mês (referência do
  // setor). É o aluguel LIVRE do dono: IPTU e condomínio são cobrados do inquilino
  // à parte. Só auto-preenche enquanto o usuário não digitar um valor próprio.
  useEffect(() => {
    if (aluguelEditado) return;
    const m = Number(mercado) || 0;
    setAluguel(m > 0 ? String(Math.round(m * 0.005)) : '');
  }, [mercado, aluguelEditado]);

  const isAVista = pagamento === 'a_vista';

  const inputs = useMemo(() => ({
    objetivoCompra: 'investimento',
    origem,
    tabelaAmortizacao: tabela,
    valorMercado: Number(mercado) || 0,
    valorArrematacao: Number(arrematacao) || 0,
    valorLocacao: Number(aluguel) || 0,
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
  }), [origem, tabela, mercado, arrematacao, aluguel, reforma, debitos, iptuMensal, condominioMensal, sinal, prazoMeses, cet, prazoVenda, isAVista]);

  const vArr = Number(arrematacao) || 0;
  const vMerc = Number(mercado) || 0;
  const vAval = Number(avaliacao) || 0;

  const m = useMemo(() => calcularMetricasCenario(inputs, vArr, isAVista), [inputs, vArr, isAVista]);
  const teto = useMemo(() => calcularTetoLance(inputs, isAVista, Number(metaRoi) || 0, vMerc), [inputs, isAVista, metaRoi, vMerc]);

  // ── Modo ALUGUEL (hold + renda) ──────────────────────────────────────────────
  const isAluguel = objetivo === 'aluguel';
  const vAluguel = Number(aluguel) || 0;
  const carregoMensal = (Number(iptuMensal) || 0) + (Number(condominioMensal) || 0);
  // Aluguel LIVRE: o dono recebe o aluguel cheio; IPTU e condomínio são cobrados do
  // inquilino à parte (não saem da renda do dono). O total que o inquilino paga é o
  // aluguel + IPTU + condomínio.
  const rendaLiquidaMensal = vAluguel;
  // Capital de aquisição (sem o carrego do flip, que aqui é custo recorrente do hold).
  const capitalAquisicao = Math.max(0, m.capitalMobilizado - m.custoCarrrego);
  // FINANCIADO: o aluguel SERVE o financiamento. O que de fato sobra (ou falta) no seu caixa por
  // mês é aluguel − parcela. Antes o rendimento usava o aluguel BRUTO ÷ entrada, ignorando a
  // parcela → mostrava um yield alto (ex.: 24,7%) num imóvel que na verdade é caixa NEGATIVO.
  const parcelaFin = isAVista ? 0 : (m.parcelaMedia || 0);
  const fluxoMensalCaixa = rendaLiquidaMensal - parcelaFin; // pode ser negativo (você banca a diferença)
  const yieldLiquidoAnual = capitalAquisicao > 0 ? (fluxoMensalCaixa * 12 / capitalAquisicao) * 100 : 0;
  const paybackMesesAluguel = fluxoMensalCaixa > 0 ? capitalAquisicao / fluxoMensalCaixa : null;
  // Fluxo hold → TIR e múltiplo. IPTU/condomínio ZERADOS aqui: são pagos pelo
  // inquilino, então o caixa do dono é só o aluguel (+ venda ao fim do horizonte).
  const fl = useMemo(() => fluxoLocacao({ ...inputs, iptuMensal: 0, condominioMensal: 0 }, (Number(horizonteAnos) || 1) * 12), [inputs, horizonteAnos]);
  const tirAluguel = useMemo(() => calcularTIR(fl.fluxos), [fl]);
  const retornoTotalAluguel = fl.fluxos.reduce((s, f) => s + (f > 0 ? f : 0), 0);
  const multiploAluguel = fl.capital > 0 ? retornoTotalAluguel / fl.capital : null;
  // Teto de lance p/ aluguel: maior arremate que mantém o yield líquido ≥ meta.
  const tetoAluguel = useMemo(() => {
    if (rendaLiquidaMensal <= 0) return 0;
    let low = 0, high = (vMerc || 0) * 1.5 || 1e9, t = 0;
    for (let i = 0; i < 50; i++) {
      const mid = (low + high) / 2;
      const mm = calcularMetricasCenario(inputs, mid, isAVista);
      const cap = Math.max(0, mm.capitalMobilizado - mm.custoCarrrego);
      // Yield LÍQUIDO de caixa (aluguel − parcela do financiamento nesse lance), coerente com o card.
      const netAnual = (rendaLiquidaMensal - (isAVista ? 0 : (mm.parcelaMedia || 0))) * 12;
      const y = cap > 0 ? (netAnual / cap) * 100 : 0;
      if (y >= (Number(metaYield) || 0)) { t = mid; low = mid; } else { high = mid; }
    }
    return t;
  }, [inputs, isAVista, rendaLiquidaMensal, vMerc, metaYield]);

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
  // Com o valor de arrematação informado, o cliente quer ver o RETORNO daquele
  // lance, não um teto/projeção de lance. O teto (quanto posso dar de lance) só
  // faz sentido quando ainda NÃO se decidiu o valor da arrematação.
  const arremInformado = vArr > 0;

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

          {/* Objetivo: revender (flip) ou alugar (renda/hold) — muda toda a projeção */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {[['revenda', '🔁 Revender'], ['aluguel', '🏠 Alugar']].map(([v, l]) => (
              <button key={v} onClick={() => setObjetivo(v)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid', borderColor: objetivo === v ? '#7c3aed' : '#e2e8f0', background: objetivo === v ? '#f5f3ff' : 'white', color: objetivo === v ? '#7c3aed' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
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
              Pagamento à vista no prazo fixado pelo juiz (geralmente 24h a 15 dias após a arrematação).
            </div>
          )}

          {imPre && (fjPre || imPre.valorMinimo) && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '11px 14px', marginBottom: 14, fontSize: 12.5, color: '#1e3a5f', lineHeight: 1.55 }}>
              <span>🧮</span>
              <div>
                Valores pré-preenchidos de <strong>{imPre.titulo || 'este imóvel'}</strong>.
                {fjPre?.debitosAssumidos ? ` Débitos assumidos (propter rem) do laudo: R$ ${Number(fjPre.debitosAssumidos).toLocaleString('pt-BR')}.` : ''}
                {fjPre?.desocupacaoCusto ? ` Custo estimado de desocupação em "Reforma/desocupação": R$ ${Number(fjPre.desocupacaoCusto).toLocaleString('pt-BR')}${fjPre.desocupacaoPrazoMeses ? ` (~${fjPre.desocupacaoPrazoMeses} ${fjPre.desocupacaoPrazoMeses > 1 ? 'meses' : 'mês'})` : ''}.` : ''}
                {' '}Revise antes de decidir.
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Campo label="Valor de arrematação" value={arrematacao} onChange={setArrematacao} prefix="R$" placeholder="0" />
            <Campo label="Valor de avaliação" value={avaliacao} onChange={setAvaliacao} prefix="R$" placeholder="0" />
            <Campo label="Valor de mercado" value={mercado} onChange={setMercado} prefix="R$" placeholder="0" />
            {/* Prazo p/ revenda só faz sentido no objetivo REVENDER (no aluguel quem
                define o horizonte é o campo "Horizonte de projeção"). */}
            {!isAluguel && <Campo label="Prazo p/ revenda" value={prazoVenda} onChange={setPrazoVenda} suffix="meses" />}
            <Campo label="Débitos assumidos" value={debitos} onChange={setDebitos} prefix="R$" placeholder="0" />
            <Campo label="Reforma / desocupação" value={reforma} onChange={setReforma} prefix="R$" placeholder="0" />
            {/* IPTU e condomínio mensais só no objetivo REVENDER (custo de carrego
                enquanto revende). No aluguel são pagos pelo inquilino → indiferentes
                para o dono neste cálculo preliminar. */}
            {!isAluguel && <Campo label="IPTU mensal" value={iptuMensal} onChange={setIptuMensal} prefix="R$" placeholder="0" />}
            {!isAluguel && <Campo label="Condomínio mensal" value={condominioMensal} onChange={setCondominioMensal} prefix="R$" placeholder="0" />}
          </div>

          {isAluguel && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
              <div>
                <Campo label="Aluguel mensal esperado" value={aluguel} onChange={(v) => { setAluguel(v); setAluguelEditado(true); }} prefix="R$" placeholder="0" />
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
                  Sugestão: <strong>0,5% do valor de mercado por mês</strong> (aluguel livre; IPTU e condomínio são pagos pelo inquilino){!aluguelEditado && Number(mercado) > 0 ? ' — pode editar' : ''}.
                  {aluguelEditado && <button type="button" onClick={() => setAluguelEditado(false)} style={{ marginLeft: 4, background: 'none', border: 'none', color: '#7c3aed', fontWeight: 700, fontSize: 10, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>usar 0,5%</button>}
                </div>
              </div>
              <Campo label="Horizonte de projeção" value={horizonteAnos} onChange={setHorizonteAnos} suffix="anos" />
            </div>
          )}

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

          {/* Meta só serve ao teto de lance — some quando já há valor de arrematação. */}
          {!arremInformado && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
              {isAluguel
                ? <Campo label="Rendimento por ano que você quer (para calcular o teto de lance)" value={metaYield} onChange={setMetaYield} suffix="%" />
                : <Campo label="Retorno que você quer (para calcular o teto de lance)" value={metaRoi} onChange={setMetaRoi} suffix="%" />}
            </div>
          )}
        </div>

        {/* ── Resultados ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Teto de lance — SÓ quando ainda não há valor de arrematação. Com o
              arremate informado, mostramos o retorno (cards abaixo), não o teto. */}
          {!arremInformado && (() => {
            const tetoVal = isAluguel ? tetoAluguel : teto;
            // Teto se calcula a partir do valor de mercado (+ aluguel, no caso de
            // locação); não precisa do valor de arrematação.
            const temDadosTeto = isAluguel ? (vMerc > 0 && vAluguel > 0) : vMerc > 0;
            const metaTxt = isAluguel ? `rendimento de ${fmtPct(metaYield, 2)} ao ano` : `retorno de ${fmtPct(metaRoi, 2)}`;
            return (
            <div style={{ background: temDadosTeto ? 'linear-gradient(135deg,#1e3a8a,#0D63DB)' : '#f1f5f9', borderRadius: 16, padding: 22, color: temDadosTeto ? 'white' : '#94a3b8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, opacity: 0.85, textTransform: 'uppercase', letterSpacing: 1 }}>
                <Target size={15} /> Teto máximo de lance
              </div>
              <div style={{ fontSize: temDadosTeto ? (tetoVal > 0 ? 32 : 20) : 22, fontWeight: 900, margin: '6px 0 2px' }}>
                {!temDadosTeto ? '—' : tetoVal > 0 ? `R$ ${fmt(tetoVal, 2)}` : 'Meta inatingível'}
              </div>
              {!temDadosTeto
                ? <div style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>Preencha o <strong>Valor de mercado</strong>{isAluguel ? ' e o Aluguel mensal' : ''} para ver quanto dá para dar de lance. Ou informe o <strong>Valor de arrematação</strong> para ver o retorno.</div>
                : tetoVal > 0
                  ? <div style={{ fontSize: 12, opacity: 0.85 }}>Maior lance que mantém {metaTxt} ({isAVista ? 'à vista' : origem === 'judicial' ? 'CPC 895' : `financiado ${nomeTabela}`}). Informe o Valor de arrematação para ver o retorno do seu lance.</div>
                  : <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>Nenhum lance atinge {metaTxt} com esses custos. Reduza a meta ou revise os parâmetros.</div>
              }
            </div>
            );
          })()}

          {/* Cenário ALUGUEL: renda mensal, yield e retorno total no horizonte */}
          {temDados && isAluguel && (
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#111111', marginBottom: 14 }}>
                <TrendingUp size={16} color="#7c3aed" /> Projeção de aluguel (renda + valorização)
              </div>
              <Linha label="Desconto sobre a avaliação" valor={vAval > 0 ? fmtPct(descontoAvaliacao, 2) : '—'} cor={descontoAvaliacao > 0 ? '#059669' : '#dc2626'} />
              <Linha label="Total investido" valor={`R$ ${fmt(capitalAquisicao, 2)}`} sublabel={isAVista ? 'Arremate + custos do leilão + dívidas/reforma' : 'Entrada + custos do leilão + dívidas/reforma (o resto é financiado)'} destaque />
              <Linha label="Aluguel por mês (livre para você)" valor={vAluguel > 0 ? `R$ ${fmt(vAluguel, 2)}` : '—'} destaque cor="#059669" sublabel="IPTU e condomínio ficam com o inquilino" />
              {/* Fluxo de caixa mensal quando FINANCIA e ALUGA: a parcela precisa ser
                  coberta pelo aluguel. Sem isto, o cliente não conseguia validar. */}
              {!isAVista && (
                <>
                  <Linha label={origem === 'judicial' ? 'Parcela mensal (CPC 895)' : `Parcela mensal (${nomeTabela})`} valor={`R$ ${fmt(m.parcelaMedia, 2)}`} sublabel="Do financiamento/parcelamento do arremate" />
                  <Linha
                    label="O aluguel paga a parcela?"
                    valor={vAluguel > 0
                      ? (vAluguel >= m.parcelaMedia
                          ? `Sim — sobra R$ ${fmt(vAluguel - m.parcelaMedia, 2)}/mês`
                          : `Não — falta R$ ${fmt(m.parcelaMedia - vAluguel, 2)}/mês`)
                      : '—'}
                    destaque
                    cor={vAluguel > 0 ? (vAluguel >= m.parcelaMedia ? '#059669' : '#dc2626') : undefined} />
                </>
              )}
              <div style={{ marginTop: 4 }} />
              <Linha label="Rendimento por ano" valor={fmtPct(yieldLiquidoAnual, 2)} destaque cor={yieldLiquidoAnual >= 0 ? '#059669' : '#dc2626'} sublabel={isAVista ? 'Aluguel de 12 meses ÷ total investido' : 'Caixa livre (aluguel − parcela) de 12 meses ÷ total investido'} />
              <Linha label="Tempo p/ o aluguel pagar o que investiu" valor={paybackMesesAluguel ? `${Math.ceil(paybackMesesAluguel)} meses (~${(paybackMesesAluguel / 12).toFixed(1)} anos)` : (isAVista ? '—' : 'O aluguel não cobre a parcela')} />
              <div style={{ margin: '10px 0 4px', padding: '12px 14px', background: '#f5f3ff', borderRadius: 10, border: '1px solid #ddd6fe' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Ganho total em {horizonteAnos} anos (aluguel + venda no final)</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#6d28d9', fontWeight: 600 }}>Retorno por ano</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6' }}>{tirAluguel != null ? fmtPct(tirAluguel, 2) : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#6d28d9', fontWeight: 600 }}>Quantas vezes o dinheiro volta</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6' }}>{multiploAluguel != null ? `${multiploAluguel.toFixed(2)}x` : '—'}</span>
                </div>
                <div style={{ fontSize: 10.5, color: '#7c3aed', marginTop: 8, lineHeight: 1.5 }}>IPTU e condomínio são pagos pelo inquilino. Considera a venda no final por 90% do valor de mercado (já descontando comissão e Imposto de Renda). A conta de manter alugado não usa financiamento.</div>
              </div>
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#fef9c3', borderRadius: 8, display: 'flex', gap: 8 }}>
                <Info size={14} color="#a16207" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11, color: '#a16207', margin: 0, lineHeight: 1.5 }}>
                  <strong>Estimativa conservadora.</strong> Não considera meses sem inquilino, reajuste do aluguel nem valorização acima da inflação. Fale com nosso analista para o detalhamento.
                </p>
              </div>
            </div>
          )}

          {/* Cenário atual (revenda) */}
          {temDados && !isAluguel && (
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#111111', marginBottom: 14 }}>
                <TrendingUp size={16} color="#0D63DB" /> Cenário no lance atual
              </div>

              <Linha label="Desconto sobre avaliação" valor={vAval > 0 ? fmtPct(descontoAvaliacao, 2) : '—'} cor={descontoAvaliacao > 0 ? '#059669' : '#dc2626'} />
              <Linha label="Valor de arrematação" valor={`R$ ${fmt(vArr, 2)}`} />
              <Linha
                label="Custos do leilão"
                valor={`R$ ${fmt(custosLeilao, 2)}`}
                sublabel="Comissão do leiloeiro + honorários + ITBI e registro"
              />
              {m.debitos > 0 && <Linha label="Dívidas assumidas" valor={`R$ ${fmt(m.debitos, 2)}`} />}
              {m.manutencao > 0 && <Linha label="Reforma estimada" valor={`R$ ${fmt(m.manutencao, 2)}`} />}
              {m.custoCarrrego > 0 && <Linha label="Custos até vender (IPTU + condomínio)" valor={`R$ ${fmt(m.custoCarrrego, 2)}`} />}

              {/* Necessidade de caixa, o que precisa ter disponível */}
              <div style={{ margin: '12px 0 4px', padding: '12px 14px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#084BA6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Necessidade de caixa</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#084BA6', fontWeight: 600 }}>
                    {isAVista ? 'Total na arrematação' : 'Total no ato (sinal + custos)'}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: '#1e3a8a' }}>R$ {fmt(desembolsoArrematacao, 2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#084BA6', fontWeight: 600 }}>Parcela mensal a suportar</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: '#1e3a8a' }}>
                    {isAVista ? '—' : `R$ ${fmt(m.parcelaMedia, 2)}`}
                  </span>
                </div>
              </div>

              {!isAVista && (
                <>
                  <Linha label="Sinal / entrada" valor={`R$ ${fmt(m.valorSinal, 2)}`} />
                  <Linha
                    label={origem === 'judicial' ? 'Parcela (CPC 895)' : `Parcela (${nomeTabela})`}
                    valor={`R$ ${fmt(m.parcelaMedia, 2)}`} />
                  <Linha label="Saldo para quitar" valor={`R$ ${fmt(m.saldoDevedor, 2)}`} sublabel={origem === 'judicial' ? 'Parcelas que ainda faltam pagar' : 'Quanto falta pagar ao vender'} />
                </>
              )}

              <div style={{ marginTop: 4 }} />
              <Linha label="Total investido" valor={`R$ ${fmt(m.capitalMobilizado, 2)}`} destaque />
              <Linha label="Valor de venda estimado" valor={`R$ ${fmt(m.valorRef, 2)}`} sublabel="90% do valor de mercado (conservador)" cor="#0D63DB" />
              <Linha label="Comissão da corretagem na venda" valor={`– R$ ${fmt(m.comissao, 2)}`} sublabel="5% sobre a venda" cor="#dc2626" />
              <Linha label="Imposto de Renda sobre o lucro (15%)" valor={`– R$ ${fmt(m.ir, 2)}`} sublabel="15% sobre o ganho na venda" cor="#dc2626" />
              <Linha label="Dinheiro recebido na venda" valor={`R$ ${fmt(entradaCaixa, 2)}`} destaque cor="#0D63DB" />
              <Linha label="Lucro (já com todos os custos)" valor={`R$ ${fmt(m.lucro, 2)}`} destaque cor={m.lucro >= 0 ? '#059669' : '#dc2626'} />
              <Linha label="Retorno sobre o valor investido" valor={fmtPct(m.roi, 2)} destaque cor={m.roi >= 0 ? '#059669' : '#dc2626'} />

              {/* Aviso conservador */}
              <div style={{ marginTop: 14, padding: '10px 12px', background: '#fef9c3', borderRadius: 8, display: 'flex', gap: 8 }}>
                <Info size={14} color="#a16207" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11, color: '#a16207', margin: 0, lineHeight: 1.5 }}>
                  <strong>Estimativa conservadora.</strong> Os valores reais podem divergir conforme custos cartorários específicos, honorários negociados, condições jurídicas do imóvel e variações de mercado. Os percentuais de cada custo não são exibidos aqui, consulte nosso analista para o detalhamento completo.
                </p>
              </div>
            </div>
          )}

          {/* (Removido) Link de afiliado da calculadora — captação de marketing fica fora do
              Programa de Parceiros; a indicação do parceiro é feita pelo link em "Indicações". */}
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
        // Vai direto ao checkout do Investidor Pro (a apresentação e o preço estão lá)
        const irAssinar = () => nav('/checkout?plano=top2');

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
                  ⭐ Investidor Pro, o plano completo
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 900, lineHeight: 1.25 }}>
                  {isExplorador
                    ? 'Desbloqueie análises completas com o Investidor Pro'
                    : temRef
                      ? 'Gostou da calculadora? Acesse a plataforma completa.'
                      : 'Invista com mais segurança e inteligência'}
                </h3>
                <p style={{ color: '#bfdbfe', fontSize: 13, lineHeight: 1.7, margin: '0 0 10px' }}>
                  Esta calculadora é só o começo. No <strong style={{ color: 'white' }}>Investidor Pro</strong> você tem a <strong style={{ color: 'white' }}>informação completa de cada imóvel</strong>: relatório de viabilidade, análise jurídica do edital e da matrícula, análise processual e o <strong style={{ color: 'white' }}>Bid Score</strong> da operação, tudo para dar o lance certo, com segurança.
                </p>
                <p style={{ color: '#93c5fd', fontSize: 12, lineHeight: 1.6, margin: '0 0 18px', fontWeight: 600 }}>
                  📊 Pare de adivinhar: veja o imóvel por inteiro antes do lance.
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

            {/* Formulário lead, apenas quando vem de link de consultor */}
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
