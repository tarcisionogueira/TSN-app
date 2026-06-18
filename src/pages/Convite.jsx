import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UserPlus, AlertCircle, ShieldCheck, Users, ArrowRight } from 'lucide-react';
import { supabase } from '../utils/supabase';

export default function Convite() {
  const { codigo } = useParams();
  const nav = useNavigate();

  const [link, setLink]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');

  useEffect(() => {
    if (!codigo) return;
    supabase
      .from('links_convite')
      .select('id, codigo, criado_por, perfis:criado_por(nome)')
      .eq('codigo', codigo.toUpperCase())
      .eq('ativo', true)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setErro('Link de convite não encontrado ou expirado.');
        else {
          setLink(data);
          // Guarda o código para uso pós-login
          sessionStorage.setItem('tsn_convite_codigo', data.codigo);
        }
        setLoading(false);
      });
  }, [codigo]);

  const irParaCadastro = () => nav('/login?modo=cadastro&convite=' + codigo);
  const irParaLogin    = () => nav('/login?convite=' + codigo);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#94a3b8' }}>
      Carregando convite…
    </div>
  );

  if (erro || !link) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
        <h2 style={{ color: 'white', marginBottom: 8 }}>Convite não encontrado</h2>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>{erro || 'Este link pode ter sido desativado.'}</p>
        <button onClick={() => nav('/login')} style={{ padding: '10px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
          Ir para Login
        </button>
      </div>
    </div>
  );

  const nomeConvidante = link.perfis?.nome || 'TSN Ativos';

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>

        <div style={{ fontSize: 64, marginBottom: 16 }}>🎯</div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#2563eb', color: 'white', fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20, marginBottom: 24 }}>
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
            style={{ width: '100%', padding: '14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
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
