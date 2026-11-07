import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../utils/supabase';

// TAXAS REAIS DOS GATEWAYS (07/11, dono): "trazer as taxas reais de cada gateway; se a integração não fornecer,
// documentar usando outro de referência e, ao cobrar por ele, passar a adotar a taxa utilizada".
// Tabela `gateway_taxas` — cada ponta diz de onde veio: REFERÊNCIA (documentada) → API (o gateway informou) →
// OBSERVADA (medida numa cobrança real nossa; vence as outras). Documentar aqui grava como referência, e a próxima
// cobrança real daquele meio/parcela substitui sozinha.

const GW = { mercadopago: 'Mercado Pago', asaas: 'Asaas', inter: 'Inter' };
const MEIO = { cartao: 'Cartão', pix: 'Pix', boleto: 'Boleto' };
const FONTE = {
  observada: { t: 'medida', c: '#059669', bg: '#f0fdf4' },
  api: { t: 'API', c: '#0D63DB', bg: '#eff6ff' },
  referencia: { t: 'referência', c: '#b45309', bg: '#fffbeb' },
};
const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inp = { width: '100%', padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, background: 'white', color: '#111', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase' };

function Selo({ fonte }) {
  const f = FONTE[fonte] || FONTE.referencia;
  return <span style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 6px', borderRadius: 999, background: f.bg, color: f.c, whiteSpace: 'nowrap' }}>{f.t}</span>;
}

const taxaRecebedor = (l) => {
  const partes = [];
  if (Number(l.pct_recebedor) > 0) partes.push(pct(l.pct_recebedor));
  if (Number(l.fixo_recebedor) > 0) partes.push(brl(l.fixo_recebedor));
  const base = partes.length ? partes.join(' + ') : (l.pct_recebedor == null ? '—' : 'grátis');
  return l.teto_recebedor ? `${base} (teto ${brl(l.teto_recebedor)})` : base;
};

export default function TaxasGateways() {
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const VAZIO = { gateway: 'inter', meio: 'pix', parcelas: 1, pct: '', fixo: '', teto: '', pct_cliente: '', detalhe: '' };
  const [form, setForm] = useState(VAZIO);

  const carregar = useCallback(async () => {
    setErro('');
    const { data, error } = await supabase.from('gateway_taxas').select('*').order('gateway').order('meio').order('parcelas');
    if (error) { setErro(`Não consegui ler as taxas: ${error.message}`); setLinhas([]); return; }
    setLinhas(data || []);
  }, []);
  useEffect(() => { if (aberto && linhas == null) carregar(); }, [aberto, linhas, carregar]);

  const num = (s) => (String(s).trim() === '' ? null : Number(String(s).replace(',', '.')));
  const documentar = async (e) => {
    e.preventDefault();
    setErro('');
    if (form.detalhe.trim().length < 5) { setErro('Diga de onde vem a taxa (ex.: "tabela do site do Inter, 07/11").'); return; }
    if (num(form.pct) == null && num(form.fixo) == null) { setErro('Informe o percentual e/ou o valor fixo.'); return; }
    setSalvando(true);
    const { error } = await supabase.rpc('gateway_taxa_documentar', {
      p_gateway: form.gateway, p_meio: form.meio, p_parcelas: Number(form.parcelas) || 1,
      p_pct: num(form.pct) ?? 0, p_fixo: num(form.fixo) ?? 0, p_teto: num(form.teto), p_pct_cliente: num(form.pct_cliente),
      p_detalhe: form.detalhe.trim(),
    });
    setSalvando(false);
    if (error) { setErro(`Não salvou: ${error.message}`); return; }
    setForm(VAZIO);
    await carregar();
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 20px' }}>
      <button type="button" onClick={() => setAberto((v) => !v)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 800, color: '#111', width: '100%' }}>
        Taxas reais dos gateways {aberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {aberto && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
            <b>Taxa da BidPro</b> = o que o gateway retém do que entra. <b>Juros do cliente</b> = o que o gateway soma na fatura
            ao parcelar. <Selo fonte="observada" /> medida numa cobrança real (vale sobre as outras) · <Selo fonte="api" /> informada
            pelo gateway · <Selo fonte="referencia" /> documentada, até a primeira cobrança real substituir.
          </div>
          {linhas == null ? (
            <div style={{ fontSize: 12, color: '#64748b' }}><Loader2 size={13} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Carregando…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 10.5, textTransform: 'uppercase' }}>
                    <th style={{ padding: '4px 6px' }}>Gateway</th><th style={{ padding: '4px 6px' }}>Meio</th><th style={{ padding: '4px 6px' }}>Parc.</th>
                    <th style={{ padding: '4px 6px' }}>Taxa da BidPro</th><th style={{ padding: '4px 6px' }}>Juros do cliente</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={`${l.gateway}-${l.meio}-${l.parcelas}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '5px 6px', fontWeight: 700 }}>{GW[l.gateway] || l.gateway}</td>
                      <td style={{ padding: '5px 6px' }}>{MEIO[l.meio] || l.meio}</td>
                      <td style={{ padding: '5px 6px' }}>{l.parcelas}×</td>
                      <td style={{ padding: '5px 6px' }} title={l.detalhe_recebedor || ''}>{taxaRecebedor(l)} <Selo fonte={l.fonte_recebedor} /></td>
                      <td style={{ padding: '5px 6px' }} title={l.detalhe_cliente || ''}>{l.meio === 'cartao' && l.parcelas > 1 ? <>{pct(l.pct_cliente)} <Selo fonte={l.fonte_cliente} /></> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form onSubmit={documentar} style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>Documentar uma taxa (quando o gateway não informa)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
              <div><label style={lbl}>Gateway</label>
                <select value={form.gateway} onChange={(e) => setForm((p) => ({ ...p, gateway: e.target.value }))} style={inp}>
                  {Object.entries(GW).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><label style={lbl}>Meio</label>
                <select value={form.meio} onChange={(e) => setForm((p) => ({ ...p, meio: e.target.value, parcelas: e.target.value === 'cartao' ? p.parcelas : 1 }))} style={inp}>
                  {Object.entries(MEIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><label style={lbl}>Parcelas</label>
                <select value={form.parcelas} disabled={form.meio !== 'cartao'} onChange={(e) => setForm((p) => ({ ...p, parcelas: Number(e.target.value) }))} style={inp}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}×</option>)}
                </select></div>
              <div><label style={lbl}>Taxa %</label><input value={form.pct} onChange={(e) => setForm((p) => ({ ...p, pct: e.target.value }))} style={inp} placeholder="0,99" inputMode="decimal" /></div>
              <div><label style={lbl}>Fixo R$</label><input value={form.fixo} onChange={(e) => setForm((p) => ({ ...p, fixo: e.target.value }))} style={inp} placeholder="0,00" inputMode="decimal" /></div>
              <div><label style={lbl}>Teto R$</label><input value={form.teto} onChange={(e) => setForm((p) => ({ ...p, teto: e.target.value }))} style={inp} placeholder="opcional" inputMode="decimal" /></div>
              {form.meio === 'cartao' && Number(form.parcelas) > 1 && (
                <div><label style={lbl}>Juros cliente %</label><input value={form.pct_cliente} onChange={(e) => setForm((p) => ({ ...p, pct_cliente: e.target.value }))} style={inp} placeholder="opcional" inputMode="decimal" /></div>
              )}
            </div>
            <div><label style={lbl}>De onde vem (obrigatório)</label>
              <input value={form.detalhe} onChange={(e) => setForm((p) => ({ ...p, detalhe: e.target.value }))} style={inp} placeholder='Ex.: "contrato Inter PJ, tarifa Pix Cobrança, 07/11"' maxLength={300} /></div>
            {erro && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{erro}</div>}
            <button type="submit" disabled={salvando} style={{ padding: '8px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', alignSelf: 'flex-start', opacity: salvando ? 0.7 : 1 }}>
              {salvando ? 'Salvando…' : 'Salvar como referência'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
