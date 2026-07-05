import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, BarChart3, GraduationCap, Home as HomeIcon, Gift, Copy, Check, ArrowRight, TrendingUp, Calendar, ShieldCheck, Gavel } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import TriagemPerfil from '../components/TriagemPerfil';

// Rótulo e configuração da home por plano (usa o role EFETIVO — respeita o modo suporte).
const PLANO_INFO = {
  explorador:        { nome: 'Explorador',           limite: 5,  cor: '#64748b', indica: false },
  top2:              { nome: 'Investidor Pro',       limite: 15, cor: '#0D63DB', indica: true  },
  top2_anual:        { nome: 'Investidor Pro',       limite: 15, cor: '#0D63DB', indica: true  },
  assessorado:       { nome: 'Assessorado',          limite: 15, cor: '#d97706', indica: false },
  assessorado_anual: { nome: 'Assessorado',          limite: 15, cor: '#d97706', indica: false },
  clube:             { nome: 'Membro Leilão Club',   limite: 15, cor: '#059669', indica: false },
  clube_anual:       { nome: 'Membro Leilão Club',   limite: 15, cor: '#059669', indica: false },
};

const mesAtual = () => new Date().toISOString().slice(0, 7);

const STATUS_CASO = {
  analise_solicitada: 'Em análise', primeira_reuniao: 'Reunião agendada', segunda_reuniao: '2ª reunião',
  juridico_solicitado: 'No jurídico', juridico_concluido: 'Jurídico concluído', arrematado: '✅ Arrematado',
  procuracao_assinada: 'Procuração assinada', concluido: 'Concluído',
};

