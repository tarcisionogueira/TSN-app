import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { trackCheckoutIniciado, trackPlanContratado } from '../utils/gtag';
import { Loader2, CheckCircle2, ExternalLink, Briefcase, ShieldCheck, TrendingUp, Headphones, ArrowUpRight, ArrowDownRight, AlertTriangle, RefreshCw, MapPin } from 'lucide-react';
import LogoB from '../components/LogoB';
import { PLANOS as PLANOS_STATIC } from '../data/cursos';
import { supabase } from '../utils/supabase';
import { fetchPlanosComConfig } from '../utils/planosConfig';
import { apiCall } from '../utils/apiCall';
import { salvarRef } from '../utils/ref';
import { versaoTermoProduto, termoDoProduto } from '../utils/termos';
import PagamentoServico from '../components/PagamentoServico';
import { ESTADOS_UF } from '../data/cidades';

const ckInp = { padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#111', background: 'white', outline: 'none', boxSizing: 'border-box' };

const PLANOS_PAGOS = ['top2', 'clube', 'assessorado'];

// Mapeia mensagens técnicas de erro do Asaas para orientações amigáveis
const MENSAGENS_RECUSA = [
  {
    detectar: ['INSUFFICIENT_FUNDS', 'saldo insuficiente', 'insufficient'],
    titulo: 'Saldo ou limite insuficiente',
    orientacao: 'Seu cartão não possui limite disponível para esta transação. Tente outro cartão, realize um pagamento via PIX, ou libere o limite com seu banco.',
    icone: '💳',
  },
  {
    detectar: ['EXPIRED_CARD', 'cartão vencido', 'expired'],
    titulo: 'Cartão vencido',
    orientacao: 'O cartão informado está expirado. Use um cartão com data de validade vigente ou escolha pagar via PIX ou boleto.',
    icone: '📅',
  },
  {
    detectar: ['INVALID_SECURITY_CODE', 'cvv', 'security code', 'código de segurança'],
    titulo: 'Código de segurança inválido',
    orientacao: 'O CVV digitado não corresponde ao cartão. Verifique os 3 dígitos no verso do cartão (ou 4 dígitos na frente, para Amex).',
    icone: '🔒',
  },
  {
    detectar: ['TRANSACTION_NOT_PERMITTED', 'não permitida', 'not permitted', 'bloqueado'],
    titulo: 'Transação não permitida pelo banco',
    orientacao: 'Seu banco bloqueou a transação. Acesse o app do seu banco, libere compras online ou entre em contato com a central de atendimento do cartão.',
    icone: '🏦',
  },
  {
    detectar: ['CREDIT_LIMIT_EXCEEDED', 'limite excedido', 'limit exceeded'],
    titulo: 'Limite do cartão excedido',
    orientacao: 'Você atingiu o limite de crédito disponível. Tente outro cartão ou escolha pagar via PIX para ativação imediata.',
    icone: '📊',
  },
  {
    detectar: ['INVALID_CARD_DATA', 'dados inválidos', 'invalid card'],
    titulo: 'Dados do cartão inválidos',
    orientacao: 'Os dados do cartão foram recusados. Confira o número, o nome impresso, a validade e o CVV. Tente novamente ou use outro meio de pagamento.',
    icone: '⚠️',
  },
];

function mapearErro(msg = '') {
  const lower = msg.toLowerCase();
  for (const m of MENSAGENS_RECUSA) {
    if (m.detectar.some(d => lower.includes(d.toLowerCase()))) return m;
  }
  return null;
}

// Passo de IDENTIFICAÇÃO por CPF no link de VENDA da assessoria (parceiro/sistema compartilha
// ?plano=assessorado&ref=CODE). Um convidado NÃO-logado digita o CPF e é orientado: reusa
// /api/verificar-cpf (rate-limit por IP + hash determinístico; NUNCA devolve nome/dados — só o
// suficiente pra guiar). Três caminhos: sem cadastro (cria conta + Pro + assessoria), explorador
// (assina o Pro junto) ou já assinante Pro (entra e contrata direto). A trava vale no servidor.
function IdentificacaoCpfAssessoria({ nav, refCode, proLabel, assParcLabel, assVistaLabel }) {
  const [cpf, setCpf] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [nivel, setNivel] = useState(null); // 'novo' | 'explorador' | 'pro'
  const refQ = refCode ? `&ref=${refCode}` : '';
  const fmtCpf = (v) => v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');

  const identificar = async () => {
    const limpo = cpf.replace(/\D/g, '');
    if (limpo.length !== 11) { setErro('Digite os 11 dígitos do CPF.'); return; }
    setErro(''); setLoading(true);
    try {
      const res = await apiCall('/api/verificar-cpf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: limpo, produto: { tipo: 'plano', planoKey: 'top2' } }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.error || 'Não foi possível verificar agora. Tente em instantes.'); return; }
      // temConta=false → novo; temAcesso (>= top2) → já é Pro; senão → explorador.
      setNivel(!d.temConta ? 'novo' : (d.temAcesso ? 'pro' : 'explorador'));
    } catch { setErro('Falha de conexão. Tente de novo.'); }
    finally { setLoading(false); }
  };

  const card = (children) => (
    <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      <div style={{ maxWidth: 460, width: '100%', textAlign: 'center', background: '#1a1a1a', border: '1px solid #334155', borderRadius: 20, padding: '36px 32px' }}>{children}</div>
    </div>
  );
  const cta = (texto, destino) => (
    <button onClick={() => nav(destino)} style={{ width: '100%', padding: '14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 12 }}>{texto}</button>
  );
  const trocarCpf = (
    <button onClick={() => { setNivel(null); setCpf(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>Usar outro CPF</button>
  );

  if (nivel === 'pro') return card(<>
    <div style={{ fontSize: 40, marginBottom: 14 }}>✅</div>
    <h2 style={{ color: 'white', fontSize: 21, fontWeight: 900, marginBottom: 12 }}>Você já é assinante Investidor Pro</h2>
    <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>Entre na sua conta para contratar a assessoria — é rápido.</p>
    {cta('Entrar e contratar a assessoria →', `/login?next=${encodeURIComponent('/checkout?plano=assessorado')}`)}
    {trocarCpf}
  </>);

  if (nivel === 'explorador' || nivel === 'novo') {
    const novo = nivel === 'novo';
    return card(<>
      <div style={{ fontSize: 40, marginBottom: 14 }}>🤝</div>
      <h2 style={{ color: 'white', fontSize: 21, fontWeight: 900, marginBottom: 12 }}>A Assessoria entra junto com o Investidor Pro</h2>
      <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 18 }}>
        {novo
          ? <>Não encontramos cadastro com esse CPF — sem problema. Você <strong style={{ color: 'white' }}>cria sua conta, assina o Investidor Pro e contrata a assessoria</strong> em seguida.</>
          : <>Encontramos seu cadastro. A assessoria é <strong style={{ color: 'white' }}>exclusiva do assinante <span style={{ color: '#60a5fa' }}>Investidor Pro</span></strong>, então a assinatura entra junto.</>}
      </p>
      <div style={{ textAlign: 'left', background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <span style={{ color: '#e2e8f0', fontSize: 13.5, fontWeight: 700 }}>1. Investidor Pro</span>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{proLabel}/mês</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ color: '#e2e8f0', fontSize: 13.5, fontWeight: 700 }}>2. Assessoria</span>
          <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'right' }}>{assVistaLabel} à vista (PIX)<br/>ou {assParcLabel} em até 12× (3× sem juros)</span>
        </div>
      </div>
      {cta(novo ? 'Criar conta e assinar o Pro →' : 'Entrar e assinar o Pro →',
           novo ? `/checkout?plano=top2&apos=assessorado${refQ}` : `/login?next=${encodeURIComponent('/checkout?plano=top2&apos=assessorado')}`)}
      {trocarCpf}
    </>);
  }

  return card(<>
    <div style={{ fontSize: 40, marginBottom: 14 }}>🤝</div>
    <h2 style={{ color: 'white', fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Contratar a Assessoria</h2>
    <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 18 }}>Acompanhamento completo, do lance à imissão de posse. Digite seu CPF para começar.</p>
    <input value={cpf} inputMode="numeric" placeholder="Seu CPF" onChange={(e) => setCpf(fmtCpf(e.target.value))}
      onKeyDown={(e) => { if (e.key === 'Enter') identificar(); }}
      style={{ width: '100%', padding: '13px 14px', border: '1px solid #334155', borderRadius: 12, fontSize: 16, color: 'white', background: '#0f172a', outline: 'none', boxSizing: 'border-box', textAlign: 'center', letterSpacing: 1, marginBottom: 12 }} />
    {erro && <p style={{ color: '#f87171', fontSize: 12.5, marginBottom: 12 }}>{erro}</p>}
    <button onClick={identificar} disabled={loading} style={{ width: '100%', padding: '14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1, marginBottom: 12 }}>
      {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Verificando…</> : 'Continuar →'}
    </button>
    <button onClick={() => nav('/planos')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>Ver todos os planos</button>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </>);
}

export default function Checkout() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user, role, refreshPerfil } = useAuth();
  const planoKey = params.get('plano');
  // Fluxo GUIADO da assessoria: quem não é Pro assina o Investidor Pro primeiro e, ao
  // ativar, volta direto para contratar isto (ex.: ?plano=top2&apos=assessorado). Assim o
  // link único de assessoria vira uma jornada só, reaproveitando os checkouts já testados.
  const aposPlano = params.get('apos') || '';
  const promoCode = params.get('promo')?.toUpperCase() || '';
  const refCode = params.get('ref') || '';
  const mpStatus = params.get('status'); // 'approved' | 'rejected' | 'pending', vindo do redirect MP
  const [PLANOS, setPLANOS] = useState(PLANOS_STATIC);
  // À prova de falha: nunca indexa um PLANOS indefinido e sempre cai no estático.
  const plano = (PLANOS && PLANOS[planoKey]) || PLANOS_STATIC[planoKey] || null;

  useEffect(() => {
    // Só troca o catálogo se veio um objeto válido — senão mantém o estático
    // (evita quebrar o checkout se a config do banco falhar/vier vazia).
    fetchPlanosComConfig()
      .then(p => { if (p && typeof p === 'object') setPLANOS(p); })
      .catch(() => {});
  }, []);

  // Persiste o código de referência do consultor
  useEffect(() => {
    if (refCode) salvarRef(refCode); // persiste com janela de 30 dias
  }, [refCode]);

  const [loading, setLoading] = useState(false);
  const [promoInfo, setPromoInfo] = useState(null);
  const [linkPagamento, setLinkPagamento] = useState(null);
  const [resultadoMudanca, setResultadoMudanca] = useState(null);
  const [erro, setErro] = useState('');
  const [pago, setPago] = useState(false); // tela de aprovado
  const [pagoPendente, setPagoPendente] = useState(false); // assinatura em análise (3DS/antifraude)
  const [modalidade, setModalidade] = useState('mensal'); // 'mensal' | 'vista'
  const [aceitouTermos, setAceitouTermos] = useState(false);
  const [asaasIds, setAsaasIds] = useState(null); // { subscriptionId, paymentId }
  const [verificando, setVerificando] = useState(false);
  const [gatewayUsado, setGatewayUsado] = useState(null); // 'mp' | 'asaas'
  const [ofertandoFallback, setOfertandoFallback] = useState(false); // cliente recusado no MP, oferece Asaas
  const [showPagamento, setShowPagamento] = useState(false); // PagamentoServico inline (assessorado)
  const [showPixAnual, setShowPixAnual] = useState(false); // Investidor Pro anuidade à vista no PIX
  const [pixAnualFase, setPixAnualFase] = useState('pagando'); // pagando | ativando | erro
  const pixAnualPidRef = React.useRef(null); // paymentId do PIX-anuidade, p/ retry da ativação
  // Cadastro inline do visitante não-logado (cria a conta no próprio checkout)
  const [su, setSu] = useState({ nome: '', email: '', senha: '', aceite: false });
  const [card, setCard] = useState({ numero: '', nome: '', validade: '', cvv: '' });
  const [etapa, setEtapa] = useState('ident'); // 'ident' (dados) | 'pgto' (cartão), só top2 não-logado
  const [suErro, setSuErro] = useState('');
  const [suLoading, setSuLoading] = useState(false);
  const [contaCriada, setContaCriada] = useState(false);
  const pollingRef = React.useRef(null);
  const jaConfirmouRef = React.useRef(false);
  const assinandoRef = React.useRef(false); // trava anti-duplo-clique na assinatura
  const cancelouAnterioresRef = React.useRef(false); // idempotência do cancelamento de assinaturas anteriores
  const iniciandoRef = React.useRef(false); // trava anti-duplo-clique no botão "Ir para pagamento"

  // Limpa o formulário inline ao trocar de plano (evita dados do plano anterior).
  useEffect(() => {
    setSu({ nome: '', email: '', senha: '', aceite: false });
    setCard({ numero: '', nome: '', validade: '', cvv: '' });
    setEtapa('ident'); setSuErro('');
  }, [planoKey]);

  // Endereço do assinante — obrigatório antes de pagar um produto pago (usado em
  // contratos de assessoria / leilão clube e na pré-filtragem da Busca).
  const [end, setEnd] = useState({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  const [cpf, setCpf] = useState('');
  const [nomeFat, setNomeFat] = useState('');
  const [endLoaded, setEndLoaded] = useState(false);
  const [cepLoadingCk, setCepLoadingCk] = useState(false);
  const [cicloAtual, setCicloAtual] = useState(null); // ciclo vigente do plano (mensal/anual)
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('perfis')
      .select('nome,plano_ciclo,plano_vencimento,endereco_cep,endereco_logradouro,endereco_numero,endereco_complemento,endereco_bairro,endereco_cidade,endereco_uf')
      .eq('id', user.id).single()
      .then(({ data }) => {
        if (data) {
          setEnd({
            cep: data.endereco_cep || '', logradouro: data.endereco_logradouro || '', numero: data.endereco_numero || '',
            complemento: data.endereco_complemento || '', bairro: data.endereco_bairro || '', cidade: data.endereco_cidade || '', uf: data.endereco_uf || '',
          });
          setNomeFat(data.nome || '');
          setCicloAtual(data.plano_ciclo || null);
        }
        setEndLoaded(true);
      }, () => setEndLoaded(true)); // erro no perfil não pode travar o checkout
    // CPF do próprio titular, decifrado no backend, para pré-preencher (o texto
    // claro não fica mais no perfil/metadata; o valor vem via endpoint seguro).
    apiCall('/api/cpf-revelar', { method: 'POST', body: JSON.stringify({ ids: [user.id], full: true }) })
      .then(r => r.json()).then(d => { const c = d?.cpfs?.[user.id]; if (c) setCpf(c); }).catch(() => {});
  }, [user?.id]);

  // Assessoria é 1 arrematação POR CONTRATO (regra do dono): quem já tem uma em
  // andamento só contrata a próxima depois de SINALIZAR o arremate. O servidor
  // decide (/api/assessoria-status); erro de rede não trava o checkout (fail-open —
  // o pagamento continua sendo uma ação manual e o contrato registra a operação).
  const [assessoriaStatus, setAssessoriaStatus] = useState(null);
  useEffect(() => {
    if (planoKey !== 'assessorado' || !user?.id) { setAssessoriaStatus(null); return; }
    let vivo = true;
    apiCall('/api/assessoria-status')
      // O fail-open acima só valia para erro de REDE: um 5xx resolve a promise normalmente e o
      // corpo de erro ({error: '...'}) virava um status sem `podeContratar` → falsy → a tela de
      // bloqueio aparecia numa contratação de R$ 4.800-6.000 por causa de um soluço do servidor.
      // Agora só um veredito EXPLÍCITO do servidor bloqueia; qualquer outra coisa libera.
      .then(async (r) => (r.ok ? await r.json().catch(() => null) : null))
      .then(d => {
        if (!vivo) return;
        setAssessoriaStatus(typeof d?.podeContratar === 'boolean' ? d : { podeContratar: true, motivo: 'indisponivel' });
      })
      .catch(() => { if (vivo) setAssessoriaStatus({ podeContratar: true, motivo: 'ok' }); });
    return () => { vivo = false; };
    // `role` na dep: ao voltar do Pro recém-assinado (fluxo guiado), o gate re-consulta
    // com o papel novo (top2) e libera a assessoria sem precisar recarregar a página.
  }, [planoKey, user?.id, role]);

  const temModalidade = planoKey === 'assessorado' || planoKey === 'clube';
  const temToggleAnual = planoKey === 'top2'; // top1 removido do produto
  const planoApiKey = temModalidade && modalidade === 'vista'
    ? `${planoKey}_vista`
    : temToggleAnual && modalidade === 'anual' ? `${planoKey}_anual` : planoKey;

  useEffect(() => {
    if (planoKey && PLANOS_STATIC[planoKey]) {
      trackCheckoutIniciado(planoKey, PLANOS_STATIC[planoKey]?.valor || 0);
    }
  }, [planoKey]);

  useEffect(() => {
    if (!promoCode) return;
    import('../utils/supabase').then(({ supabase }) => {
      supabase.from('links_promo').select('*').eq('codigo', promoCode).eq('ativo', true).single()
        .then(({ data }) => { if (data) setPromoInfo(data); });
    });
  }, [promoCode]);

  React.useEffect(() => {
    if (!plano && planoKey !== 'explorador') nav('/');
  }, [planoKey]);

  // Ativa plano quando MP redireciona de volta com status=approved.
  //
  // O QUERY PARAM NÃO É PROVA DE PAGAMENTO (corrigido em 07/08 — achado da varredura de
  // 05/08). Antes, `?plano=clube&status=approved` bastava: qualquer usuário logado que
  // abrisse essa URL (link compartilhado, histórico do navegador, curiosidade) via a tela
  // "Pagamento aprovado!", tinha um ACEITE de contrato gravado sem transação nenhuma e ainda
  // era mandado para o fluxo de contrato. Quem ativa o plano é o webhook, no servidor; então
  // agora conferimos NO SERVIDOR que o plano ficou ativo antes de comemorar. O webhook às
  // vezes chega alguns segundos depois do redirect, daí as tentativas espaçadas; se mesmo
  // assim não confirmar, cai na tela honesta de "Pagamento em análise" (pagoPendente), que já
  // existe e não grava aceite nem gera contrato.
  useEffect(() => {
    if (mpStatus !== 'approved' || jaConfirmouRef.current) return;
    jaConfirmouRef.current = true;
    let vivo = true;
    (async () => {
      const HIER = ['explorador', 'top2', 'assessorado', 'clube'];
      const alvo = HIER.indexOf(String(planoKey || '').replace(/_(anual|vista|mensal)$/i, ''));
      for (let i = 0; i < 6 && vivo; i++) { // ~30s de tolerância para o webhook
        let p = null;
        try { p = await refreshPerfil?.(); } catch { /* tenta de novo */ }
        const atual = HIER.indexOf(String(p?.role || '').replace(/_anual$/, ''));
        if (alvo < 0 || (atual >= 0 && atual >= alvo)) { if (vivo) confirmarPagamento(); return; }
        await new Promise(r => setTimeout(r, 5000));
      }
      if (vivo) setPagoPendente(true);
    })();
    return () => { vivo = false; };
  }, [mpStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling automático — verifica a cada 8s se o Asaas confirmou o pagamento.
  // Trava de segurança: para após ~10 min (75 tentativas) e avisa o cliente,
  // em vez de ficar "aguardando" para sempre se o webhook falhar.
  useEffect(() => {
    if (!asaasIds || pago) return;
    setVerificando(true);
    let tentativas = 0;
    const MAX_TENTATIVAS = 75; // 75 × 8s ≈ 10 min
    const verificar = async () => {
      tentativas += 1;
      try {
        const res = await apiCall('/api/verificar-pagamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(asaasIds),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.confirmado && !jaConfirmouRef.current) {
            jaConfirmouRef.current = true;
            clearInterval(pollingRef.current);
            setVerificando(false);
            confirmarPagamento();
            return;
          }
        }
      } catch (_) {}
      if (tentativas >= MAX_TENTATIVAS && !jaConfirmouRef.current) {
        clearInterval(pollingRef.current);
        setVerificando(false);
        setErro('Ainda não recebemos a confirmação do pagamento. Se você já pagou, o acesso é liberado automaticamente assim que o banco confirmar (pode levar alguns minutos). Você pode fechar esta tela com segurança, ou tentar novamente.');
      }
    };
    verificar(); // primeira verificação imediata
    pollingRef.current = setInterval(verificar, 8000);
    return () => clearInterval(pollingRef.current);
  }, [asaasIds, pago]);

  // Purchase — evento de CONVERSÃO (Meta Pixel + Google Ads). Dispara UMA única vez
  // quando o pagamento é APROVADO. Todos os fluxos de sucesso convergem em setPago(true):
  // confirmarPagamento (redirect MP · polling Asaas · PagamentoServico inline) e
  // assinarComCadastro (visitante). pagoPendente (análise antifraude) NÃO conta — a
  // conversão só é contabilizada quando a assinatura é efetivamente aprovada. Sem isto,
  // Meta/Google mediam clique e início de checkout, mas NÃO a venda (métrica que otimiza
  // campanha e mede ROI). O valor real é reforçado depois server-side no webhook (CAPI).
  const compradoRef = useRef(false);
  useEffect(() => {
    if (!pago || compradoRef.current) return;
    compradoRef.current = true;
    try {
      // event_id determinístico p/ DEDUP com o servidor (Meta CAPI). MESMO formato do
      // backend (api/_meta-capi.js → purchaseEventId): pur_<userId>_<planoBase>_<YYYYMMDD UTC>.
      // A base (top2/clube/assessorado) sem sufixo casa com o mapeamento do webhook.
      const base = String(planoApiKey || planoKey || '').replace(/_(anual|vista|mensal)$/i, '');
      const dia = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const eventID = user?.id ? `pur_${user.id}_${base}_${dia}` : undefined;
      // Enhanced Conversions (Google): dados primários do titular p/ casar a conversão.
      const userData = { email: user?.email, nome: nomeFat || user?.user_metadata?.nome, cidade: end.cidade, uf: end.uf, cep: end.cep };
      trackPlanContratado(planoApiKey || planoKey, Number(plano?.preco) || 0, eventID, userData);
    } catch { /* nunca bloqueia o fluxo */ }
  }, [pago]);

  if (!plano && planoKey !== 'explorador') return null;

  // Explorador (grátis): mesma lógica do fluxo pago, sem a etapa de pagamento —
  // cria a conta já confirmada e libera o acesso direto.
  const criarContaGratis = async () => {
    setSuErro('');
    const nome = su.nome.trim(), email = su.email.trim().toLowerCase(), senha = su.senha;
    if (!nome || !email || !senha) { setSuErro('Preencha nome, e-mail e senha.'); return; }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(senha)) { setSuErro('A senha não atende aos requisitos listados.'); return; }
    if (!su.aceite) { setSuErro('Aceite os Termos de Uso para continuar.'); return; }
    setSuLoading(true);
    try {
      const res = await apiCall('/api/criar-conta-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, senha, ...(refCode ? { ref_codigo: refCode } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível criar a conta.');
      try { await supabase.auth.signInWithPassword({ email, password: senha }); } catch { /* loga manual se falhar */ }
      nav('/membros');
    } catch (e) { setSuErro(e.message || 'Erro ao criar a conta.'); }
    setSuLoading(false);
  };

  // Assessoria (por arrematação) só pode ser contratada por assinante Investidor
  // Pro ou acima. Explorador/deslogado veem um upsell para assinar o Pro antes.
  const ROLES_PRO_OU_ACIMA = ['top2', 'assessorado', 'clube', 'admin', 'analista', 'advogado', 'suporte'];
  if (planoKey === 'assessorado' && !ROLES_PRO_OU_ACIMA.includes(role)) {
    // Regra ABSOLUTA (dono): assessoria só para Investidor Pro. Em vez de barrar num beco,
    // a tela é TRANSPARENTE sobre a regra e as DUAS cobranças, e conduz: assina o Pro e volta
    // direto para a assessoria (?apos=assessorado). Reaproveita os checkouts já testados.
    const proLabel = PLANOS?.top2?.precoLabel || 'R$ 49,90';
    const assParcLabel = plano?.precoLabel || 'R$ 6.000,00';
    const assVistaLabel = plano?.precoVistaLabel || 'R$ 4.800,00';
    // Convidado NÃO-logado no link de venda: identifica por CPF primeiro (parceiro/sistema
    // compartilha). Logado já é identificado pelo papel → segue direto na tela de bundle.
    if (!user) return <IdentificacaoCpfAssessoria nav={nav} refCode={refCode} proLabel={proLabel} assParcLabel={assParcLabel} assVistaLabel={assVistaLabel} />;
    return (
      <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ maxWidth: 480, textAlign: 'center', background: '#1a1a1a', border: '1px solid #334155', borderRadius: 20, padding: '36px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🤝</div>
          <h2 style={{ color: 'white', fontSize: 22, fontWeight: 900, marginBottom: 12 }}>A Assessoria entra junto com o Investidor Pro</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 18 }}>
            A Assessoria (do lance à imissão de posse) é <strong style={{ color: 'white' }}>exclusiva do assinante <span style={{ color: '#60a5fa' }}>Investidor Pro</span></strong>. Você assina o Investidor Pro e contrata a assessoria na sequência — são duas contratações:
          </p>
          <div style={{ textAlign: 'left', background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <span style={{ color: '#e2e8f0', fontSize: 13.5, fontWeight: 700 }}>1. Investidor Pro</span>
              <span style={{ color: '#94a3b8', fontSize: 13 }}>{proLabel}/mês</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ color: '#e2e8f0', fontSize: 13.5, fontWeight: 700 }}>2. Assessoria</span>
              <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'right' }}>{assVistaLabel} à vista (PIX)<br/>ou {assParcLabel} em até 12× (3× sem juros)</span>
            </div>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, lineHeight: 1.6, marginBottom: 20 }}>
            Assim que o Investidor Pro for ativado, você segue <strong style={{ color: '#94a3b8' }}>direto</strong> para a contratação da assessoria.
          </p>
          <button onClick={() => nav('/checkout?plano=top2&apos=assessorado')} style={{ width: '100%', padding: '14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 12 }}>
            Assinar o Investidor Pro e seguir →
          </button>
          <button onClick={() => nav('/planos')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
            Ver todos os planos
          </button>
        </div>
      </div>
    );
  }

  // Assessoria em ANDAMENTO (contratada e ainda sem arremate sinalizado): a próxima
  // só libera quando o cliente sinalizar a arrematação ("Arrematei") — regra de 1
  // operação por contrato. Leilão Club nem passa por aqui (assessoria já inclusa).
  if (planoKey === 'assessorado' && assessoriaStatus && !assessoriaStatus.podeContratar) {
    const ehClube = assessoriaStatus.motivo === 'clube_incluido';
    return (
      <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ maxWidth: 480, textAlign: 'center', background: '#1a1a1a', border: '1px solid #334155', borderRadius: 20, padding: '40px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>{ehClube ? '♾️' : '🏗️'}</div>
          <h2 style={{ color: 'white', fontSize: 22, fontWeight: 900, marginBottom: 12 }}>
            {ehClube ? 'Assessoria já inclusa no seu plano' : 'Você já tem uma assessoria em andamento'}
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
            {ehClube
              ? <>Como membro do <strong style={{ color: '#c084fc' }}>Leilão Club</strong>, você tem assessoria completa para TODAS as suas arrematações — não precisa contratar avulsa. Fale com o time para iniciar o acompanhamento de um novo imóvel.</>
              : <>A assessoria é individual: <strong style={{ color: 'white' }}>uma arrematação por contrato</strong>. Assim que você arrematar o imóvel da assessoria atual e sinalizar com o botão <strong style={{ color: '#34d399' }}>"Arrematei"</strong> (em Minhas Análises), a contratação da próxima é liberada — mesmo antes de vender ou tomar posse.</>}
          </p>
          <button onClick={() => nav(ehClube ? '/painel' : '/analises')} style={{ width: '100%', padding: '14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 12 }}>
            {ehClube ? 'Falar com o time' : 'Ir para Minhas Análises'}
          </button>
          <button onClick={() => nav('/planos')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
            Ver todos os planos
          </button>
        </div>
      </div>
    );
  }

  // Página de apresentação do plano Explorador (gratuito)
  if (planoKey === 'explorador') {
    const planoExp = PLANOS['explorador'];
    return (
      <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) minmax(280px, 420px)', gap: 24, maxWidth: 840, width: '100%', alignItems: 'stretch' }} className="checkout-grid">
          {/* Coluna esquerda, apresentação */}
          <div style={{ color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
              <div style={{ background: '#0D63DB', borderRadius: 12, padding: 10, fontSize: 20 }}>🏢</div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 1 }}>BIDPRO BRASIL</div>
                <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#10b981', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Plano Explorador, Gratuito</div>
            <h1 style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.2, margin: '0 0 16px' }}>Comece a explorar leilões imobiliários sem pagar nada.</h1>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.8, marginBottom: 28 }}>
              Crie sua conta gratuitamente e tenha acesso à plataforma BidPro Brasil, sem cartão de crédito, sem compromisso.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                'Acesso à plataforma BidPro Brasil',
                'Calculadora de lances gratuita',
                'Visualização de leilões disponíveis',
                'Perfil de investidor ativo',
                'Suporte via chat da plataforma',
              ].map(r => (
                <div key={r} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#10b98122', border: '1px solid #10b98144', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ color: '#10b981', fontSize: 12 }}>✓</span>
                  </div>
                  <span style={{ fontSize: 13, color: '#cbd5e1' }}>{r}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Coluna direita, cadastro grátis inline (mesma lógica, sem pagamento) */}
          <div style={{ background: 'white', borderRadius: 20, padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#111111', marginBottom: 2 }}>Grátis</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>Sem cartão de crédito · Acesso imediato</div>
            {user ? (
              <>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 16, fontSize: 13, color: '#166534', fontWeight: 600 }}>Você já tem uma conta ativa.</div>
                <button onClick={() => nav('/membros')} style={{ width: '100%', padding: '15px', background: '#10b981', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>Ir para a plataforma →</button>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
                  <input value={su.nome} placeholder="Nome completo" autoComplete="name" onChange={e => setSu(p => ({ ...p, nome: e.target.value }))} style={{ ...ckInp, width: '100%' }} />
                  <input value={su.email} type="email" placeholder="E-mail" autoComplete="email" onChange={e => setSu(p => ({ ...p, email: e.target.value }))} style={{ ...ckInp, width: '100%' }} />
                  <input value={su.senha} type="password" placeholder="Crie uma senha" autoComplete="new-password" onChange={e => setSu(p => ({ ...p, senha: e.target.value }))} style={{ ...ckInp, width: '100%' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, margin: '0 2px 10px' }}>
                  {[
                    { ok: su.senha.length >= 8, txt: 'Mínimo 8 caracteres' },
                    { ok: /[A-Z]/.test(su.senha), txt: 'Uma letra maiúscula' },
                    { ok: /[a-z]/.test(su.senha), txt: 'Uma letra minúscula' },
                    { ok: /\d/.test(su.senha), txt: 'Um número' },
                    { ok: /[^A-Za-z0-9]/.test(su.senha), txt: 'Um caractere especial' },
                  ].map(rr => (
                    <div key={rr.txt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: rr.ok ? '#059669' : '#94a3b8', fontWeight: rr.ok ? 600 : 400 }}>
                      <span style={{ fontSize: 12, width: 12, display: 'inline-block' }}>{rr.ok ? '✓' : '○'}</span> {rr.txt}
                    </div>
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#475569', cursor: 'pointer', marginBottom: 10 }}>
                  <input type="checkbox" checked={su.aceite} onChange={e => setSu(p => ({ ...p, aceite: e.target.checked }))} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>Li e aceito os <a href="#/termos" target="_blank" style={{ color: '#0D63DB' }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" style={{ color: '#0D63DB' }}>Política de Privacidade</a>.</span>
                </label>
                {suErro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 10 }}>{suErro}</div>}
                <button onClick={criarContaGratis} disabled={suLoading} style={{ width: '100%', padding: '15px', background: suLoading ? '#94a3b8' : '#10b981', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: suLoading ? 'not-allowed' : 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {suLoading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Criando conta…</> : 'Criar conta grátis →'}
                </button>
                <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: 0 }}>
                  Já tem conta? <button onClick={() => nav('/login')} style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>Entrar</button>
                </p>
              </>
            )}
          </div>
        </div>
        <style>{`@media (max-width: 760px) { .checkout-grid { grid-template-columns: 1fr !important; } }`}</style>
      </div>
    );
  }

  const nomeUsuario = nomeFat || user?.user_metadata?.nome || user?.email?.split('@')[0] || '';
  const cpfDigits = (cpf || '').replace(/\D/g, '');
  const cpfUsuario = cpfDigits || user?.user_metadata?.cpf || '';

  // Dados de faturamento/emissão fiscal completos? (CPF + nome + endereço).
  // Só quando falta algo é que a coleta aparece antes do pagamento.
  const enderecoOk = !!(end.cep && end.logradouro && end.numero && end.bairro && end.cidade && end.uf);
  const cpfOk = cpfDigits.length === 11;
  const perfilFaturamentoOk = cpfOk && !!nomeUsuario && enderecoOk;
  const buscarCepCk = async (cepRaw) => {
    const cep = (cepRaw || '').replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoadingCk(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json();
      if (!j.erro) setEnd(p => ({ ...p, cep, logradouro: j.logradouro || p.logradouro, bairro: j.bairro || p.bairro, cidade: j.localidade || p.cidade, uf: j.uf || p.uf }));
    } catch { /* CEP offline, usuário preenche manualmente */ }
    setCepLoadingCk(false);
  };
  const salvarDadosFaturamento = async () => {
    const enderecoFmt = [
      [end.logradouro, end.numero].filter(Boolean).join(', '),
      end.complemento, end.bairro,
      [end.cidade, end.uf].filter(Boolean).join(' - '),
      end.cep ? `CEP ${end.cep}` : '',
    ].filter(Boolean).join(' · ');
    await supabase.from('perfis').update({
      endereco: enderecoFmt || null, endereco_cep: end.cep || null, endereco_logradouro: end.logradouro || null,
      endereco_numero: end.numero || null, endereco_complemento: end.complemento || null, endereco_bairro: end.bairro || null,
      endereco_cidade: end.cidade || null, endereco_uf: end.uf || null,
    }).eq('id', user.id);
    // CPF pelo backend (grava só hash + cifra; a chave só existe lá). Não
    // gravamos mais o CPF em texto claro no metadata do Auth.
    if (cpfOk) { try { await apiCall('/api/cpf-set', { method: 'POST', body: JSON.stringify({ cpf: cpfDigits }) }); } catch { /* best-effort */ } }
  };
  // Salva os dados de faturamento e então dispara o fluxo de pagamento original.
  // Visitante não-logado: cria a conta no checkout (cadastro normal, com
  // confirmação de e-mail). O plano fica guardado para, após o login, voltar ao
  // checkout e concluir o pagamento (Explorador não tem pagamento). O pagamento
  // exige login por segurança (a assinatura é sempre da conta autenticada).
  const criarContaInline = async () => {
    setSuErro('');
    const nome = su.nome.trim(), email = su.email.trim().toLowerCase(), senha = su.senha;
    if (!nome || !email || !senha) { setSuErro('Preencha nome, e-mail e senha.'); return; }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(senha)) {
      setSuErro('A senha deve ter ao menos 8 caracteres, com maiúscula, minúscula, número e caractere especial.'); return;
    }
    if (!su.aceite) { setSuErro('Aceite os Termos de Uso para continuar.'); return; }
    setSuLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password: senha,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: { nome, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString(), ...(promoCode ? { ref_codigo: promoCode } : {}) },
        },
      });
      if (error) throw error;
      // E-MAIL É ÚNICO POR CADASTRO (regra do dono, 05/08). Com "Confirm email" ligado, o
      // Supabase NÃO devolve erro para e-mail já cadastrado — é a proteção anti-enumeração:
      // responde 200 com um usuário "fantasma" e `identities: []`, e NÃO manda e-mail nenhum.
      // O código só checava `error` → a tela dizia "Cadastro criado!" e o cliente ficava
      // esperando uma confirmação que nunca chegaria (venda perdida em silêncio).
      // `identities` vazio é o sinal documentado para esse caso.
      if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
        setSuErro('Este e-mail já tem conta. Clique em "Já tenho conta, Entrar" para continuar a assinatura.');
        setSuLoading(false);
        return;
      }
      // Guarda o plano p/ o Login redirecionar de volta ao checkout após o login
      // (Explorador não tem pagamento → não guarda, cai direto na plataforma).
      if (planoKey !== 'explorador') { try { sessionStorage.setItem('tsn_plano_pendente', planoApiKey); } catch { /* ok */ } }
      setContaCriada(true);
    } catch (e) {
      const m = String(e?.message || '');
      setSuErro(/already|registered|exists/i.test(m)
        ? 'Este e-mail já tem conta. Clique em "Já tenho conta, Entrar".'
        : (m || 'Erro ao criar a conta.'));
    }
    setSuLoading(false);
  };

  const fmtCardNum = v => v.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
  const fmtCardVal = v => v.replace(/\D/g, '').replace(/^(\d{2})/, '$1/').slice(0, 5);

  // Etapa 1 → 2: valida os dados de identificação (incl. CPF/endereço p/ fiscal)
  // antes de mostrar o cartão. Mesma validação que o servidor refaz.
  const irParaPagamento = () => {
    setSuErro('');
    const nome = su.nome.trim(), email = su.email.trim(), senha = su.senha;
    if (!nome || !email || !senha) { setSuErro('Preencha nome, e-mail e senha.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setSuErro('E-mail inválido.'); return; }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(senha)) { setSuErro('A senha não atende aos requisitos listados.'); return; }
    if (!su.aceite) { setSuErro('Aceite os Termos de Uso para continuar.'); return; }
    setEtapa('pgto');
  };

  // Visitante assina o Investidor Pro (pay-first): cria a conta + paga de forma
  // ATÔMICA no servidor. Se o pagamento não autoriza, nada é gravado (a conta é
  // apagada) e o cliente refaz. Autorizado → acesso direto. CPF/endereço vão junto
  // e ficam salvos no perfil para os próximos pagamentos e a emissão fiscal.
  const assinarComCadastro = async () => {
    setSuErro('');
    const nome = su.nome.trim(), email = su.email.trim().toLowerCase(), senha = su.senha;
    if (!nome || !email || !senha || !su.aceite) { setSuErro('Complete seus dados no passo 1.'); setEtapa('ident'); return; }
    if (!cpfOk) { setSuErro('Informe um CPF válido (11 dígitos).'); return; }
    if (!enderecoOk) { setSuErro('Preencha o endereço completo para a nota fiscal.'); return; }
    if (!card.numero || !card.nome || !card.validade || !card.cvv) { setSuErro('Preencha todos os dados do cartão.'); return; }
    if (!/^\d{2}\/\d{2}$/.test(card.validade)) { setSuErro('Validade no formato MM/AA.'); return; }
    const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY;
    if (!MP_PUBLIC_KEY) { setSuErro('Pagamento indisponível no momento. Tente mais tarde.'); return; }
    if (assinandoRef.current) return; // evita duplo-clique/duplo-envio
    assinandoRef.current = true;
    setSuLoading(true);
    try {
      if (!window.MercadoPago) {
        await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://sdk.mercadopago.com/js/v2'; s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
      }
      const mp = new window.MercadoPago(MP_PUBLIC_KEY);
      const [mes, ano] = card.validade.split('/');
      const token = await mp.createCardToken({ cardNumber: card.numero.replace(/\s/g, ''), cardholderName: card.nome, cardExpirationMonth: mes, cardExpirationYear: `20${ano}`, securityCode: card.cvv });
      if (!token?.id) throw new Error('Não foi possível validar o cartão. Confira os dados.');
      const res = await apiCall('/api/assinar-com-cadastro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, email, senha, cpf: cpfDigits, endereco: end, cardTokenId: token.id, plano: 'top2' }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) { setSuErro('Este e-mail já tem conta. Clique em "Já tenho conta — Entrar".'); setEtapa('ident'); return; }
        throw new Error(data.error || 'Não foi possível concluir a assinatura.');
      }
      // Conta criada + já confirmada → loga. 'pending' = análise antifraude: o
      // plano é liberado pelo webhook ao aprovar (ele entra como Explorador por ora).
      try { await supabase.auth.signInWithPassword({ email, password: senha }); } catch { /* loga manual se falhar */ }
      if (data.status === 'pending') {
        setPagoPendente(true);
        setTimeout(() => nav('/membros'), 3500);
      } else {
        setPago(true);
        // Pro ativo agora → se veio do fluxo guiado da assessoria, segue direto p/ ela.
        setTimeout(() => nav(aposPlano ? `/checkout?plano=${aposPlano}` : '/membros'), 3000);
      }
    } catch (e) {
      setSuErro(e.message || 'Erro ao processar a assinatura.');
    } finally {
      assinandoRef.current = false;
      setSuLoading(false);
    }
  };

  const iniciarPagamento = async () => {
    if (!perfilFaturamentoOk) return;
    // Trava anti-duplo-clique SÍNCRONA (ref): o handler faz awaits (salvar faturamento) ANTES
    // de qualquer setLoading, então dois cliques rápidos passariam ambos e gerariam duas
    // preferências/assinaturas no gateway. O ref bloqueia na hora (state async não bloquearia).
    if (iniciandoRef.current) return;
    iniciandoRef.current = true;
    try {
      try { await salvarDadosFaturamento(); } catch { /* não bloqueia o pagamento por falha ao gravar */ }
      // TROCA DE CICLO (mensal↔anual) antes de tudo:
      //  - para ANUAL (regra a): cancela a recorrência mensal + cria a anual recorrente, cobra
      //    agora (via gerarLink, que já cancela as anteriores antes de criar).
      //  - para MENSAL (regra b): NÃO cobra agora — agenda a virada para o fim do anual vigente.
      if (ehTrocaCiclo && cicloAlvo === 'anual') return await gerarLink();
      if (ehTrocaCiclo && cicloAlvo === 'mensal') return await agendarCiclo();
      if (ehMudanca) return await mudarPlano();
      if (planoKey === 'assessorado') return setShowPagamento(true);
      // Investidor Pro mensal (recorrente): checkout transparente inline (cartão coletado no
      // BidPro). O anual (recorrente 12m) segue pelo fluxo de link (redirect autoriza o mandato).
      if (planoKey === 'top2' && modalidade !== 'anual') return setShowPagamento(true);
      return await gerarLink();
    } finally {
      iniciandoRef.current = false;
    }
  };

  // Mudança de plano: já assina um plano pago e escolheu outro plano recorrente
  const planoAtual = PLANOS[role];
  const ehMudanca = PLANOS_PAGOS.includes(role) && role !== planoKey && planoKey !== 'assessorado' && role !== 'assessorado';
  const ehUpgrade = ehMudanca && plano.preco > (planoAtual?.preco || 0);
  // Troca de CICLO do Investidor Pro (mensal↔anual): ehMudanca compara a base (top2×top2),
  // então dá false de propósito — este é o sinal separado. Só quando o cliente JÁ é top2 e
  // o ciclo escolhido difere do vigente.
  const cicloAlvo = (temToggleAnual && modalidade === 'anual') ? 'anual' : 'mensal';
  const ehTrocaCiclo = role === 'top2' && planoKey === 'top2' && (cicloAtual || 'mensal') !== cicloAlvo;

  // Log de aceite para proteção contra chargeback
  const logAceite = async (planoKey, valor, asaasData, gateway = null) => {
    if (!user) return;
    try {
      // Server-side: grava o aceite com o IP de origem (prova para chargeback)
      await apiCall('/api/registrar-aceite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plano_key: planoKey,
          valor,
          asaas_payment_id: asaasData?.subscriptionId || asaasData?.customerId || null,
          asaas_subscription_id: asaasData?.subscriptionId || null,
          user_agent: navigator.userAgent,
          // Versão POR PRODUTO (ex.: 'top2-v2.0'): prova qual termo, de qual produto,
          // em qual versão foi aceito — cada produto tem o seu (registro em utils/termos.js).
          termos_versao: versaoTermoProduto(planoKey),
          gateway,
        }),
      });
    } catch (_) {}
  };

  // Evita DUPLICIDADE de assinatura: antes de criar uma nova recorrência,
  // cancela qualquer assinatura ativa do cliente nos dois gateways (idempotente).
  // Só roda uma vez por sessão de checkout. (cancelouAnterioresRef é declarado no
  // topo do componente para respeitar as rules-of-hooks.)
  const cancelarAssinaturasAnteriores = async () => {
    if (cancelouAnterioresRef.current || !user?.email) return;
    cancelouAnterioresRef.current = true;
    await Promise.allSettled([
      apiCall('/api/mp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancelar_assinatura', email: user.email }) }),
      apiCall('/api/asaas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancelar_assinatura', email: user.email }) }),
    ]);
  };

  // Tenta pagar via Asaas (backup) com dados já preenchidos
  const pagarAsaas = async () => {
    setLoading(true);
    setErro('');
    setOfertandoFallback(false);
    try {
      if (['clube', 'top2', 'top2_anual'].includes(planoApiKey)) await cancelarAssinaturasAnteriores();
      const res = await apiCall('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'criar_assinatura', nome: nomeUsuario, email: user.email, cpf: cpfUsuario, plano: planoApiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar cobrança');
      setGatewayUsado('asaas');
      const link = data.linkPagamento;
      setLinkPagamento(link);
      // Abre o pagamento em NOVA ABA (não substitui a tela do BidPro — antes o
      // window.location.href levava a cliente embora "sozinha"). A tela de
      // "aguardando confirmação" fica aberta e o plano ativa quando o pagamento cai.
      if (link) window.open(link, '_blank', 'noopener');
      const ids = { subscriptionId: data.subscriptionId || null, paymentId: data.paymentId || null };
      setAsaasIds(ids);
      if (data.customerId && user?.id) {
        supabase.from('perfis').update({ asaas_id: data.customerId }).eq('id', user.id).then(() => {});
      }
    } catch (err) {
      setErro(err.message);
    }
    setLoading(false);
  };

  const gerarLink = async () => {
    setLoading(true);
    setErro('');
    setOfertandoFallback(false);

    // Anti-duplicidade: cancela assinaturas ativas antes de criar a nova recorrência
    if (['clube', 'top2', 'top2_anual'].includes(planoApiKey)) await cancelarAssinaturasAnteriores();

    // Verifica se MP está ativo (admin pode desligar manualmente no painel)
    const { data: cfgRows } = await supabase.from('config_financeira').select('gateway,ativo');
    const mpDesligadoManualmente = cfgRows?.find(r => r.gateway === 'mp')?.ativo === false;

    if (!mpDesligadoManualmente) {
      // ── Tenta Mercado Pago primeiro ───────────────────────────────────
      try {
        const planoRecorrente = ['clube', 'top2', 'top2_anual'].includes(planoApiKey);
        const action = planoRecorrente ? 'criar_assinatura' : 'criar_preferencia';
        const res = await apiCall('/api/mp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, plano: planoApiKey, email: user.email, nome: nomeUsuario, cpf: cpfUsuario }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'MP indisponível');
        const link = data.initPoint || data.init_point;
        setGatewayUsado('mp');
        setLinkPagamento(link);
        // Abre o pagamento em NOVA ABA (não substitui a tela do BidPro — antes o
      // window.location.href levava a cliente embora "sozinha"). A tela de
      // "aguardando confirmação" fica aberta e o plano ativa quando o pagamento cai.
      if (link) window.open(link, '_blank', 'noopener');
        setLoading(false);
        return;
      } catch (mpErr) {
        // MP falhou — fallback automático para Asaas sem mostrar erro ao cliente.
        // ANTI-DUPLO-MANDATO (P0.2): se o MP CRIOU o preapproval e só o response falhou
        // (timeout), o Asaas criaria uma 2ª recorrência (no anual, 2× R$449,90). Reseta o
        // ref para o cancelarAssinaturasAnteriores do pagarAsaas RODAR DE NOVO e cancelar o
        // mandato meio-criado no MP antes de criar o do Asaas. Fica UM só mandato ativo.
        cancelouAnterioresRef.current = false;
        console.warn('[checkout] MP falhou, tentando Asaas:', mpErr.message);
      }
    }

    // ── Asaas (backup automático) ─────────────────────────────────────
    try {
      await pagarAsaas();
    } catch (err) {
      setErro(err.message);
    }
    setLoading(false);
  };

  const mudarPlano = async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await apiCall('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gerenciar_assinatura', email: user.email, plano: planoKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao alterar plano');
      setResultadoMudanca(data);
      if (data.linkPagamento) {
        setLinkPagamento(data.linkPagamento);
        window.open(data.linkPagamento, '_blank', 'noopener');
      } else {
        // Mudança sem link (downgrade): mostra sucesso e redireciona
        setTimeout(() => nav('/'), 3000);
      }
    } catch (err) {
      setErro(err.message);
    }
    setLoading(false);
  };

  // Regra (b) anual→mensal: AGENDA a virada para o fim do anual vigente (não cobra agora).
  // O servidor marca ciclo_agendado='mensal', cancela a auto-renovação anual (para a regra c
  // não recobrar 449,90) e mantém o acesso até plano_vencimento. A mensal é materializada
  // no vencimento (cron) — o cliente reautoriza o cartão por e-mail perto da virada.
  const agendarCiclo = async () => {
    setLoading(true); setErro('');
    try {
      const res = await apiCall('/api/agendar-ciclo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alvo: 'mensal' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.msg || data.error || 'Não foi possível agendar a mudança.');
      setResultadoMudanca({ agendado: 'mensal', ate: data.ate });
      setTimeout(() => nav('/'), 4000);
    } catch (err) { setErro(err.message); }
    setLoading(false);
  };

  // Investidor Pro ANUIDADE via PIX: o PIX foi confirmado (paymentId) → ativa o Pro anual
  // via endpoint VERIFICADO (confere valor+dono+aprovação no MP). Depois segue o fluxo guiado
  // (volta pra assessoria se veio do bundle). Idempotente no servidor; erro → oferece retry.
  const ativarProAnual = async (paymentId) => {
    pixAnualPidRef.current = paymentId;
    setPixAnualFase('ativando');
    try {
      const res = await apiCall('/api/ativar-pro-anual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPixAnualFase('erro'); return; }
      try { await logAceite('top2_anual', plano?.precoAnual, {}, 'mp'); } catch (_) {}
      try { await refreshPerfil?.(); } catch (_) {}
      nav(aposPlano ? `/checkout?plano=${aposPlano}` : '/membros');
    } catch { setPixAnualFase('erro'); }
  };

  const confirmarPagamento = async () => {
    setPago(true);
    // Registra o aceite dos termos SOMENTE quando o pagamento é efetivado — antes
    // era gravado a cada clique em "Ir para Pagamento" (mesmo em checkout abandonado),
    // gerando aceites sem transação. O aceite agora é prova do pagamento concluído.
    try { await logAceite(planoApiKey, plano?.preco, {}, gatewayUsado || (mpStatus ? 'mp' : null)); } catch (_) {}
    // O plano já foi ativado no servidor de forma síncrona (assinatura transparente).
    // Reavalia o perfil AGORA para o novo role valer sem precisar de re-login/reload.
    try { await refreshPerfil?.(); } catch (_) {}
    if (planoKey === 'assessorado' || planoKey === 'clube') {
      try {
        const res = await apiCall('/api/auto-contrato', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user?.id,
            planoKey,
            nomeUsuario,
            emailUsuario: user?.email,
          }),
        });
        const data = await res.json();
        if (data.token) {
          setTimeout(() => nav(`/c/${data.token}`), 2000);
          return;
        }
      } catch (_) {}
    }
    // Fluxo guiado: Pro recém-ativado → segue DIRETO para contratar o que motivou (assessoria).
    setTimeout(() => nav(aposPlano ? `/checkout?plano=${aposPlano}` : '/'), 3500);
  };

  // Tela de aprovado — cobre tudo, redireciona para home (ou contrato)
  const ehContratoPlano = planoKey === 'assessorado' || planoKey === 'clube';
  if (pagoPendente) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>⏳</div>
      <h1 style={{ color: 'white', fontWeight: 900, fontSize: 28, margin: '0 0 12px' }}>Pagamento em análise</h1>
      <p style={{ color: '#cbd5e1', fontSize: 15, margin: '0 0 24px', lineHeight: 1.6, maxWidth: 440 }}>
        Seu banco está confirmando a assinatura (costuma levar alguns minutos). Assim que aprovado, o plano <strong style={{ color: 'white' }}>{plano?.nome}</strong> é liberado automaticamente. Você já pode entrar na plataforma.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#93c5fd', fontSize: 14 }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Entrando…
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (pago) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 72, marginBottom: 24, animation: 'pop 0.4s ease' }}>✅</div>
      <h1 style={{ color: 'white', fontWeight: 900, fontSize: 32, margin: '0 0 12px' }}>Pagamento aprovado!</h1>
      <p style={{ color: '#a7f3d0', fontSize: 16, margin: '0 0 32px', lineHeight: 1.6 }}>
        {ehContratoPlano ? (
          <>Pagamento aprovado! Preparando seu contrato para assinatura…</>
        ) : (
          <>Seu plano <strong style={{ color: 'white' }}>{plano?.nome}</strong> está ativo.<br/>Redirecionando para o início em instantes…</>
        )}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6ee7b7', fontSize: 14 }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Aguarde…
      </div>
      <style>{`@keyframes pop{0%{transform:scale(0.5);opacity:0}80%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #111111 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>

      {/* Banner: MP rejeitou o pagamento, oferece Asaas com 1 clique */}
      {mpStatus === 'rejected' && !ofertandoFallback && gatewayUsado !== 'asaas' && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 998, background: '#fef3c7', borderBottom: '2px solid #f59e0b', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, color: '#92400e', fontWeight: 600 }}>
            ⚠️ Pagamento não aprovado no Mercado Pago. Tente finalizar pelo Asaas (link bancário seguro), seus dados já estão preenchidos.
          </span>
          <button
            onClick={pagarAsaas}
            disabled={loading}
            style={{ padding: '8px 20px', background: '#d97706', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? 'Aguarde…' : 'Continuar pelo Asaas →'}
          </button>
          <button onClick={() => window.history.replaceState({}, '', window.location.pathname + '?plano=' + planoKey)}
            style={{ background: 'none', border: 'none', color: '#92400e', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        </div>
      )}

      {/* Popup de erro, overlay sobre o checkout */}
      {erro && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setErro('')}>
          <div style={{ background: 'white', borderRadius: 20, padding: '32px 30px', maxWidth: 440, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', textAlign: 'center' }}
            onClick={e => e.stopPropagation()}>
            {(() => {
              const m = mapearErro(erro);
              return m ? (
                <>
                  <div style={{ fontSize: 52, marginBottom: 12 }}>{m.icone}</div>
                  <h3 style={{ color: '#dc2626', margin: '0 0 10px', fontWeight: 900, fontSize: 20 }}>{m.titulo}</h3>
                  <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, margin: '0 0 24px' }}>{m.orientacao}</p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
                  <h3 style={{ color: '#dc2626', margin: '0 0 10px', fontWeight: 900, fontSize: 20 }}>Pagamento não processado</h3>
                  <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, margin: '0 0 24px' }}>{erro}</p>
                </>
              );
            })()}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setErro('')}
                style={{ padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} /> Tentar novamente
              </button>
              <button onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}
                style={{ padding: '10px 20px', background: '#0D63DB', color: 'white', borderRadius: 10, fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                💬 Falar com suporte
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) minmax(280px, 460px)', gap: 24, maxWidth: 880, width: '100%', alignItems: 'stretch' }} className="checkout-grid">

        {/* Coluna esquerda, conteúdo BidPro Brasil sobre o produto (alinhado ao topo) */}
        <div style={{ color: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '4px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{ background: '#0D63DB', borderRadius: 10, padding: '8px 10px' }}>
              <LogoB size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>BIDPRO BRASIL</div>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
            </div>
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.25, margin: '0 0 14px' }}>
            Arremate imóveis com segurança e inteligência de dados.
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            A BidPro Brasil une análise mercadológica, viabilidade financeira e leitura jurídica para você investir em leilões com confiança, do primeiro lance à arrematação.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              [TrendingUp, 'Viabilidade real', 'Relatórios de mercado e fluxo de caixa antes de dar o lance.'],
              [ShieldCheck, 'Risco jurídico mapeado', 'Análise de edital, matrícula e processo para evitar surpresas.'],
              [MapPin, 'Imóveis no Brasil inteiro', 'Milhares de oportunidades da Caixa e dos maiores leiloeiros, num só lugar.'],
              [Headphones, 'Suporte da equipe', 'Assessoria humana quando você precisar avançar na arrematação.'],
            ].map(([Icon, t, d]) => (
              <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ background: 'rgba(37,99,235,0.2)', borderRadius: 9, padding: 8, flexShrink: 0 }}><Icon size={16} color="#60a5fa" /></div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t}</div>
                  <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
          {/* Selo de confiança */}
          <div style={{ marginTop: 22, display: 'flex', gap: 10, alignItems: 'center', background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 12, padding: '12px 14px' }}>
            <CheckCircle2 size={18} color="#34d399" style={{ flexShrink: 0 }} />
            <div style={{ fontSize: 12.5, color: '#a7f3d0', lineHeight: 1.5 }}>
              <strong style={{ color: '#fff' }}>Método dos 30%:</strong> só recomendamos operações com margem de segurança, você dá o lance certo, no valor certo.
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 16 }}>Cancele quando quiser · Sem fidelidade · Pagamento seguro</p>
        </div>

        {/* Coluna direita, card de checkout */}
        <div style={{ background: 'white', borderRadius: 20, padding: '36px 34px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

          {ehMudanca && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: ehUpgrade ? '#eff6ff' : '#fef3c7', color: ehUpgrade ? '#084BA6' : '#92400e', fontSize: 12, fontWeight: 800, padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>
              {ehUpgrade ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {ehUpgrade ? 'Upgrade de plano' : 'Downgrade de plano'}
            </div>
          )}

          {planoKey === 'top2' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 800, padding: '4px 12px', borderRadius: 20, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              ★ Mais popular
            </div>
          )}
          <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#111111' }}>
            Plano {plano.nome}
          </h2>

          {/* Toggle mensal/anual, Investidor Pro (top2) */}
          {temToggleAnual && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, background: '#f1f5f9', borderRadius: 10, padding: 4 }}>
              {[
                { key: 'mensal', label: 'Mensal' },
                { key: 'anual',  label: 'Anual' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setModalidade(key)}
                  style={{ flex: 1, padding: '9px 4px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                    background: modalidade === key ? plano.cor : 'transparent',
                    color: modalidade === key ? 'white' : '#64748b' }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Seletor de modalidade, apenas para assessorado e clube */}
          {temModalidade && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, background: '#f1f5f9', borderRadius: 10, padding: 4 }}>
              {[
                { key: 'mensal', label: 'Parcelado' },
                { key: 'vista',  label: 'À vista' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setModalidade(key)}
                  style={{ flex: 1, padding: '8px 4px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    background: modalidade === key ? plano.cor : 'transparent',
                    color: modalidade === key ? 'white' : '#64748b' }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {promoInfo ? (() => {
            const orig = temModalidade && modalidade === 'vista' ? (plano.precoVista || plano.preco)
              : temToggleAnual && modalidade === 'anual' ? (plano.precoAnual || plano.preco * 12) : plano.preco;
            const promo = promoInfo.desconto_pct > 0
              ? orig * (1 - promoInfo.desconto_pct / 100)
              : promoInfo.desconto_valor > 0 ? Math.max(0, orig - promoInfo.desconto_valor) : orig;
            const fmtR = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, color: '#94a3b8', textDecoration: 'line-through' }}>R$ {fmtR(orig)}</span>
                  <strong style={{ color: '#059669', fontSize: 28 }}>R$ {fmtR(promo)}</strong>
                  <span style={{ color: '#64748b', fontSize: 15 }}>{plano.periodicidade}</span>
                </div>
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef9c3', borderRadius: 8, fontSize: 13, color: '#a16207', fontWeight: 700 }}>
                  🎁 Código <strong>{promoCode}</strong> aplicado
                  {promoInfo.descricao_condicoes && `, ${promoInfo.descricao_condicoes}`}
                </div>
              </div>
            );
          })() : temToggleAnual ? (
            <div style={{ marginBottom: 20 }}>
              {modalidade === 'mensal' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ color: '#111111', fontSize: 32 }}>{plano.precoLabel}</strong>
                    <span style={{ color: '#64748b', fontSize: 15, fontWeight: 600 }}>/mês</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                    Assinatura recorrente, cobrado <strong>{plano.precoLabel}</strong> todo mês no cartão. Cancele a qualquer momento pela plataforma. Sem multa ou fidelidade.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ color: '#111111', fontSize: 32 }}>12× {plano.precoMensalAnualLabel}</strong>
                    <span style={{ background: '#d1fae5', color: '#065f46', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>20% off</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                    Total de <strong>{plano?.precoAnualLabel || 'R$ 449,90'}/ano</strong>, em até 12× no cartão ou à vista. Renova automaticamente a cada 12 meses pelo valor vigente. Você pode <strong>cancelar a renovação quando quiser</strong>, o acesso continua até o fim do período já pago.
                  </div>
                </>
              )}
            </div>
          ) : temModalidade ? (() => {
            // Apresentação REATIVA ao toggle: parcelado mostra "12× R$ X"; à vista
            // mostra o valor com desconto + PIX sem taxa e cartão à vista.
            const fmtR = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const preco = Number(plano.preco) || 0;
            const precoVista = Number(plano.precoVista) || 0;
            const parcela = preco / 12;
            const economia = preco - precoVista;
            return (
              <div style={{ marginBottom: 20 }}>
                {modalidade === 'vista' ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ color: '#111111', fontSize: 32 }}>{fmtR(precoVista)}</strong>
                      <span style={{ color: '#64748b', fontSize: 16, fontWeight: 600 }}>à vista</span>
                      <span style={{ background: '#d1fae5', color: '#065f46', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>20% OFF</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                      No <strong>PIX (sem taxa)</strong> ou <strong>cartão de crédito à vista</strong>.{economia > 0 ? ` Economize ${fmtR(economia)} em relação ao parcelado.` : ''}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ color: '#111111', fontSize: 32 }}>12× {fmtR(parcela)}</strong>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                      Total {fmtR(preco)} no cartão de crédito{planoKey === 'assessorado' ? ' · sem juros até 3×' : ''}.
                    </div>
                  </>
                )}
              </div>
            );
          })() : (
            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 15 }}>
              <strong style={{ color: '#111111', fontSize: 28 }}>{plano.precoLabel}</strong> {plano.periodicidade}
            </p>
          )}
          {typeof plano.honorarios === 'string' && plano.honorarios && (
            <div style={{ background: plano.bg, color: plano.cor, fontSize: 13, fontWeight: 700, padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
              {plano.honorarios}
            </div>
          )}

          <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px', marginBottom: 20 }}>
            {(plano.recursos || plano.features || []).map(f => (
              <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                <CheckCircle2 size={14} color={plano.cor} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13, color: '#334155' }}>{f.replace(/^[✅❌]\s*/, '')}</span>
              </div>
            ))}
          </div>

          {ehMudanca && planoAtual && (
            <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#64748b' }}>
              Plano atual: <strong>{planoAtual.nome}</strong> ({planoAtual.precoLabel})
            </div>
          )}
          {/* Aviso LGPD, CPF e nome são enviados ao processador de pagamento */}
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', marginBottom: 20, fontSize: 11, color: '#0369a1', lineHeight: 1.5 }}>
            Seus dados (nome e CPF) serão compartilhados com o processador de pagamento para emissão da cobrança, conforme a <strong>Lei nº 13.709/2018 (LGPD)</strong>.
          </div>

          {/* Resultado de mudança de plano */}
          {resultadoMudanca ? (
            <div>
              <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10, padding: '14px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#065f46', marginBottom: 6 }}>
                  <CheckCircle2 size={16} /> {resultadoMudanca.agendado ? 'Mudança agendada!' : 'Plano alterado com sucesso!'}
                </div>
                {resultadoMudanca.agendado === 'mensal' ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                    Você continua no plano anual até <strong>{resultadoMudanca.ate ? new Date(resultadoMudanca.ate).toLocaleDateString('pt-BR') : 'o fim do período pago'}</strong>. Ao fim dos 12 meses, o plano passa a ser <strong>mensal (R$ 49,90/mês)</strong> — enviaremos um e-mail perto da virada para você confirmar o cartão. Nenhuma cobrança agora.
                  </p>
                ) : resultadoMudanca.tipo === 'upgrade' ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                    Geramos a cobrança da diferença de <strong>R$ {Number(resultadoMudanca.cobrancaDiferenca).toFixed(2)}</strong>. O vencimento da recorrência permanece em <strong>{resultadoMudanca.proximoVencimento}</strong>.
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                    Você mantém os benefícios do plano atual até a próxima cobrança (<strong>{resultadoMudanca.proximoVencimento}</strong>), quando passará a pagar <strong>{plano.precoLabel}</strong>.
                  </p>
                )}
              </div>
              {linkPagamento && (
                <a href={linkPagamento} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', background: '#10b981', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: 'none', boxSizing: 'border-box' }}>
                  <ExternalLink size={16} /> Pagar diferença agora
                </a>
              )}
            </div>
          ) : linkPagamento ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
              <p style={{ fontWeight: 800, color: '#111111', marginBottom: 8, fontSize: 16 }}>Página de pagamento aberta!</p>
              <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 20 }}>
                Complete o pagamento na página de pagamento. <strong>Não precisa fazer mais nada</strong>, assim que o pagamento cair, seu plano é ativado automaticamente. Se a página não abrir, use o botão abaixo.
              </p>
              <a href={linkPagamento} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box', marginBottom: 10 }}>
                <ExternalLink size={15} /> Reabrir página de pagamento
              </a>
              <div style={{ width: '100%', padding: '14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#166534', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  Aguardando confirmação do pagamento…
                </div>
                <p style={{ fontSize: 12, color: '#4ade80', margin: 0 }}>Verificando automaticamente a cada 8 segundos</p>
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, textAlign: 'center' }}>
                Assim que seu pagamento for processado, seu plano será ativado automaticamente.
              </p>
            </div>
          ) : !user ? (
            /* Visitante não-logado — cria a conta AQUI (confirma e-mail e depois loga) */
            <>
              {contaCriada ? (
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 14px' }} />
                  <h3 style={{ margin: '0 0 8px', fontWeight: 900, color: '#111' }}>Cadastro criado!</h3>
                  <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                    Enviamos um e-mail de confirmação para <strong>{su.email}</strong>. Confirme (verifique também o spam) e faça login{planoKey !== 'explorador' ? ` para concluir a assinatura do ${plano.nome}.` : ' para acessar a plataforma.'}
                  </p>
                  <button onClick={() => nav(`/login?plano=${planoKey}${promoCode ? '&promo=' + promoCode : ''}`)}
                    style={{ width: '100%', padding: '14px', background: plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
                    Ir para o login →
                  </button>
                </div>
              ) : (
              <>
              {planoKey === 'top2' && etapa === 'pgto' ? (
                /* ── Etapa 2: Pagamento (cartão) ── */
                <>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Você está assinando</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>{plano.nome} · {plano.precoLabel || 'R$ 49,90'}/mês</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Como {su.email} · Cancele quando quiser</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Dados para a nota fiscal</div>
                    <input value={cpf} inputMode="numeric" placeholder="CPF"
                      onChange={e => setCpf(e.target.value)} style={{ ...ckInp, width: '100%' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={end.cep} inputMode="numeric" placeholder="CEP"
                        onChange={e => setEnd(p => ({ ...p, cep: e.target.value }))} onBlur={e => buscarCepCk(e.target.value)} style={{ ...ckInp, width: 120 }} />
                      <input value={end.logradouro} placeholder="Logradouro"
                        onChange={e => setEnd(p => ({ ...p, logradouro: e.target.value }))} style={{ ...ckInp, flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={end.numero} placeholder="Nº"
                        onChange={e => setEnd(p => ({ ...p, numero: e.target.value }))} style={{ ...ckInp, width: 80 }} />
                      <input value={end.bairro} placeholder="Bairro"
                        onChange={e => setEnd(p => ({ ...p, bairro: e.target.value }))} style={{ ...ckInp, flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input value={end.cidade} placeholder="Cidade"
                        onChange={e => setEnd(p => ({ ...p, cidade: e.target.value }))} style={{ ...ckInp, flex: 1 }} />
                      <select value={end.uf} onChange={e => setEnd(p => ({ ...p, uf: e.target.value }))} style={{ ...ckInp, width: 90 }}>
                        <option value="">UF</option>
                        {ESTADOS_UF.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                      </select>
                    </div>
                    {cepLoadingCk && <div style={{ fontSize: 11, color: '#0D63DB' }}>Buscando endereço…</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Dados do cartão</div>
                    <input value={card.numero} inputMode="numeric" placeholder="Número do cartão"
                      onChange={e => setCard(p => ({ ...p, numero: fmtCardNum(e.target.value) }))} style={{ ...ckInp, width: '100%' }} />
                    <input value={card.nome} placeholder="Nome impresso no cartão"
                      onChange={e => setCard(p => ({ ...p, nome: e.target.value.toUpperCase() }))} style={{ ...ckInp, width: '100%' }} />
                    <div style={{ display: 'flex', gap: 10 }}>
                      <input value={card.validade} inputMode="numeric" placeholder="MM/AA"
                        onChange={e => setCard(p => ({ ...p, validade: fmtCardVal(e.target.value) }))} style={{ ...ckInp, flex: 1 }} />
                      <input value={card.cvv} inputMode="numeric" placeholder="CVV" maxLength={4}
                        onChange={e => setCard(p => ({ ...p, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))} style={{ ...ckInp, flex: 1 }} />
                    </div>
                  </div>
                  {suErro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{suErro}</div>}
                  <button onClick={assinarComCadastro} disabled={suLoading}
                    style={{ width: '100%', padding: '15px', background: suLoading ? '#94a3b8' : plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: suLoading ? 'not-allowed' : 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    {suLoading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processando…</> : `Assinar e pagar ${plano.precoLabel || 'R$ 49,90'}`}
                  </button>
                  <button onClick={() => { setSuErro(''); setEtapa('ident'); }} disabled={suLoading}
                    style={{ width: '100%', padding: '10px', background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: suLoading ? 'default' : 'pointer' }}>
                    ← Voltar aos dados
                  </button>
                </>
              ) : (
                /* ── Etapa 1: Identificação (top2) ou cadastro simples (demais) ── */
                <>
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '14px 16px', marginBottom: 18, fontSize: 13, color: '#084BA6', fontWeight: 600 }}>
                    ✅ Plano <strong>{plano.nome}</strong> selecionado{planoKey === 'top2' ? ' — seus dados (passo 1 de 2)' : ' — crie sua conta'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                    <input value={su.nome} placeholder="Nome completo" autoComplete="name"
                      onChange={e => setSu(p => ({ ...p, nome: e.target.value }))} style={{ ...ckInp, width: '100%' }} />
                    <input value={su.email} type="email" placeholder="E-mail" autoComplete="email"
                      onChange={e => setSu(p => ({ ...p, email: e.target.value }))} style={{ ...ckInp, width: '100%' }} />
                    <input value={su.senha} type="password" placeholder="Crie uma senha" autoComplete="new-password"
                      onChange={e => setSu(p => ({ ...p, senha: e.target.value }))} style={{ ...ckInp, width: '100%' }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, margin: '2px 2px 0' }}>
                      {[
                        { ok: su.senha.length >= 8, txt: 'Mínimo 8 caracteres' },
                        { ok: /[A-Z]/.test(su.senha), txt: 'Uma letra maiúscula' },
                        { ok: /[a-z]/.test(su.senha), txt: 'Uma letra minúscula' },
                        { ok: /\d/.test(su.senha), txt: 'Um número' },
                        { ok: /[^A-Za-z0-9]/.test(su.senha), txt: 'Um caractere especial' },
                      ].map(r => (
                        <div key={r.txt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: r.ok ? '#059669' : '#94a3b8', fontWeight: r.ok ? 600 : 400 }}>
                          <span style={{ fontSize: 12, width: 12, display: 'inline-block' }}>{r.ok ? '✓' : '○'}</span> {r.txt}
                        </div>
                      ))}
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#475569', cursor: 'pointer', marginBottom: 12 }}>
                    <input type="checkbox" checked={su.aceite} onChange={e => setSu(p => ({ ...p, aceite: e.target.checked }))} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>Li e aceito os <a href="#/termos" target="_blank" style={{ color: '#0D63DB' }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" style={{ color: '#0D63DB' }}>Política de Privacidade</a>.</span>
                  </label>
                  {suErro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{suErro}</div>}
                  <button onClick={planoKey === 'top2' ? irParaPagamento : criarContaInline} disabled={suLoading}
                    style={{ width: '100%', padding: '15px', background: suLoading ? '#94a3b8' : plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: suLoading ? 'not-allowed' : 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    {suLoading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processando…</>
                      : (planoKey === 'top2' ? 'Continuar para pagamento →' : 'Criar conta e continuar →')}
                  </button>
                  <button onClick={() => nav(`/login?plano=${planoKey}${promoCode ? '&promo=' + promoCode : ''}`)}
                    style={{ width: '100%', padding: '12px', background: 'white', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 12, fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
                    Já tenho conta, Entrar
                  </button>
                  <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: 0 }}>
                    {planoKey === 'top2' ? 'Cartão de crédito · Cancele quando quiser' : 'Pague via PIX ou cartão de crédito · Cancele quando quiser'}
                  </p>
                </>
              )}
              </>
              )}
            </>
          ) : showPixAnual && planoKey === 'top2' ? (
            /* ── Investidor Pro ANUIDADE à vista no PIX (pagamento único de 12 meses) ── */
            pixAnualFase === 'ativando' ? (
              <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                <Loader2 size={40} color="#059669" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>Ativando seu Investidor Pro…</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>Pagamento confirmado. Só um instante.</div>
              </div>
            ) : pixAnualFase === 'erro' ? (
              <div style={{ background: 'white', borderRadius: 16, padding: '28px 24px', maxWidth: 460, margin: '0 auto', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.10)' }}>
                <AlertTriangle size={40} color="#d97706" style={{ margin: '0 auto 14px' }} />
                <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Pagamento recebido — ativação pendente</div>
                <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.7, marginBottom: 18 }}>Seu PIX foi pago, mas não conseguimos ativar o Pro agora. Tente de novo — se não resolver, fale com o suporte que ativamos na hora (o pagamento está registrado).</p>
                <button onClick={() => ativarProAnual(pixAnualPidRef.current)} style={{ width: '100%', padding: '13px', background: '#059669', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Tentar ativar de novo</button>
              </div>
            ) : (
              <PagamentoServico
                servico={{
                  id: 'top2_anual',
                  nome: 'Investidor Pro — 1 ano (à vista)',
                  valor: plano.precoAnual || 449.90,
                  descricao: 'Investidor Pro anual',
                  proposito: 'plano_anual',
                }}
                soPix
                onPago={(pid) => ativarProAnual(pid)}
                onCancelar={() => { setShowPixAnual(false); setPixAnualFase('pagando'); }}
              />
            )
          ) : showPagamento && planoKey === 'assessorado' ? (
            /* ── Assessoria: pagamento inline PIX + cartão ── */
            <PagamentoServico
              servico={{
                id: planoApiKey,
                nome: `${plano.nome}${modalidade === 'vista' ? ' (à vista)' : ' (parcelado)'}`,
                valor: modalidade === 'vista' ? (plano.precoVista || plano.preco) : plano.preco,
                descricao: plano.nome,
              }}
              assinatura={false}
              onPago={() => confirmarPagamento()}
              onCancelar={() => setShowPagamento(false)}
            />
          ) : showPagamento && planoKey === 'top2' && modalidade !== 'anual' ? (
            /* ── Investidor Pro mensal: assinatura transparente inline (cartão no BidPro) ── */
            <PagamentoServico
              servico={{
                id: 'top2',
                plano: 'top2',
                nome: plano.nome,
                valor: plano.preco,
                descricao: plano.nome,
              }}
              assinatura
              onPago={() => confirmarPagamento()}
              onCancelar={() => setShowPagamento(false)}
            />
          ) : (
            <>
              {/* Dados de faturamento, aparecem SÓ quando o perfil não está completo
                  (CPF + endereço). Necessários para faturamento e emissão fiscal. */}
              {!linkPagamento && !perfilFaturamentoOk && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 14, background: '#f8fafc' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                    <MapPin size={15} color="#0D63DB" />
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#111' }}>Dados de faturamento</span>
                  </div>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px', lineHeight: 1.5 }}>Necessários para faturamento e emissão fiscal da contratação.</p>
                  {!cpfOk && (
                    <div style={{ marginBottom: 8 }}>
                      <input value={cpf} inputMode="numeric" placeholder="CPF (somente números)"
                        onChange={e => setCpf(e.target.value)} style={{ ...ckInp, width: '100%' }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ width: 110 }}>
                      <input value={end.cep} inputMode="numeric" placeholder="CEP"
                        onChange={e => setEnd(p => ({ ...p, cep: e.target.value }))} onBlur={e => buscarCepCk(e.target.value)}
                        style={ckInp} />
                    </div>
                    <input value={end.logradouro} placeholder="Logradouro" onChange={e => setEnd(p => ({ ...p, logradouro: e.target.value }))} style={{ ...ckInp, flex: 1, minWidth: 150 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <input value={end.numero} placeholder="Nº" onChange={e => setEnd(p => ({ ...p, numero: e.target.value }))} style={{ ...ckInp, width: 80 }} />
                    <input value={end.bairro} placeholder="Bairro" onChange={e => setEnd(p => ({ ...p, bairro: e.target.value }))} style={{ ...ckInp, flex: 1, minWidth: 120 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <input value={end.cidade} placeholder="Cidade" onChange={e => setEnd(p => ({ ...p, cidade: e.target.value }))} style={{ ...ckInp, flex: 1, minWidth: 140 }} />
                    <select value={end.uf} onChange={e => setEnd(p => ({ ...p, uf: e.target.value }))} style={{ ...ckInp, width: 90 }}>
                      <option value="">UF</option>
                      {ESTADOS_UF.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                    </select>
                  </div>
                  {cepLoadingCk && <div style={{ fontSize: 11, color: '#0D63DB', marginTop: 6 }}>Buscando endereço…</div>}
                </div>
              )}

              {/* Aceite dos termos, prova de consentimento */}
              {!linkPagamento && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#475569', cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={aceitouTermos} onChange={e => setAceitouTermos(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>
                    Li e aceito os <a href="#/termos" target="_blank" style={{ color: '#0D63DB' }}>Termos de Uso</a>.{' '}
                    {planoKey === 'assessorado'
                      ? `Estou ciente de que este é um serviço de assessoria ${modalidade === 'vista' ? 'pago à vista' : 'parcelado em até 12×'}. O acesso à assessoria é ativado após confirmação do pagamento.`
                      : temToggleAnual && modalidade === 'anual'
                        ? `Autorizo a cobrança anual recorrente (${plano?.precoAnualLabel || 'R$ 449,90'}), que renova automaticamente a cada 12 meses pelo valor vigente. Posso cancelar a renovação a qualquer momento pela plataforma, sem multa — o acesso continua até o fim do período já pago.`
                        : 'Autorizo a cobrança recorrente mensal conforme o plano selecionado. Sei que posso cancelar a qualquer momento pela plataforma sem multa.'}
                    {(() => {
                      // Termo COMPLETO do produto (registro central utils/termos.js) — o texto
                      // exibido é o mesmo versionado que o aceite grava (termos_versao por produto).
                      const t = termoDoProduto(planoKey, {
                        nome: plano?.nome,
                        valorLabel: modalidade === 'anual' ? (plano?.precoAnualLabel || plano?.precoLabel) : plano?.precoLabel,
                        modelo: planoKey === 'assessorado' ? (modalidade === 'vista' ? 'unico' : 'parcelado') : 'recorrente',
                      });
                      return (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ color: '#0D63DB', cursor: 'pointer', fontWeight: 600 }}>Ver o termo de contratação — {t.titulo} (versão {t.versao})</summary>
                          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>{t.texto}</p>
                        </details>
                      );
                    })()}
                  </span>
                </label>
              )}
              <button
                onClick={iniciarPagamento}
                disabled={loading || !aceitouTermos || !perfilFaturamentoOk}
                style={{ width: '100%', padding: '14px', background: plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: (!aceitouTermos || !perfilFaturamentoOk || loading) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (loading || !aceitouTermos || !perfilFaturamentoOk) ? 0.6 : 1 }}>
                {loading
                  ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processando...</>
                  : ehTrocaCiclo ? (cicloAlvo === 'anual' ? 'Passar para o plano anual →' : 'Agendar mensalidade ao fim do anual →')
                  : ehMudanca ? `Confirmar ${ehUpgrade ? 'upgrade' : 'downgrade'} →` : 'Ir para Pagamento →'}
              </button>
              {/* Investidor Pro por PIX = ANUIDADE à vista (cartão = mensalidade recorrente, acima).
                  Só num contrato NOVO do Pro anual (não em troca de ciclo / mudança de plano). */}
              {temToggleAnual && modalidade === 'anual' && !ehTrocaCiclo && !ehMudanca && (
                <button
                  onClick={() => { if (aceitouTermos && perfilFaturamentoOk) { setPixAnualFase('pagando'); setShowPixAnual(true); } }}
                  disabled={loading || !aceitouTermos || !perfilFaturamentoOk}
                  style={{ width: '100%', marginTop: 10, padding: '13px', background: 'white', color: '#059669', border: '1.5px solid #059669', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: (!aceitouTermos || !perfilFaturamentoOk || loading) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (!aceitouTermos || !perfilFaturamentoOk || loading) ? 0.6 : 1 }}>
                  Pagar 1 ano à vista no PIX ({plano?.precoAnualLabel || 'R$ 449,90'})
                </button>
              )}
              {!perfilFaturamentoOk && aceitouTermos && (
                <p style={{ fontSize: 11, color: '#b45309', textAlign: 'center', marginTop: 8 }}>
                  {!cpfOk && !enderecoOk ? 'Preencha o CPF e o endereço acima para continuar.'
                    : !cpfOk ? 'Preencha o CPF acima para continuar.'
                    : 'Preencha o endereço acima para continuar.'}
                </p>
              )}
              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 12 }}>
                {planoKey === 'assessorado'
                  ? 'Pague via PIX (sem taxa) ou cartão de crédito em até 12×'
                  : temToggleAnual && modalidade === 'anual'
                    ? `Cobrança anual recorrente (${plano?.precoAnualLabel || 'R$ 449,90'}) · Renova a cada 12 meses · Cancele a renovação quando quiser`
                    : 'Somente cartão de crédito · Cancele quando quiser'}
              </p>
            </>
          )}

          <button onClick={() => nav('/')} style={{ marginTop: 16, width: '100%', background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            Voltar para o início
          </button>
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @media (max-width: 760px) { .checkout-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </div>
    </div>
  );
}
