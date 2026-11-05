import React, { useState } from 'react';
import { Loader2, FileText } from 'lucide-react';
import { AZUL } from '../utils/marca';
import { buscarCep, formatCpf, formatCep, formatTel, validarCpf, validarEmail } from '../utils/cnpjCep';

// TERMO DE ACEITE antes do pagamento de uma cobrança avulsa (05/11, dono). Ordem pedida: CPF + e-mail primeiro;
// com cadastro, os dados vêm preenchidos e o cliente só completa; depois lê o termo com os dados dele e aceita.
// O texto que vale juridicamente é o que o SERVIDOR preenche e grava no aceite (api/cobranca-avulsa-termo.js);
// aqui ele só é montado para leitura.
const ENDERECO_VAZIO = { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' };

const lbl = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };
const inp = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' };
const btn = (ativo) => ({ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: ativo ? AZUL : '#94a3b8', color: 'white', fontWeight: 800, fontSize: 14, cursor: ativo ? 'pointer' : 'default' });

function enderecoTexto(e) {
  const rua = [e.logradouro, e.numero].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  const cep = String(e.cep || '').replace(/\D/g, '');
  return [rua, e.complemento, e.bairro, e.cidade && `${e.cidade}${e.uf ? `/${String(e.uf).toUpperCase()}` : ''}`, cep.length === 8 ? `CEP ${cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '']
    .map((x) => String(x || '').trim()).filter(Boolean).join(', ');
}

export default function TermoAceiteCobranca({ cobrancaId, termo, onAceito }) {
  const [etapa, setEtapa] = useState('identificar'); // identificar → dados → termo
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [end, setEnd] = useState(ENDERECO_VAZIO);
  const [cadastrado, setCadastrado] = useState(false);
  const [li, setLi] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function chamar(corpo) {
    const r = await fetch('/api/cobranca-avulsa-termo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cobrancaId, cpf, email: email.trim(), ...corpo }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  async function identificar() {
    setErro(''); setOcupado(true);
    try {
      const j = await chamar({ acao: 'identificar' });
      if (j.cadastrado && j.dados) {
        setCadastrado(true);
        setNome(j.dados.nome || ''); setTelefone(formatTel(j.dados.telefone || ''));
        setEnd({ ...ENDERECO_VAZIO, ...Object.fromEntries(Object.entries(j.dados.endereco || {}).map(([k, v]) => [k, v || ''])) });
      }
      setEtapa('dados');
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  async function completarCep(v) {
    setEnd((x) => ({ ...x, cep: formatCep(v) }));
    if (v.replace(/\D/g, '').length !== 8) return;
    const c = await buscarCep(v);
    if (c) setEnd((x) => ({ ...x, logradouro: x.logradouro || c.logradouro, bairro: x.bairro || c.bairro, cidade: x.cidade || c.municipio, uf: x.uf || c.uf }));
  }

  const dadosOk = nome.trim().split(/\s+/).length >= 2 && telefone.replace(/\D/g, '').length >= 10
    && end.logradouro.trim() && end.numero.trim() && end.cidade.trim() && /^[A-Za-z]{2}$/.test(end.uf.trim());

  const textoPreenchido = String(termo?.texto || '')
    .replace(/\[NOME DO SIGNATÁRIO\]/gi, nome.trim() || '[NOME]')
    .replace(/\[CPF\/CNPJ DO SIGNATÁRIO\]/gi, formatCpf(cpf))
    .replace(/\[CPF DO SIGNATÁRIO\]/gi, formatCpf(cpf))
    .replace(/\[ENDEREÇO DO SIGNATÁRIO\]/gi, enderecoTexto(end));

  async function aceitar() {
    setErro(''); setOcupado(true);
    try {
      await chamar({ acao: 'aceitar', aceite: true, nome: nome.trim(), telefone, endereco: { ...end, uf: end.uf.trim().toUpperCase() } });
      onAceito(email.trim());
    } catch (e) { setErro(e.message); }
    setOcupado(false);
  }

  return (
    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, display: 'grid', gap: 12 }}>
      {/* TERMO EM DROPDOWN no topo, como o fechamento tradicional (Checkout.jsx — "Ver o termo de contratação"). Todas
          as cláusulas, preenchidas com os dados do cliente conforme ele digita; no passo do aceite abre sozinho. */}
      <details open={etapa === 'termo'} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
        <summary style={{ color: '#0D63DB', cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={15} color={AZUL} /> Ver o termo de contratação — {termo?.titulo || 'Assessoria'}
        </summary>
        <div style={{ marginTop: 8, maxHeight: 380, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 11.5, lineHeight: 1.55, color: '#334155' }}>
          {textoPreenchido}
        </div>
      </details>
      <div style={{ fontSize: 12, color: '#64748b' }}>
        {etapa === 'identificar' && 'Passo 1 de 3 — informe seu CPF e e-mail. Se você já tem cadastro na BidPro, seus dados aparecem preenchidos.'}
        {etapa === 'dados' && `Passo 2 de 3 — ${cadastrado ? 'confira e complete' : 'preencha'} seus dados para o contrato.`}
        {etapa === 'termo' && 'Passo 3 de 3 — confira o termo acima, já com os seus dados, e confirme o aceite. Depois disso, o pagamento é liberado.'}
      </div>

      {etapa === 'identificar' && (<>
        <div><label style={lbl}>CPF</label><input style={inp} inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" /></div>
        <div><label style={lbl}>E-mail</label><input style={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seuemail@exemplo.com" /></div>
        <button style={btn(validarCpf(cpf) && validarEmail(email) && !ocupado)} disabled={!validarCpf(cpf) || !validarEmail(email) || ocupado} onClick={identificar}>
          {ocupado ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Continuar'}
        </button>
      </>)}

      {etapa === 'dados' && (<>
        {cadastrado && <div style={{ fontSize: 12, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 10px' }}>Encontramos seu cadastro. Confira os dados e complete o que faltar.</div>}
        <div><label style={lbl}>Nome completo</label><input style={inp} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como no documento" /></div>
        <div><label style={lbl}>Telefone / WhatsApp</label><input style={inp} inputMode="tel" value={telefone} onChange={(e) => setTelefone(formatTel(e.target.value))} placeholder="(11) 98765-4321" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
          <div><label style={lbl}>CEP</label><input style={inp} inputMode="numeric" value={end.cep} onChange={(e) => completarCep(e.target.value)} placeholder="00000-000" /></div>
          <div><label style={lbl}>Número</label><input style={inp} value={end.numero} onChange={(e) => setEnd({ ...end, numero: e.target.value })} /></div>
        </div>
        <div><label style={lbl}>Rua / logradouro</label><input style={inp} value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
          <div><label style={lbl}>Complemento</label><input style={inp} value={end.complemento} onChange={(e) => setEnd({ ...end, complemento: e.target.value })} /></div>
          <div><label style={lbl}>Bairro</label><input style={inp} value={end.bairro} onChange={(e) => setEnd({ ...end, bairro: e.target.value })} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,1fr)', gap: 8 }}>
          <div><label style={lbl}>Cidade</label><input style={inp} value={end.cidade} onChange={(e) => setEnd({ ...end, cidade: e.target.value })} /></div>
          <div><label style={lbl}>UF</label><input style={inp} maxLength={2} value={end.uf} onChange={(e) => setEnd({ ...end, uf: e.target.value.toUpperCase() })} /></div>
        </div>
        <button style={btn(dadosOk)} disabled={!dadosOk} onClick={() => setEtapa('termo')}>Continuar para o aceite</button>
        <button onClick={() => setEtapa('identificar')} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer' }}>← Voltar</button>
      </>)}

      {etapa === 'termo' && (<>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#0f172a', cursor: 'pointer' }}>
          <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Li e aceito o termo de contratação acima, com todas as suas cláusulas. Entendo que este aceite eletrônico, registrado com data, hora e IP, tem validade de assinatura (Lei 14.063/2020).</span>
        </label>
        <button style={btn(li && !ocupado)} disabled={!li || ocupado} onClick={aceitar}>
          {ocupado ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Aceitar e ir para o pagamento'}
        </button>
        <button onClick={() => setEtapa('dados')} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer' }}>← Corrigir meus dados</button>
      </>)}

      {erro && <div style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{erro}</div>}
      <style>{'@keyframes spin{to{transform:rotate(360deg);}}'}</style>
    </div>
  );
}
