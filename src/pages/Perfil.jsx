import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';
import { BarChart2, FileText, Clock, CheckCircle, AlertTriangle, XCircle, Bell, BellOff, Camera, ShieldCheck, MapPin } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { pushSuportado, statusPermissao, ativarPush, desativarPush, getSubscriptionAtiva } from '../utils/push';
import { ESTADOS_UF } from '../data/cidades';

const fmtBRL = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fmtData = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

const STATUS_LABEL = {
  analise: 'Em Análise', aprovado: 'Aprovado', arrematado: 'Arrematado',
  em_reforma: 'Em Reforma', venda: 'À Venda', alugado: 'Alugado',
  concluido: 'Concluído', reprovado: 'Reprovado',
};
const STATUS_COLOR = {
  analise: '#0D63DB', aprovado: '#16a34a', arrematado: '#7c3aed',
  em_reforma: '#d97706', venda: '#0891b2', alugado: '#0891b2',
  concluido: '#15803d', reprovado: '#dc2626',
};
const STATUS_BG = {
  analise: '#eff6ff', aprovado: '#f0fdf4', arrematado: '#f5f3ff',
  em_reforma: '#fefce8', venda: '#ecfeff', alugado: '#ecfeff',
  concluido: '#f0fdf4', reprovado: '#fef2f2',
};

const ROLES_COM_COMISSAO = ['admin', 'consultor', 'analista', 'advogado'];

const ROLE_LABELS = {
  admin: 'Administrador',
  analista: 'Analista',
  consultor: 'Consultor',
  advogado: 'Advogado',
  explorador: 'Explorador',
  top1: 'Top 1',
  top2: 'Top 2',
  assessorado: 'Assessorado',
  clube: 'Clube',
};

const ROLE_COLORS = {
  admin: '#7c3aed',
  analista: '#0284c7',
  consultor: '#0891b2',
  advogado: '#7c3aed',
  explorador: '#64748b',
  top1: '#d97706',
  top2: '#d97706',
  assessorado: '#16a34a',
  clube: '#dc2626',
};

