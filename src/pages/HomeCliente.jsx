import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, BarChart3, GraduationCap, Home as HomeIcon, Gift, Copy, Check, ArrowRight, TrendingUp, ShieldCheck, Gavel, Wallet, Landmark } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { lerCotas, janelaLabel } from '../utils/cotaAnalise';
import TriagemPerfil from '../components/TriagemPerfil';
import VitrineMaterial from '../components/VitrineMaterial';
import { TERMO_PARCEIRO_VERSAO, TERMO_PARCEIRO_PREAMBULO, TERMO_PARCEIRO } from '../components/ConviteParceiro';

// Rótulo da home por plano (usa o role EFETIVO — respeita o modo suporte).
// SÓ NOME E COR. O limite saiu daqui em 09/08: esta tabela dava `limite: null` ao CONSULTOR,
// e null pinta "Análises ilimitadas" na tela — o consultor tem 5. Analista e advogado idem
// (o banco dá 100, não infinito). Além disso o contador lia `analises_count` para todo mundo,
// e o explorador grava em `amostra_mercado_usadas` — o selo dele ficava eterno em "3 de 3".
// Agora o número vem de `minhas_cotas`, que é o mesmo que a escrita usa.
const PLANO_INFO = {
  admin:             { nome: 'Administrador',        cor: '#0D63DB', indica: true },
  analista:          { nome: 'Analista',             cor: '#0D63DB', indica: true },
  advogado:          { nome: 'Jurídico',             cor: '#0D63DB', indica: true },
  consultor:         { nome: 'Consultor',            cor: '#0D63DB', indica: true },
  explorador:        { nome: 'Explorador',           cor: '#0D63DB', indica: true },
  top2:              { nome: 'Investidor Pro',       cor: '#0D63DB', indica: true },
  top2_anual:        { nome: 'Investidor Pro',       cor: '#0D63DB', indica: true },
  assessorado:       { nome: 'Assessorado',          cor: '#0D63DB', indica: true },
  assessorado_anual: { nome: 'Assessorado',          cor: '#0D63DB', indica: true },
  clube:             { nome: 'Membro Leilão Club',   cor: '#0D63DB', indica: true },
  clube_anual:       { nome: 'Membro Leilão Club',   cor: '#0D63DB', indica: true },
};

// Termo de ADESÃO ao Programa de Parceiros: FONTE ÚNICA em ../components/ConviteParceiro
// (importado acima). Reutilizado aqui (card lateral) e nas telas de equipe/leiloeiro.

const STATUS_CASO = {
  analise_solicitada: 'Em análise', primeira_reuniao: 'Reunião agendada', segunda_reuniao: '2ª reunião',
  juridico_solicitado: 'No jurídico', juridico_concluido: 'Jurídico concluído', arrematado: '✅ Arrematado',
  procuracao_assinada: 'Procuração assinada', concluido: 'Concluído',
};

