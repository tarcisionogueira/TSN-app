import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';
import { BarChart2, Bell, BellOff, Camera, ShieldCheck, MapPin, CreditCard, ArrowRight, ArrowDownCircle, Check } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { pushSuportado, statusPermissao, ativarPush, desativarPush, getSubscriptionAtiva } from '../utils/push';
import { ESTADOS_UF } from '../data/cidades';
import CidadeAutocomplete from '../components/CidadeAutocomplete';
import { usePlanos } from '../contexts/PlanosContext';
import { PLANOS as PLANOS_STATIC } from '../data/cursos';

// Ordem hierárquica dos planos compráveis (para o quadro de upgrade/downgrade).
const ORDEM_PLANOS = ['explorador', 'top2', 'assessorado', 'clube'];
// Papéis de CLIENTE (têm assinatura a gerenciar). Operacionais (admin/consultor/…) não.
const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];

const fmtBRL = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fmtData = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

const ROLES_COM_COMISSAO = ['admin', 'consultor', 'analista', 'advogado'];
// Clientes PAGANTES também recebem comissão (Programa de Parceiros — rede multinível) e
// precisam ver saldo/saque + o relatório da rede.
const ROLES_PAGOS_CLIENTE = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];

const ROLE_LABELS = {
  admin: 'Administrador',
  analista: 'Analista',
  consultor: 'Consultor',
  advogado: 'Advogado',
  explorador: 'Explorador',
  top2: 'Investidor Pro',
  assessorado: 'Assessorado',
  clube: 'Clube',
};

const ROLE_COLORS = {
  admin: '#7c3aed',
  analista: '#0284c7',
  consultor: '#0891b2',
  advogado: '#7c3aed',
  explorador: '#64748b',
  top2: '#d97706',
  assessorado: '#16a34a',
  clube: '#dc2626',
};

// Opções do perfil de investidor (espelham a triagem inicial). Deixamos o cliente
// corrigir aqui a qualquer momento — é o que direciona a recomendação de imóveis
// do e-mail semanal (objetivo + cidade de interesse).
const INV_OBJETIVOS = [
  ['revenda', '🔁 Comprar para revender'],
  ['locacao', '🏠 Comprar para alugar'],
  ['uso_proprio', '🔑 Comprar para uso'],
  ['incorporacao', '🏗️ Comprar para incorporar'],
];
const INV_FAIXAS = [
  ['ate_150k', 'Até R$ 150 mil'],
  ['150_400k', 'R$ 150 a 400 mil'],
  ['400k_1mi', 'R$ 400 mil a 1 milhão'],
  ['acima_1mi', 'Acima de R$ 1 milhão'],
];
const INV_PAGAMENTO = [
  ['a_vista', 'À vista'],
  ['financiado', 'Financiado'],
  ['avaliando', 'Ainda avaliando'],
];
const INV_CONSORCIO = [
  ['tem', 'Já tenho consórcio'],
  ['quero', 'Tenho interesse em consórcio'],
  ['nao', 'Não'],
];
const INV_EXPERIENCIA = [
  ['primeira', 'Primeira vez'],
  ['1_2', 'Já arrematei 1 a 2'],
  ['recorrente', 'Investidor recorrente'],
];

