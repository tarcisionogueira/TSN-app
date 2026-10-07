import React, { useState } from 'react';
import { Loader2, Copy, FileText, CheckCircle2 } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { AZUL, VERDE } from '../utils/marca';

const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// BOLETO MERCADO PAGO GENÉRICO (07/10) — para cobranças avulsas (serviços de cartório). O MP exige
// documento, nome e endereço completo do pagador para emitir; o valor vem SEMPRE do servidor
// (api/mp-checkout.js lê `cobrancas_avulsas`), nunca daqui. A baixa é automática quando o boleto
// compensa (mp-webhook → cobrancas_avulsas 'paga' → gatilho da parcela de cartório).
export default function BoletoMp({ cobrancaId, email, nomeSugerido = '', valor }) {
  const [doc, setDoc] = useState('');
  const [nome, setNome] = useState(nomeSugerido || '');
  const [end, setEnd] = useState({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [boleto, setBoleto] = useState(null);
  const [copiado, setCopiado] = useState(false);

  const buscarCep = async (raw) => {
    const cep = (raw || '').replace(/\D/g, '');
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json(); // padrao-ok: ViaCEP responde 200 até para CEP inexistente ({erro:true}); só autopreenche, campos seguem editáveis
      if (!j.erro) setEnd(p => ({ ...p, cep, logradouro: j.logradouro || p.logradouro, bairro: j.bairro || p.bairro, cidade: j.localidade || p.cidade, uf: j.uf || p.uf }));
    } catch (e) { console.error('[BoletoMp] busca CEP:', e?.message || e); } // padrao-ok: CEP offline, preenche à mão
    setBuscandoCep(false);
  };

  const docLimpo = doc.replace(/\D/g, '');
  const pronto = [11, 14].includes(docLimpo.length) && nome.trim().length >= 3
    && end.cep && end.logradouro && end.numero && end.bairro && end.cidade && /^[A-Za-z]{2}$/.test(end.uf);

  const gerar = async () => {
    if (!pronto) { setErro('Preencha CPF/CNPJ, nome e o endereço completo de quem paga.'); return; }
    setEnviando(true); setErro('');
    try {
      const res = await apiCall('/api/mp-checkout', {
        method: 'POST',
        body: JSON.stringify({ proposito: 'cobranca_avulsa', cobranca_id: cobrancaId, metodoPagamento: 'bolbradesco', email, pagador_doc: docLimpo, pagador_nome: nome.trim(), endereco: end, descricao: 'Cobrança BidPro Brasil', valor: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.boletoUrl) throw new Error(data?.error || 'Não foi possível gerar o boleto agora.');
      setBoleto(data);
    } catch (e) {
      setErro(e.message || 'Erro ao gerar o boleto.');
    } finally {
      setEnviando(false);
    }
  };

  const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13.5, boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 };

  if (boleto) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: VERDE, fontWeight: 800 }}><CheckCircle2 size={20} /> Boleto gerado</div>
        <div style={{ fontSize: 12.5, color: '#334155' }}>
          Valor: <strong>{fmtBRL(valor)}</strong>
          {boleto.vencimento && <> · vence em <strong>{new Date(boleto.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}</strong></>}
        </div>
        {boleto.linhaDigitavel && (
          <div>
            <div style={lbl}>Linha digitável</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input readOnly value={boleto.linhaDigitavel} style={{ ...inp, fontFamily: 'monospace', fontSize: 12, minWidth: 0 }} />
              <button onClick={() => { navigator.clipboard?.writeText(boleto.linhaDigitavel); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}
                style={{ padding: '0 12px', border: `1px solid ${AZUL}`, background: 'white', color: AZUL, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Copy size={13} /> {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        )}
        <a href={boleto.boletoUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, background: AZUL, color: 'white', borderRadius: 10, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>
          <FileText size={16} /> Abrir boleto (PDF)
        </a>
        <div style={{ fontSize: 11.5, color: '#64748b' }}>A compensação leva de 1 a 3 dias úteis. A baixa é automática.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 8 }}>
        <div><label style={lbl}>CPF ou CNPJ de quem paga</label><input value={doc} onChange={e => setDoc(e.target.value)} inputMode="numeric" style={inp} /></div>
        <div><label style={lbl}>Nome / razão social</label><input value={nome} onChange={e => setNome(e.target.value)} style={inp} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 8 }}>
        <div><label style={lbl}>CEP {buscandoCep && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}</label>
          <input value={end.cep} onChange={e => { setEnd(p => ({ ...p, cep: e.target.value })); buscarCep(e.target.value); }} inputMode="numeric" placeholder="00000-000" style={inp} /></div>
        <div><label style={lbl}>Logradouro</label><input value={end.logradouro} onChange={e => setEnd(p => ({ ...p, logradouro: e.target.value }))} style={inp} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 8 }}>
        <div><label style={lbl}>Número</label><input value={end.numero} onChange={e => setEnd(p => ({ ...p, numero: e.target.value }))} style={inp} /></div>
        <div><label style={lbl}>Complemento</label><input value={end.complemento} onChange={e => setEnd(p => ({ ...p, complemento: e.target.value }))} style={inp} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 2fr) minmax(0, 1fr)', gap: 8 }}>
        <div><label style={lbl}>Bairro</label><input value={end.bairro} onChange={e => setEnd(p => ({ ...p, bairro: e.target.value }))} style={inp} /></div>
        <div><label style={lbl}>Cidade</label><input value={end.cidade} onChange={e => setEnd(p => ({ ...p, cidade: e.target.value }))} style={inp} /></div>
        <div><label style={lbl}>UF</label><input value={end.uf} maxLength={2} onChange={e => setEnd(p => ({ ...p, uf: e.target.value.toUpperCase() }))} style={inp} /></div>
      </div>
      {erro && <div style={{ fontSize: 12, color: '#991b1b', background: '#fee2e2', borderRadius: 8, padding: '8px 10px' }}>{erro}</div>}
      <button onClick={gerar} disabled={enviando || !pronto}
        style={{ padding: 12, border: 'none', borderRadius: 10, background: pronto ? AZUL : '#94a3b8', color: 'white', fontWeight: 800, fontSize: 14, cursor: pronto ? 'pointer' : 'default' }}>
        {enviando ? 'Gerando…' : `Gerar boleto de ${fmtBRL(valor)}`}
      </button>
    </div>
  );
}