export default function HomeCliente() {
  const nav = useNavigate();
  const { user, effectiveRole, effectiveUserId, impersonate, roleSimulado } = useAuth();
  const info = PLANO_INFO[effectiveRole] || PLANO_INFO.explorador;
  // Modo suporte: a saudação é a do CLIENTE visualizado (a equipe navega como ele).
  const primeiroNome = (impersonate?.nome || user?.user_metadata?.nome || user?.email || 'Investidor').split(' ')[0].split('@')[0];

  const [cotaMercado, setCotaMercado] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const [meusCasos, setMeusCasos] = useState([]);
  const [aceite, setAceite] = useState(undefined); // undefined=carregando · null=não aceitou · ts=aceitou
  const [refCodigo, setRefCodigo] = useState(''); // código curto de indicação (link enxuto)
  const [showTermo, setShowTermo] = useState(false);
  const [concordo, setConcordo] = useState(false);
  const [aceitando, setAceitando] = useState(false);

  useEffect(() => {
    if (!effectiveUserId) return;
    // ATENÇÃO: a coluna é created_at ('criado_em' não existe em casos — o 42703 do
    // PostgREST zerava a lista e "Meus acompanhamentos" nunca renderizava, inclusive
    // para arremates atribuídos pela equipe).
    supabase.from('casos').select('id, imovel_endereco, status_etapa, created_at')
      .eq('cliente_id', effectiveUserId).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setMeusCasos(data || []));
  }, [effectiveUserId]);

  useEffect(() => {
    if (!effectiveUserId) { setCotaMercado(null); return; }
    let vivo = true;
    lerCotas(supabase, effectiveUserId, { roleSimulado }).then((c) => { if (vivo) setCotaMercado(c?.mercado || null); });
    return () => { vivo = false; };
  }, [effectiveUserId, roleSimulado]);

  // Sem cota carregada não mostra selo nenhum. Melhor nenhum número que um número errado.
  const temSelo = !!cotaMercado && !cotaMercado.ilimitado && Number(cotaMercado.limite || 0) > 0;
  const limiteCota = temSelo ? Number(cotaMercado.limite) : null;
  const restantes = temSelo ? Math.max(0, limiteCota - Number(cotaMercado.usado || 0)) + Number(cotaMercado.bonus || 0) : null;
  // Link GERAL do parceiro → tela de INÍCIO do site (o visitante entra, navega, vê os produtos e
  // vem a assinar). Usa o código curto de indicação (…?ref=ABC123) em vez do UUID cru; enquanto o
  // código não carrega, cai no id (também aceito por vincular_upline) — o link nunca quebra. A
  // indicação é capturada globalmente (AuthContext) e vincula ao parceiro quantas pessoas clicarem.
  const linkIndicacao = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/?ref=${refCodigo || effectiveUserId || ''}`;
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
      if (!error) { setAceite(data || new Date().toISOString()); setShowTermo(false); window.dispatchEvent(new Event('tsn:parceiro-atualizado')); nav('/minha-rede'); }
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

  // Card lateral de CONVITE — aparece só ANTES do aceite (depois, o parceiro usa o menu Indicações).
  const mostraConviteParceiro = info.indica && effectiveRole !== 'admin' && !aceite;

  return (
    <div className="home-grid" style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px', display: 'grid', gridTemplateColumns: mostraConviteParceiro ? 'minmax(0,1fr) 320px' : '1fr', gap: 20, alignItems: 'start' }}>
      {/* No celular a coluna lateral (Indique e Ganhe) empilha embaixo do conteúdo. */}
      <style>{`@media (max-width: 820px){ .home-grid{ grid-template-columns: 1fr !important; } }`}</style>
      {/* Triagem de perfil, modal one-time no 1º acesso do cliente */}
      <TriagemPerfil userId={user?.id} />
      {/* Coluna principal */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
        {/* Vitrine: material em destaque que esta pessoa ainda não abriu. Some sozinha
            quando não há destaque marcado ou quando ela já viu tudo. */}
        <VitrineMaterial />
        {/* Boas-vindas — gradiente da marca (azul), consistente com o header e os planos */}
        <div style={{ background: 'linear-gradient(135deg, #0D63DB 0%, #084BA6 100%)', borderRadius: 18, padding: '26px 26px', color: 'white', boxShadow: '0 8px 24px rgba(13,99,219,0.18)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Bem-vindo, {info.nome}</div>
          <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.15 }}>Olá, {primeiroNome}! 👋</div>
          {restantes != null && (
            <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
              <BarChart3 size={14} /> {restantes} de {limiteCota} análises disponíveis {janelaLabel(cotaMercado)}
            </div>
          )}
          {cotaMercado?.ilimitado && (
            <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
              <BarChart3 size={14} /> Análises ilimitadas
            </div>
          )}
        </div>

        {/* Ações rápidas por plano */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <Acao Icon={Search} titulo="Buscar leilões" desc="Encontre imóveis em todo o Brasil e analise oportunidades." cor="#0D63DB" onClick={() => nav('/buscar')} />
          <Acao Icon={BarChart3} titulo="Minhas Análises" desc="Retome seus relatórios e agende com o analista." cor="#0d9488" onClick={() => nav('/analises')} />
          {/* Meus Arrematados (decisão do dono 30/07): o portfólio real é a tela de
              arrematados — /painel é a tela antiga, descartada. */}
          <Acao Icon={HomeIcon} titulo="Meu Portfólio" desc="Acompanhe seus imóveis arrematados, aportes e resultados." cor="#7c3aed" onClick={() => nav('/arrematados')} />
          <Acao Icon={Wallet} titulo="Meus Créditos" desc="Consultas disponíveis, bônus e saldo, tudo num lugar." cor="#0891b2" onClick={() => nav('/creditos')} />
          <Acao Icon={GraduationCap} titulo="Área de Membros" desc="Cursos, eBooks e materiais para arrematar com segurança." cor="#059669" onClick={() => nav('/membros')} />
          {/* Home Equity e Consórcio (dono, 14/08): vitrine de originação, aberta a TODOS os
              planos, inclusive o Explorador gratuito. Não é módulo pago e não tem gate. Fica
              DEPOIS das ações de leilão de propósito, porque leilão é a base e módulo é "a
              mais", nunca por cima.
              17/08: este comentário dizia "quem remunera é a instituição parceira" — não há
              parceira nem contrato; o interesse vira lead para a nossa própria equipe. A frase
              equivalente na /alavancagem foi o que reprovou a verificação do Google Ads. */}
          <Acao Icon={Landmark} titulo="Home Equity e Consórcio" desc="Use o imóvel que você já tem para comprar o próximo. Sem compromisso." cor="#ea580c" onClick={() => nav('/alavancagem')} />
          {/* "Agendar com o time" REMOVIDO (decisão do dono 30/07): o agendamento com o
              analista é dos planos pagos e só APÓS os 3 relatórios prontos — o caminho
              certo já existe dentro do Caso/Minhas Análises, com o gate dos 3 relatórios
              no servidor (agendar-reuniao). Um atalho solto aqui furava esse funil. */}
          {effectiveRole === 'explorador' && (
            <Acao Icon={TrendingUp} titulo="Fazer upgrade" desc="Investidor Pro: 10 relatórios mercadológicos e 10 documentais e jurídicos por mês." cor="#0D63DB" onClick={() => nav('/planos')} />
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

      {/* Coluna lateral: CONVITE para ser parceiro. Some após o aceite (o parceiro passa a usar o
          menu "Indicações") e não aparece para admin — ver mostraConviteParceiro. */}
      {mostraConviteParceiro && (
        <div style={{ background: 'white', border: '2px solid #bfdbfe', borderRadius: 18, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 88 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Gift size={18} color="#0D63DB" />
            <div style={{ fontSize: 15, fontWeight: 900, color: '#084BA6' }}>Programa de Parceiros</div>
          </div>
          {/* A REGRA MUDOU EM 08/08 E ESTE TEXTO NÃO ACOMPANHOU (achado do dono, 15/08).
              Dizia "para receber as comissões, é preciso ter uma assinatura ativa" — o que
              contradiz `regra_negocio.comissao.gratis_ganha`, ativa desde 08/08 e aplicada por
              `pode_ganhar_comissao()`: o parceiro GRATUITO ganha em todos os fluxos, sem teto de
              ganho, e **a trava fica no SAQUE**. Conferido no banco:
              `pode_ganhar_comissao('explorador')` = true.

              Não era um detalhe de redação: é a frase que o explorador lê ANTES de decidir
              convidar alguém, e ela dizia a ele que não receberia. A regra existe para atraí-lo;
              o texto a desmentia.

              SEM NÚMERO AQUI, DE PROPÓSITO. O teto sem nota fiscal vive em
              `regra_negocio.saque.teto_sem_nf` e o servidor já o devolve em `/api/saque`
              (`teto_sem_nf`), que é o que a tela Minha Rede exibe. Escrever "R$ 2.500" aqui
              criaria a quinta cópia de um número do servidor no front — exatamente o defeito
              que `src/utils/cotaAnalise.js` documenta (a tabela de limites copiada em 4 telas,
              as 4 divergindo). Cópia envelhece sozinha; ponteiro não. */}
          <div style={{ fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.65 }}>
            Convide investidores para a BidPro. <strong>Todos podem convidar e todos ganham</strong> — inclusive no plano gratuito. Suas indicações ficam vinculadas a você. A <strong>assinatura</strong> só entra em cena para <strong>sacar acima do teto mensal</strong>, que aí também pede nota fiscal; o valor do teto aparece em <strong>Indicações</strong>.
          </div>
          <div style={{ background: '#eff6ff', border: '1px dashed #93c5fd', borderRadius: 10, padding: '11px 13px', fontSize: 11.5, color: '#084BA6', lineHeight: 1.6 }}>
            Ative sua participação e <strong>aceite as regras</strong> do Programa. Leva 10 segundos e libera a aba <strong>Indicações</strong> no menu.
          </div>
          <button onClick={() => { setConcordo(false); setShowTermo(true); }} disabled={aceite === undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: aceite === undefined ? '#93c5fd' : '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: aceite === undefined ? 'default' : 'pointer' }}>
            <Gift size={15} /> Quero ser parceiro
          </button>
          <div style={{ fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5 }}>Traz segurança para você e para a BidPro: você indica de acordo com as regras.</div>
        </div>
      )}

      {/* Modal — Termo de aceite do Programa de Parceiros */}
      {showTermo && (
        <div onClick={() => !aceitando && setShowTermo(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 18, padding: 24, width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Gift size={20} color="#7c3aed" />
              <div style={{ fontSize: 18, fontWeight: 900, color: '#5b21b6' }}>Programa de Parceiros: Regras</div>
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