// Card editável do perfil de investidor. Autossuficiente (carrega/salva sozinho),
// independente do formulário de dados cadastrais.
function PerfilInvestidorCard({ userId, isMobile }) {
  const [f, setF] = useState(null); // null = carregando
  const [orig, setOrig] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!userId) return;
    supabase.from('perfis')
      .select('perfil_investidor, faixa_capital, forma_pagamento, consorcio_interesse, experiencia_leilao, cidades_interesse')
      .eq('id', userId).single()
      .then(({ data }) => {
        const c0 = Array.isArray(data?.cidades_interesse) && data.cidades_interesse[0] && typeof data.cidades_interesse[0] === 'object' ? data.cidades_interesse[0] : {};
        const snap = {
          perfil_investidor: data?.perfil_investidor || '',
          faixa_capital: data?.faixa_capital || '',
          forma_pagamento: data?.forma_pagamento || '',
          consorcio_interesse: data?.consorcio_interesse || '',
          experiencia_leilao: data?.experiencia_leilao || '',
          cidade: c0.cidade || '', uf: c0.uf || '', raio_km: String(c0.raio_km || 50),
        };
        setF(snap); setOrig(snap);
      });
  }, [userId]);

  if (!f) return null;
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setMsg(null); };
  const dirty = orig && JSON.stringify(f) !== JSON.stringify(orig);

  const salvar = async () => {
    setSalvando(true); setMsg(null);
    const cidades = f.cidade.trim()
      ? [{ cidade: f.cidade.trim(), uf: (f.uf || '').trim().toUpperCase(), raio_km: Number(f.raio_km) || 50 }]
      : [];
    const { error } = await supabase.from('perfis').update({
      perfil_investidor: f.perfil_investidor || null,
      faixa_capital: f.faixa_capital || null,
      forma_pagamento: f.forma_pagamento || null,
      consorcio_interesse: f.consorcio_interesse || null,
      experiencia_leilao: f.experiencia_leilao || null,
      cidades_interesse: cidades,
    }).eq('id', userId);
    setSalvando(false);
    if (error) setMsg({ ok: false, texto: 'Não foi possível salvar. Tente novamente.' });
    else { setOrig({ ...f }); setMsg({ ok: true, texto: 'Perfil de investidor atualizado! As recomendações do seu e-mail passam a seguir essa intenção.' }); }
  };

  const selStyle = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13.5, color: '#111', background: 'white', outline: 'none', boxSizing: 'border-box' };
  const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 5 };
  const Campo = ({ label, campo, opts }) => (
    <div>
      <label style={lbl}>{label}</label>
      <select value={f[campo]} onChange={e => set(campo, e.target.value)} style={selStyle}>
        <option value="">Selecione…</option>
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </div>
  );

  return (
    <div style={{ background: 'white', borderRadius: 14, padding: isMobile ? '16px' : '24px', border: '1px solid #e2e8f0', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <BarChart2 size={18} color="#0D63DB" />
        <span style={{ fontSize: 15, fontWeight: 800, color: '#111111' }}>Perfil de investidor</span>
      </div>
      <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
        É o que direciona a recomendação de imóveis que você recebe por e-mail. Ajuste sempre que sua intenção mudar.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
        <Campo label="Objetivo principal" campo="perfil_investidor" opts={INV_OBJETIVOS} />
        <Campo label="Faixa de capital" campo="faixa_capital" opts={INV_FAIXAS} />
        <Campo label="Forma de pagamento" campo="forma_pagamento" opts={INV_PAGAMENTO} />
        <Campo label="Consórcio" campo="consorcio_interesse" opts={INV_CONSORCIO} />
        <Campo label="Experiência com leilão" campo="experiencia_leilao" opts={INV_EXPERIENCIA} />
      </div>

      <div style={{ height: 1, background: '#f1f5f9', margin: '18px 0 14px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <MapPin size={15} color="#0D63DB" />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Cidade/região de interesse</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12, alignItems: 'start' }}>
        <div>
          <CidadeAutocomplete value={f.cidade} placeholder="Digite e selecione sua cidade…"
            onSelect={({ cidade, uf }) => setF(p => ({ ...p, cidade, uf }))} />
          {f.cidade && !f.uf && <div style={{ fontSize: 11, color: '#d97706', marginTop: 5 }}>Selecione a cidade na lista para vincular o estado (UF).</div>}
        </div>
        <select value={f.raio_km} onChange={e => set('raio_km', e.target.value)} style={selStyle}>
          <option value="25">Raio de 25 km</option>
          <option value="50">Raio de 50 km</option>
          <option value="100">Raio de 100 km</option>
          <option value="200">Raio de 200 km</option>
        </select>
      </div>
      {f.cidade && (
        <button type="button" onClick={() => setF(p => ({ ...p, cidade: '', uf: '' }))}
          style={{ marginTop: 8, background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          Remover cidade de interesse
        </button>
      )}

      {msg && (
        <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
          background: msg.ok ? '#f0fdf4' : '#fef2f2', color: msg.ok ? '#16a34a' : '#dc2626', border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}` }}>
          {msg.ok ? '✓ ' : '✕ '}{msg.texto}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={salvar} disabled={!dirty || salvando}
          style={{ padding: '10px 20px', background: (!dirty || salvando) ? '#e2e8f0' : '#0D63DB', color: (!dirty || salvando) ? '#94a3b8' : 'white',
            border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: (!dirty || salvando) ? 'not-allowed' : 'pointer' }}>
          {salvando ? 'Salvando…' : dirty ? 'Salvar perfil de investidor' : 'Tudo salvo'}
        </button>
      </div>
    </div>
  );
}

export default function Perfil() {
  const { user, role, effectiveRole } = useAuth();
  const isMobile = useIsMobile();
  const nav = useNavigate();
  const loc = useLocation();
  const planosLive = usePlanos();

  // Sub-abas do Meu Perfil (organização por funcionalidade). A "Assinatura" abre
  // primeiro — é onde vive a gestão de plano (antes espalhada no menu/topo).
  const abaInicial = new URLSearchParams(loc.search).get('aba') || 'assinatura';
  const [aba, setAba] = useState(abaInicial);
  useEffect(() => {
    const a = new URLSearchParams(loc.search).get('aba');
    if (a) setAba(a);
  }, [loc.search]);

  const [nome, setNome] = useState(user?.user_metadata?.nome || '');
  const [cpf, setCpf] = useState('');
  const [cpfInput, setCpfInput] = useState('');   // entrada quando ainda não há CPF salvo
  const [salvandoCpf, setSalvandoCpf] = useState(false);
  const [msgCpf, setMsgCpf] = useState(null);
  const [telefone, setTelefone] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [end, setEnd] = useState({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  const [original, setOriginal] = useState(null); // snapshot dos campos editáveis (dirty + cancelar)
  const [cepLoading, setCepLoading] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState(null);

  // Validação de identidade (assessorado e clube)
  const ROLES_SELFIE = ['assessorado', 'clube'];
  const [identValidada, setIdentValidada] = useState(null); // null=carregando, true, false
  const [identPendente, setIdentPendente] = useState(false);
  const [selfieLoading, setSelfieLoading] = useState(false);
  const [selfieMsg, setSelfieMsg] = useState(null);
  const selfieRef = useRef();

  useEffect(() => {
    if (!user?.id || !ROLES_SELFIE.includes(role)) return;
    supabase.from('perfis').select('identidade_validada, identidade_pendente').eq('id', user.id).single()
      .then(({ data }) => {
        setIdentValidada(data?.identidade_validada || false);
        setIdentPendente(data?.identidade_pendente || false);
      });
  }, [user?.id, role]); // eslint-disable-line

  // Assinatura / cancelamento (garantia de 7 dias)
  const ROLES_PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
  const [planoPagoEm, setPlanoPagoEm] = useState(null);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [cancelMsg, setCancelMsg] = useState(null);

  useEffect(() => {
    if (!user?.id || !ROLES_PAGANTES.includes(role)) return;
    supabase.from('perfis').select('plano_pago_em').eq('id', user.id).single()
      .then(({ data }) => setPlanoPagoEm(data?.plano_pago_em || null));
  }, [user?.id, role]); // eslint-disable-line

  const dentroGarantia = planoPagoEm && (Date.now() - new Date(planoPagoEm).getTime() <= 7 * 24 * 3600 * 1000);
  const diasRestantesGarantia = planoPagoEm ? Math.max(0, 7 - Math.floor((Date.now() - new Date(planoPagoEm).getTime()) / 86400000)) : 0;

  async function confirmarCancelamento() {
    setCancelando(true); setCancelMsg(null);
    try {
      const res = await apiCall('/api/garantia-cancelar', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Erro ao cancelar.');
      setCancelMsg({ ok: true, texto: d.msg || 'Solicitação registrada.' });
      if (d.reembolso) setTimeout(() => window.location.reload(), 2500); // rebaixou o role
    } catch (e) {
      setCancelMsg({ ok: false, texto: e.message });
    } finally {
      setCancelando(false);
    }
  }

  const enviarSelfie = async (file) => {
    if (!file) return;
    setSelfieLoading(true); setSelfieMsg(null);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imagem = e.target.result;
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/validar-selfie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ imagem }),
        });
        const json = await res.json();
        // A persistência de identidade_validada/pendente é feita NO SERVIDOR (service
        // key) por /api/validar-selfie — o cliente não escreve mais esses campos (o
        // trigger de perfis os bloqueia). Aqui só reflete o resultado retornado.
        if (json.ok) {
          setIdentValidada(true); setIdentPendente(false);
          setSelfieMsg({ ok: true, texto: 'Identidade verificada com sucesso!' });
        } else {
          setIdentPendente(true);
          setSelfieMsg({ ok: false, texto: json.mensagem || 'Foto não aprovada. Nossa equipe irá revisar.' });
        }
        setSelfieLoading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setSelfieMsg({ ok: false, texto: 'Erro ao enviar a foto. Tente novamente.' });
      setSelfieLoading(false);
    }
  };

  // Push notifications
  const [pushAtivo, setPushAtivo] = useState(false);
  const [pushSupport, setPushSupport] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMensagem, setPushMensagem] = useState(null);

  useEffect(() => {
    setPushSupport(pushSuportado());
    getSubscriptionAtiva().then(sub => setPushAtivo(!!sub));
  }, []);

  const togglePush = async () => {
    setPushLoading(true); setPushMensagem(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (pushAtivo) {
        await desativarPush(session);
        setPushAtivo(false);
        setPushMensagem({ tipo: 'ok', texto: 'Notificações desativadas.' });
      } else {
        await ativarPush(session);
        setPushAtivo(true);
        setPushMensagem({ tipo: 'ok', texto: 'Notificações ativadas! Você receberá alertas de imóveis e novidades.' });
      }
    } catch (e) {
      setPushMensagem({ tipo: 'erro', texto: e.message });
    }
    setPushLoading(false);
  };

  // LGPD states
  const [baixando, setBaixando] = useState(false);
  const [mostrarConfirmacaoExclusao, setMostrarConfirmacaoExclusao] = useState(false);
  const [textoConfirmacao, setTextoConfirmacao] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const [lgpdErro, setLgpdErro] = useState(null);

  // CPF é mostrado mascarado (o valor cheio nunca vem para o navegador; a chave
  // de decifra fica só no backend). O próprio dono recebe a máscara.
  useEffect(() => {
    if (!user?.id) return;
    apiCall('/api/cpf-revelar', { method: 'POST', body: JSON.stringify({ ids: [user.id] }) })
      .then(r => r.json()).then(d => setCpf(d?.cpfs?.[user.id] || '')).catch(() => {});
  }, [user?.id]);

  // Carrega dados cadastrais (nome fixo + telefone/endereço/pix editáveis)
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('perfis')
      .select('nome,telefone,chave_pix,endereco_cep,endereco_logradouro,endereco_numero,endereco_complemento,endereco_bairro,endereco_cidade,endereco_uf')
      .eq('id', user.id).single()
      .then(({ data }) => {
        if (!data) return;
        const snap = {
          telefone: data.telefone || '',
          chavePix: data.chave_pix || '',
          end: {
            cep: data.endereco_cep || '', logradouro: data.endereco_logradouro || '',
            numero: data.endereco_numero || '', complemento: data.endereco_complemento || '',
            bairro: data.endereco_bairro || '', cidade: data.endereco_cidade || '', uf: data.endereco_uf || '',
          },
        };
        if (data.nome) setNome(data.nome);
        setTelefone(snap.telefone);
        setChavePix(snap.chavePix);
        setEnd(snap.end);
        setOriginal(snap);
      });
  }, [user?.id]);

  // Há alterações não salvas? (compara com o snapshot original)
  const dirty = !!original && (
    telefone !== original.telefone ||
    chavePix !== original.chavePix ||
    JSON.stringify(end) !== JSON.stringify(original.end) ||
    !!novaSenha || !!confirmarSenha
  );

  // Avisa antes de fechar/recarregar a aba com alterações pendentes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Navegação interna (botões desta tela) pede confirmação se houver alteração.
  const navGuard = (to) => {
    if (dirty && !window.confirm('Você tem alterações não salvas. Sair sem salvar?')) return;
    nav(to);
  };

  // CEP → preenche logradouro/bairro/cidade/UF (ViaCEP; falha silenciosa).
  const buscarCep = async (cepRaw) => {
    const cep = (cepRaw || '').replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (!j.erro) setEnd(p => ({ ...p, cep, logradouro: j.logradouro || p.logradouro, bairro: j.bairro || p.bairro, cidade: j.localidade || p.cidade, uf: j.uf || p.uf }));
    } catch { /* CEP offline, usuário preenche manualmente */ }
    setCepLoading(false);
  };

  const cancelar = () => {
    if (!original) return;
    setTelefone(original.telefone);
    setChavePix(original.chavePix);
    setEnd({ ...original.end });
    setNovaSenha(''); setConfirmarSenha('');
    setMensagem(null);
  };

  // Comissões (apenas para papéis elegíveis) — saldo via API unificada /api/saque
  // Comissões/PIX: SÓ para a equipe com repasse (admin/consultor/analista/advogado).
  // Usa effectiveRole (não `role`) para que, durante o modo suporte/impersonate, os
  // blocos de comissão/PIX NÃO apareçam na tela de um cliente. Clientes nunca veem.
  // (Não gatear por comissao_afiliado_pct: a coluna tem DEFAULT 20, valeria p/ todos.)
  const temComissao = ROLES_COM_COMISSAO.includes(effectiveRole) || ROLES_PAGOS_CLIENTE.includes(effectiveRole);
  const ehParceiro = ROLES_PAGOS_CLIENTE.includes(effectiveRole); // cliente pagante → vê o relatório da rede
  const [relRede, setRelRede] = useState(null); // relatório do Programa de Parceiros (rede multinível)
  const [saldoSaque, setSaldoSaque] = useState(null);
  const [valorSaque, setValorSaque] = useState('');
  const [showSaqueForm, setShowSaqueForm] = useState(false);
  const [solicitandoSaque, setSolicitandoSaque] = useState(false);
  const [msgSaque, setMsgSaque] = useState(null);
  const [proximaLiberacao, setProximaLiberacao] = useState(null); // data da próxima sexta de pagamento
  const [faltandoSaque, setFaltandoSaque] = useState([]); // campos do cadastro que faltam p/ liberar saque

  // "sexta-feira, 18/07" — data calculada no servidor (fuso Bahia) e devolvida pela API.
  const fmtLiberacao = (iso) => {
    if (!iso) return null;
    try { return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso)); }
    catch { return null; }
  };

  const carregarSaldo = async () => {
    try {
      const res = await apiCall('/api/saque');
      const data = await res.json();
      if (res.ok) {
        setSaldoSaque(Number(data.saldo || 0));
        setProximaLiberacao(data.proxima_liberacao || null);
        setFaltandoSaque(Array.isArray(data.faltando) ? data.faltando : []);
      }
    } catch { /* ignora */ }
  };

  useEffect(() => {
    if (!temComissao) return;
    carregarSaldo();
  }, [temComissao, user.id]); // eslint-disable-line

  // Relatório do Programa de Parceiros (rede multinível) — sintético + analítico.
  useEffect(() => {
    if (!ehParceiro) return;
    supabase.rpc('relatorio_comissoes_rede').then(({ data }) => { if (data && !data.erro) setRelRede(data); }).catch(() => {});
  }, [ehParceiro, user.id]); // eslint-disable-line

  // CPF: só é digitado UMA vez. Grava cifrado (cpf-set) e passa a ser reusado em
  // pagamentos e saques. Depois de salvo, o campo vira somente-leitura (mascarado).
  const maskCpf = (v) => (v || '').replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  async function salvarCpf() {
    const digits = cpfInput.replace(/\D/g, '');
    if (digits.length !== 11) { setMsgCpf({ tipo: 'erro', texto: 'Informe um CPF válido (11 dígitos).' }); return; }
    setSalvandoCpf(true); setMsgCpf(null);
    try {
      const r = await apiCall('/api/cpf-set', { method: 'POST', body: JSON.stringify({ cpf: digits }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível salvar o CPF.');
      // Re-lê o CPF mascarado e reavalia a habilitação de saque.
      apiCall('/api/cpf-revelar', { method: 'POST', body: JSON.stringify({ ids: [user.id] }) })
        .then(rr => rr.json()).then(dd => setCpf(dd?.cpfs?.[user.id] || '')).catch(() => {});
      if (temComissao) carregarSaldo();
      setCpfInput('');
      setMsgCpf({ tipo: 'sucesso', texto: 'CPF salvo! Será usado nos seus pagamentos e saques.' });
    } catch (e) {
      setMsgCpf({ tipo: 'erro', texto: e.message || 'Erro ao salvar o CPF.' });
    }
    setSalvandoCpf(false);
  }

  async function solicitarSaque() {
    const valor = Number(valorSaque);
    if (!valor || valor <= 0) { setMsgSaque({ tipo: 'erro', texto: 'Informe um valor válido.' }); return; }
    setSolicitandoSaque(true);
    setMsgSaque(null);
    try {
      const res = await apiCall('/api/saque', { method: 'POST', body: JSON.stringify({ valor }) });
      const data = await res.json();
      if (res.ok) {
        const lib = fmtLiberacao(proximaLiberacao);
        setMsgSaque({ tipo: 'sucesso', texto: `Saque solicitado! Liberação ${lib ? `na ${lib}` : 'na próxima sexta'}. Saldo restante: ${fmtBRL(data.saldo_restante)}` });
        setValorSaque('');
        setShowSaqueForm(false);
        carregarSaldo();
      } else {
        setMsgSaque({ tipo: 'erro', texto: data.error || 'Erro ao solicitar saque.' });
      }
    } catch {
      setMsgSaque({ tipo: 'erro', texto: 'Erro ao solicitar saque.' });
    } finally {
      setSolicitandoSaque(false);
    }
  }

  async function salvar(e) {
    e?.preventDefault();
    setMensagem(null);

    if (novaSenha && novaSenha !== confirmarSenha) {
      setMensagem({ tipo: 'erro', texto: 'As senhas não coincidem.' });
      return;
    }
    if (novaSenha && novaSenha.length < 6) {
      setMensagem({ tipo: 'erro', texto: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    setSalvando(true);
    try {
      if (novaSenha) {
        const { error } = await supabase.auth.updateUser({ password: novaSenha });
        if (error) throw error;
      }

      // Endereço formatado (campo legado, usado em export/contratos que leem `endereco`).
      const enderecoFmt = [
        [end.logradouro, end.numero].filter(Boolean).join(', '),
        end.complemento, end.bairro,
        [end.cidade, end.uf].filter(Boolean).join(' - '),
        end.cep ? `CEP ${end.cep}` : '',
      ].filter(Boolean).join(' · ');

      const perfilUpdate = {
        telefone: telefone || null,
        endereco: enderecoFmt || null,
        endereco_cep: end.cep || null,
        endereco_logradouro: end.logradouro || null,
        endereco_numero: end.numero || null,
        endereco_complemento: end.complemento || null,
        endereco_bairro: end.bairro || null,
        endereco_cidade: end.cidade || null,
        endereco_uf: end.uf || null,
      };
      if (temComissao) perfilUpdate.chave_pix = chavePix || null;

      const { error: e2 } = await supabase.from('perfis').update(perfilUpdate).eq('id', user.id);
      if (e2) throw e2;

      setNovaSenha('');
      setConfirmarSenha('');
      setOriginal({ telefone, chavePix, end: { ...end } });
      setMensagem({ tipo: 'sucesso', texto: 'Dados atualizados com sucesso!' });
      if (temComissao) carregarSaldo(); // reavalia o que falta p/ liberar o saque
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao salvar alterações.' });
    } finally {
      setSalvando(false);
    }
  }

  async function baixarDados() {
    setBaixando(true);
    setLgpdErro(null);
    try {
      const res = await apiCall('/api/lgpd-exportar');
      // apiCall devolve o Response cru; JSON.stringify(Response) vira "{}" — o export LGPD
      // saía sempre vazio. Precisa ler o corpo (e falhar de verdade se não vier OK).
      if (!res.ok) throw new Error('falha_exportar');
      const dados = await res.json();
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meus-dados-bidpro-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setLgpdErro('Erro ao exportar dados. Tente novamente.');
    } finally {
      setBaixando(false);
    }
  }

  async function excluirConta() {
    if (textoConfirmacao !== 'EXCLUIR') return;
    setExcluindo(true);
    setLgpdErro(null);
    try {
      // fetch NÃO lança em 4xx/5xx — sem checar res.ok, uma exclusão que falhou no
      // servidor ainda deslogava o usuário e o mandava pra home como se a conta (e a PII)
      // tivessem sido apagadas. Confirma o sucesso ANTES de deslogar.
      const res = await apiCall('/api/lgpd-excluir', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'falha_excluir');
      }
      await supabase.auth.signOut();
      nav('/');
    } catch (err) {
      setLgpdErro('Erro ao excluir conta. Tente novamente.');
      setExcluindo(false);
    }
  }

  const roleLabel = ROLE_LABELS[role] || role || 'Explorador';
  const roleColor = ROLE_COLORS[role] || '#64748b';

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 14,
    color: '#111111',
    background: 'white',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#475569',
    marginBottom: 6,
  };

  const fieldStyle = {
    marginBottom: 20,
  };

  // ── Assinatura: posição do plano atual na hierarquia + planos acima/abaixo ──
  const planosCat = planosLive || PLANOS_STATIC;
  const baseRole = String(role || 'explorador').replace('_anual', '');
  const idxAtual = ORDEM_PLANOS.indexOf(baseRole); // -1 = papel operacional (equipe)
  const ehCliente = ROLES_CLIENTE.includes(role);
  const fmtPreco = (p) => {
    if (!p) return '';
    if (Number(p.preco) === 0) return 'Grátis';
    return `${p.precoLabel || ''}${p.periodicidade ? ' ' + p.periodicidade : ''}`;
  };
  const irCheckout = (key) => navGuard(`/checkout?plano=${key}`);

  // Abas visíveis: Investidor só para cliente; Parceiros só para quem recebe comissão.
  const TABS = [
    { id: 'assinatura', label: 'Assinatura', icon: CreditCard },
    { id: 'dados', label: 'Meus dados', icon: ShieldCheck },
    ...(ehCliente ? [{ id: 'investidor', label: 'Investidor', icon: BarChart2 }] : []),
    ...((temComissao || ehParceiro) ? [{ id: 'parceiros', label: 'Parceiros', icon: BarChart2 }] : []),
    { id: 'preferencias', label: 'Preferências', icon: Bell },
  ];
  const abaValida = TABS.some(t => t.id === aba) ? aba : 'assinatura';

  return (
    <div style={{ minHeight: '80vh', background: '#f1f5f9', padding: isMobile ? '24px 16px' : '40px 20px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: '#111111', margin: 0 }}>Meu Perfil</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 6 }}>Gerencie sua assinatura, seus dados e suas preferências</p>
        </div>

        {/* Sub-abas por funcionalidade */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 22, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
          {TABS.map(t => {
            const on = abaValida === t.id;
            return (
              <button key={t.id} onClick={() => setAba(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, border: on ? '1px solid #0D63DB' : '1px solid #e2e8f0',
                  background: on ? '#0D63DB' : 'white', color: on ? 'white' : '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <t.icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>

        {/* ═══ ABA: ASSINATURA ═══ */}
        {abaValida === 'assinatura' && (<>
        {/* Card Plano atual */}
        <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', marginBottom: 16, border: `1px solid ${roleColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>PLANO ATUAL</div>
            <span style={{
              display: 'inline-block',
              padding: '4px 12px',
              background: roleColor,
              color: 'white',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 700,
            }}>{roleLabel}</span>
            {ehCliente && idxAtual >= 0 && (
              <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 8 }}>{fmtPreco(planosCat[baseRole])}</div>
            )}
          </div>
          {ROLES_PAGANTES.includes(role) && (
            <button
              onClick={() => { setCancelMsg(null); setCancelModal(true); }}
              style={{ padding: '6px 12px', background: 'transparent', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {dentroGarantia ? 'Cancelar plano e reembolsar' : 'Cancelar plano'}
            </button>
          )}
        </div>

        {/* Quadro de mudança de plano: acima = upgrade · abaixo = downgrade */}
        {idxAtual >= 0 ? (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 10 }}>Mudar de plano</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ORDEM_PLANOS.map((key, idx) => {
                const p = planosCat[key] || PLANOS_STATIC[key];
                if (!p) return null;
                if (key !== 'explorador' && p.ativo === false) return null; // plano desativado no admin
                const ehAtual = idx === idxAtual;
                const acima = idx > idxAtual;
                const cor = ROLE_COLORS[key] || '#64748b';
                const nomeP = ROLE_LABELS[key] || p.nome || key;
                return (
                  <div key={key} style={{ background: 'white', border: `1px solid ${ehAtual ? cor : '#e2e8f0'}`, borderRadius: 12, padding: '14px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', opacity: ehAtual ? 1 : 0.98 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#111' }}>{nomeP}</span>
                        {ehAtual && <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: `${cor}1a`, color: cor }}>ATUAL</span>}
                        {!ehAtual && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: acima ? '#eef2ff' : '#f8fafc', color: acima ? '#0D63DB' : '#94a3b8' }}>{acima ? 'Upgrade' : 'Downgrade'}</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4 }}>{fmtPreco(p)}</div>
                    </div>
                    {ehAtual ? (
                      <span style={{ fontSize: 12, fontWeight: 700, color: cor, display: 'flex', alignItems: 'center', gap: 5 }}><Check size={14} /> Plano atual</span>
                    ) : key === 'explorador' ? (
                      ROLES_PAGANTES.includes(role) ? (
                        <button onClick={() => { setCancelMsg(null); setCancelModal(true); }}
                          style={{ padding: '9px 14px', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                          <ArrowDownCircle size={14} /> Voltar ao gratuito
                        </button>
                      ) : null
                    ) : (
                      <button onClick={() => irCheckout(key)}
                        style={{ padding: '9px 16px', background: acima ? cor : 'white', color: acima ? 'white' : cor, border: `1px solid ${cor}`, borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        {acima ? <>Fazer upgrade <ArrowRight size={14} /></> : <>Mudar para este plano</>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, lineHeight: 1.5 }}>
              Upgrades entram em vigor no pagamento. Para descer de plano pago, fale com a nossa equipe pelo atendimento — cuidamos da transição e de qualquer ajuste proporcional.
            </div>
          </div>
        ) : (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px', marginBottom: 20, fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
            Sua conta é <strong>operacional</strong> (equipe BidPro), sem assinatura de cliente para gerenciar aqui.
          </div>
        )}
        </>)}

        {/* Modal, cancelamento (garantia de 7 dias × renovação) */}
        {cancelModal && (
          <div onClick={() => !cancelando && setCancelModal(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 460 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#111', marginBottom: 8 }}>
                {dentroGarantia ? 'Cancelar e receber reembolso' : 'Cancelar assinatura'}
              </div>
              {dentroGarantia ? (
                <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6, marginBottom: 16 }}>
                  Você está dentro da <strong>garantia de 7 dias</strong> ({diasRestantesGarantia} {diasRestantesGarantia === 1 ? 'dia restante' : 'dias restantes'}).
                  Ao confirmar, cancelamos sua assinatura e o <strong>reembolso de 100%</strong> do valor pago é processado, sem burocracia.
                  Seu acesso volta ao plano Explorador.
                </p>
              ) : (
                <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6, marginBottom: 16 }}>
                  Ao confirmar, cancelamos a <strong>renovação automática</strong>, você não será mais cobrado.
                  Seu acesso continua até o fim do período já pago. Não há reembolso fora da janela de 7 dias.
                </p>
              )}
              {cancelMsg && (
                <div style={{ fontSize: 13, fontWeight: 600, color: cancelMsg.ok ? '#16a34a' : '#dc2626', marginBottom: 12 }}>
                  {cancelMsg.ok ? '✓ ' : '✕ '}{cancelMsg.texto}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setCancelModal(false)} disabled={cancelando}
                  style={{ padding: '9px 16px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {cancelMsg?.ok ? 'Fechar' : 'Voltar'}
                </button>
                {!cancelMsg?.ok && (
                  <button onClick={confirmarCancelamento} disabled={cancelando}
                    style={{ padding: '9px 16px', background: dentroGarantia ? '#059669' : '#dc2626', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: cancelando ? 'default' : 'pointer' }}>
                    {cancelando ? 'Processando…' : dentroGarantia ? 'Confirmar e reembolsar' : 'Confirmar cancelamento'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ ABA: MEUS DADOS ═══ */}
        {abaValida === 'dados' && (<>
        {/* Validação de Identidade, assessorado e clube */}
        {ROLES_SELFIE.includes(role) && (
          <div style={{ background: identValidada ? '#f0fdf4' : '#fffbeb', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: `1px solid ${identValidada ? '#bbf7d0' : '#fde68a'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <ShieldCheck size={18} color={identValidada ? '#16a34a' : '#d97706'} />
              <span style={{ fontWeight: 800, fontSize: 14, color: '#111' }}>Verificação de Identidade</span>
              {identValidada && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', background: '#dcfce7', color: '#166534', borderRadius: 999 }}>✓ Verificado</span>}
              {identPendente && !identValidada && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', background: '#fef9c3', color: '#92400e', borderRadius: 999 }}>Em revisão</span>}
            </div>
            {identValidada ? (
              <p style={{ fontSize: 13, color: '#166534', margin: 0 }}>Sua identidade foi verificada. Você está habilitado para participar de arrematações.</p>
            ) : identPendente ? (
              <p style={{ fontSize: 13, color: '#92400e', margin: 0 }}>Sua foto foi enviada e está em revisão pela nossa equipe. Em breve você receberá a confirmação.</p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: '#78350f', margin: '0 0 12px' }}>Para garantir a segurança das transações, precisamos verificar sua identidade. Tire uma selfie segurando seu documento (RG ou CNH).</p>
                <input ref={selfieRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={e => enviarSelfie(e.target.files[0])} />
                <button
                  onClick={() => selfieRef.current?.click()}
                  disabled={selfieLoading}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', background: '#d97706', color: 'white', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: selfieLoading ? 'not-allowed' : 'pointer', opacity: selfieLoading ? 0.7 : 1 }}>
                  <Camera size={15} /> {selfieLoading ? 'Verificando...' : 'Enviar selfie com documento'}
                </button>
              </>
            )}
            {selfieMsg && (
              <div style={{ marginTop: 10, fontSize: 13, color: selfieMsg.ok ? '#166534' : '#991b1b', fontWeight: 600 }}>
                {selfieMsg.ok ? '✓ ' : '✕ '}{selfieMsg.texto}
              </div>
            )}
          </div>
        )}

        </>)}

        {/* ═══ ABA: INVESTIDOR ═══ */}
        {abaValida === 'investidor' && (
          <>
          {/* Perfil de investidor (editável) — direciona a recomendação por e-mail.
              Só para clientes; equipe (admin/analista/etc.) não recebe recomendação. */}
          {['explorador','top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual'].includes(role) && (
            <PerfilInvestidorCard userId={user?.id} isMobile={isMobile} />
          )}
          </>
        )}

        {/* ═══ ABA: PARCEIROS ═══ */}
        {abaValida === 'parceiros' && (<>
        {/* Programa de Parceiros — relatório da rede (só cliente pagante) */}
        {ehParceiro && relRede && (
          <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 12 }}>PROGRAMA DE PARCEIROS</div>
            {/* Sintético */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 14 }}>
              {[
                { l: 'Total recebido', v: fmtBRL(relRede.total_recebido || 0), c: '#16a34a' },
                { l: 'Este mês', v: fmtBRL(relRede.mes_atual || 0), c: '#0D63DB' },
                { l: 'A liberar', v: fmtBRL(relRede.pendente || 0), c: '#d97706' },
                { l: 'Indicados', v: `${relRede.diretos || 0}`, c: '#111', sub: `${relRede.diretos_pagantes || 0} pagantes` },
              ].map((k) => (
                <div key={k.l} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{k.l}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: k.c }}>{k.v}</div>
                  {k.sub && <div style={{ fontSize: 10, color: '#94a3b8' }}>{k.sub}</div>}
                </div>
              ))}
            </div>
            {/* Analítico por nível */}
            {Array.isArray(relRede.por_nivel) && relRede.por_nivel.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>Por nível da rede</div>
                {relRede.por_nivel.map((n) => (
                  <div key={n.nivel} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475569', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span>Nível {n.nivel} · {n.n} comissã{n.n === 1 ? 'o' : 'es'}</span>
                    <strong style={{ color: '#16a34a' }}>{fmtBRL(n.valor || 0)}</strong>
                  </div>
                ))}
              </div>
            )}
            {/* Últimas comissões */}
            {Array.isArray(relRede.ultimos) && relRede.ultimos.length > 0 && (
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>Últimas comissões</div>
                {relRede.ultimos.slice(0, 6).map((u, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#64748b', padding: '3px 0' }}>
                    <span>{new Date(u.data).toLocaleDateString('pt-BR')} · N{u.nivel} · {u.origem}</span>
                    <strong style={{ color: '#16a34a' }}>{fmtBRL(u.valor || 0)}</strong>
                  </div>
                ))}
              </div>
            )}
            {(!relRede.ultimos || relRede.ultimos.length === 0) && (
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                Você ainda não tem comissões da rede. Compartilhe seu link de convite na tela inicial — quando um indicado assina um plano, você é recompensado.
              </div>
            )}
          </div>
        )}

        {/* Card Comissões (apenas para papéis com repasse) */}
        {temComissao && (
          <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 12 }}>SAQUE & COMISSÕES</div>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#0D63DB', fontWeight: 700 }}>SALDO DISPONÍVEL</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#111111' }}>
                {saldoSaque !== null ? fmtBRL(saldoSaque) : '—'}
              </div>
            </div>

            {/* Regras e prazos do saque — explícitos para o profissional entender */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 8 }}>Como funciona o saque</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
                <li>Você pode solicitar saques <strong>quando quiser</strong> durante a semana (valores avulsos).</li>
                <li>Os pagamentos são feitos <strong>toda sexta-feira</strong>, via PIX.</li>
                <li><strong>Corte às sextas, 12h:</strong> pedidos até o meio-dia de sexta entram <strong>naquela sexta</strong>; após o corte, na <strong>sexta seguinte</strong>.</li>
                <li>É preciso ter a <strong>chave PIX cadastrada</strong> (nos dados cadastrais, abaixo).</li>
              </ul>
              {proximaLiberacao && (
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: '#0D63DB' }}>
                  📅 Próxima liberação: {fmtLiberacao(proximaLiberacao)}
                </div>
              )}
              {faltandoSaque.length === 0 ? (
                <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: '#16a34a' }}>✓ Cadastro completo — você pode solicitar saque.</div>
              ) : (
                <div style={{ marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#92400e', marginBottom: 4 }}>⚠ Complete seu cadastro para liberar o saque. Falta:</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: '#92400e', lineHeight: 1.6 }}>
                    {faltandoSaque.map(f => <li key={f}><strong>{f}</strong></li>)}
                  </ul>
                  <div style={{ fontSize: 11, color: '#a16207', marginTop: 4 }}>Telefone, CPF e chave PIX você preenche abaixo, nos dados cadastrais. Nome, se faltar, fale com o atendimento.</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowSaqueForm(v => !v); setMsgSaque(null); }}
                disabled={!saldoSaque || saldoSaque <= 0 || faltandoSaque.length > 0}
                title={faltandoSaque.length > 0 ? `Complete o cadastro: falta ${faltandoSaque.join(', ')}` : undefined}
                style={{ flex: 1, padding: '9px', background: (saldoSaque > 0 && faltandoSaque.length === 0) ? '#0D63DB' : '#e2e8f0', color: (saldoSaque > 0 && faltandoSaque.length === 0) ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: (saldoSaque > 0 && faltandoSaque.length === 0) ? 'pointer' : 'default' }}>
                Solicitar saque
              </button>
              <button onClick={() => navGuard('/comissoes')}
                style={{ flex: 1, padding: '9px', background: '#111111', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Ver extrato →
              </button>
            </div>

            {showSaqueForm && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <input
                    type="number" min="1" step="0.01" value={valorSaque}
                    onChange={e => setValorSaque(e.target.value)}
                    placeholder={`Valor (máx. ${fmtBRL(saldoSaque)})`}
                    style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                  />
                  <button onClick={solicitarSaque} disabled={solicitandoSaque}
                    style={{ padding: '9px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    {solicitandoSaque ? 'Enviando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            )}

            {msgSaque && (
              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: msgSaque.tipo === 'sucesso' ? '#16a34a' : '#dc2626' }}>
                {msgSaque.tipo === 'sucesso' ? '✓ ' : '✕ '}{msgSaque.texto}
              </div>
            )}
          </div>
        )}
        {(!temComissao && !ehParceiro) && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px', fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
            O <strong>Programa de Parceiros</strong> é liberado para assinantes pagantes. Assine um plano e compartilhe seu link de convite para começar a receber comissões da sua rede.
          </div>
        )}
        </>)}

        {/* ═══ ABA: MEUS DADOS (continuação: dados cadastrais) ═══ */}
        {abaValida === 'dados' && (<>
        {/* Dados cadastrais + endereço */}
        <div style={{ background: 'white', borderRadius: 14, padding: isMobile ? '20px 16px' : '28px 28px', border: '1px solid #e2e8f0' }}>
          <form onSubmit={salvar}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 16 }}>Dados cadastrais</div>

            {/* Nome (fixo) */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Nome</label>
              <input type="text" value={nome} readOnly
                style={{ ...inputStyle, background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' }} />
            </div>

            {/* Linha: E-mail + CPF (fixos) */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ ...fieldStyle, flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>E-mail</label>
                <input type="email" value={user?.email || ''} readOnly
                  style={{ ...inputStyle, background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' }} />
              </div>
              <div style={{ ...fieldStyle, flex: 1, minWidth: 160 }}>
                <label style={labelStyle}>CPF</label>
                {cpf ? (
                  <input type="text" value={cpf} readOnly
                    style={{ ...inputStyle, background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' }} />
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="text" value={cpfInput} onChange={e => setCpfInput(maskCpf(e.target.value))}
                      placeholder="000.000.000-00" inputMode="numeric"
                      style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
                    <button type="button" onClick={salvarCpf} disabled={salvandoCpf || cpfInput.replace(/\D/g, '').length !== 11}
                      style={{ padding: '9px 16px', background: cpfInput.replace(/\D/g, '').length === 11 ? '#111111' : '#e2e8f0', color: cpfInput.replace(/\D/g, '').length === 11 ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: cpfInput.replace(/\D/g, '').length === 11 ? 'pointer' : 'default' }}>
                      {salvandoCpf ? 'Salvando…' : 'Salvar CPF'}
                    </button>
                  </div>
                )}
                {msgCpf && <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600, color: msgCpf.tipo === 'sucesso' ? '#16a34a' : '#dc2626' }}>{msgCpf.texto}</div>}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -12, marginBottom: 20 }}>
              {cpf
                ? 'Nome, e-mail e CPF não podem ser alterados aqui. Para corrigir, fale com o atendimento.'
                : 'Informe seu CPF uma única vez — ele fica salvo com segurança e é reusado nos pagamentos e saques. Nome e e-mail não mudam aqui.'}
            </div>

            {/* Telefone (editável) */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Telefone</label>
              <input type="tel" value={telefone} onChange={e => setTelefone(e.target.value)}
                placeholder="(11) 90000-0000" style={inputStyle} />
            </div>

            {/* Endereço (editável) */}
            <div style={{ height: 1, background: '#f1f5f9', margin: '8px 0 18px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
              <MapPin size={16} color="#0D63DB" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Endereço do assinante</span>
            </div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
              Usado para pré-filtrar a Busca pela sua cidade e nos contratos de assessoria / leilão clube, caso venham a ser gerados.
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ ...fieldStyle, width: 160 }}>
                <label style={labelStyle}>CEP</label>
                <input type="text" value={end.cep} inputMode="numeric"
                  onChange={e => setEnd(p => ({ ...p, cep: e.target.value }))}
                  onBlur={e => buscarCep(e.target.value)}
                  placeholder="00000-000" style={inputStyle} />
                {cepLoading && <div style={{ fontSize: 11, color: '#0D63DB', marginTop: 4 }}>Buscando endereço…</div>}
              </div>
              <div style={{ ...fieldStyle, flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>Logradouro</label>
                <input type="text" value={end.logradouro} onChange={e => setEnd(p => ({ ...p, logradouro: e.target.value }))}
                  placeholder="Rua / Avenida" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ ...fieldStyle, width: 120 }}>
                <label style={labelStyle}>Número</label>
                <input type="text" value={end.numero} onChange={e => setEnd(p => ({ ...p, numero: e.target.value }))}
                  placeholder="123" style={inputStyle} />
              </div>
              <div style={{ ...fieldStyle, flex: 1, minWidth: 180 }}>
                <label style={labelStyle}>Complemento</label>
                <input type="text" value={end.complemento} onChange={e => setEnd(p => ({ ...p, complemento: e.target.value }))}
                  placeholder="Apto, bloco… (opcional)" style={inputStyle} />
              </div>
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Bairro</label>
              <input type="text" value={end.bairro} onChange={e => setEnd(p => ({ ...p, bairro: e.target.value }))}
                placeholder="Bairro" style={inputStyle} />
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ ...fieldStyle, flex: 1, minWidth: 200 }}>
                <label style={labelStyle}>Cidade</label>
                <input type="text" value={end.cidade} onChange={e => setEnd(p => ({ ...p, cidade: e.target.value }))}
                  placeholder="Cidade" style={inputStyle} />
              </div>
              <div style={{ ...fieldStyle, width: 110 }}>
                <label style={labelStyle}>UF</label>
                <select value={end.uf} onChange={e => setEnd(p => ({ ...p, uf: e.target.value }))} style={inputStyle}>
                  <option value="">—</option>
                  {ESTADOS_UF.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
            </div>

            {/* Chave PIX (apenas profissionais com comissão) */}
            {temComissao && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Chave PIX para recebimento</label>
                <input type="text" value={chavePix} onChange={e => setChavePix(e.target.value)}
                  placeholder="CPF, CNPJ, e-mail, telefone ou chave aleatória" style={inputStyle} />
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Usada para transferência de comissões e saques</div>
              </div>
            )}

            {/* Separador senha */}
            <div style={{ height: 1, background: '#f1f5f9', margin: '8px 0 20px' }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 16 }}>Alterar senha (opcional)</div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Nova senha</label>
              <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres" style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Confirmar nova senha</label>
              <input type="password" value={confirmarSenha} onChange={e => setConfirmarSenha(e.target.value)}
                placeholder="Repita a nova senha" style={inputStyle} />
            </div>

            {/* Feedback */}
            {mensagem && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
                background: mensagem.tipo === 'sucesso' ? '#f0fdf4' : '#fef2f2',
                color: mensagem.tipo === 'sucesso' ? '#16a34a' : '#dc2626',
                border: `1px solid ${mensagem.tipo === 'sucesso' ? '#bbf7d0' : '#fecaca'}`,
              }}>
                {mensagem.tipo === 'sucesso' ? '✓ ' : '✕ '}{mensagem.texto}
              </div>
            )}

            {/* Salvar / Cancelar */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={salvando || !dirty}
                style={{
                  flex: 1, padding: '12px', background: (salvando || !dirty) ? '#94a3b8' : '#111111', color: 'white',
                  border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: (salvando || !dirty) ? 'not-allowed' : 'pointer',
                }}>
                {salvando ? 'Salvando...' : dirty ? 'Salvar alterações' : 'Tudo salvo'}
              </button>
              {dirty && (
                <button type="button" onClick={cancelar} disabled={salvando}
                  style={{ padding: '12px 20px', background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </div>
        </>)}

        {/* ═══ ABA: PREFERÊNCIAS ═══ */}
        {abaValida === 'preferencias' && (<>
        {/* Seção Push Notifications */}
        {pushSupport && (
          <div style={{ background: 'white', borderRadius: 14, padding: 24, marginTop: 24, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              {pushAtivo ? <Bell size={18} color="#0D63DB" /> : <BellOff size={18} color="#94a3b8" />}
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111111' }}>Notificações Push</div>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
              Receba alertas de novos imóveis, atualizações dos seus casos e avisos importantes diretamente no seu navegador, mesmo com o site fechado.
            </p>
            {pushMensagem && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, background: pushMensagem.tipo === 'ok' ? '#f0fdf4' : '#fef2f2', color: pushMensagem.tipo === 'ok' ? '#16a34a' : '#dc2626', border: `1px solid ${pushMensagem.tipo === 'ok' ? '#bbf7d0' : '#fca5a5'}` }}>
                {pushMensagem.texto}
              </div>
            )}
            <button onClick={togglePush} disabled={pushLoading}
              style={{ padding: '10px 20px', background: pushAtivo ? '#f1f5f9' : '#0D63DB', color: pushAtivo ? '#475569' : 'white', border: pushAtivo ? '1px solid #e2e8f0' : 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              {pushLoading ? 'Aguarde...' : pushAtivo ? <><BellOff size={14} /> Desativar notificações</> : <><Bell size={14} /> Ativar notificações</>}
            </button>
          </div>
        )}

        {/* Seção LGPD */}
        <div style={{ background: 'white', borderRadius: 14, padding: 24, marginTop: 24, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111111', marginBottom: 6 }}>Seus Dados (LGPD)</div>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
            Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode exportar uma cópia de todos os seus dados pessoais ou solicitar a exclusão da sua conta.
          </p>

          {lgpdErro && (
            <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13, fontWeight: 600, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {lgpdErro}
            </div>
          )}

          {ROLES_PAGANTES.includes(role) && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#166534', lineHeight: 1.6, marginBottom: 10 }}>
                Só quer <strong>parar de pagar</strong>? Você não precisa excluir a conta — <strong>cancele o plano</strong> e continue como <strong>Explorador</strong> (acesso gratuito), mantendo seu histórico e análises.
              </div>
              <button onClick={() => { setCancelMsg(null); setCancelModal(true); }}
                style={{ padding: '10px 18px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Cancelar plano (continuar como Explorador)
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: mostrarConfirmacaoExclusao ? 16 : 0 }}>
            <button
              onClick={baixarDados}
              disabled={baixando}
              style={{
                padding: '10px 18px',
                background: 'white',
                color: '#0D63DB',
                border: '1px solid #0D63DB',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: baixando ? 'not-allowed' : 'pointer',
                opacity: baixando ? 0.7 : 1,
              }}>
              {baixando ? 'Exportando...' : 'Baixar meus dados'}
            </button>
            <button
              onClick={() => { setMostrarConfirmacaoExclusao(v => !v); setTextoConfirmacao(''); setLgpdErro(null); }}
              style={{
                padding: '10px 18px',
                background: 'white',
                color: '#dc2626',
                border: '1px solid #fca5a5',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}>
              Excluir minha conta
            </button>
          </div>

          {mostrarConfirmacaoExclusao && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', marginBottom: 8 }}>Tem certeza? Esta ação é irreversível.</div>
              <p style={{ fontSize: 12, color: '#7f1d1d', margin: '0 0 12px', lineHeight: 1.6 }}>
                Seus dados pessoais serão anonimizados. Registros financeiros são mantidos por 5 anos por obrigação legal. Você será desconectado imediatamente.
              </p>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#991b1b', marginBottom: 6 }}>
                  Digite <strong>EXCLUIR</strong> para confirmar:
                </label>
                <input
                  type="text"
                  value={textoConfirmacao}
                  onChange={e => setTextoConfirmacao(e.target.value)}
                  placeholder="EXCLUIR"
                  style={{ padding: '8px 12px', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={excluirConta}
                  disabled={textoConfirmacao !== 'EXCLUIR' || excluindo}
                  style={{
                    padding: '9px 18px',
                    background: textoConfirmacao === 'EXCLUIR' ? '#dc2626' : '#94a3b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: textoConfirmacao === 'EXCLUIR' && !excluindo ? 'pointer' : 'not-allowed',
                  }}>
                  {excluindo ? 'Excluindo...' : 'Confirmar exclusão'}
                </button>
                <button
                  onClick={() => { setMostrarConfirmacaoExclusao(false); setTextoConfirmacao(''); }}
                  style={{ padding: '9px 18px', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
        </>)}
      </div>

      {/* Barra fixa: alterações não salvas */}
      {dirty && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: '#111111', color: 'white', padding: isMobile ? '12px 16px' : '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', boxShadow: '0 -4px 16px rgba(0,0,0,0.18)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Você tem alterações não salvas.</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={salvar} disabled={salvando}
              style={{ padding: '8px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: salvando ? 'not-allowed' : 'pointer' }}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
            <button onClick={cancelar} disabled={salvando}
              style={{ padding: '8px 18px', background: 'transparent', color: 'white', border: '1px solid #475569', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
