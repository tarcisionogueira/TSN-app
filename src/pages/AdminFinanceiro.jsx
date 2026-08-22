import React, { useState, useEffect } from 'react';
import ExtratoUnificado from '../components/ExtratoUnificado';
import ConciliacaoBancaria from '../components/ConciliacaoBancaria';
import MonitorFinanceiro from '../components/MonitorFinanceiro';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../utils/apiCall';
import { supabase } from '../utils/supabase';
import { AlertTriangle, Info } from 'lucide-react';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Assinaturas — taxonomia (igual à do Mercado Pago), calculada de `perfis`.
// Em dia: pagamento aprovado / vigente. Em atraso: tentativas de cobrança rolando
// (inadimplente há poucos dias). Vencida: tentativas esgotadas. Cancelada: conta
// inativa. Pausado/Teste grátis: hoje sem campo próprio — virão do status da
// assinatura no Asaas (por ora ficam zerados, prontos p/ o dado). Grátis = Explorador.
const PLANOS_PAGOS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
// Papéis que são ASSINANTES (cliente): grátis (explorador) + todos os tiers pagos, mensais e
// ANUAIS. Papéis internos (admin/analista/advogado/consultor/afiliado/leiloeiro) ficam de fora.
const ROLES_ASSINANTE = ['explorador', ...PLANOS_PAGOS];
// Rótulo do tier a partir do `role` (a coluna `plano` é sempre 'gratuito' e enganaria).
const TIER_LABEL = {
  explorador: 'Explorador (grátis)',
  top2: 'Investidor Pro', top2_anual: 'Investidor Pro (anual)',
  assessorado: 'Assessoria', assessorado_anual: 'Assessoria (anual)',
  clube: 'Leilão Club', clube_anual: 'Leilão Club (anual)',
};
const DIAS_ATRASO_MAX = Number(20); // ≤ este nº de dias inadimplente = "em atraso"; acima = "vencida"

const STATUS_ASSIN = {
  em_dia:   { label: 'Em dia',      cor: '#059669', bg: '#f0fdf4' },
  atraso:   { label: 'Em atraso',   cor: '#d97706', bg: '#fffbeb' },
  vencida:  { label: 'Vencida',     cor: '#dc2626', bg: '#fef2f2' },
  pausado:  { label: 'Pausado',     cor: '#0ea5e9', bg: '#f0f9ff' },
  cancelada:{ label: 'Cancelada',   cor: '#64748b', bg: '#f1f5f9' },
  gratis:   { label: 'Grátis',      cor: '#7c3aed', bg: '#faf5ff' },
};

function statusAssinante(p) {
  if (p.ativo === false) return 'cancelada';
  // O TIER pago é a fonte de verdade no `role` (top2/assessorado/clube e anuais); a coluna
  // `plano` hoje fica sempre 'gratuito' (default legado). Considera pago por role OU plano.
  const pago = PLANOS_PAGOS.includes(p.role) || PLANOS_PAGOS.includes(p.plano);
  if (!pago) return 'gratis'; // Explorador / sem plano pago (não é assinatura ativa)
  if (p.inadimplente_desde) {
    const dias = Math.floor((Date.now() - new Date(p.inadimplente_desde).getTime()) / 86400000);
    return dias <= DIAS_ATRASO_MAX ? 'atraso' : 'vencida';
  }
  return 'em_dia';
}

// Limite Bacen para instituições de pagamento: R$ 500.000/mês
// Acima deste volume, é necessário autorização do Banco Central (Resolução BCB 80/2021)
const LIMITE_BACEN = 500_000;

