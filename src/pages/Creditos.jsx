import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, FileText, Search, Wallet, Gift, ArrowLeft, RefreshCw, Info, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import PagamentoServico from '../components/PagamentoServico';

// Tela "Meus Créditos e Consumo" (#21) — o usuário monitora, num só lugar:
//  • a COTA mensal do plano por tipo (mercadológico, documental, índice): usado × limite;
//  • o BÔNUS disponível (consultas extras, inclusive as concedidas pela equipe no suporte);
//  • o SALDO de crédito pré-pago (usado quando a cota+bônus acabam) e o EXTRATO de movimentações.
// Respeita o modo suporte: usa effectiveUserId (admin/analista vê a conta do cliente).

const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (s) => { try { return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); } catch { return '—'; } };

// Rótulos amigáveis das funcionalidades no extrato de crédito.
const FUNC_LABEL = {
  mercado: 'Relatório Mercadológico', documental: 'Relatório Documental',
  laudo: 'Laudo de Viabilidade', indice: 'Consulta ao Índice',
  recarga: 'Recarga de crédito', credito: 'Recarga de crédito', ajuste: 'Ajuste',
};

const TIPOS = [
  { key: 'mercado', nome: 'Relatório Mercadológico', desc: 'Valor de mercado e viabilidade', Icon: BarChart3, cor: '#0D63DB' },
  { key: 'documental', nome: 'Relatório Documental', desc: 'Edital, matrícula e riscos', Icon: FileText, cor: '#0d9488' },
  { key: 'indice', nome: 'Consulta ao Índice', desc: 'Índice BidPro de preços', Icon: Search, cor: '#7c3aed' },
];

