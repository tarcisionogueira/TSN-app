import React, { useState } from 'react';
import { Loader2, Copy, FileText, CheckCircle2 } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { AZUL, VERDE } from '../utils/marca';

const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// BOLETO DO HONORÁRIO DE ÊXITO PELO ASAAS (30/09, decisão do dono). Testado em produção: o Asaas
// emite boleto de até R$ 500 mil (o do Mercado Pago para em R$ 100 mil). O valor é recalculado no
// servidor (api/asaas.js, `criar_cobranca_fallback` com meio='boleto'), nunca aceito daqui — a tela
// só mostra a mesma conta (src/utils/taxaHonorario.js). A baixa é automática quando o boleto
// compensa (api/asaas-webhook.js), registrando o honorário sem a taxa.
export default function BoletoHonorario({ arrematacaoId, email, previsto, onGerado }) {
  const [cpf, setCpf] = useState('');
  const [nome, setNome] = useState('');
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
    } catch (e) { console.error('[BoletoHonorario] busca CEP:', e?.message || e); } // padrao-ok: CEP offline, preenche à mão
    setBuscandoCep(false);
  };

  const enderecoOk = !!(end.cep && end.logradouro && end.numero && end.bairro && end.cidade && end.uf);

  const gerar = async () => {
    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) { setErro('Informe um CPF válido.'); return; }
    if (!enderecoOk) { setErro('Informe o endereço completo (CEP, logradouro, número, bairro, cidade e UF).'); return; }
    setEnviando(true); setErro('');
    try {
      const res = await apiCall('/api/asaas', {
        method: 'POST',
        body: JSON.stringify({ action: 'criar_cobranca_fallback', proposito: 'honorario_exito', meio: 'boleto', arrematacao_id: arrematacaoId, nome: nome || email, email, cpf: cpfLimpo, endereco: end }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.linkPagamento) throw new Error(data?.mensagem || data?.error || 'Não foi possível gerar o boleto agora.');
      setBoleto(data);
      onGerado?.();
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: VERDE, fontWeight: 800 }}>
          <CheckCircle2 size={20} /> Boleto gerado
        </div>
        <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.6 }}>
          Valor: <strong>{fmtBRL(boleto.valor)}</strong> (honorário {fmtBRL(boleto.honorario)} + taxa do boleto {fmtBRL(boleto.taxa)})
          {boleto.vencimento && <> · vence em <strong>{new Date(boleto.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}</strong></>}
        </div>
        {boleto.linhaDigitavel && (
          <div>
            <div style={lbl}>Linha digitável</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input readOnly value={boleto.linhaDigitavel} style={{ ...inp, fontFamily: 'monospace', fontSize: 12 }} />
              <button onClick={() => { navigator.clipboard?.writeText(boleto.linhaDigitavel); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}
                style={{ padding: '0 12px', border: `1px solid ${AZUL}`, background: 'white', color: AZUL, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Copy size={13} /> {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        )}
        <a href={boleto.linkPagamento} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px', background: AZUL, color: 'white', borderRadius: 10, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>
          <FileText size={16} /> Abrir boleto (PDF)
        </a>
        <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
          A compensação leva de 1 a 3 dias úteis. Assim que o banco confirmar, a baixa é automática e você recebe o recibo por e-mail.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', lineHeight: 1.6 }}>
        Honorário {fmtBRL(previsto.honorario)} + taxa do boleto {fmtBRL(previsto.taxa)} = <strong>{fmtBRL(previsto.total)}</strong>
      </div>
      <div>
        <label style={lbl}>Nome de quem paga</label>
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" style={inp} />
      </div>
      <div>
        <label style={lbl}>CPF</label>
        <input value={cpf} onChange={e => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" style={inp} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
        <div>
          <label style={lbl}>CEP {buscandoCep && <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />}</label>
          <input value={end.cep} onChange={e => { setEnd(p => ({ ...p, cep: e.target.value })); buscarCep(e.target.value); }} inputMode="numeric" placeholder="00000-000" style={inp} />
        </div>
        <div>
          <label style={lbl}>Logradouro</label>
          <input value={end.logradouro} onChange={e => setEnd(p => ({ ...p, logradouro: e.target.value }))} style={inp} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
        <div>
          <label style={lbl}>Número</label>
          <input value={end.numero} onChange={e => setEnd(p => ({ ...p, numero: e.target.value }))} style={inp} />
        </div>
        <div>
          <label style={lbl}>Complemento</label>
          <input value={end.complemento} onChange={e => setEnd(p => ({ ...p, complemento: e.target.value }))} style={inp} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 8 }}>
        <div>
          <label style={lbl}>Bairro</label>
          <input value={end.bairro} onChange={e => setEnd(p => ({ ...p, bairro: e.target.value }))} style={inp} />
        </div>
        <div>
          <label style={lbl}>Cidade</label>
          <input value={end.cidade} onChange={e => setEnd(p => ({ ...p, cidade: e.target.value }))} style={inp} />
        </div>
        <div>
          <label style={lbl}>UF</label>
          <input value={end.uf} maxLength={2} onChange={e => setEnd(p => ({ ...p, uf: e.target.value.toUpperCase() }))} style={inp} />
        </div>
      </div>
      {erro && <div style={{ color: '#dc2626', fontSize: 12.5, fontWeight: 600 }}>{erro}</div>}
      <button onClick={gerar} disabled={enviando}
        style={{ padding: '12px', background: enviando ? '#94a3b8' : AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: enviando ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {enviando ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Gerando boleto...</> : `Gerar boleto de ${fmtBRL(previsto.total)}`}
      </button>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
