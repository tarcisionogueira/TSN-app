import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import LogoB from '../components/LogoB';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import CidadeAutocomplete from '../components/CidadeAutocomplete';
import { validarNome, normalizarNome } from '../lib/nome';
import { validarTelefone } from '../lib/telefone';

const inp = {
  width: '100%', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10,
  fontSize: 14, background: 'white', color: '#111111', boxSizing: 'border-box',
};
const lbl = { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 };

// Validação simples de CPF (11 dígitos + dígitos verificadores)
function cpfValido(cpf) {
  const c = (cpf || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}

export default function CompletarCadastro() {
  const nav = useNavigate();
  const { user, setCadastroIncompleto } = useAuth();
  const [form, setForm] = useState({ nome: '', cpf: '', telefone: '', cidade: '', uf: '' });
  const [cpfJaTem, setCpfJaTem] = useState(false);   // CPF já no banco (hash) → não pede de novo
  const [lgpdJaTem, setLgpdJaTem] = useState(false); // aceite LGPD já registrado
  const [aceite, setAceite] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // Carrega o que o cliente JÁ tem e pré-preenche — só pedimos o que falta.
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!user?.id) { setCarregando(false); return; }
      const { data } = await supabase
        .from('perfis')
        .select('nome, telefone, endereco_cidade, endereco_uf, cpf_hash, lgpd_aceito')
        .eq('id', user.id).single();
      if (!vivo) return;
      const tel = (data?.telefone || '').replace(/\D/g, '');
      setForm({
        nome: data?.nome || user.user_metadata?.full_name || user.user_metadata?.name || '',
        cpf: '',
        telefone: tel ? tel.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2') : '',
        cidade: data?.endereco_cidade || '',
        uf: data?.endereco_uf || '',
      });
      setCpfJaTem(!!data?.cpf_hash);
      setLgpdJaTem(!!data?.lgpd_aceito);
      setAceite(!!data?.lgpd_aceito);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [user]);

  const setNome = (v) => setForm(f => ({ ...f, nome: v }));
  const setCpf = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    setForm(f => ({ ...f, cpf: d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2') }));
  };
  const setTel = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    setForm(f => ({ ...f, telefone: d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2') }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');
    // 19/08: cópias sem o conserto (aceitavam "ana" e telefone inválido) — regra única.
    { const v = validarNome(form.nome); if (!v.ok) { setErro(v.erro); return; } }
    if (!cpfJaTem && !cpfValido(form.cpf)) { setErro('Informe um CPF válido.'); return; }
    { const t = validarTelefone(form.telefone); if (!t.ok || form.telefone.replace(/\D/g, '').length < 10) { setErro(t.erro || 'Informe um telefone/WhatsApp válido com DDD.'); return; } }
    if (!form.cidade || !form.uf) { setErro('Selecione sua cidade na lista (com o estado).'); return; }
    if (!aceite) { setErro('É necessário aceitar os Termos de Uso e a Política de Privacidade.'); return; }
    if (!user?.id) { setErro('Sessão expirada. Entre novamente.'); return; }
    setLoading(true);
    try {
      // Cidade + UF resolvidos pelo autocomplete: gravam em endereco (exibição) E em
      // cidades_interesse (o que a Busca usa nos filtros) — com a UF, os filtros não
      // quebram mais por "cidade sem estado".
      const patch = {
        nome: normalizarNome(form.nome),
        telefone: form.telefone.replace(/\D/g, ''),
        endereco: `${form.cidade} - ${form.uf}`,
        endereco_cidade: form.cidade,
        endereco_uf: form.uf,
        cidades_interesse: [{ cidade: form.cidade, uf: form.uf, raio_km: 50 }],
      };
      if (!lgpdJaTem) { patch.lgpd_aceito = true; patch.lgpd_data = new Date().toISOString(); }
      const { error } = await supabase.from('perfis').update(patch).eq('id', user.id);
      if (error) throw error;
      // CPF vai pelo backend, que grava também o hash + a cifra (chave só existe lá).
      if (!cpfJaTem) {
        const rc = await apiCall('/api/cpf-set', { method: 'POST', body: JSON.stringify({ cpf: form.cpf.replace(/\D/g, '') }) });
        if (!rc.ok) throw new Error('Falha ao salvar o CPF.');
      }
      // Replica no metadata do Auth (best-effort)
      supabase.auth.updateUser({ data: { nome: form.nome.trim(), telefone: form.telefone.replace(/\D/g, ''), lgpd_aceito: true } }).catch(() => {});
      if (setCadastroIncompleto) setCadastroIncompleto(false);
      // Continua para o destino que o usuário tentava acessar (ou home)
      const dest = sessionStorage.getItem('tsn_oauth_redirect');
      sessionStorage.removeItem('tsn_oauth_redirect');
      nav(dest || '/', { replace: true });
    } catch (err) {
      setErro(err.message || 'Não foi possível salvar. Tente novamente.');
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #111111 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 440, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <div style={{ background: '#0D63DB', borderRadius: 10, padding: '8px 10px' }}>
            <LogoB size={20} />
          </div>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#111111' }}>BidPro Brasil</div>
        </div>

        <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#111111' }}>Complete seu cadastro</h2>
        <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
          Para usar a plataforma, precisamos dos seus dados básicos. Preencha os campos que faltam.
        </p>

        {carregando ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0', color: '#64748b', fontSize: 14 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Carregando…
          </div>
        ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={lbl}>Nome completo</label>
            <input value={form.nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome completo" required style={inp} />
          </div>
          {!cpfJaTem && (
            <div>
              <label style={lbl}>CPF</label>
              <input value={form.cpf} onChange={e => setCpf(e.target.value)} placeholder="000.000.000-00" inputMode="numeric" required style={inp} />
            </div>
          )}
          <div>
            <label style={lbl}>Telefone / WhatsApp (com DDD)</label>
            <input value={form.telefone} onChange={e => setTel(e.target.value)} placeholder="(00) 00000-0000" inputMode="numeric" required style={inp} />
          </div>
          <div>
            <label style={lbl}>Cidade e estado</label>
            <CidadeAutocomplete value={form.cidade} placeholder="Digite e selecione sua cidade…"
              onSelect={({ cidade, uf }) => setForm(f => ({ ...f, cidade, uf }))} />
            {form.cidade && form.uf
              ? <div style={{ fontSize: 11, color: '#059669', marginTop: 4 }}>✓ {form.cidade} — {form.uf}</div>
              : <div style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>Selecione a cidade na lista para vincular o estado (UF).</div>}
          </div>

          {!lgpdJaTem && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#475569', lineHeight: 1.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} />
              <span>Li e aceito os <a href="#/termos" target="_blank" style={{ color: '#0D63DB', fontWeight: 600 }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" style={{ color: '#0D63DB', fontWeight: 600 }}>Política de Privacidade</a>.</span>
            </label>
          )}

          {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}

          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
            {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Salvando...</> : 'Concluir cadastro'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
            <ShieldCheck size={11} /> Seus dados são protegidos conforme a LGPD
          </div>
        </form>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