function CotaCard({ tipo, dados }) {
  const { nome, desc, Icon, cor } = tipo;
  const ilimitado = dados?.ilimitado;
  const usado = Number(dados?.usado || 0);
  const limite = dados?.limite;
  const bonus = Number(dados?.bonus || 0);
  const restanteMes = ilimitado ? null : Math.max(0, Number(limite || 0) - usado);
  const pct = ilimitado || !limite ? 0 : Math.min(100, Math.round((usado / limite) * 100));
  // `amostra` vem de minhas_cotas: o explorador tem contador VITALÍCIO, não mensal. Dizer
  // "restantes este mês" a ele fazia esperar uma renovação que nunca acontece.
  const janela = dados?.amostra ? 'no total' : 'este mês';
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: cor + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={cor} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111' }}>{nome}</div>
          <div style={{ fontSize: 11.5, color: '#64748b' }}>{desc}</div>
        </div>
      </div>
      {ilimitado ? (
        <div style={{ fontSize: 13, fontWeight: 800, color: cor }}>Ilimitado no seu plano</div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#111' }}>{restanteMes}<span style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}> de {limite}</span></div>
            <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700 }}>restantes {janela}</div>
          </div>
          <div style={{ height: 7, background: '#eef2f7', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: cor, transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>{usado} usada(s){dados?.amostra ? ' — amostra grátis, não renova' : ' no mês'}</div>
        </>
      )}
      {bonus > 0 && (
        <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 800 }}>
          <Gift size={13} /> +{bonus} bônus {ilimitado ? '' : 'extra'}{bonus > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export default function Creditos() {
  const { effectiveUserId, impersonate } = useAuth();
  const nav = useNavigate();
  const [cotas, setCotas] = useState(null);
  const [concessoes, setConcessoes] = useState([]);
  const [extrato, setExtrato] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  // Recarga de crédito (PIX/cartão) — o crédito só entra após o servidor confirmar o
  // pagamento no gateway (/api/creditos-recarga), nunca pelo cliente.
  const [recarga, setRecarga] = useState(false);
  const [valorRecarga, setValorRecarga] = useState(null);
  const [valorLivre, setValorLivre] = useState('');
  const [recarregando, setRecarregando] = useState(false);
  const [recargaOk, setRecargaOk] = useState(null);
  const [recargaErro, setRecargaErro] = useState('');

  const confirmarRecarga = async (paymentId) => {
    setRecarregando(true); setRecargaErro('');
    try {
      const res = await apiCall('/api/creditos-recarga', { method: 'POST', body: JSON.stringify({ paymentId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Não foi possível confirmar a recarga.');
      setRecargaOk({ valor: d.valor || valorRecarga });
      carregar();
    } catch (e) {
      setValorRecarga(null);
      setRecargaErro(e.message || 'Erro ao confirmar a recarga. Se você já pagou, fale com o suporte.');
    }
    setRecarregando(false);
  };

  const carregar = async () => {
    if (!effectiveUserId) return;
    setLoading(true); setErro('');
    try {
      const [cot, con, ext] = await Promise.all([
        supabase.rpc('minhas_cotas', { p_user_id: effectiveUserId }),
        supabase.from('cota_concessoes').select('mercado,documental,indice,motivo,criado_em').eq('user_id', effectiveUserId).order('criado_em', { ascending: false }).limit(20),
        supabase.from('credito_lancamentos').select('tipo,funcionalidade,valor,saldo_apos,justificativa,criado_em').eq('user_id', effectiveUserId).order('criado_em', { ascending: false }).limit(30),
      ]);
      if (cot?.error || cot?.data?.erro) setErro('Não foi possível carregar suas cotas.');
      setCotas(cot?.data?.erro ? null : (cot?.data || null));
      setConcessoes(Array.isArray(con?.data) ? con.data : []);
      setExtrato(Array.isArray(ext?.data) ? ext.data : []);
    } catch { setErro('Erro ao carregar. Tente novamente.'); }
    setLoading(false);
  };
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [effectiveUserId]);

  const saldo = Number(cotas?.credito_saldo || 0);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 60px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Cabeçalho */}
      <div>
        <button onClick={() => nav(-1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          <ArrowLeft size={15} /> Voltar
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111', margin: 0 }}>Meus créditos e consumo</h1>
            <div style={{ fontSize: 13.5, color: '#64748b', marginTop: 2 }}>Acompanhe suas consultas disponíveis, bônus e saldo.</div>
          </div>
          <button onClick={carregar} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {impersonate && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#92400e', fontWeight: 700 }}>
          Modo suporte — você está vendo os créditos de <b>{impersonate.nome}</b>.
        </div>
      )}

      {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#b91c1c' }}>{erro}</div>}

      {loading && !cotas ? (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Carregando…</div>
      ) : (
        <>
          {/* Cotas por tipo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {TIPOS.map(t => <CotaCard key={t.key} tipo={t} dados={cotas?.[t.key]} />)}
          </div>

          {/* Saldo de crédito pré-pago */}
          <div style={{ background: 'linear-gradient(135deg, #0D63DB 0%, #084BA6 100%)', borderRadius: 16, padding: '20px 22px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Wallet size={22} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9, textTransform: 'uppercase', letterSpacing: 0.5 }}>Saldo de crédito</div>
                <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1 }}>{BRL(saldo)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, opacity: 0.92, maxWidth: 300, lineHeight: 1.4 }}>
                Usado automaticamente quando a cota do mês e os bônus acabam. Cada relatório desconta apenas o custo real.
              </div>
              {/* Recarga: só o PRÓPRIO titular (no modo suporte a equipe não paga pelo cliente). */}
              {!impersonate && (
                <button onClick={() => setRecarga(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 18px', background: 'white', color: '#084BA6', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <Plus size={16} /> Adicionar créditos
                </button>
              )}
            </div>
          </div>

          {/* Modal de RECARGA — fecha o ciclo "Comprar créditos" (a Análise já mandava
              para cá, mas não existia como pagar). PIX/cartão via PagamentoServico; a
              confirmação é SERVIDOR-side (/api/creditos-recarga verifica o pagamento no
              MP e credita via RPC — o valor creditado é o realmente recebido). */}
          {recarga && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => !recarregando && setRecarga(false)}>
              <div style={{ background: 'white', borderRadius: 18, padding: '22px 22px 26px', width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                {recarregando ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#0D63DB', fontWeight: 700, fontSize: 14 }}>Confirmando sua recarga…</div>
                ) : recargaOk ? (
                  <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#059669' }}>Crédito adicionado!</div>
                    <div style={{ fontSize: 13.5, color: '#64748b', marginTop: 6 }}>{BRL(recargaOk.valor)} entraram no seu saldo.</div>
                    <button onClick={() => { setRecarga(false); setRecargaOk(null); setValorRecarga(null); }} style={{ marginTop: 18, padding: '12px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Fechar</button>
                  </div>
                ) : !valorRecarga ? (
                  <>
                    <div style={{ fontSize: 17, fontWeight: 900, color: '#111', marginBottom: 4 }}>Adicionar créditos</div>
                    <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16, lineHeight: 1.5 }}>O saldo é usado quando a cota mensal e os bônus acabam — cada relatório desconta só o custo real.</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                      {[50, 100, 250, 500].map(v => (
                        <button key={v} onClick={() => setValorRecarga(v)} style={{ padding: '16px 10px', background: '#f8fafc', border: '2px solid #e2e8f0', borderRadius: 12, fontWeight: 900, fontSize: 17, color: '#0f172a', cursor: 'pointer' }}>
                          {BRL(v)}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" min="20" placeholder="Outro valor (mín. R$ 20)" value={valorLivre} onChange={e => setValorLivre(e.target.value)}
                        style={{ flex: 1, padding: '11px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none' }} />
                      <button onClick={() => { const v = Math.floor(Number(valorLivre)); if (v >= 20) setValorRecarga(v); }} disabled={!(Number(valorLivre) >= 20)}
                        style={{ padding: '11px 16px', background: Number(valorLivre) >= 20 ? '#0D63DB' : '#94a3b8', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13.5, cursor: Number(valorLivre) >= 20 ? 'pointer' : 'not-allowed' }}>OK</button>
                    </div>
                    {recargaErro && <div style={{ marginTop: 10, fontSize: 12.5, color: '#b91c1c', fontWeight: 700 }}>{recargaErro}</div>}
                    <button onClick={() => setRecarga(false)} style={{ marginTop: 14, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', width: '100%' }}>Cancelar</button>
                  </>
                ) : (
                  <PagamentoServico
                    servico={{ id: 'recarga', proposito: 'recarga', nome: `Recarga de crédito — ${BRL(valorRecarga)}`, valor: valorRecarga }}
                    soCartao
                    onPago={confirmarRecarga}
                    onCancelar={() => setValorRecarga(null)}
                  />
                )}
              </div>
            </div>
          )}

          {/* Bônus concedidos pela equipe */}
          {concessoes.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '16px 20px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Gift size={17} color="#d97706" /> Bônus concedidos pela equipe
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {concessoes.map((c, i) => {
                  const partes = [
                    c.mercado > 0 ? `${c.mercado} mercadológico${c.mercado > 1 ? 's' : ''}` : null,
                    c.documental > 0 ? `${c.documental} documental${c.documental > 1 ? 'is' : ''}` : null,
                    c.indice > 0 ? `${c.indice} índice` : null,
                  ].filter(Boolean).join(' + ');
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, borderBottom: i < concessoes.length - 1 ? '1px solid #f1f5f9' : 'none', paddingBottom: 8 }}>
                      <div><b style={{ color: '#166534' }}>+{partes}</b>{c.motivo ? <span style={{ color: '#64748b' }}> — {c.motivo}</span> : ''}</div>
                      <div style={{ color: '#94a3b8', whiteSpace: 'nowrap' }}>{dataBR(c.criado_em)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Extrato de crédito (movimentações de saldo) */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '16px 20px' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 4 }}>Extrato de crédito</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Recargas e descontos do seu saldo de crédito.</div>
            {extrato.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13, padding: '10px 0' }}>
                <Info size={15} /> Nenhuma movimentação de crédito ainda. Suas consultas estão sendo cobertas pela cota do plano.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#94a3b8', textAlign: 'left', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      <th style={{ padding: '6px 8px' }}>Data</th>
                      <th style={{ padding: '6px 8px' }}>Movimentação</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extrato.map((e, i) => {
                      const credito = e.tipo === 'credito';
                      return (
                        <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px', color: '#64748b', whiteSpace: 'nowrap' }}>{dataBR(e.criado_em)}</td>
                          <td style={{ padding: '8px', color: '#111' }}>{FUNC_LABEL[e.funcionalidade] || e.funcionalidade || (credito ? 'Recarga' : 'Consumo')}</td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 800, color: credito ? '#166534' : '#b91c1c', whiteSpace: 'nowrap' }}>{credito ? '+' : '−'} {BRL(e.valor)}</td>
                          <td style={{ padding: '8px', textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' }}>{BRL(e.saldo_apos)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
            A cota mensal renova no início de cada mês. Os bônus não expiram no fim do mês e são usados só depois da cota. Precisa de mais consultas? Fale com o suporte ou faça um upgrade de plano.
          </div>
        </>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
