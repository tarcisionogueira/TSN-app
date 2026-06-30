import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { buscarCnpj, buscarCep, formatCnpj, formatCpf, formatCep, formatTel } from '../utils/cnpjCep';
import { CheckCircle2, Loader2, AlertCircle, Copy, Check } from 'lucide-react';

const API_BASE = '';

export default function ConviteLeiloeiro() {
  const { token } = useParams();
  const [parceiro, setParceiro] = useState(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [erroInit, setErroInit] = useState('');
  const [form, setForm] = useState({
    nome: '', nome_fantasia: '', cnpj: '', cpf: '', email: '', telefone: '',
    cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
  });
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [erroEnvio, setErroEnvio] = useState('');
  const [copiado, setCopiado] = useState('');

  useEffect(() => {
    if (!token) { setErroInit('Token não informado.'); setLoadingInit(false); return; }
    fetch(`${API_BASE}/api/leiloeiro-cadastro?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErroInit(d.error); }
        else {
          setParceiro(d.parceiro);
          const p = d.parceiro;
          setForm({
            nome: p.nome || '',
            nome_fantasia: p.nome_fantasia || '',
            cnpj: p.cnpj ? formatCnpj(p.cnpj) : '',
            cpf: p.cpf ? formatCpf(p.cpf) : '',
            email: p.email || '',
            telefone: p.telefone || '',
            cep: p.cep ? formatCep(p.cep) : '',
            logradouro: p.logradouro || '',
            numero: p.numero || '',
            complemento: p.complemento || '',
            bairro: p.bairro || '',
            municipio: p.municipio || '',
            uf: p.uf || '',
          });
        }
      })
      .catch(() => setErroInit('Erro ao verificar convite.'))
      .finally(() => setLoadingInit(false));
  }, [token]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCnpj = async (v) => {
    const fmt = formatCnpj(v);
    set('cnpj', fmt);
    const digits = fmt.replace(/\D/g, '');
    if (digits.length === 14) {
      setBuscandoCnpj(true);
      const d = await buscarCnpj(digits);
      if (d) {
        setForm(p => ({
          ...p,
          cnpj: fmt,
          nome: p.nome || d.razao_social,
          nome_fantasia: p.nome_fantasia || d.nome_fantasia,
          email: p.email || d.email,
          telefone: p.telefone || d.telefone,
          cep: d.cep ? formatCep(d.cep) : p.cep,
          logradouro: d.logradouro || p.logradouro,
          numero: d.numero || p.numero,
          complemento: d.complemento || p.complemento,
          bairro: d.bairro || p.bairro,
          municipio: d.municipio || p.municipio,
          uf: d.uf || p.uf,
        }));
      }
      setBuscandoCnpj(false);
    }
  };

  const handleCep = async (v) => {
    const fmt = formatCep(v);
    set('cep', fmt);
    const digits = fmt.replace(/\D/g, '');
    if (digits.length === 8) {
      setBuscandoCep(true);
      const d = await buscarCep(digits);
      if (d) {
        setForm(p => ({
          ...p,
          cep: fmt,
          logradouro: d.logradouro || p.logradouro,
          bairro: d.bairro || p.bairro,
          municipio: d.municipio || p.municipio,
          uf: d.uf || p.uf,
        }));
      }
      setBuscandoCep(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErroEnvio('');
    if (!form.nome.trim() || !form.email.trim()) {
      setErroEnvio('Nome e e-mail são obrigatórios.');
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(`${API_BASE}/api/leiloeiro-cadastro?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          cnpj: form.cnpj.replace(/\D/g, ''),
          cpf: form.cpf.replace(/\D/g, ''),
          cep: form.cep.replace(/\D/g, ''),
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Erro ao salvar cadastro.');
      setConcluido(true);
    } catch (err) {
      setErroEnvio(err.message);
    }
    setEnviando(false);
  };

  const copiar = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiado(key);
      setTimeout(() => setCopiado(''), 1800);
    });
  };

  const inp = (extra = {}) => ({
    style: {
      width: '100%', padding: '10px 14px', border: '1.5px solid #e2e8f0',
      borderRadius: 10, fontSize: 14, color: '#111111', background: 'white',
      boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
      ...extra.style,
    },
    ...extra,
  });

  const lbl = (text) => (
    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>{text}</label>
  );

  if (loadingInit) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={32} color="#0D63DB" style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (erroInit) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
        <h2 style={{ color: '#111111', marginBottom: 8 }}>Convite inválido</h2>
        <p style={{ color: '#64748b' }}>{erroInit}</p>
      </div>
    </div>
  );

  if (concluido) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ maxWidth: 600, width: '100%' }}>
        <div style={{ background: 'white', borderRadius: 20, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', marginBottom: 20 }}>
          <CheckCircle2 size={52} color="#10b981" style={{ marginBottom: 16 }} />
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111111', marginBottom: 8 }}>Cadastro concluído!</h1>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
            Sua conta de parceiro foi configurada. Use o token abaixo para enviar imóveis à plataforma BidPro Brasil via API.
          </p>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>SEU TOKEN DE API</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <code style={{ flex: 1, fontSize: 12, color: '#111111', wordBreak: 'break-all', fontFamily: 'monospace', background: '#f1f5f9', padding: '8px 12px', borderRadius: 8 }}>{token}</code>
              <button onClick={() => copiar(token, 'token')}
                style={{ padding: '8px 14px', background: copiado === 'token' ? '#10b981' : '#0D63DB', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                {copiado === 'token' ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}
              </button>
            </div>
          </div>

          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>COMO ENVIAR IMÓVEIS</div>
            <pre style={{ fontSize: 11, color: '#78350f', fontFamily: 'monospace', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{`POST https://tsnativos.com.br/api/leiloeiro-feed
Authorization: Bearer ${token}
Content-Type: application/json

[
  {
    "id": "lote-001",
    "titulo": "Apartamento 3 quartos",
    "descricao": "Descrição completa...",
    "tipo": "Apartamento",
    "endereco": "Rua das Flores, 123",
    "cidade": "São Paulo",
    "estado": "SP",
    "cep": "01310100",
    "valor_avaliacao": 350000,
    "valor_minimo": 210000,
    "modalidade": "Judicial",
    "data_leilao": "2026-07-15T10:00:00",
    "link": "https://seuleilao.com.br/lote-001",
    "fotos": ["https://..."]
  }
]`}</pre>
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', marginBottom: 6 }}>CAMPOS ACEITOS</div>
            <div style={{ fontSize: 11, color: '#166534', lineHeight: 1.8 }}>
              <strong>Obrigatório:</strong> id (ou codigo)<br />
              <strong>Recomendados:</strong> titulo, descricao, tipo, endereco, cidade, estado, cep, valor_avaliacao, valor_minimo, modalidade, data_leilao, link, fotos<br />
              <strong>Opcionais:</strong> bairro, desconto<br />
              <strong>Limite:</strong> 500 lotes por requisição · envios ilimitados
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '32px 16px' }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#ea580c', fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20, marginBottom: 12 }}>
            🔨 Leiloeiro Parceiro
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: '#111111', margin: '0 0 8px' }}>Complete seu cadastro</h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
            Preencha os dados abaixo para ativar sua integração com a plataforma BidPro Brasil.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#111111', marginBottom: 16 }}>Identificação</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                {lbl('CNPJ')}
                <div style={{ position: 'relative' }}>
                  <input {...inp()} value={form.cnpj} onChange={e => handleCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
                  {buscandoCnpj && <Loader2 size={14} color="#0D63DB" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', animation: 'spin 1s linear infinite' }} />}
                </div>
                {buscandoCnpj && <div style={{ fontSize: 11, color: '#0D63DB', marginTop: 4 }}>Buscando dados do CNPJ…</div>}
              </div>

              <div>
                {lbl('Razão Social *')}
                <input {...inp()} value={form.nome} onChange={e => set('nome', e.target.value)} placeholder="Nome da empresa ou pessoa" required />
              </div>

              <div>
                {lbl('Nome Fantasia')}
                <input {...inp()} value={form.nome_fantasia} onChange={e => set('nome_fantasia', e.target.value)} placeholder="Nome fantasia (se houver)" />
              </div>

              <div>
                {lbl('CPF (pessoa física)')}
                <input {...inp()} value={form.cpf} onChange={e => set('cpf', formatCpf(e.target.value))} placeholder="000.000.000-00" />
              </div>

              <div>
                {lbl('E-mail *')}
                <input {...inp()} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="contato@seuleilao.com.br" required />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                {lbl('Telefone / WhatsApp')}
                <input {...inp()} value={form.telefone} onChange={e => set('telefone', formatTel(e.target.value))} placeholder="(00) 00000-0000" />
              </div>
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#111111', marginBottom: 16 }}>Endereço</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                {lbl('CEP')}
                <div style={{ position: 'relative' }}>
                  <input {...inp()} value={form.cep} onChange={e => handleCep(e.target.value)} placeholder="00000-000" />
                  {buscandoCep && <Loader2 size={14} color="#0D63DB" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', animation: 'spin 1s linear infinite' }} />}
                </div>
              </div>

              <div>
                {lbl('UF')}
                <input {...inp()} value={form.uf} onChange={e => set('uf', e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" maxLength={2} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                {lbl('Logradouro')}
                <input {...inp()} value={form.logradouro} onChange={e => set('logradouro', e.target.value)} placeholder="Rua, Avenida..." />
              </div>

              <div>
                {lbl('Número')}
                <input {...inp()} value={form.numero} onChange={e => set('numero', e.target.value)} placeholder="123" />
              </div>

              <div>
                {lbl('Complemento')}
                <input {...inp()} value={form.complemento} onChange={e => set('complemento', e.target.value)} placeholder="Sala, andar..." />
              </div>

              <div>
                {lbl('Bairro')}
                <input {...inp()} value={form.bairro} onChange={e => set('bairro', e.target.value)} placeholder="Bairro" />
              </div>

              <div>
                {lbl('Cidade')}
                <input {...inp()} value={form.municipio} onChange={e => set('municipio', e.target.value)} placeholder="Cidade" />
              </div>
            </div>
          </div>

          {erroEnvio && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
              <AlertCircle size={15} /> {erroEnvio}
            </div>
          )}

          <button type="submit" disabled={enviando}
            style={{ width: '100%', padding: '14px', background: enviando ? '#94a3b8' : '#ea580c', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: enviando ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {enviando ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</> : <>Concluir cadastro →</>}
          </button>

          <p style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: '#94a3b8' }}>
            Seus dados são protegidos conforme a LGPD e usados exclusivamente para operação da parceria.
          </p>
        </form>
      </div>
    </div>
  );
}
