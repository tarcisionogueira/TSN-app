import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { useIsMobile } from '../utils/useIsMobile';
import { DollarSign, TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react';

const ROLES_ELEGÍVEIS = ['admin', 'consultor', 'analista', 'advogado'];

const STATUS_LABEL = { pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado' };
const STATUS_COLOR = { pendente: '#d97706', pago: '#16a34a', cancelado: '#94a3b8' };
// Extrato unificado (/api/saque)
const EXTRATO_STATUS_LABEL = { disponivel: 'Disponível', solicitado: 'Solicitado', sacado: 'Sacado', cancelado: 'Cancelado' };
const EXTRATO_STATUS_COLOR = { disponivel: '#16a34a', solicitado: '#d97706', sacado: '#0D63DB', cancelado: '#94a3b8' };
const TIPO_LABEL = { comissao_venda: 'Comissão de venda', honorario_exito: 'Honorário de êxito', saque: 'Saque' };

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

export default function Comissoes() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const isMobile = useIsMobile();

  const [comissoes, setComissoes] = useState([]);
  const [saldoApi, setSaldoApi] = useState(0);
  const [extrato, setExtrato] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState('resumo'); // resumo | analitico | saques
  const [pixKey, setPixKey] = useState('');
  const [pixKeySalva, setPixKeySalva] = useState('');
  const [salvandoPix, setSalvandoPix] = useState(false);
  const [msgPix, setMsgPix] = useState(null);
  const [solicitandoSaque, setSolicitandoSaque] = useState(false);
  const [valorSaque, setValorSaque] = useState('');
  const [msgSaque, setMsgSaque] = useState(null);
  const [showSaqueForm, setShowSaqueForm] = useState(false);
  const [proximaLiberacao, setProximaLiberacao] = useState(null); // data da próxima sexta de pagamento
  const [faltandoSaque, setFaltandoSaque] = useState([]); // campos do cadastro que faltam p/ liberar saque
  const [precisaAssinatura, setPrecisaAssinatura] = useState(false); // grátis: indica, mas só saca sendo pagante

  const [cfinConfig, setCfinConfig] = useState({});  // config financeira por gateway

  // "sexta, 18/07" a partir do ISO devolvido pela API (calculado no fuso Bahia no servidor).
  const fmtLiberacao = (iso) => {
    if (!iso) return null;
    try { return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso)); }
    catch { return null; }
  };

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: p }, { data: cf }, saqueRes] = await Promise.all([
      supabase.from('comissoes').select('*').eq('beneficiario_id', user.id).order('created_at', { ascending: false }),
      supabase.from('perfis').select('chave_pix').eq('id', user.id).maybeSingle(),
      supabase.from('config_financeira').select('*'),
      apiCall('/api/saque'),
    ]);
    setComissoes(c || []);
    try {
      const sq = await saqueRes.json();
      setSaldoApi(Number(sq.saldo || 0));
      setExtrato(Array.isArray(sq.extrato) ? sq.extrato : []);
      setProximaLiberacao(sq.proxima_liberacao || null);
      setFaltandoSaque(Array.isArray(sq.faltando) ? sq.faltando : []);
      setPrecisaAssinatura(!!sq.precisa_assinatura);
    } catch { setSaldoApi(0); setExtrato([]); }
    const k = p?.chave_pix || '';
    setPixKey(k);
    setPixKeySalva(k);
    if (cf) {
      const m = {};
      cf.forEach(r => { m[r.gateway] = r; });
      setCfinConfig(m);
    }
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    if (!ROLES_ELEGÍVEIS.includes(role)) { nav('/'); return; }
    carregar();
  }, [role, carregar]);

  async function salvarPix() {
    setSalvandoPix(true);
    setMsgPix(null);
    const { error } = await supabase.from('perfis').update({ chave_pix: pixKey.trim() }).eq('id', user.id);
    if (error) setMsgPix({ tipo: 'erro', txt: 'Erro ao salvar.' });
    else { setPixKeySalva(pixKey.trim()); setMsgPix({ tipo: 'ok', txt: 'Chave PIX salva!' }); }
    setSalvandoPix(false);
    setTimeout(() => setMsgPix(null), 3000);
  }

  async function solicitarSaque() {
    const valor = Number(valorSaque);
    if (!valor || valor <= 0) { setMsgSaque({ tipo: 'erro', txt: 'Informe um valor válido.' }); return; }
    if (!pixKeySalva) { setMsgSaque({ tipo: 'erro', txt: 'Salve sua chave PIX antes de solicitar.' }); return; }
    if (valor > totalDisponivel) { setMsgSaque({ tipo: 'erro', txt: 'Valor maior que o disponível.' }); return; }

    setSolicitandoSaque(true);
    setMsgSaque(null);
    try {
      const res = await apiCall('/api/saque', { method: 'POST', body: JSON.stringify({ valor }) });
      const data = await res.json();
      if (res.ok) {
        const lib = fmtLiberacao(proximaLiberacao);
        setMsgSaque({ tipo: 'ok', txt: `Saque solicitado! Liberação ${lib ? `na ${lib}` : 'na próxima sexta'}. Saldo restante: ${fmt(data.saldo_restante)}` });
        setValorSaque('');
        setShowSaqueForm(false);
        carregar();
      } else {
        setMsgSaque({ tipo: 'erro', txt: data.error || 'Erro ao solicitar saque.' });
      }
    } catch {
      setMsgSaque({ tipo: 'erro', txt: 'Erro ao solicitar saque.' });
    }
    setSolicitandoSaque(false);
    setTimeout(() => setMsgSaque(null), 5000);
  }

  const totalPendente = comissoes.filter(c => c.status === 'pendente').reduce((a, c) => a + Number(c.valor_comissao), 0);
  const totalPago = comissoes.filter(c => c.status === 'pago').reduce((a, c) => a + Number(c.valor_comissao), 0);
  // Saldo disponível p/ saque vem da API unificada (/api/saque)
  const totalDisponivel = saldoApi;

  // Agrupamento por gateway (usa a coluna real; fallback p/ linhas antigas)
  const porGateway = comissoes.reduce((acc, c) => {
    const g = c.gateway || (c.asaas_payment_id ? 'asaas' : 'mercadopago');
    if (!acc[g]) acc[g] = { total: 0, qtd: 0 };
    acc[g].total += Number(c.valor_comissao);
    acc[g].qtd++;
    return acc;
  }, {});

  const inputStyle = {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 14, color: '#111111', background: 'white',
    outline: 'none', boxSizing: 'border-box',
  };
  const cardStyle = {
    background: 'white', borderRadius: 14, padding: isMobile ? '16px' : '20px 24px',
    border: '1px solid #e2e8f0', marginBottom: 16,
  };
  const abaStyle = (a) => ({
    padding: '8px 18px', border: 'none', borderRadius: 8, fontWeight: 700,
    fontSize: 13, cursor: 'pointer',
    background: aba === a ? '#111111' : 'transparent',
    color: aba === a ? 'white' : '#64748b',
  });

  if (loading) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#64748b', fontSize: 14 }}>Carregando...</div>
    </div>
  );

  return (
    <div style={{ minHeight: '80vh', background: '#f1f5f9', padding: isMobile ? '20px 16px' : '36px 20px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: '#111111', margin: 0 }}>Minhas Comissões</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Acompanhe seus repasses e solicite saques</p>
        </div>

        {/* Cards de resumo */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { icon: Clock, label: 'A receber', valor: fmt(totalPendente), cor: '#d97706', bg: '#fffbeb' },
            { icon: CheckCircle, label: 'Já recebido', valor: fmt(totalPago), cor: '#16a34a', bg: '#f0fdf4' },
            { icon: DollarSign, label: 'Disponível p/ saque', valor: fmt(totalDisponivel), cor: '#0D63DB', bg: '#eff6ff' },
            { icon: TrendingUp, label: 'Total de vendas', valor: comissoes.length, cor: '#7c3aed', bg: '#faf5ff' },
          ].map(({ icon: Icon, label, valor, cor, bg }) => (
            <div key={label} style={{ background: bg, borderRadius: 12, padding: '14px 16px', border: `1px solid ${cor}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Icon size={14} color={cor} />
                <div style={{ fontSize: 11, fontWeight: 700, color: cor, textTransform: 'uppercase' }}>{label}</div>
              </div>
              <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, color: '#111111' }}>{valor}</div>
            </div>
          ))}
        </div>

        {/* Chave PIX */}
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 12 }}>Chave PIX para saque</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={pixKey}
              onChange={e => setPixKey(e.target.value)}
              placeholder="CPF, e-mail, telefone ou chave aleatória"
              style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            />
            <button onClick={salvarPix} disabled={salvandoPix || pixKey === pixKeySalva}
              style={{ padding: '9px 18px', background: pixKey === pixKeySalva ? '#e2e8f0' : '#111111', color: pixKey === pixKeySalva ? '#94a3b8' : 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: pixKey === pixKeySalva ? 'default' : 'pointer' }}>
              {salvandoPix ? 'Salvando...' : 'Salvar PIX'}
            </button>
          </div>
          {msgPix && (
            <div style={{ marginTop: 8, fontSize: 12, color: msgPix.tipo === 'ok' ? '#16a34a' : '#ef4444', fontWeight: 600 }}>
              {msgPix.txt}
            </div>
          )}
        </div>

        {/* Solicitar saque */}
        <div style={{ ...cardStyle, background: totalDisponivel > 0 ? '#eff6ff' : 'white', border: `1px solid ${totalDisponivel > 0 ? '#0D63DB44' : '#e2e8f0'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Solicitar saque</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Disponível: {fmt(totalDisponivel)}</div>
              {proximaLiberacao && (
                <div style={{ fontSize: 11, color: '#0D63DB', marginTop: 4, fontWeight: 600 }}>
                  Pagamentos às sextas · próxima liberação: {fmtLiberacao(proximaLiberacao)}
                </div>
              )}
            </div>
            {(() => { const liberado = totalDisponivel > 0 && faltandoSaque.length === 0 && !precisaAssinatura; return (
            <button onClick={() => setShowSaqueForm(p => !p)} disabled={!liberado}
              title={precisaAssinatura ? 'Assine um plano pago para liberar o saque' : (faltandoSaque.length > 0 ? `Complete o cadastro: falta ${faltandoSaque.join(', ')}` : undefined)}
              style={{ padding: '9px 18px', background: liberado ? '#0D63DB' : '#e2e8f0', color: liberado ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: liberado ? 'pointer' : 'default' }}>
              Solicitar saque
            </button>
            ); })()}
          </div>
          {precisaAssinatura && (
            <div style={{ marginTop: 8, background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#6d28d9', marginBottom: 4 }}>💜 Você pode indicar, mas para RECEBER precisa de uma assinatura ativa</div>
              <div style={{ fontSize: 11.5, color: '#7c3aed', lineHeight: 1.55 }}>Suas indicações continuam vinculadas a você e as comissões vão se acumulando. Para liberar o saque, assine um plano pago.</div>
              <button onClick={() => { window.location.hash = '#/planos'; }} style={{ marginTop: 8, padding: '8px 16px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>Ver planos e assinar →</button>
            </div>
          )}
          {faltandoSaque.length > 0 && (
            <div style={{ marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#92400e', marginBottom: 4 }}>⚠ Complete seu cadastro para liberar o saque. Falta:</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#92400e', lineHeight: 1.6 }}>
                {faltandoSaque.map(f => <li key={f}><strong>{f}</strong></li>)}
              </ul>
              <div style={{ fontSize: 11, color: '#a16207', marginTop: 4 }}>Chave PIX você preenche acima. Telefone e CPF, no seu Perfil; nome, se faltar, fale com o atendimento.</div>
            </div>
          )}
          {showSaqueForm && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #dbeafe' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Valor do saque (R$)</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="number" min="1" step="0.01" value={valorSaque}
                  onChange={e => setValorSaque(e.target.value)}
                  placeholder={`Máx. ${fmt(totalDisponivel)}`}
                  style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                />
                <button onClick={solicitarSaque} disabled={solicitandoSaque}
                  style={{ padding: '9px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {solicitandoSaque ? 'Enviando...' : 'Confirmar'}
                </button>
                <button onClick={() => setShowSaqueForm(false)}
                  style={{ padding: '9px 14px', background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
              {msgSaque && (
                <div style={{ marginTop: 8, fontSize: 12, color: msgSaque.tipo === 'ok' ? '#16a34a' : '#ef4444', fontWeight: 600 }}>
                  {msgSaque.txt}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', gap: 4, background: 'white', borderRadius: 10, padding: 4, border: '1px solid #e2e8f0', marginBottom: 20, width: 'fit-content' }}>
          {[['resumo','Resumo'], ['analitico','Por venda'], ['saques','Extrato']].map(([a, l]) => (
            <button key={a} onClick={() => setAba(a)} style={abaStyle(a)}>{l}</button>
          ))}
        </div>

        {/* Resumo por gateway */}
        {aba === 'resumo' && (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 14 }}>Por meio de pagamento</div>
            {Object.keys(porGateway).length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhuma comissão registrada ainda.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Object.entries(porGateway).map(([g, d]) => (
                  <div key={g} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#111111' }}>{g === 'asaas' ? 'Asaas' : g === 'mercadopago' ? 'Mercado Pago' : g}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{d.qtd} venda{d.qtd !== 1 ? 's' : ''}</div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#0D63DB' }}>{fmt(d.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Analítico por venda */}
        {aba === 'analitico' && (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 14 }}>Comissões por venda</div>
            {comissoes.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhuma comissão registrada ainda.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                      {['Data', 'Referência', 'Gateway', 'Valor base', '% Comissão', 'Comissão bruta', 'Taxa crédito', 'Taxa antecip.', 'Comissão líquida', 'Prazo', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comissoes.map(c => {
                      // Gateway pela coluna real (mercadopago | asaas); fallback p/ antigos.
                      const gw = c.gateway || (c.asaas_payment_id ? 'asaas' : 'mercadopago');
                      // config_financeira usa a chave 'mp' para o Mercado Pago.
                      const cfgKey = gw === 'asaas' ? 'asaas' : 'mp';
                      const cfg = cfinConfig[cfgKey] || {};
                      const taxaCredito = Number(cfg.taxa_credito_pct || 0);
                      const taxaAntecip = cfg.antecipacao_ativa ? Number(cfg.antecipacao_pct_mes || 0) : 0;
                      const prazo = cfg.prazo_recebimento_dias || (gw === 'asaas' ? 32 : 30);

                      // Taxas aplicadas sobre a comissão bruta
                      const comissaoBruta = Number(c.valor_comissao);
                      const descontoCredito = comissaoBruta * taxaCredito / 100;
                      // Taxa de antecipação: taxa mensal aplicada sobre o período (prazo / 30 meses)
                      const descontoAntecip = cfg.antecipacao_ativa
                        ? comissaoBruta * (taxaAntecip / 100) * (prazo / 30)
                        : 0;
                      const comissaoLiquida = comissaoBruta - descontoCredito - descontoAntecip;

                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{fmtData(c.created_at)}</td>
                          <td style={{ padding: '8px 10px', color: '#111111', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.referencia || c.origem}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{gw === 'asaas' ? 'Asaas' : gw === 'mercadopago' ? 'Mercado Pago' : (gw || '—')}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{fmt(c.valor_base)}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{Number(c.percentual).toFixed(2)}%</td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#111111', whiteSpace: 'nowrap' }}>{fmt(comissaoBruta)}</td>
                          <td style={{ padding: '8px 10px', color: taxaCredito > 0 ? '#ef4444' : '#94a3b8', whiteSpace: 'nowrap' }}>
                            {taxaCredito > 0 ? `−${fmt(descontoCredito)} (${taxaCredito}%)` : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', color: cfg.antecipacao_ativa ? '#d97706' : '#94a3b8', whiteSpace: 'nowrap' }}>
                            {cfg.antecipacao_ativa ? `−${fmt(descontoAntecip)} (${taxaAntecip}%/mês)` : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#16a34a', whiteSpace: 'nowrap' }}>{gw ? fmt(comissaoLiquida) : '—'}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{gw ? `D+${prazo}` : '—'}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: STATUS_COLOR[c.status] + '22', color: STATUS_COLOR[c.status] }}>
                              {STATUS_LABEL[c.status] || c.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Legenda */}
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#f8fafc', borderRadius: 8, fontSize: 11, color: '#64748b', lineHeight: 1.7 }}>
                  <strong style={{ color: '#334155' }}>Legenda:</strong><br/>
                  <strong>Taxa crédito</strong> = MDR do gateway aplicado sobre a comissão bruta (configurável em Admin → Configurações).<br/>
                  <strong>Taxa antecipação</strong> = custo de antecipar o recebível antes do prazo padrão (Asaas D+32 · Mercado Pago D+30). Ativa quando habilitada no admin.<br/>
                  <strong>Comissão líquida</strong> = valor estimado após descontar as taxas. Valores reais podem variar por contrato.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Extrato / Saques */}
        {aba === 'saques' && (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 14 }}>Extrato de saldo</div>
            {extrato.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhum lançamento ainda.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {extrato.map(e => {
                  const negativo = Number(e.valor) < 0;
                  return (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#f8fafc', borderRadius: 8, gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#111111' }}>{TIPO_LABEL[e.tipo] || e.tipo}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{e.descricao} · {fmtData(e.criado_em)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: negativo ? '#ef4444' : '#16a34a' }}>
                          {negativo ? '−' : '+'}{fmt(Math.abs(Number(e.valor)))}
                        </div>
                        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (EXTRATO_STATUS_COLOR[e.status] || '#94a3b8') + '22', color: EXTRATO_STATUS_COLOR[e.status] || '#94a3b8', whiteSpace: 'nowrap' }}>
                          {EXTRATO_STATUS_LABEL[e.status] || e.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
