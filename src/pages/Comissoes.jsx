import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import useIsMobile from '../utils/useIsMobile';
import { DollarSign, TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react';

const ROLES_ELEGÍVEIS = ['admin', 'consultor', 'analista', 'advogado'];

const STATUS_LABEL = { pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado' };
const STATUS_COLOR = { pendente: '#d97706', pago: '#16a34a', cancelado: '#94a3b8' };
const SAQUE_STATUS_LABEL = { pendente: 'Aguardando', aprovado: 'Aprovado', pago: 'Pago', recusado: 'Recusado' };
const SAQUE_STATUS_COLOR = { pendente: '#d97706', aprovado: '#2563eb', pago: '#16a34a', recusado: '#ef4444' };

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
  const [saques, setSaques] = useState([]);
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

  useEffect(() => {
    if (!ROLES_ELEGÍVEIS.includes(role)) { nav('/'); return; }
    carregar();
  }, [role]);

  const [cfinConfig, setCfinConfig] = useState({});  // config financeira por gateway

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: s }, { data: p }, { data: cf }] = await Promise.all([
      supabase.from('comissoes').select('*').eq('beneficiario_id', user.id).order('created_at', { ascending: false }),
      supabase.from('saques').select('*').eq('usuario_id', user.id).order('criado_em', { ascending: false }),
      supabase.from('perfis').select('pix_key').eq('id', user.id).maybeSingle(),
      supabase.from('config_financeira').select('*'),
    ]);
    setComissoes(c || []);
    setSaques(s || []);
    const k = p?.pix_key || '';
    setPixKey(k);
    setPixKeySalva(k);
    if (cf) {
      const m = {};
      cf.forEach(r => { m[r.gateway] = r; });
      setCfinConfig(m);
    }
    setLoading(false);
  }, [user.id]);

  async function salvarPix() {
    setSalvandoPix(true);
    setMsgPix(null);
    const { error } = await supabase.from('perfis').update({ pix_key: pixKey.trim() }).eq('id', user.id);
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
    const { error } = await supabase.from('saques').insert({
      usuario_id: user.id,
      valor,
      pix_key: pixKeySalva,
    });
    if (error) setMsgSaque({ tipo: 'erro', txt: 'Erro ao solicitar saque.' });
    else {
      setMsgSaque({ tipo: 'ok', txt: 'Saque solicitado! Processamos em até 3 dias úteis.' });
      setValorSaque('');
      setShowSaqueForm(false);
      carregar();
    }
    setSolicitandoSaque(false);
    setTimeout(() => setMsgSaque(null), 5000);
  }

  const totalPendente = comissoes.filter(c => c.status === 'pendente').reduce((a, c) => a + Number(c.valor_comissao), 0);
  const totalPago = comissoes.filter(c => c.status === 'pago').reduce((a, c) => a + Number(c.valor_comissao), 0);
  const totalSaquesPendentes = saques.filter(s => ['pendente','aprovado'].includes(s.status)).reduce((a, s) => a + Number(s.valor), 0);
  const totalDisponivel = Math.max(0, totalPendente - totalSaquesPendentes);

  // Agrupamento por gateway
  const porGateway = comissoes.reduce((acc, c) => {
    const g = c.asaas_payment_id?.startsWith('pay_') ? 'pagar.me' : 'asaas';
    if (!acc[g]) acc[g] = { total: 0, qtd: 0 };
    acc[g].total += Number(c.valor_comissao);
    acc[g].qtd++;
    return acc;
  }, {});

  const inputStyle = {
    width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0',
    borderRadius: 8, fontSize: 14, color: '#0f172a', background: 'white',
    outline: 'none', boxSizing: 'border-box',
  };
  const cardStyle = {
    background: 'white', borderRadius: 14, padding: isMobile ? '16px' : '20px 24px',
    border: '1px solid #e2e8f0', marginBottom: 16,
  };
  const abaStyle = (a) => ({
    padding: '8px 18px', border: 'none', borderRadius: 8, fontWeight: 700,
    fontSize: 13, cursor: 'pointer',
    background: aba === a ? '#0f172a' : 'transparent',
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
          <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: '#0f172a', margin: 0 }}>Minhas Comissões</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Acompanhe seus repasses e solicite saques</p>
        </div>

        {/* Cards de resumo */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { icon: Clock, label: 'A receber', valor: fmt(totalPendente), cor: '#d97706', bg: '#fffbeb' },
            { icon: CheckCircle, label: 'Já recebido', valor: fmt(totalPago), cor: '#16a34a', bg: '#f0fdf4' },
            { icon: DollarSign, label: 'Disponível p/ saque', valor: fmt(totalDisponivel), cor: '#2563eb', bg: '#eff6ff' },
            { icon: TrendingUp, label: 'Total de vendas', valor: comissoes.length, cor: '#7c3aed', bg: '#faf5ff' },
          ].map(({ icon: Icon, label, valor, cor, bg }) => (
            <div key={label} style={{ background: bg, borderRadius: 12, padding: '14px 16px', border: `1px solid ${cor}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <Icon size={14} color={cor} />
                <div style={{ fontSize: 11, fontWeight: 700, color: cor, textTransform: 'uppercase' }}>{label}</div>
              </div>
              <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, color: '#0f172a' }}>{valor}</div>
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
              style={{ padding: '9px 18px', background: pixKey === pixKeySalva ? '#e2e8f0' : '#0f172a', color: pixKey === pixKeySalva ? '#94a3b8' : 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: pixKey === pixKeySalva ? 'default' : 'pointer' }}>
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
        <div style={{ ...cardStyle, background: totalDisponivel > 0 ? '#eff6ff' : 'white', border: `1px solid ${totalDisponivel > 0 ? '#2563eb44' : '#e2e8f0'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Solicitar saque</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Disponível: {fmt(totalDisponivel)}</div>
            </div>
            <button onClick={() => setShowSaqueForm(p => !p)} disabled={totalDisponivel <= 0 || !pixKeySalva}
              style={{ padding: '9px 18px', background: totalDisponivel > 0 && pixKeySalva ? '#2563eb' : '#e2e8f0', color: totalDisponivel > 0 && pixKeySalva ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: totalDisponivel > 0 && pixKeySalva ? 'pointer' : 'default' }}>
              Solicitar saque
            </button>
          </div>
          {!pixKeySalva && totalDisponivel > 0 && (
            <div style={{ fontSize: 12, color: '#d97706', marginTop: 8, fontWeight: 600 }}>Cadastre sua chave PIX acima para solicitar.</div>
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
                  style={{ padding: '9px 18px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
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
          {[['resumo','Resumo'], ['analitico','Por venda'], ['saques','Saques']].map(([a, l]) => (
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
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', textTransform: 'capitalize' }}>{g}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{d.qtd} venda{d.qtd !== 1 ? 's' : ''}</div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: '#2563eb' }}>{fmt(d.total)}</div>
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
                      // Detecta gateway pela estrutura do payment_id
                      const gw = c.asaas_payment_id
                        ? (c.asaas_payment_id.startsWith('pay_') ? 'pagarme' : 'asaas')
                        : null;
                      const cfg = gw ? (cfinConfig[gw] || {}) : {};
                      const taxaCredito = Number(cfg.taxa_credito_pct || 0);
                      const taxaAntecip = cfg.antecipacao_ativa ? Number(cfg.antecipacao_pct_mes || 0) : 0;
                      const prazo = cfg.prazo_recebimento_dias || (gw === 'pagarme' ? 30 : 32);

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
                          <td style={{ padding: '8px 10px', color: '#0f172a', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.referencia || c.origem}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>{gw || '—'}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{fmt(c.valor_base)}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>{Number(c.percentual).toFixed(1)}%</td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' }}>{fmt(comissaoBruta)}</td>
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
                  <strong>Taxa antecipação</strong> = custo de antecipar o recebível antes do prazo padrão (Asaas D+32 · Pagar.me D+30). Ativa quando habilitada no admin.<br/>
                  <strong>Comissão líquida</strong> = valor estimado após descontar as taxas. Valores reais podem variar por contrato.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Saques */}
        {aba === 'saques' && (
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 14 }}>Histórico de saques</div>
            {saques.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhuma solicitação de saque ainda.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {saques.map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#f8fafc', borderRadius: 8, gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{fmt(s.valor)}</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>PIX: {s.pix_key} · {fmtData(s.criado_em)}</div>
                      {s.observacao && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{s.observacao}</div>}
                    </div>
                    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: SAQUE_STATUS_COLOR[s.status] + '22', color: SAQUE_STATUS_COLOR[s.status], whiteSpace: 'nowrap' }}>
                      {SAQUE_STATUS_LABEL[s.status]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