// ── Fluxo de caixa (Asaas): saldo, extrato do mês, transferência PIX + marcador Bacen.
// Componente REUTILIZÁVEL (sem a moldura de página) — usado tanto na rota /admin/financeiro
// quanto na aba "Financeiro" do painel admin (hub unificado).
export function FinanceiroCaixa() {
  const [financas, setFinancas] = useState(null);
  const [extrato, setExtrato] = useState([]);
  const [loadingFin, setLoadingFin] = useState(true);
  const [loadingExt, setLoadingExt] = useState(true);
  const [pix, setPix] = useState({ chave: '', tipo: 'CPF', valor: '', descricao: '' });
  const [pixLoading, setPixLoading] = useState(false);
  const [pixModal, setPixModal] = useState(false);
  const [pixResult, setPixResult] = useState(null);
  const [pagina, setPagina] = useState(0);

  useEffect(() => {
    loadFinancas();
    loadExtrato();
  }, []);

  async function loadFinancas() {
    setLoadingFin(true);
    try {
      const res = await apiCall('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'financas' }),
      });
      if (res.ok) setFinancas(await res.json());
    } catch (_) {}
    setLoadingFin(false);
  }

  async function loadExtrato() {
    setLoadingExt(true);
    try {
      const res = await apiCall('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extrato' }),
      });
      if (res.ok) {
        const data = await res.json();
        setExtrato(data.data || []);
      }
    } catch (_) {}
    setLoadingExt(false);
  }

  async function confirmarPix() {
    setPixLoading(true);
    setPixResult(null);
    try {
      const res = await apiCall('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transferir_pix',
          chavePix: pix.chave,
          tipoChave: pix.tipo,
          valor: parseFloat(pix.valor.replace(',', '.')),
          descricao: pix.descricao || 'Transferência BidPro Brasil',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPixResult({ ok: true, msg: 'Transferência realizada com sucesso!' });
        setPix({ chave: '', tipo: 'CPF', valor: '', descricao: '' });
        loadFinancas();
      } else {
        setPixResult({ ok: false, msg: data.error || 'Erro ao transferir' });
      }
    } catch (_) {
      setPixResult({ ok: false, msg: 'Falha de conexão' });
    }
    setPixLoading(false);
    setPixModal(false);
  }

  const POR_PAGINA = 10;
  const extratoPage = extrato.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const totalPag = Math.ceil(extrato.length / POR_PAGINA);

  const cards = [
    { label: 'Saldo disponível', value: financas?.balance?.balance, cor: '#10b981' },
    { label: 'A receber', value: financas?.balance?.totalReceivable, cor: '#0D63DB' },
    { label: 'Recebido no mês', value: financas?.statsMes?.revenue, cor: '#7c3aed' },
    { label: 'Taxas cobradas', value: financas?.statsMes?.fees, cor: '#f59e0b' },
  ];

  const volumeMes = Number(financas?.statsMes?.revenue || 0);
  const pctBacen = Math.min(100, (volumeMes / LIMITE_BACEN) * 100);
  const corBacen = pctBacen >= 90 ? '#dc2626' : pctBacen >= 70 ? '#d97706' : '#059669';

  return (
    <>
      {/* Nota: "Saldo disponível" é o que está PARADO no gateway; após o saque/varredura para o
          banco ele volta a zero — o número que importa é "Recebido no mês". */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 12, color: '#1e3a5f', lineHeight: 1.55 }}>
        💡 <strong>Saldo disponível</strong> é o que está parado no gateway agora — depois do saque para o banco ele volta a R$ 0,00. O faturamento do período é o <strong>Recebido no mês</strong>.
      </div>

      {/* Marcador de volume Bacen */}
      {volumeMes > 0 && (
        <div style={{ background: 'white', borderRadius: 12, border: `1px solid ${corBacen}40`, padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {pctBacen >= 70 ? <AlertTriangle size={15} color={corBacen} /> : <Info size={15} color={corBacen} />}
            <span style={{ fontSize: 13, fontWeight: 800, color: '#111111' }}>Volume mensal — Limite Bacen</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: corBacen }}>
              R$ {fmt(volumeMes)} / R$ {fmt(LIMITE_BACEN)} ({pctBacen.toFixed(2)}%)
            </span>
          </div>
          <div style={{ height: 7, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pctBacen}%`, background: corBacen, borderRadius: 99, transition: 'width 0.4s' }} />
          </div>
          {pctBacen >= 90 && (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#dc2626', fontWeight: 600 }}>
              ⚠️ Volume próximo ao limite de R$ 500k/mês. Acima deste valor é necessário autorização do Banco Central como Instituição de Pagamento (Resolução BCB 80/2021). Consulte seu advogado.
            </p>
          )}
          {pctBacen >= 70 && pctBacen < 90 && (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#92400e' }}>
              Volume em atenção. Acompanhe o crescimento para antecipar o processo de autorização junto ao Bacen caso necessário.
            </p>
          )}
        </div>
      )}

      {/* Conta desta aba: Asaas (gateway de BACKUP). O principal é o Mercado Pago — os
          recebimentos de verdade (mensalidades, produtos) estão na aba 🏦 Mercado Pago. */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 28, padding: '7px 14px', borderRadius: 8, background: '#fff', border: '2px solid #e2e8f0', fontSize: 13, fontWeight: 700, color: '#374151' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8' }} />
        Conta Asaas <span style={{ fontWeight: 600, color: '#94a3b8' }}>· gateway de backup (o principal é o Mercado Pago)</span>
      </div>

      {/* Cards de saldo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 32 }}>
        {cards.map(({ label, value, cor }) => (
          <div key={label} style={{ background: '#ffffff', borderRadius: 12, padding: '20px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            {loadingFin
              ? <div style={{ height: 28, background: '#f1f5f9', borderRadius: 6, width: '70%' }} />
              : <div style={{ fontSize: 22, fontWeight: 800, color: cor }}>R$ {fmt(value)}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }} className="fin-caixa-grid">
        <style>{`@media (max-width: 780px){ .fin-caixa-grid{ grid-template-columns: 1fr !important; } }`}</style>

        {/* Extrato */}
        <div style={{ background: '#ffffff', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', fontWeight: 700, fontSize: 16, color: '#111111' }}>
            Extrato do mês
          </div>
          {loadingExt ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Carregando…</div>
          ) : extratoPage.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Nenhum pagamento recebido este mês.</div>
          ) : (
            <>
              {extratoPage.map((p, i) => (
                <div key={p.id || i} style={{ padding: '14px 24px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{p.description || p.customer?.name || '—'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('pt-BR') : ''}
                      {p.billingType ? ` · ${p.billingType}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#10b981' }}>R$ {fmt(p.value)}</div>
                </div>
              ))}
              {totalPag > 1 && (
                <div style={{ padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}
                    style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: pagina === 0 ? 'not-allowed' : 'pointer', color: '#374151' }}>
                    ← Anterior
                  </button>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{pagina + 1} / {totalPag}</span>
                  <button disabled={pagina >= totalPag - 1} onClick={() => setPagina(p => p + 1)}
                    style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: pagina >= totalPag - 1 ? 'not-allowed' : 'pointer', color: '#374151' }}>
                    Próximo →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Transferir via PIX */}
        <div style={{ background: '#ffffff', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '24px' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#111111', marginBottom: 20 }}>Transferir via PIX</div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Tipo de chave</label>
            <select value={pix.tipo} onChange={e => setPix(p => ({ ...p, tipo: e.target.value }))}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, color: '#111111', background: '#fff' }}>
              <option value="CPF">CPF</option>
              <option value="CNPJ">CNPJ</option>
              <option value="EMAIL">E-mail</option>
              <option value="PHONE">Telefone</option>
              <option value="EVP">Chave aleatória</option>
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Chave PIX</label>
            <input value={pix.chave} onChange={e => setPix(p => ({ ...p, chave: e.target.value }))}
              placeholder="Digite a chave PIX"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, color: '#111111', boxSizing: 'border-box' }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Valor (R$)</label>
            <input value={pix.valor} onChange={e => setPix(p => ({ ...p, valor: e.target.value }))}
              placeholder="0,00" type="text" inputMode="decimal"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, color: '#111111', boxSizing: 'border-box' }} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Descrição (opcional)</label>
            <input value={pix.descricao} onChange={e => setPix(p => ({ ...p, descricao: e.target.value }))}
              placeholder="Ex: Retirada mensal"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, color: '#111111', boxSizing: 'border-box' }} />
          </div>

          {pixResult && (
            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: pixResult.ok ? '#f0fdf4' : '#fef2f2', color: pixResult.ok ? '#15803d' : '#dc2626' }}>
              {pixResult.ok ? '✅' : '❌'} {pixResult.msg}
            </div>
          )}

          <button
            disabled={!pix.chave || !pix.valor || pixLoading}
            onClick={() => setPixModal(true)}
            style={{
              width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: !pix.chave || !pix.valor ? 'not-allowed' : 'pointer',
              background: !pix.chave || !pix.valor ? '#e2e8f0' : '#0D63DB', color: !pix.chave || !pix.valor ? '#94a3b8' : '#ffffff',
              fontWeight: 700, fontSize: 15,
            }}>
            Transferir via PIX →
          </button>
        </div>
      </div>

      {/* Modal de confirmação */}
      {pixModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 16, padding: 32, maxWidth: 400, width: '100%' }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#111111', marginBottom: 8 }}>Confirmar transferência</div>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Você está prestes a transferir <strong style={{ color: '#111111' }}>R$ {pix.valor}</strong> via PIX para a chave <strong style={{ color: '#111111' }}>{pix.chave}</strong>. Essa operação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setPixModal(false)}
                style={{ flex: 1, padding: '12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: '#374151' }}>
                Cancelar
              </button>
              <button onClick={confirmarPix} disabled={pixLoading}
                style={{ flex: 1, padding: '12px', borderRadius: 8, border: 'none', background: '#0D63DB', color: '#ffffff', cursor: pixLoading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 14 }}>
                {pixLoading ? 'Processando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Aba Assinaturas: status de cada assinante (taxonomia Mercado Pago) ─────────
export function AbaAssinaturas() {
  const [assinantes, setAssinantes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState(null);

  useEffect(() => {
    // `perfis` NÃO tem coluna `email` (o e-mail fica em auth.users) — incluí-la fazia o
    // PostgREST devolver 400 e, sem checar `error`, o painel mostrava tudo 0. `role` é
    // necessário para classificar o tier (a coluna `plano` é sempre 'gratuito').
    supabase.from('perfis')
      .select('id, nome, role, plano, plano_ciclo, plano_vencimento, plano_pago_em, inadimplente_desde, ativo, created_at')
      .in('role', ROLES_ASSINANTE)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('[assinaturas] erro ao ler perfis:', error.message);
        setAssinantes((data || []).map(p => ({ ...p, _status: statusAssinante(p) })));
        setLoading(false);
      });
  }, []);

  const dataBR = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
  const contagem = Object.keys(STATUS_ASSIN).reduce((a, k) => { a[k] = assinantes.filter(x => x._status === k).length; return a; }, {});
  const pagantes = assinantes.filter(a => ['em_dia', 'atraso', 'vencida'].includes(a._status)).length;
  const lista = filtro ? assinantes.filter(a => a._status === filtro) : assinantes;

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Carregando assinaturas…</div>;

  return (
    <div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        <b style={{ color: '#111' }}>{assinantes.length}</b> assinantes · <b style={{ color: '#059669' }}>{pagantes}</b> pagantes ativos · clique num status para filtrar.
      </div>

      {/* Cartões de status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: 12, marginBottom: 24 }}>
        {Object.entries(STATUS_ASSIN).map(([k, s]) => (
          <button key={k} onClick={() => setFiltro(filtro === k ? null : k)}
            style={{ background: s.bg, border: `2px solid ${filtro === k ? s.cor : 'transparent'}`, borderRadius: 12, padding: '15px 18px', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: s.cor, textTransform: 'uppercase', letterSpacing: 0.3 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.cor, marginTop: 4 }}>{contagem[k]}</div>
          </button>
        ))}
      </div>

      {/* Lista de assinantes */}
      <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>Assinantes</span>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>{lista.length}{filtro ? ` · ${STATUS_ASSIN[filtro].label}` : ''}</span>
          {filtro && <button onClick={() => setFiltro(null)} style={{ marginLeft: 'auto', fontSize: 12, color: '#0D63DB', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>limpar filtro</button>}
        </div>
        {lista.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Nenhum assinante nesse status.</div>
        ) : lista.map(a => {
          const s = STATUS_ASSIN[a._status];
          return (
            <div key={a.id} style={{ padding: '14px 22px', borderBottom: '1px solid #f8fafc', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.nome || '—'}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{TIER_LABEL[a.role] || a.plano || 'sem plano'}{a.plano_ciclo ? ` · ${a.plano_ciclo}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11.5, color: '#64748b', minWidth: 92 }}>
                <div>vence {dataBR(a.plano_vencimento)}</div>
                <div style={{ color: '#94a3b8' }}>pgto {dataBR(a.plano_pago_em)}</div>
              </div>
              <span style={{ background: s.bg, color: s.cor, fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{s.label}</span>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 12, lineHeight: 1.55 }}>
        Status calculado dos dados de cobrança (plano, vencimento, inadimplência): <b>Em dia</b> = pagamento vigente · <b>Em atraso</b> = inadimplente há ≤{DIAS_ATRASO_MAX} dias (tentativas de cobrança rolando) · <b>Vencida</b> = acima disso · <b>Cancelada</b> = conta inativa · <b>Grátis</b> = Explorador. <b>Pausado</b> e período de <b>teste</b> passam a contar quando plugarmos o status da assinatura no Asaas.
      </p>
    </div>
  );
}

// ── Página standalone /admin/financeiro — mantida para deep-link (ex.: links do Dashboard).
// Reusa exatamente os mesmos componentes do hub Financeiro do painel admin (sem duplicar UI).
// ── Síntese: REAL recebido (mensalidades × vendas, dinheiro que entrou/saiu) × PROJEÇÃO (MRR).
// Lê /api/financeiro-resumo (tabelas locais — econômico). Enche conforme webhook/backfill rodam.
export function SinteseFinanceira() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await apiCall('/api/financeiro-resumo?meses=6');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'erro');
        if (vivo) setD(data);
      } catch (e) { if (vivo) setErro(e.message || 'Erro ao carregar'); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, []);

  if (loading) return <div style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</div>;
  if (erro) return <div style={{ color: '#dc2626', fontSize: 14 }}>Erro: {erro}</div>;
  if (!d) return null;

  const m = d.mes_atual || {};
  const a = d.assinantes || {};
  const entradas = Number(m.mensalidades || 0) + Number(m.vendas || 0);
  const resultado = entradas - Number(m.saidas || 0);
  const serie = Array.isArray(d.serie) ? d.serie : [];
  const maxSerie = Math.max(1, ...serie.map(s => Number(s.mensalidades || 0) + Number(s.vendas || 0)));
  const semDados = serie.every(s => (Number(s.mensalidades || 0) + Number(s.vendas || 0)) === 0);

  const Card = ({ titulo, valor, cor, sub, tag }) => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px', flex: '1 1 200px', minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{titulo}</div>
        {tag && <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: tag === 'real' ? '#059669' : '#0D63DB', background: tag === 'real' ? '#f0fdf4' : '#eff6ff', borderRadius: 999, padding: '1px 7px' }}>{tag === 'real' ? 'realizado' : 'projeção'}</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color: cor || '#111', marginTop: 6 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 10 }}>Situação atual — dinheiro que entrou e saiu</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <Card titulo="Entradas do mês" valor={`R$ ${fmt(entradas)}`} cor="#059669" tag="real" sub={`Mensalidades R$ ${fmt(m.mensalidades)} + Vendas R$ ${fmt(m.vendas)}`} />
        <Card titulo="Saídas do mês" valor={`R$ ${fmt(m.saidas)}`} cor="#dc2626" tag="real" sub="Repasses pagos" />
        <Card titulo="Resultado do mês" valor={`R$ ${fmt(resultado)}`} cor={resultado >= 0 ? '#059669' : '#dc2626'} tag="real" sub="Entradas − Saídas" />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <Card titulo="Mensalidades recebidas" valor={`R$ ${fmt(m.mensalidades)}`} cor="#0D63DB" tag="real" sub="Assinaturas (recorrente)" />
        <Card titulo="Vendas avulsas recebidas" valor={`R$ ${fmt(m.vendas)}`} cor="#7c3aed" tag="real" sub="Cursos, produtos, serviços" />
        <Card titulo="A pagar (fila de saque)" valor={`R$ ${fmt(m.a_pagar)}`} cor="#d97706" tag="real" sub="Solicitações aguardando" />
        <Card titulo="Comissões acumuladas" valor={`R$ ${fmt(d.saldo_a_pagar_total)}`} cor="#334155" tag="real" sub="Saldo de todos os parceiros" />
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 10 }}>Projeção — cenário se todos efetivarem</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <Card titulo="MRR projetado" valor={`R$ ${fmt(a.mrr_projetado)}`} cor="#0D63DB" tag="proj" sub="Se todas as assinaturas ativas seguirem" />
        <Card titulo="Assinantes ativos" valor={a.ativos ?? 0} cor="#111" tag="real" sub="Assinaturas autorizadas" />
        <Card titulo="Inadimplentes" valor={d.inadimplentes ?? 0} cor="#dc2626" tag="real" sub="Cobrança em atraso" />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 4 }}>Receita por mês (recebido)</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#64748b', marginBottom: 14 }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#0D63DB', borderRadius: 2, marginRight: 4 }} />Mensalidades</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#7c3aed', borderRadius: 2, marginRight: 4 }} />Vendas</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 160, overflowX: 'auto' }}>
          {serie.map(s => {
            const men = Number(s.mensalidades || 0), ven = Number(s.vendas || 0), tot = men + ven;
            const h = Math.round((tot / maxSerie) * 130);
            const hMen = tot > 0 ? Math.round((men / tot) * h) : 0;
            return (
              <div key={s.mes} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 44 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', height: 12 }}>{tot > 0 ? `R$ ${fmt(tot)}` : ''}</div>
                <div title={`Mensalidades R$ ${fmt(men)} · Vendas R$ ${fmt(ven)}`} style={{ width: 34, height: Math.max(h, 2), borderRadius: '4px 4px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: '#eef2f7' }}>
                  <div style={{ height: h - hMen, background: '#7c3aed' }} />
                  <div style={{ height: hMen, background: '#0D63DB' }} />
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.mes?.slice(5)}/{s.mes?.slice(2, 4)}</div>
              </div>
            );
          })}
        </div>
        {semDados && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 10 }}>Sem dados ainda — enche conforme os pagamentos entram (webhook) e o backfill semanal roda.</div>}
      </div>
    </div>
  );
}

// RECUSAS DE PAGAMENTO (22/08): o código do Mercado Pago traduzido para o motivo + ação.
// Antes só dava para ler no banco/equipe; aqui o admin vê por que uma cobrança não passou
// (ex.: "alto risco" do antifraude do MP ≠ falta de saldo) e decide a recuperação.
function AbaRecusas() {
  const [rows, setRows] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    supabase.rpc('admin_pagamentos_recusados', { p_dias: 90 })
      .then(({ data, error }) => { if (error) setErro(error.message || 'Falha ao carregar.'); else setRows(Array.isArray(data) ? data : []); })
      .catch(e => setErro(String(e?.message || e)));
  }, []);
  const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const data = (s) => { try { return new Date(s).toLocaleString('pt-BR'); } catch { return s; } };
  if (erro) return <div style={{ color: '#dc2626', fontSize: 14 }}>{erro}</div>;
  if (rows === null) return <div style={{ color: '#94a3b8' }}>Carregando…</div>;
  if (!rows.length) return <div style={{ background: '#fff', borderRadius: 12, padding: 24, textAlign: 'center', color: '#64748b' }}>Nenhuma cobrança recusada nos últimos 90 dias. 🎉</div>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Cobranças recusadas (Mercado Pago) nos últimos 90 dias — {rows.length}. O motivo já vem traduzido do código da operadora.</p>
      {rows.map((r, i) => (
        <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #fee2e2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 800, color: '#111' }}>{r.nome || r.email || '(sem nome)'} <span style={{ fontWeight: 500, color: '#64748b' }}>· {r.email || ''}</span></div>
            <div style={{ fontWeight: 800, color: '#b91c1c' }}>{fmt(r.valor)} {r.plano ? `· ${r.plano}` : ''}</div>
          </div>
          <div style={{ fontSize: 13.5, color: '#334155', marginTop: 6 }}>{r.motivo}</div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>código: <code>{r.codigo || '—'}</code> · {r.metodo || ''} · {r.origem || ''} · {data(r.em)}</div>
        </div>
      ))}
    </div>
  );
}

export default function AdminFinanceiro() {
  const navigate = useNavigate();
  // Abre já na aba que o atalho do Admin pediu (Extrato / Conciliação / Monitor). Sem isto,
  // quem clicava em "Conciliação e DRE" caía na Síntese e tinha de procurar a aba de novo.
  const [aba, setAba] = useState(() => {
    try {
      const pedida = sessionStorage.getItem('admin_fin_aba');
      if (pedida) { sessionStorage.removeItem('admin_fin_aba'); return pedida; }
    } catch { /* sessionStorage indisponível */ }
    return 'sintese';
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '0 0 60px' }}>
      {/* Header — paddingTop com env(safe-area-inset-top) p/ o botão "Voltar" não ficar
          atrás da barra de status no PWA iOS (viewport-fit=cover + status bar translúcida). */}
      <div style={{ background: '#111111', padding: '20px 32px', paddingTop: 'calc(20px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => navigate('/admin')}
          style={{ background: 'none', border: '1px solid #374151', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
          ← Voltar
        </button>
        <div style={{ color: '#ffffff', fontWeight: 900, fontSize: 20 }}>Financeiro</div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>
        {/* Seletor de visão: Fluxo de caixa × Assinaturas */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#e2e8f0', padding: 4, borderRadius: 10, width: 'fit-content' }}>
          {[['sintese', '📊 Síntese'], ['caixa', '💰 Fluxo de caixa'], ['extrato', '🏦 Extrato'], ['conciliacao', '📒 Conciliação'], ['monitor', '📈 Monitor'], ['assinaturas', '👥 Assinaturas'], ['recusas', '⛔ Recusas']].map(([k, label]) => (
            <button key={k} onClick={() => setAba(k)}
              style={{ padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700,
                background: aba === k ? '#fff' : 'transparent', color: aba === k ? '#0D63DB' : '#64748b',
                boxShadow: aba === k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {label}
            </button>
          ))}
        </div>

        {aba === 'sintese' && <SinteseFinanceira />}
        {aba === 'assinaturas' && <AbaAssinaturas />}
        {aba === 'caixa' && <FinanceiroCaixa />}
        {/* EXTRATO REAL das contas integradas (Asaas + Mercado Pago), com os DOIS lados do
            fluxo. As outras abas partem do que o sistema registrou; esta lê as contas e mostra
            também as SAÍDAS — sem elas há faturamento, não fluxo de caixa. */}
        {aba === 'extrato' && <ExtratoUnificado />}
        {/* CONCILIAÇÃO: onde o extrato vira contabilidade. Classifica pelo plano de contas,
            registra quem classificou e exporta (PDF/OFX) para a contabilidade fechar a DRE. */}
        {aba === 'conciliacao' && <ConciliacaoBancaria />}
        {/* MONITOR: para onde o dinheiro vai, a fila de credores a classificar e o diagnóstico
            da operação. É a leitura de decisão — a conciliação é o trabalho que a alimenta. */}
        {aba === 'monitor' && <MonitorFinanceiro />}
        {/* RECUSAS: por que uma cobrança não passou (código do MP traduzido) — base para recuperação. */}
        {aba === 'recusas' && <AbaRecusas />}
      </div>
    </div>
  );
}
