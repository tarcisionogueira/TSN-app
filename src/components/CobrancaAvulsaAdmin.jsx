import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Copy, Check, ExternalLink, Plus } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { supabase } from '../utils/supabase';
import { maskMoedaDigitando } from '../utils/moeda';

const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#111111', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };
const btn = (color = '#0D63DB') => ({ padding: '10px 20px', background: color, color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' });

const STATUS_COR = { aberta: { c: '#d97706', bg: '#fffbeb' }, paga: { c: '#059669', bg: '#f0fdf4' }, cancelada: { c: '#64748b', bg: '#f1f5f9' } };
const STATUS_LABEL = { aberta: 'Aguardando pagamento', paga: 'Paga', cancelada: 'Cancelada' };

// Cobrança avulsa (17/09, pedido do dono): motivo/valor livres, fora do catálogo fixo de
// PROPOSITOS que api/mp-checkout.js já aceita — pra situações que não têm coluna própria no
// schema (ex.: cobrar um terceiro por algo pontual). O link gerado funciona igual ao de
// honorários: PIX ou cartão, via api/mp-checkout.js (proposito='cobranca_avulsa'), preço
// sempre lido do banco (api/cobranca-avulsa-info.js), nunca do que o pagador manda.
export default function CobrancaAvulsaAdmin() {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState({ descricao: '', valor: '', destinatario_nome: '', destinatario_email: '' });
  const [linkCopiado, setLinkCopiado] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from('cobrancas_avulsas').select('*').order('criado_em', { ascending: false }).limit(50);
    if (!error) setLista(data || []);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const criar = async (e) => {
    e.preventDefault();
    setErro('');
    const valorNum = parseFloat(String(form.valor).replace(/\./g, '').replace(',', '.')) || 0;
    if (form.descricao.trim().length < 5) { setErro('Descreva o motivo da cobrança (mín. 5 caracteres).'); return; }
    if (valorNum <= 0) { setErro('Informe um valor válido.'); return; }
    setCriando(true);
    try {
      const r = await apiCall('/api/cobranca-avulsa-criar', {
        method: 'POST',
        body: JSON.stringify({ descricao: form.descricao.trim(), valor: valorNum, destinatario_nome: form.destinatario_nome || null, destinatario_email: form.destinatario_email || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || 'Não foi possível criar a cobrança.');
      setForm({ descricao: '', valor: '', destinatario_nome: '', destinatario_email: '' });
      await carregar();
    } catch (e2) {
      setErro(e2.message || 'Erro ao criar cobrança.');
    } finally {
      setCriando(false);
    }
  };

  const copiarLink = async (id) => {
    const link = `${window.location.origin}/#/cobranca/${id}`;
    try { await navigator.clipboard.writeText(link); setLinkCopiado(id); setTimeout(() => setLinkCopiado(''), 2500); } catch { /* padrao-ok: clipboard pode falhar em contexto não-seguro/iframe, sem impacto no fluxo */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={15} /> Nova cobrança avulsa
        </div>
        <form onSubmit={criar} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={lbl}>Motivo / descrição</label>
            <input value={form.descricao} onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))} style={inp} placeholder="Ex.: Saldo do honorário de êxito no cartão" maxLength={500} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Valor (R$)</label>
              <input value={form.valor} onChange={e => setForm(p => ({ ...p, valor: maskMoedaDigitando(e.target.value) }))} style={inp} placeholder="0,00" />
            </div>
            <div>
              <label style={lbl}>Destinatário (opcional)</label>
              <input value={form.destinatario_nome} onChange={e => setForm(p => ({ ...p, destinatario_nome: e.target.value }))} style={inp} placeholder="Nome" />
            </div>
          </div>
          <div>
            <label style={lbl}>E-mail do destinatário (opcional)</label>
            <input type="email" value={form.destinatario_email} onChange={e => setForm(p => ({ ...p, destinatario_email: e.target.value }))} style={inp} placeholder="email@exemplo.com" />
          </div>
          {erro && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{erro}</div>}
          <button type="submit" disabled={criando} style={{ ...btn('#0D63DB'), display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', opacity: criando ? 0.7 : 1 }}>
            {criando ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
            Gerar link de cobrança
          </button>
          <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
        </form>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 12 }}>Cobranças recentes</div>
        {carregando ? (
          <div style={{ color: '#64748b', fontSize: 13 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle', marginRight: 6 }} />Carregando...</div>
        ) : !lista.length ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhuma cobrança avulsa criada ainda.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lista.map(c => (
              <div key={c.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111', overflowWrap: 'break-word' }}>{c.descricao}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {fmtDate(c.criado_em)}{c.destinatario_nome ? ` · ${c.destinatario_nome}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: '#111' }}>{fmt(c.valor)}</div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: STATUS_COR[c.status]?.bg, color: STATUS_COR[c.status]?.c }}>
                      {STATUS_LABEL[c.status] || c.status}
                    </span>
                  </div>
                </div>
                {c.status === 'aberta' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => copiarLink(c.id)} style={{ ...btn(linkCopiado === c.id ? '#059669' : '#64748b'), padding: '6px 12px', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {linkCopiado === c.id ? <Check size={12} /> : <Copy size={12} />}
                      {linkCopiado === c.id ? 'Copiado' : 'Copiar link'}
                    </button>
                    <a href={`${window.location.origin}/#/cobranca/${c.id}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#0D63DB', fontWeight: 700, textDecoration: 'none' }}>
                      <ExternalLink size={12} /> Abrir
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
