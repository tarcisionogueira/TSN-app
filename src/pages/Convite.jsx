import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserPlus, AlertCircle, ShieldCheck, Users, ArrowRight, Briefcase } from 'lucide-react';
import { supabase } from '../utils/supabase';

const ROLE_LABELS = {
  analista: 'Analista',
  advogado: 'Advogado',
  consultor: 'Consultor',
  admin: 'Administrador',
};

const ROLE_COLORS = {
  analista: { bg: '#dbeafe', color: '#084BA6', icon: '🔍' },
  advogado: { bg: '#ede9fe', color: '#5b21b6', icon: '⚖️' },
  consultor: { bg: '#d1fae5', color: '#065f46', icon: '🤝' },
  admin:     { bg: '#fef3c7', color: '#92400e', icon: '👑' },
};

export default function Convite() {
  const { codigo } = useParams();
  const nav = useNavigate();

  const [link, setLink]             = useState(null);
  const [conviteEquipe, setConviteEquipe] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [erro, setErro]             = useState('');

  useEffect(() => {
    if (!codigo) return;

    async function detectar() {
      setLoading(true);

      // 1. Try convites_equipe first (team invite by token)
      const { data: equipeData } = await supabase
        .from('convites_equipe')
        .select('*')
        .eq('token', codigo)
        .eq('ativo', true)
        .single();

      if (equipeData) {
        // Check not expired
        if (equipeData.expira_em && new Date(equipeData.expira_em) < new Date()) {
          setErro('Este link de convite da equipe expirou.');
        } else {
          setConviteEquipe(equipeData);
          sessionStorage.setItem('tsn_convite_equipe', equipeData.token);
        }
        setLoading(false);
        return;
      }

      // 2. Fallback: client invite (links_convite)
      const { data, error } = await supabase
        .from('links_convite')
        .select('id, codigo, criado_por, perfis:criado_por(nome)')
        .eq('codigo', codigo.toUpperCase())
        .eq('ativo', true)
        .single();

      if (error || !data) {
        setErro('Link de convite não encontrado ou expirado.');
      } else {
        setLink(data);
        sessionStorage.setItem('tsn_convite_codigo', data.codigo);
      }
      setLoading(false);
    }

    detectar();
  }, [codigo]);

  const irParaCadastroEquipe = () => {
    sessionStorage.setItem('tsn_convite_equipe', codigo);
    nav('/login?modo=cadastro&convite_equipe=' + codigo);
  };
  const irParaLoginEquipe = () => {
    sessionStorage.setItem('tsn_convite_equipe', codigo);
    nav('/login?convite_equipe=' + codigo);
  };

  const irParaCadastro = () => nav('/login?modo=cadastro&convite=' + codigo);
  const irParaLogin    = () => nav('/login?convite=' + codigo);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111111', color: '#94a3b8' }}>
      Carregando convite…
    </div>
  );

  if (erro || (!link && !conviteEquipe)) return (
    <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
        <h2 style={{ color: 'white', marginBottom: 8 }}>Convite não encontrado</h2>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>{erro || 'Este link pode ter sido desativado.'}</p>
        <button onClick={() => nav('/login')} style={{ padding: '10px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
          Ir para Login
        </button>
      </div>
    </div>
  );

  // ── Team invite view ──────────────────────────────────────────────────────────
  if (conviteEquipe) {
    const roles = conviteEquipe.roles || [];
    const primaryRole = roles[0] || 'analista';
    const primaryColors = ROLE_COLORS[primaryRole] || ROLE_COLORS.analista;
    const rolesLabel = roles.map(r => ROLE_LABELS[r] || r).join(' + ');

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #111111 0%, #111111 50%, #111111 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>

          <div style={{ fontSize: 64, marginBottom: 16 }}>
            {primaryColors.icon}
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#7c3aed', color: 'white', fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20, marginBottom: 24 }}>
            <Briefcase size={14} /> Convite de Equipe TSN Ativos
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 900, color: 'white', margin: '0 0 12px', lineHeight: 1.2 }}>
            Você foi convidado para integrar a equipe TSN Ativos como{' '}
            <span style={{ color: '#a78bfa' }}>{rolesLabel}</span>
          </h1>

          <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.7, margin: '0 0 24px' }}>
            {conviteEquipe.descricao || 'Você receberá acesso às ferramentas e painéis específicos para sua função na plataforma.'}
          </p>

          {/* Role badges */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 32, flexWrap: 'wrap' }}>
            {roles.map(r => {
              const rc = ROLE_COLORS[r] || { bg: '#f1f5f9', color: '#475569', icon: '👤' };
              return (
                <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 999, fontWeight: 700, fontSize: 14, background: rc.bg, color: rc.color }}>
                  {rc.icon} {ROLE_LABELS[r] || r}
                </span>
              );
            })}
          </div>

          <div style={{ background: 'white', borderRadius: 20, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
            <button onClick={irParaCadastroEquipe}
              style={{ width: '100%', padding: '14px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
              <UserPlus size={18} /> Criar minha conta na equipe
            </button>

            <button onClick={irParaLoginEquipe}
              style={{ width: '100%', padding: '12px', background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              Já tenho conta — Entrar <ArrowRight size={16} />
            </button>

            <div style={{ marginTop: 16, fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <ShieldCheck size={11} /> Acesso seguro · Dados protegidos
            </div>
          </div>

          {conviteEquipe.expira_em && (
            <p style={{ marginTop: 16, fontSize: 12, color: '#475569' }}>
              Convite válido até: <strong style={{ color: '#60a5fa' }}>{new Date(conviteEquipe.expira_em).toLocaleDateString('pt-BR')}</strong>
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Client invite view (original) ────────────────────────────────────────────
  const nomeConvidante = link.perfis?.nome || 'TSN Ativos';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #111111 0%, #111111 50%, #111111 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>

        <div style={{ fontSize: 64, marginBottom: 16 }}>🎯</div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0D63DB', color: 'white', fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20, marginBottom: 24 }}>
          <Users size={14} /> Convite exclusivo
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 900, color: 'white', margin: '0 0 12px', lineHeight: 1.2 }}>
          {nomeConvidante} te convidou para o TSN Ativos
        </h1>

        <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.7, margin: '0 0 36px' }}>
          Plataforma completa para análise e acompanhamento de imóveis em leilão. Acesse leilões, analise oportunidades e gerencie seus ativos em um só lugar.
        </p>

        <div style={{ background: 'white', borderRadius: 20, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
          <button onClick={irParaCadastro}
            style={{ width: '100%', padding: '14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
            <UserPlus size={18} /> Criar minha conta
          </button>

          <button onClick={irParaLogin}
            style={{ width: '100%', padding: '12px', background: '#f8fafc', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            Já tenho conta — Entrar <ArrowRight size={16} />
          </button>

          <div style={{ marginTop: 16, fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <ShieldCheck size={11} /> Acesso seguro · Dados protegidos
          </div>
        </div>

        <p style={{ marginTop: 20, fontSize: 12, color: '#475569' }}>
          Código do convite: <strong style={{ color: '#60a5fa' }}>{link.codigo}</strong>
        </p>
      </div>
    </div>
  );
}
