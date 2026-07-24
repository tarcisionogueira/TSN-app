import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, BarChart3, GraduationCap, Home as HomeIcon, Gift, Copy, Check, ArrowRight, TrendingUp, Calendar, ShieldCheck, Gavel } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import TriagemPerfil from '../components/TriagemPerfil';

// Rótulo e configuração da home por plano (usa o role EFETIVO — respeita o modo suporte).
const PLANO_INFO = {
  // Admin/equipe entram pela home normal (o admin, desde o fim do redirect forçado) — sem o
  // fallback "Explorador 3/3". limite null = ilimitado (esconde o contador "X de Y").
  admin:             { nome: 'Administrador',        limite: null, cor: '#7c3aed', indica: false },
  analista:          { nome: 'Analista',             limite: null, cor: '#0d9488', indica: false },
  advogado:          { nome: 'Jurídico',             limite: null, cor: '#0d9488', indica: false },
  consultor:         { nome: 'Consultor',            limite: null, cor: '#d97706', indica: true  },
  explorador:        { nome: 'Explorador',           limite: 3,  cor: '#64748b', indica: true  },
  top2:              { nome: 'Investidor Pro',       limite: 10, cor: '#0D63DB', indica: true  },
  top2_anual:        { nome: 'Investidor Pro',       limite: 10, cor: '#0D63DB', indica: true  },
  assessorado:       { nome: 'Assessorado',          limite: 10, cor: '#d97706', indica: false },
  assessorado_anual: { nome: 'Assessorado',          limite: 10, cor: '#d97706', indica: false },
  clube:             { nome: 'Membro Leilão Club',   limite: 10, cor: '#059669', indica: false },
  clube_anual:       { nome: 'Membro Leilão Club',   limite: 10, cor: '#059669', indica: false },
};

const mesAtual = () => new Date().toISOString().slice(0, 7);

// Termo de aceite do Programa de Parceiros — só indica/recebe quem aceitar as regras.
// (Sem revelar percentuais: mantém a estrutura comercial reservada.)
const TERMO_PARCEIRO_VERSAO = 'v1-2026-07';
const TERMO_PARCEIRO = [
  'Participo do Programa de Parceiros indicando pessoas para a BidPro Brasil.',
  'Sou recompensado apenas sobre assinaturas, produtos/mentorias e vendas diretas efetivamente pagas por quem eu indicar (direta ou indiretamente na minha rede). Não há recompensa sobre honorários de êxito nem sobre recarga de créditos.',
  'As recompensas valem enquanto minha assinatura estiver ativa (paga).',
  'Os pagamentos são por PIX, semanais (às sextas), após conferência, e exigem cadastro completo: nome, CPF, telefone e chave PIX.',
  'Indico de forma honesta: sem spam, sem autoindicação e sem informações falsas. Indicações irregulares podem ser canceladas e a participação encerrada.',
  'Sou responsável pelos tributos incidentes sobre os valores que eu receber.',
  'A BidPro pode ajustar as regras e os percentuais do Programa, com aviso prévio razoável.',
];

const STATUS_CASO = {
  analise_solicitada: 'Em análise', primeira_reuniao: 'Reunião agendada', segunda_reuniao: '2ª reunião',
  juridico_solicitado: 'No jurídico', juridico_concluido: 'Jurídico concluído', arrematado: '✅ Arrematado',
  procuracao_assinada: 'Procuração assinada', concluido: 'Concluído',
};

