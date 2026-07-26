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
  admin:             { nome: 'Administrador',        limite: null, cor: '#0D63DB', indica: true  },
  analista:          { nome: 'Analista',             limite: null, cor: '#0D63DB', indica: true  },
  advogado:          { nome: 'Jurídico',             limite: null, cor: '#0D63DB', indica: true  },
  consultor:         { nome: 'Consultor',            limite: null, cor: '#0D63DB', indica: true  },
  explorador:        { nome: 'Explorador',           limite: 3,  cor: '#0D63DB', indica: true  },
  top2:              { nome: 'Investidor Pro',       limite: 10, cor: '#0D63DB', indica: true  },
  top2_anual:        { nome: 'Investidor Pro',       limite: 10, cor: '#0D63DB', indica: true  },
  assessorado:       { nome: 'Assessorado',          limite: 10, cor: '#0D63DB', indica: true  },
  assessorado_anual: { nome: 'Assessorado',          limite: 10, cor: '#0D63DB', indica: true  },
  clube:             { nome: 'Membro Leilão Club',   limite: 10, cor: '#0D63DB', indica: true  },
  clube_anual:       { nome: 'Membro Leilão Club',   limite: 10, cor: '#0D63DB', indica: true  },
};

const mesAtual = () => new Date().toISOString().slice(0, 7);