export default function Perfil() {
  const { user, role, effectiveRole } = useAuth();
  const isMobile = useIsMobile();
  const nav = useNavigate();

  const [nome, setNome] = useState(user?.user_metadata?.nome || '');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [end, setEnd] = useState({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  const [original, setOriginal] = useState(null); // snapshot dos campos editáveis (dirty + cancelar)
  const [cepLoading, setCepLoading] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState(null);
  const [relatorios, setRelatorios] = useState([]);
  const [loadRelatorios, setLoadRelatorios] = useState(false);

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
        if (json.ok) {
          await supabase.from('perfis').update({ identidade_validada: true, identidade_validada_em: new Date().toISOString(), identidade_pendente: false }).eq('id', user.id);
          setIdentValidada(true); setIdentPendente(false);
          setSelfieMsg({ ok: true, texto: 'Identidade verificada com sucesso!' });
        } else {
          // Claude não aprovou automaticamente — marca como pendente para revisão manual
          await supabase.from('perfis').update({ identidade_pendente: true }).eq('id', user.id);
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

  useEffect(() => {
    if (!user?.id) return;
    setLoadRelatorios(true);
    supabase.from('relatorios')
      .select('id, imovel_nome, imovel_cidade, imovel_estado, valor_minimo, desconto_percentual, status, arrematado, created_at, expira_em')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { setRelatorios(data || []); setLoadRelatorios(false); })
      .catch(() => setLoadRelatorios(false));
  }, [user?.id]);

  // Carrega dados cadastrais (nome/cpf fixos + telefone/endereço/pix editáveis)
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('perfis')
      .select('nome,cpf,telefone,chave_pix,endereco_cep,endereco_logradouro,endereco_numero,endereco_complemento,endereco_bairro,endereco_cidade,endereco_uf')
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
        setCpf(data.cpf || '');
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
    } catch { /* CEP offline — usuário preenche manualmente */ }
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
  const temComissao = ROLES_COM_COMISSAO.includes(effectiveRole);
  const [saldoSaque, setSaldoSaque] = useState(null);
  const [valorSaque, setValorSaque] = useState('');
  const [showSaqueForm, setShowSaqueForm] = useState(false);
  const [solicitandoSaque, setSolicitandoSaque] = useState(false);
  const [msgSaque, setMsgSaque] = useState(null);

  const carregarSaldo = async () => {
    try {
      const res = await apiCall('/api/saque');
      const data = await res.json();
      if (res.ok) setSaldoSaque(Number(data.saldo || 0));
    } catch { /* ignora */ }
  };

  useEffect(() => {
    if (!temComissao) return;
    carregarSaldo();
  }, [temComissao, user.id]); // eslint-disable-line

  async function solicitarSaque() {
    const valor = Number(valorSaque);
    if (!valor || valor <= 0) { setMsgSaque({ tipo: 'erro', texto: 'Informe um valor válido.' }); return; }
    setSolicitandoSaque(true);
    setMsgSaque(null);
    try {
      const res = await apiCall('/api/saque', { method: 'POST', body: JSON.stringify({ valor }) });
      const data = await res.json();
      if (res.ok) {
        setMsgSaque({ tipo: 'sucesso', texto: `Saque solicitado! Saldo restante: ${fmtBRL(data.saldo_restante)}` });
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
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
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
      await apiCall('/api/lgpd-excluir', { method: 'POST' });
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

  return (
    <div style={{ minHeight: '80vh', background: '#f1f5f9', padding: isMobile ? '24px 16px' : '40px 20px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: '#111111', margin: 0 }}>Meu Perfil</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 6 }}>Gerencie seus dados e segurança da conta</p>
        </div>

        {/* Card Plano */}
        <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
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
          </div>
          <button
            onClick={() => navGuard('/planos')}
            style={{ padding: '8px 16px', background: '#111111', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Fazer upgrade
          </button>
        </div>

        {/* Validação de Identidade — assessorado e clube */}
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

        {/* Minhas Análises */}
        {['top1','top2','assessorado','clube','analista','advogado','admin'].includes(role) && (
          <div style={{ background: 'white', borderRadius: 14, padding: isMobile ? '16px' : '24px', border: '1px solid #e2e8f0', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChart2 size={18} color="#0D63DB" />
                <span style={{ fontSize: 15, fontWeight: 800, color: '#111111' }}>Minhas Análises</span>
              </div>
              <button onClick={() => navGuard('/analise')}
                style={{ padding: '6px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                + Nova análise
              </button>
            </div>

            {loadRelatorios ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>Carregando…</div>
            ) : relatorios.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '28px 0' }}>
                <FileText size={32} color="#e2e8f0" style={{ marginBottom: 8 }} />
                <div>Nenhuma análise salva ainda.</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Encontre um imóvel e clique em "Solicitar Análise".</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {relatorios.map(r => {
                  const desc = r.desconto_percentual || 0;
                  const diasRestantes = r.expira_em ? Math.ceil((new Date(r.expira_em) - new Date()) / (1000*60*60*24)) : null;
                  return (
                    <div key={r.id}
                      onClick={() => navGuard('/analise')}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer', background: '#f8fafc', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={e => e.currentTarget.style.background = '#f8fafc'}
                    >
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: STATUS_BG[r.status] || '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <FileText size={16} color={STATUS_COLOR[r.status] || '#64748b'} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#111111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.imovel_nome || 'Imóvel sem nome'}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {[r.imovel_cidade, r.imovel_estado].filter(Boolean).join('/')}
                          {r.valor_minimo ? ` · ${fmtBRL(r.valor_minimo)}` : ''}
                          {desc > 0 ? ` · -${Number(desc).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: STATUS_BG[r.status] || '#f1f5f9', color: STATUS_COLOR[r.status] || '#64748b' }}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                        {diasRestantes !== null && (
                          <span style={{ fontSize: 10, color: diasRestantes <= 7 ? '#dc2626' : '#94a3b8' }}>
                            {diasRestantes > 0 ? `Expira em ${diasRestantes}d` : 'Expirado'}
                          </span>
                        )}
                        {r.arrematado && (
                          <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700 }}>Permanente</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* Card Comissões (apenas para papéis com repasse) */}
        {temComissao && (
          <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 12 }}>MINHAS COMISSÕES</div>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#0D63DB', fontWeight: 700 }}>SALDO DISPONÍVEL</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#111111' }}>
                {saldoSaque !== null ? fmtBRL(saldoSaque) : '—'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowSaqueForm(v => !v); setMsgSaque(null); }}
                disabled={!saldoSaque || saldoSaque <= 0}
                style={{ flex: 1, padding: '9px', background: saldoSaque > 0 ? '#0D63DB' : '#e2e8f0', color: saldoSaque > 0 ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: saldoSaque > 0 ? 'pointer' : 'default' }}>
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
                <input type="text" value={cpf || '—'} readOnly
                  style={{ ...inputStyle, background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' }} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -12, marginBottom: 20 }}>Nome, e-mail e CPF não podem ser alterados aqui. Para corrigir, fale com o atendimento.</div>

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

        {/* Seção Push Notifications */}
        {pushSupport && (
          <div style={{ background: 'white', borderRadius: 14, padding: 24, marginTop: 24, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              {pushAtivo ? <Bell size={18} color="#0D63DB" /> : <BellOff size={18} color="#94a3b8" />}
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111111' }}>Notificações Push</div>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>
              Receba alertas de novos imóveis, atualizações dos seus casos e avisos importantes diretamente no seu navegador — mesmo com o site fechado.
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
                background: '#dc2626',
                color: 'white',
                border: 'none',
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