export default function HomeCliente() {
  const nav = useNavigate();
  const { user, effectiveRole, effectiveUserId, planoLegado } = useAuth();
  const infoBase = PLANO_INFO[effectiveRole] || PLANO_INFO.explorador;
  // Assinante antigo (grandfather) mantém 15; o banco (limite_ia_efetivo) confirma na hora.
  const ehPagoCliente = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'].includes(effectiveRole);
  const info = (planoLegado && ehPagoCliente && infoBase.limite != null) ? { ...infoBase, limite: 15 } : infoBase;
  const primeiroNome = (user?.user_metadata?.nome || user?.email || 'Investidor').split(' ')[0].split('@')[0];

  const [usadas, setUsadas] = useState(0);
  const [copiado, setCopiado] = useState(false);
  const [meusCasos, setMeusCasos] = useState([]);
  const [aceite, setAceite] = useState(undefined); // undefined=carregando · null=não aceitou · ts=aceitou
  const [showTermo, setShowTermo] = useState(false);
  const [concordo, setConcordo] = useState(false);
  const [aceitando, setAceitando] = useState(false);

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

  // Aceite do Programa de Parceiros — habilita o link de indicação e o recebimento.
  useEffect(() => {
    if (!effectiveUserId || !info.indica) return;
    supabase.from('perfis').select('parceiro_aceite_em').eq('id', effectiveUserId).single()
      .then(({ data }) => setAceite(data?.parceiro_aceite_em || null));
  }, [effectiveUserId, info.indica]);

  const aceitarParceria = async () => {
    if (!concordo || aceitando) return;
    setAceitando(true);
    try {
      const { data, error } = await supabase.rpc('aceitar_parceria', { p_versao: TERMO_PARCEIRO_VERSAO });
      if (!error) { setAceite(data || new Date().toISOString()); setShowTermo(false); }
    } finally { setAceitando(false); }
  };

  const Acao = ({ Icon, titulo, desc, cor, onClick }) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'box-shadow .15s, border-color .15s' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.07)'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e2e8f0'; }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${cor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={20} color={cor} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#111', marginBottom: 3 }}>{titulo}</div>
        <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.55 }}>{desc}</div>
      </div>
      <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 10 }} />
    </button>
  );

  return (
    <div className="home-grid" style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px', display: 'grid', gridTemplateColumns: info.indica ? 'minmax(0,1fr) 320px' : '1fr', gap: 20, alignItems: 'start' }}>
      {/* No celular a coluna lateral (Indique e Ganhe) empilha embaixo do conteúdo. */}
      <style>{`@media (max-width: 820px){ .home-grid{ grid-template-columns: 1fr !important; } }`}</style>
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
            <div style={{ fontSize: 16.5, fontWeight: 800, color: '#111', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gavel size={18} color="#059669" /> Meus acompanhamentos
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {meusCasos.map(c => (
                <button key={c.id} onClick={() => nav(`/caso/${c.id}`)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.imovel_endereco || 'Arrematação'}</div>
                    <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>{STATUS_CASO[c.status_etapa] || c.status_etapa}</div>
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

      {/* Coluna lateral: Programa de Parceiros — só libera o link após o TERMO DE ACEITE */}
      {info.indica && (
        <div style={{ background: 'white', border: '2px solid #ddd6fe', borderRadius: 18, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 88 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Gift size={18} color="#7c3aed" />
            <div style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6' }}>Programa de Parceiros</div>
          </div>
          <div style={{ fontSize: 12.5, color: '#4c1d95', lineHeight: 1.65 }}>
            {ehPagoCliente ? (
              <>Indique investidores para a BidPro e <strong>ganhe indicando</strong>: quando alguém da sua rede assina um plano, você é recompensado — enquanto sua assinatura estiver ativa.</>
            ) : (
              <>Convide investidores para a BidPro e <strong>ganhe indicando</strong>. Quando alguém assina um plano pela sua indicação, <strong>você é recompensado</strong>.</>
            )}
          </div>

          {aceite ? (
            <>
              {/* Já é parceiro → link liberado */}
              <div style={{ background: '#faf5ff', border: '1px solid #ede9fe', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: '#6d28d9', wordBreak: 'break-all', fontFamily: 'monospace' }}>{linkIndicacao}</div>
              <button onClick={copiarLink} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                {copiado ? <><Check size={15} /> Link copiado!</> : <><Copy size={15} /> Copiar meu link</>}
              </button>
              <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5 }}>Sua recompensa é creditada automaticamente quando o indicado assina um plano. Você aceitou as regras do Programa.</div>
            </>
          ) : (
            <>
              {/* Ainda não é parceiro → convite + aceite */}
              <div style={{ background: '#f5f3ff', border: '1px dashed #c4b5fd', borderRadius: 10, padding: '11px 13px', fontSize: 11.5, color: '#6d28d9', lineHeight: 1.6 }}>
                Para indicar e receber, ative sua participação e <strong>aceite as regras</strong> do Programa. Leva 10 segundos.
              </div>
              <button onClick={() => { setConcordo(false); setShowTermo(true); }} disabled={aceite === undefined}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: aceite === undefined ? '#c4b5fd' : '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: aceite === undefined ? 'default' : 'pointer' }}>
                <Gift size={15} /> Quero ser parceiro
              </button>
              <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5 }}>Traz segurança para você e para a BidPro: você indica de acordo com as regras.</div>
            </>
          )}
        </div>
      )}

      {/* Modal — Termo de aceite do Programa de Parceiros */}
      {showTermo && (
        <div onClick={() => !aceitando && setShowTermo(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 18, padding: 24, width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Gift size={20} color="#7c3aed" />
              <div style={{ fontSize: 18, fontWeight: 900, color: '#5b21b6' }}>Programa de Parceiros — Regras</div>
            </div>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
              Leia e aceite para ativar sua participação. Ao aceitar, você passa a poder <strong>indicar</strong> e <strong>receber</strong> pelo programa.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
              {TERMO_PARCEIRO.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Check size={15} color="#7c3aed" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.55 }}>{t}</span>
                </div>
              ))}
            </div>
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer', background: '#faf5ff', border: '1px solid #ede9fe', borderRadius: 10, padding: '11px 13px', marginBottom: 14 }}>
              <input type="checkbox" checked={concordo} onChange={e => setConcordo(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: '#7c3aed', cursor: 'pointer' }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#5b21b6', lineHeight: 1.5 }}>
                Li e concordo com as regras do Programa de Parceiros e declaro que vou indicar de acordo com elas.
              </span>
            </label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowTermo(false)} disabled={aceitando}
                style={{ padding: '10px 16px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Agora não</button>
              <button onClick={aceitarParceria} disabled={!concordo || aceitando}
                style={{ padding: '10px 18px', background: (!concordo || aceitando) ? '#c4b5fd' : '#7c3aed', color: 'white', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: (!concordo || aceitando) ? 'default' : 'pointer' }}>
                {aceitando ? 'Ativando…' : 'Aceitar e ativar meu link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