export default function HomeCliente() {
  const nav = useNavigate();
  const { user, effectiveRole, effectiveUserId } = useAuth();
  const info = PLANO_INFO[effectiveRole] || PLANO_INFO.explorador;
  const primeiroNome = (user?.user_metadata?.nome || user?.email || 'Investidor').split(' ')[0].split('@')[0];

  const [usadas, setUsadas] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const [meusCasos, setMeusCasos] = useState([]);

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('casos').select('id, imovel_endereco, status_etapa, criado_em')
      .eq('cliente_id', effectiveUserId).order('criado_em', { ascending: false }).limit(10)
      .then(({ data }) => setMeusCasos(data || []));
  }, [effectiveUserId]);

  useEffect(() => {
    if (!effectiveUserId || info.limite == null) return;
    supabase.from('perfis').select('analises_mes, analises_count').eq('id', effectiveUserId).single()
      .then(({ data }) => { if (data) setUsadas(data.analises_mes === mesAtual() ? (data.analises_count || 0) : 0); });
  }, [effectiveUserId, info.limite]);

  const restantes = info.limite != null ? Math.max(0, info.limite - usadas) : null;
  const linkIndicacao = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/planos?ref=${effectiveUserId || ''}`;
  const copiarLink = () => { navigator.clipboard?.writeText(linkIndicacao); setCopiado(true); setTimeout(() => setCopiado(false), 2000); };

  const Acao = ({ Icon, titulo, desc, cor, onClick }) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'box-shadow .15s, border-color .15s' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.07)'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e2e8f0'; }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${cor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={20} color={cor} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 2 }}>{titulo}</div>
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{desc}</div>
      </div>
      <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 10 }} />
    </button>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px', display: 'grid', gridTemplateColumns: info.indica ? 'minmax(0,1fr) 320px' : '1fr', gap: 20, alignItems: 'start' }}>
      {/* Triagem de perfil, modal one-time no 1º acesso do cliente */}
      <TriagemPerfil userId={user?.id} />
      {/* Coluna principal */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        {/* Boas-vindas */}
        <div style={{ background: `linear-gradient(135deg, ${info.cor}, ${info.cor}dd)`, borderRadius: 18, padding: '26px 26px', color: 'white' }}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Bem-vindo, {info.nome}</div>
          <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.15 }}>Olá, {primeiroNome}! 👋</div>
          {restantes != null && (
            <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
              <BarChart3 size={14} /> {restantes} de {info.limite} análises disponíveis este mês
            </div>
          )}
          {info.limite == null && (
            <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
              <BarChart3 size={14} /> Análises ilimitadas
            </div>
          )}
        </div>

        {/* Ações rápidas por plano */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Acao Icon={Search} titulo="Buscar leilões" desc="Encontre imóveis em todo o Brasil e analise oportunidades." cor="#0D63DB" onClick={() => nav('/buscar')} />
          <Acao Icon={BarChart3} titulo="Minhas Análises" desc="Retome seus relatórios e agende com o analista." cor="#0d9488" onClick={() => nav('/analises')} />
          <Acao Icon={HomeIcon} titulo="Meu Portfólio" desc="Acompanhe seus imóveis, aportes e resultados." cor="#7c3aed" onClick={() => nav('/painel')} />
          <Acao Icon={GraduationCap} titulo="Área de Membros" desc="Cursos, eBooks e materiais para arrematar com segurança." cor="#059669" onClick={() => nav('/membros')} />
          {(effectiveRole === 'assessorado' || effectiveRole === 'assessorado_anual' || effectiveRole === 'clube' || effectiveRole === 'clube_anual') && (
            <Acao Icon={Calendar} titulo="Agendar com o time" desc="Marque sua reunião de assessoria/mentoria." cor="#d97706" onClick={() => nav('/painel')} />
          )}
          {effectiveRole === 'explorador' && (
            <Acao Icon={TrendingUp} titulo="Fazer upgrade" desc="Investidor Pro: análise documental e jurídica + 15 relatórios/mês." cor="#0D63DB" onClick={() => nav('/planos')} />
          )}
        </div>

        {/* Meus acompanhamentos, casos do cliente (inclui arremates atribuídos pela equipe) */}
        {meusCasos.length > 0 && (
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gavel size={16} color="#059669" /> Meus acompanhamentos
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {meusCasos.map(c => (
                <button key={c.id} onClick={() => nav(`/caso/${c.id}`)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.imovel_endereco || 'Arrematação'}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{STATUS_CASO[c.status_etapa] || c.status_etapa}</div>
                  </div>
                  <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mensagem de segurança (tom positivo, não alarmista) */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '12px 16px' }}>
          <ShieldCheck size={16} color="#0D63DB" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: '#1e3a5f', lineHeight: 1.6 }}>
            <strong>Arremate com segurança.</strong> Cada imóvel vem com relatórios de viabilidade e jurídico e, se quiser, você valida a operação com um analista antes do lance, para decidir com confiança.
          </div>
        </div>
      </div>

      {/* Coluna lateral: Indique e Ganhe (Investidor Pro) */}
      {info.indica && (
        <div style={{ background: 'white', border: '2px solid #ddd6fe', borderRadius: 18, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 88 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Gift size={18} color="#7c3aed" />
            <div style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6' }}>Indique e Ganhe</div>
          </div>
          <div style={{ fontSize: 12.5, color: '#4c1d95', lineHeight: 1.65 }}>
            Para cada pessoa que assinar o Investidor Pro pelo seu link, você ganha <strong>20% de desconto na sua mensalidade</strong>, <strong>acumulativo</strong> e válido <strong>enquanto ela continuar pagando</strong>. Indicou 5 que pagam? Sua mensalidade fica <strong>grátis</strong>.
          </div>
          <div style={{ background: '#faf5ff', border: '1px solid #ede9fe', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: '#6d28d9', wordBreak: 'break-all', fontFamily: 'monospace' }}>{linkIndicacao}</div>
          <button onClick={copiarLink} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {copiado ? <><Check size={15} /> Link copiado!</> : <><Copy size={15} /> Copiar meu link</>}
          </button>
          <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5 }}>O desconto é aplicado automaticamente na sua próxima cobrança assim que o indicado assina.</div>
        </div>
      )}
    </div>
  );
}
