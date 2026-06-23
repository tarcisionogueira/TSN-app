import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../utils/apiCall';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CONTAS = [
  { key: 'asaas', label: 'Asaas', ativo: true },
  { key: 'pagarme', label: 'Pagar.me', ativo: false },
];

export default function AdminFinanceiro() {
  const navigate = useNavigate();
  const [conta, setConta] = useState('asaas');
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
  }, [conta]);

  async function loadFinancas() {
    setLoadingFin(true);
    try {
      const res = await apiCall('/api/asaas, {
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
      const res = await apiCall('/api/asaas, {
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
      const res = await apiCall('/api/asaas, {
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

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '0 0 60px' }}>
      {/* Header */}
      <div style={{ background: '#111111', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => navigate('/admin')}
          style={{ background: 'none', border: '1px solid #374151', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
          ← Voltar
        </button>
        <div style={{ color: '#ffffff', fontWeight: 900, fontSize: 20 }}>Financeiro</div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>

        {/* Filtro de conta */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
          {CONTAS.map(c => (
            <button key={c.key}
              disabled={!c.ativo}
              onClick={() => c.ativo && setConta(c.key)}
              title={!c.ativo ? 'Em breve' : ''}
              style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: c.ativo ? 'pointer' : 'not-allowed',
                border: conta === c.key ? '2px solid #0D63DB' : '2px solid #e2e8f0',
                background: conta === c.key ? '#eff6ff' : '#ffffff',
                color: conta === c.key ? '#0D63DB' : c.ativo ? '#374151' : '#94a3b8',
              }}>
              {c.label}{!c.ativo && ' (em breve)'}
            </button>
          ))}
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }}>

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
    </div>
  );
}
