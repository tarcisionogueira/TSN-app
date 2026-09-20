import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { fmtBRL } from '../utils/format';

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

// Uso interno (admin/analista) — pedido do dono (20/09): localizar processos de busca e
// apreensão/alienação fiduciária de veículo por banco/financeira, via CNJ DataJud (dado
// público). Só LISTA pra avaliação — não envia proposta nem contato a ninguém.
export default function RetomadaVeiculos() {
  const nav = useNavigate();
  const [banco, setBanco] = useState('');
  const [uf, setUf] = useState('');
  const [nacional, setNacional] = useState(true);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function buscar(e) {
    e.preventDefault();
    if (!banco.trim()) return;
    setCarregando(true); setErro(null); setResultado(null);
    try {
      const r = await apiCall('/api/cnj-retomada-veiculos', {
        method: 'POST',
        body: JSON.stringify({ banco: banco.trim(), uf: nacional ? undefined : uf, nacional }),
      });
      const dados = await r.json();
      if (!r.ok) { setErro(dados.error || 'Erro na consulta'); setCarregando(false); return; }
      setResultado(dados);
    } catch (e) {
      console.error('[RetomadaVeiculos] falha na consulta:', e.message);
      setErro('Falha ao consultar — tente novamente.');
    }
    setCarregando(false);
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={() => nav('/admin')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 700, alignSelf: 'flex-start' }}>
        <ArrowLeft size={16} /> Voltar ao Admin
      </button>

      <h1 style={{ fontSize: 20, fontWeight: 900, color: '#111111', margin: 0 }}>Retomada de veículos — CNJ DataJud</h1>

      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12, display: 'flex', gap: 8, fontSize: 12.5, color: '#92400e' }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          Dado público do CNJ (processo, partes, valor da causa) — <strong>não inclui placa,
          marca, modelo ou ano do veículo</strong> (o DataJud não expõe isso; só apareceria dentro
          do PDF da petição de cada processo, que esta busca não lê). Uso interno para avaliação:
          esta tela não envia proposta nem contato a ninguém.
        </div>
      </div>

      <form onSubmit={buscar} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 260px' }}>
          <label style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>Banco / financeira (credor)</label>
          <input value={banco} onChange={e => setBanco(e.target.value)} placeholder="Ex.: Banco Bradesco Financiamentos"
            style={{ width: '100%', padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: '#64748b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={nacional} onChange={e => setNacional(e.target.checked)} /> Nacional
          </label>
          {!nacional && (
            <select value={uf} onChange={e => setUf(e.target.value)} style={{ padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}>
              <option value="">UF</option>
              {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
        </div>
        <button type="submit" disabled={carregando || !banco.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {carregando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
        </button>
      </form>

      {erro && <div style={{ color: '#991b1b', fontSize: 13 }}>{erro}</div>}

      {resultado && (
        <div>
          <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 8 }}>
            {resultado.total} processo(s) encontrado(s)
            {resultado.erros?.length ? ` — ${resultado.erros.length} tribunal(is) falharam na consulta` : ''}.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resultado.processos.map(p => (
              <div key={p.numero} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, fontWeight: 700, fontSize: 13, color: '#111111' }}>
                    {p.executado.length ? p.executado.map(e => e.nome).join(', ') : '(executado não identificado)'}
                  </div>
                  {p.valor_causa != null && <div style={{ flexShrink: 0, fontWeight: 800, color: '#0369a1', fontSize: 13 }}>{fmtBRL(p.valor_causa)}</div>}
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                  {p.numero} · {p.tribunal} · {p.classe}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Assuntos: {p.assuntos || '—'} · Ajuizado em {p.data_ajuizamento || '—'} · Fase: {p.fase?.fase || '—'}
                </div>
              </div>
            ))}
            {!resultado.processos.length && <div style={{ fontSize: 13, color: '#64748b' }}>Nenhum processo encontrado.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