// Termo de ADESÃO ao Programa de Parceiros — respaldo jurídico p/ o fluxo de indicação.
// Só indica/recebe quem aceitar. (Sem revelar percentuais: estrutura comercial reservada.)
const TERMO_PARCEIRO_VERSAO = 'v4-2026-07';
const TERMO_PARCEIRO_PREAMBULO = 'Este Termo de Adesão rege sua participação no Programa de Parceiros da BidPro Brasil (indicação/afiliação) e complementa os Termos de Uso e a Política de Privacidade da plataforma. Ao aceitar, você concorda com as condições abaixo.';
const TERMO_PARCEIRO = [
  { t: '1. Natureza da relação', d: 'O Programa é de indicação/afiliação. Você atua de forma autônoma, por conta e risco próprios e sem exclusividade. Este Termo NÃO cria vínculo empregatício, societário, de representação comercial ou de sociedade com a BidPro Brasil.' },
  { t: '2. Elegibilidade', d: 'Para participar você deve ser maior de 18 anos, manter uma assinatura ativa (paga) e um cadastro completo e verídico (nome, CPF, telefone e chave PIX). Dados falsos impedem o pagamento e podem encerrar a participação.' },
  { t: '3. Como você é recompensado', d: 'A recompensa incide apenas sobre ASSINATURAS, PRODUTOS/MENTORIAS e VENDAS DIRETAS efetivamente pagas e não estornadas por pessoas que você indicar, direta ou indiretamente na sua rede. NÃO há recompensa sobre honorários de êxito nem sobre recarga de créditos.' },
  { t: '4. Condições e estorno', d: 'A comissão de cada cobrança só é devida se, NA DATA em que o pagamento do seu indicado (ou da rede abaixo) é realizado, a sua assinatura estiver ATIVA e EM DIA. Se em determinado mês você não estiver em dia, você não faz jus à comissão daquela cobrança (ela pode ser atribuída ao próximo parceiro elegível na rede); voltando a ficar em dia, você volta a receber nas cobranças seguintes. O vínculo do indicado com você permanece. Valores relativos a pagamentos posteriormente cancelados, estornados (chargeback) ou identificados como fraude são estornados do seu saldo e podem ser descontados de pagamentos seguintes.' },
  { t: '5. Pagamento', d: 'Os pagamentos são feitos por PIX, semanalmente (às sextas-feiras), após conferência, para a chave PIX cadastrada em seu nome/CPF. É necessário ter o cadastro completo para liberar o saque.' },
  { t: '6. Tributos', d: 'Você é o único responsável pelos tributos incidentes sobre os valores que receber, podendo ser exigida a emissão de recibo/nota fiscal conforme a legislação aplicável.' },
  { t: '7. Conduta e anti-fraude', d: 'Você se compromete a indicar de forma honesta e lícita, sendo VEDADO: spam, autoindicação, contas falsas, informações enganosas, uso indevido da marca e captação em canais não autorizados. A violação acarreta o cancelamento das comissões relacionadas e a exclusão do Programa.' },
  { t: '8. Proteção de dados (LGPD)', d: 'O tratamento segue a Lei nº 13.709/2018 (LGPD) e a Política de Privacidade da BidPro Brasil. Na tela "Indicações" você visualiza: (a) dos seus INDICADOS DIRETOS — pessoas que você mesmo trouxe (sua venda direta) — nome, cidade/UF e CONTATO (telefone e e-mail), para o relacionamento comercial legítimo com quem você indicou; (b) da REDE ABAIXO deles (indicações feitas pelos seus próprios indicados) — apenas NOME e CIDADE/UF, nunca contato. Esses dados são disponibilizados só para você conduzir e acompanhar o Programa: ao acessá-los você atua como CORRESPONSÁVEL pelo tratamento e se compromete a usá-los exclusivamente para esse fim, respeitando a LGPD, não os repassando a terceiros nem os usando para outra finalidade. Para prevenção a fraudes, registramos metadados do seu aceite e transações (data/hora, IP e dispositivo).' },
  { t: '9. Alterações do Programa', d: 'A BidPro Brasil pode alterar regras, condições e percentuais do Programa mediante aviso prévio razoável pelos canais oficiais. A continuidade da participação após o aviso implica concordância.' },
  { t: '10. Vigência e encerramento', d: 'A adesão vigora por prazo indeterminado. Qualquer das partes pode encerrar a participação a qualquer tempo; o encerramento não prejudica comissões já apuradas de boa-fé até a data.' },
  { t: '11. Legislação e foro', d: 'Aplica-se a legislação brasileira. Fica eleito o foro do domicílio do parceiro para dirimir controvérsias, sem prejuízo das normas de proteção ao consumidor, quando aplicáveis.' },
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
  const [refCodigo, setRefCodigo] = useState(''); // código curto de indicação (link enxuto)
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
  // Link de parceiro ENXUTO: usa o código curto de indicação (…?ref=ABC123) em vez do UUID cru.
  // Enquanto o código não carrega, cai no id (também aceito por vincular_upline) — link nunca quebra.
  const linkIndicacao = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/planos?ref=${refCodigo || effectiveUserId || ''}`;
  const linkDisplay = linkIndicacao.replace(/^https?:\/\/(www\.)?/, ''); // exibição sem https://www.
  const copiarLink = () => { navigator.clipboard?.writeText(linkIndicacao); setCopiado(true); setTimeout(() => setCopiado(false), 2000); };

  // Aceite do Programa de Parceiros — habilita o link de indicação e o recebimento.
  useEffect(() => {
    if (!effectiveUserId || !info.indica) return;
    supabase.from('perfis').select('parceiro_aceite_em').eq('id', effectiveUserId).single()
      .then(({ data }) => setAceite(data?.parceiro_aceite_em || null));
  }, [effectiveUserId, info.indica]);

  // Código curto de indicação — busca o existente; se não houver e o usuário já é parceiro,
  // gera sob demanda (RPC idempotente). Deixa o link do card enxuto sem quebrar nada.
  useEffect(() => {
    if (!effectiveUserId || !info.indica || !aceite) return;
    let vivo = true;
    (async () => {
      const { data } = await supabase.from('perfis').select('codigo_indicacao').eq('id', effectiveUserId).single();
      let cod = data?.codigo_indicacao;
      if (!cod) {
        try { const { data: novo } = await supabase.rpc('gerar_codigo_indicacao', { p_id: effectiveUserId }); cod = novo; } catch (_) { /* mantém fallback no id */ }
      }
      if (vivo && cod) setRefCodigo(cod);
    })();
    return () => { vivo = false; };
  }, [effectiveUserId, info.indica, aceite]);

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
        {/* Boas-vindas — gradiente da marca (azul), consistente com o header e os planos */}
        <div style={{ background: 'linear-gradient(135deg, #0D63DB 0%, #084BA6 100%)', borderRadius: 18, padding: '26px 26px', color: 'white', boxShadow: '0 8px 24px rgba(13,99,219,0.18)' }}>
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

      {/* Coluna lateral: Programa de Parceiros — só libera o link após o TERMO DE ACEITE.
          NÃO aparece para admin. A observação de "assinatura em dia" mora na tela Indicações. */}
      {info.indica && effectiveRole !== 'admin' && (
        <div style={{ background: 'white', border: '2px solid #bfdbfe', borderRadius: 18, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 88 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Gift size={18} color="#0D63DB" />
            <div style={{ fontSize: 15, fontWeight: 900, color: '#084BA6' }}>Programa de Parceiros</div>
          </div>
          <div style={{ fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.65 }}>
            {ehPagoCliente ? (
              <>Indique investidores para a BidPro e <strong>ganhe indicando</strong>: quando alguém da sua rede assina um plano, você é recompensado — enquanto sua assinatura estiver ativa.</>
            ) : (
              <>Convide investidores para a BidPro — <strong>todos podem convidar</strong>. Suas indicações já ficam vinculadas a você; para <strong>receber as comissões</strong>, é preciso ter uma <strong>assinatura ativa</strong>.</>
            )}
          </div>

          {aceite ? (
            <>
              {/* Já é parceiro → selo de pertencimento + link liberado */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 999, padding: '4px 11px', fontSize: 11, fontWeight: 800, color: '#084BA6' }}>
                <ShieldCheck size={12} /> Parceiro desde {(() => { try { return new Date(aceite).toLocaleDateString('pt-BR'); } catch { return 'hoje'; } })()}
              </div>
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 12px', fontSize: 11.5, color: '#084BA6', wordBreak: 'break-all', fontFamily: 'monospace' }}>{linkDisplay}</div>
              <button onClick={copiarLink} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                {copiado ? <><Check size={15} /> Link copiado!</> : <><Copy size={15} /> Copiar meu link</>}
              </button>
              <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5 }}>Sua recompensa é creditada automaticamente quando o indicado assina um plano. Você aceitou as regras do Programa.</div>
              <button onClick={() => nav('/minha-rede')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 11.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Abrir Indicações (nível, ganhos e saque) →</button>
            </>
          ) : (
            <>
              {/* Ainda não é parceiro → convite + aceite */}
              <div style={{ background: '#eff6ff', border: '1px dashed #93c5fd', borderRadius: 10, padding: '11px 13px', fontSize: 11.5, color: '#084BA6', lineHeight: 1.6 }}>
                Para indicar e receber, ative sua participação e <strong>aceite as regras</strong> do Programa. Leva 10 segundos.
              </div>
              <button onClick={() => { setConcordo(false); setShowTermo(true); }} disabled={aceite === undefined}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: aceite === undefined ? '#93c5fd' : '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: aceite === undefined ? 'default' : 'pointer' }}>
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
            <p style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>{TERMO_PARCEIRO_PREAMBULO}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14, maxHeight: '40vh', overflowY: 'auto', padding: '2px 2px 2px 0' }}>
              {TERMO_PARCEIRO.map((c, i) => (
                <div key={i}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: '#5b21b6', marginBottom: 2 }}>{c.t}</div>
                  <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.55 }}>{c.d}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
              Este termo complementa os <a href="#/termos" target="_blank" rel="noreferrer" style={{ color: '#7c3aed', fontWeight: 700 }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" rel="noreferrer" style={{ color: '#7c3aed', fontWeight: 700 }}>Política de Privacidade</a>. Versão {TERMO_PARCEIRO_VERSAO}.
            </div>
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer', background: '#faf5ff', border: '1px solid #ede9fe', borderRadius: 10, padding: '11px 13px', marginBottom: 14 }}>
              <input type="checkbox" checked={concordo} onChange={e => setConcordo(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: '#7c3aed', cursor: 'pointer' }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#5b21b6', lineHeight: 1.5 }}>
                Declaro que li, compreendi e concordo com este Termo de Adesão, os Termos de Uso e a Política de Privacidade, e que vou indicar de acordo com as regras.
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
