import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, BarChart3, GraduationCap, Home as HomeIcon, Gift, ArrowRight, TrendingUp, ShieldCheck, Gavel, Wallet, Landmark, PlayCircle, Car, MapPin, ChevronDown, ChevronUp, AlertTriangle, MessageSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { lerCotas, janelaLabel } from '../utils/cotaAnalise';
import TriagemPerfil from '../components/TriagemPerfil';
import VitrineMaterial from '../components/VitrineMaterial';
import ConvideAmigo from '../components/ConvideAmigo';
import { TERMO_PARCEIRO_VERSAO, TERMO_PARCEIRO_PREAMBULO, TERMO_PARCEIRO, DECLARACAO_REPASSE } from '../components/ConviteParceiro';
import { LATAO } from '../utils/marca';
import { usePlanos } from '../contexts/PlanosContext';
import { registrarEvento } from '../utils/tracker';
import { ehEquipeVeiculos, CHECKOUT_COMBO } from '../utils/veiculosAcesso';
import { ROLES_PAGOS_IMOVEIS } from '../utils/leiloeiroAcesso';

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

// Cache em MÓDULO, não em state (20/09 — achado do dono: o card "Rever vídeo de boas-vindas"
// sempre atrasa em relação aos demais). Causa: HomeCliente REMONTA a cada clique em "Início"
// (state não sobrevive à navegação — mesma característica já documentada pro esqueleto da
// cota, ver abaixo), então o fetch de `cursos_admin` roda de novo TODA VEZ, enquanto os outros
// cards da grade não dependem de rede e já nascem prontos. O curso de onboarding é config
// global do admin — não muda por navegação nem por usuário — então cachear fora do state faz
// o card nascer instantâneo a partir da 2ª visita da sessão (só a 1ª ainda mostra o esqueleto).
//
// 30/09 — o atraso VOLTOU porque o cache acima tinha dois furos: (1) o state nascia `undefined` e
// só lia o cache no useEffect → o esqueleto pintava 1 quadro e o card entrava depois, EM TODA
// visita; (2) cache só em memória some a cada recarga/login. Agora o state NASCE do cache, que
// também fica no localStorage (id/título de curso — config pública, nada pessoal), e a rede só
// REVALIDA em segundo plano (se o admin trocar o curso, a próxima visita já pega o novo).
const CHAVE_CACHE_BV = 'bidpro_curso_boas_vindas_v1';
let cacheCursoBoasVindas = (() => {
  try { const s = localStorage.getItem(CHAVE_CACHE_BV); return s ? JSON.parse(s) : undefined; } catch { return undefined; }
})(); // undefined = ainda não buscado · null = sem curso · obj = achado

export default function HomeCliente() {
  const nav = useNavigate();
  const { user, effectiveRole, effectiveUserId, impersonate, roleSimulado, nome: nomePerfil } = useAuth();
  const info = PLANO_INFO[effectiveRole] || PLANO_INFO.explorador;
  // Modo suporte: a saudação é a do CLIENTE visualizado (a equipe navega como ele).
  const primeiroNome = (impersonate?.nome || nomePerfil || user?.user_metadata?.nome || user?.email || 'Investidor').split(' ')[0].split('@')[0];

  const [cotas, setCotas] = useState(undefined); // undefined=lendo · null=não lido · obj=minhas_cotas
  const [copiado, setCopiado] = useState(false);
  const [meusCasos, setMeusCasos] = useState([]);
  const [casosLidos, setCasosLidos] = useState(false);
  const [casosErro, setCasosErro] = useState(null);
  const [maisOpcoes, setMaisOpcoes] = useState(false);
  const planos = usePlanos();
  const [cursoBoasVindas, setCursoBoasVindas] = useState(() => cacheCursoBoasVindas); // undefined=carregando · null=sem curso · obj=achado
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
    // `error` checado (25/10): o herói da assessoria ("abra o seu acompanhamento") só aparece com a
    // lista LIDA e vazia — falha de leitura não pode virar "você não tem caso" (forma 2).
    supabase.from('casos').select('id, imovel_endereco, status_etapa, created_at')
      .eq('cliente_id', effectiveUserId).order('created_at', { ascending: false }).limit(10)
      .then(({ data, error }) => {
        if (error) { console.warn('[home] casos:', error.message); setCasosErro(error.message); return; }
        setCasosErro(null); setMeusCasos(data || []); setCasosLidos(true);
      });
  }, [effectiveUserId]);

  // COTAS INTEIRAS (25/10): a Home passou a montar-se pela CAPACIDADE (imóveis, documental, veículos),
  // então lê o objeto todo de `minhas_cotas` — não só o mercado. `undefined` = lendo · `null` = NÃO LIDO
  // (lerCotas nunca lança e devolve null na falha). "Não lido" é dito na tela; nunca vira 0.
  useEffect(() => {
    if (!effectiveUserId) { setCotas(null); return; }
    let vivo = true;
    setCotas(undefined);
    lerCotas(supabase, effectiveUserId, { roleSimulado }).then((c) => { if (vivo) setCotas(c || null); });
    return () => { vivo = false; };
  }, [effectiveUserId, roleSimulado]);
  const cotaMercado = cotas ? (cotas.mercado || null) : null;

  // ACESSO A VEÍCULOS (25/10) — o add-on NÃO é role: é `perfis.acesso_veiculos_ate`, decidido por
  // `tem_acesso_veiculos()` (assessoria inclui o Combo). Leitura PRÓPRIA aqui, e não `useAcessoVeiculos`,
  // porque o hook funde erro com "sem acesso" (lado seguro para um cadeado) — e na Home isso seria
  // REBAIXAR um assinante a "Explorador" por uma falha de rede. Aqui o erro é um estado com nome.
  // Passa `p_user_id` para o modo suporte enxergar o cliente (o banco aceita equipe lendo terceiros).
  const equipeVeic = ehEquipeVeiculos(effectiveRole);
  const [acessoVeic, setAcessoVeic] = useState(undefined); // undefined=lendo · 'erro' · true · false
  const [tentativaVeic, setTentativaVeic] = useState(0);
  useEffect(() => {
    if (equipeVeic) { setAcessoVeic(true); return; }
    if (!effectiveUserId) { setAcessoVeic(false); return; }
    // Simulação de papel: o usuário real é o admin (que sempre tem acesso). Responde pelo PAPEL.
    if (roleSimulado) { setAcessoVeic(['assessorado', 'assessorado_anual'].includes(roleSimulado)); return; }
    let vivo = true;
    setAcessoVeic(undefined);
    supabase.rpc('tem_acesso_veiculos', { p_user_id: effectiveUserId }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { console.warn('[home] tem_acesso_veiculos:', error.message); setAcessoVeic('erro'); return; }
      setAcessoVeic(data === true);
    }, (e) => { if (vivo) { console.warn('[home] tem_acesso_veiculos (rede):', e?.message || e); setAcessoVeic('erro'); } });
    return () => { vivo = false; };
  }, [effectiveUserId, equipeVeic, roleSimulado, tentativaVeic]);

  // ATALHO "REVER VÍDEO DE BOAS-VINDAS" (12/09). Achado real: Neuma ligou perguntando por
  // ele — o `BoasVindasModal` marca o convite como visto assim que os vídeos são concluídos
  // e NUNCA mais reaparece sozinho (por desenho: quem já assistiu não deveria ser incomodado
  // de novo). O vídeo continua acessível em /membros/curso/:id (Curso.jsx não bloqueia
  // reassistir uma aula concluída), mas nada na tela dizia isso — ela não tinha como saber
  // que precisava ir procurar o curso "Comece aqui" na Área de Membros. Este link resolve a
  // DESCOBERTA, sem duplicar a lógica do modal nem mexer no que já funciona (o "fechar volta
  // no próximo acesso" e o "concluiu, some para sempre" continuam intactos).
  useEffect(() => {
    if (!effectiveUserId) { setCursoBoasVindas(null); return; }
    let vivo = true;
    supabase.from('cursos_admin').select('id, titulo')
      .eq('onboarding', true).eq('ativo', true).order('ordem').limit(1).maybeSingle()
      .then(({ data, error }) => {
        // Erro de leitura NÃO é "sem curso" (forma 2): mantém o que já se sabia.
        if (error) { if (vivo && cacheCursoBoasVindas === undefined) setCursoBoasVindas(null); return; }
        const v = data || null;
        cacheCursoBoasVindas = v;
        try { localStorage.setItem(CHAVE_CACHE_BV, JSON.stringify(v)); } catch { /* armazenamento bloqueado — segue com a memória */ }
        if (vivo) setCursoBoasVindas(v);
      });
    return () => { vivo = false; };
  }, [effectiveUserId]);

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
  // ⚠️ SEM O GATE DE PARCEIRO (29/08). Este efeito só rodava para quem já tinha ACEITADO o
  // termo — 10 de 73 contas — porque o código só servia ao card "Indique e Ganhe". Agora ele
  // alimenta também o "Convide um amigo", que é para TODO cliente: o dono quis que qualquer
  // pessoa da base pudesse chamar alguém para a aula.
  useEffect(() => {
    if (!effectiveUserId) return;
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
  }, [effectiveUserId]);

  // Próxima aula ao vivo — para o convite levar data e cartão de compartilhamento. Vem do banco
  // (`live_proxima` já calcula a recorrência), nunca fixa no código: o card só aparece quando
  // existe aula ATIVA e ainda por acontecer. Convidar para uma aula encerrada seria pior que
  // não convidar — o amigo abriria um convite morto e a indicação queimaria com ele.
  const [aulaProxima, setAulaProxima] = useState(null);
  // "TERMINOU DE PROCURAR" é diferente de "achou" (31/08). O card de convite muda de link
  // conforme haja aula, então ele precisa esperar a BUSCA acabar — e `aulaProxima` continua
  // `null` tanto durante a consulta quanto quando não há aula nenhuma. Sem este sinal, os dois
  // estados ficam indistinguíveis e o card publica o link genérico antes da hora.
  const [aulaResolvida, setAulaResolvida] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      // `error` checado: sem isso, "não consegui ler" e "não há aula" ficariam indistinguíveis,
      // e o card sumiria da tela sem ninguém saber que houve falha.
      const { data, error } = await supabase.rpc('live_proxima', { p_slug: 'leilao-ao-vivo' });
      if (error) { console.error('[home] live_proxima', error.message); if (vivo) setAulaResolvida(true); return; }
      if (vivo && data?.slug) setAulaProxima(data);
      // Resolvida em QUALQUER desfecho — inclusive erro e "não há aula". O card não pode ficar
      // preso no esqueleto porque a consulta falhou.
      if (vivo) setAulaResolvida(true);
    })();
    return () => { vivo = false; };
  }, []);

  // ── CAPACIDADE (25/10, arena "Home por capacidade") ──────────────────────────────────────────
  // O que a pessoa TEM, dito por extenso: role (imóveis) + acesso a veículos (add-on). Explorador que
  // assina Veículos não é "Explorador" — era assim que a Home o chamava, por ler só o role.
  const ehExplorador = effectiveRole === 'explorador';
  const ehPro = ['top2', 'top2_anual'].includes(effectiveRole);
  const ehAssessorado = ['assessorado', 'assessorado_anual'].includes(effectiveRole);
  const ehClube = ['clube', 'clube_anual'].includes(effectiveRole);
  const pagaImoveis = ROLES_PAGOS_IMOVEIS.includes(effectiveRole);
  const temVeic = acessoVeic === true;
  const veicErro = acessoVeic === 'erro';
  const veicLendo = acessoVeic === undefined;
  const selos = [];
  if (ehAssessorado) selos.push({ t: 'Assessorado', d: 'inclui o Combo' });
  else if (ehPro && temVeic) selos.push({ t: 'Combo', d: 'Investidor Pro + Leilão de Veículos' });
  else if (ehPro) selos.push({ t: 'Investidor Pro' });
  else if (ehClube) selos.push({ t: 'Membro Leilão Club' });
  if (temVeic && !ehAssessorado && !ehPro && !equipeVeic) selos.push({ t: 'Leilão de Veículos' });
  // Saudação: para o explorador, enquanto o acesso a veículos não foi LIDO, nenhum nome de plano —
  // dizer "Explorador" e trocar 1 s depois (ou nunca, se a leitura falhou) é o rebaixamento proibido.
  const nomePlanoSaudacao = selos[0]?.t
    || (ehExplorador ? ((veicLendo || veicErro) ? '' : 'Explorador') : info.nome);

  // Preço SÓ do planos_config (`doBanco`) — o estático de cursos.js é o fallback de leitura falha e
  // exibi-lo é o "R$ 49,90 na tela, R$ 89,90 no checkout" (mesma regra de Landing.jsx).
  const precoDe = (key) => { const p = planos?.[key]; return p?.doBanco && Number(p.preco) > 0 ? p : null; };
  const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pro = precoDe('top2');
  const combo = precoDe('combo');
  const assessoria = planos?.assessorado;

  // Cota por balde, "não lido" quando a leitura falhou (nunca 0).
  const fmtBalde = (b) => {
    if (cotas === undefined) return '…';
    if (!cotas || !b) return 'não lido';
    if (b.ilimitado) return 'ilimitado';
    const lim = Number(b.limite || 0) + Number(b.bonus || 0);
    return `${Number(b.usado || 0)}/${lim}`;
  };
  const acessoAte = cotas?.veiculo?.acesso_ate ? new Date(cotas.veiculo.acesso_ate) : null;
  const ddmm = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const linhaVeic = !temVeic ? null
    : acessoAte && Number.isFinite(acessoAte.getTime())
      ? (acessoAte.getTime() >= Date.now() ? `Veículos ativo até ${ddmm(acessoAte)}` : `Veículos: renovação pendente (venceu em ${ddmm(acessoAte)})`)
      : ehAssessorado ? 'Veículos incluso na assessoria'
        : cotas === null ? 'Veículos ativo · validade não lida' : null;

  // ── AMOSTRA GRÁTIS DO EXPLORADOR ─────────────────────────────────────────────────────────────
  const amostra = ehExplorador && cotaMercado?.amostra ? cotaMercado : null;
  const amostraUsado = amostra ? Number(amostra.usado || 0) : null;
  const amostraLimite = amostra ? Number(amostra.limite || 0) : null;
  const amostraRestam = amostra ? Math.max(0, amostraLimite - amostraUsado) + Number(amostra.bonus || 0) : null;
  const creditoSaldo = Number(cotas?.credito_saldo || 0);
  const amostraEsgotada = amostra && amostraRestam <= 0 && creditoSaldo <= 0;
  // A vitrine só serve ao explorador que ainda pode gerar (ou cuja cota não foi lida — aí mostra os lotes
  // com o aviso, em vez de esconder o caminho por uma falha de leitura).
  const querVitrine = ehExplorador && cotas !== undefined && !amostraEsgotada;

  // Região do perfil (triagem): 1ª cidade de interesse, senão o endereço. Sem dado, qualquer lote.
  const [regiao, setRegiao] = useState(undefined); // undefined=lendo · null=sem região/ilegível · {uf,cidade}
  useEffect(() => {
    if (!querVitrine || !effectiveUserId) return;
    let vivo = true;
    supabase.from('perfis').select('endereco_uf, endereco_cidade, cidades_interesse').eq('id', effectiveUserId).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { console.warn('[home] região do perfil:', error.message); setRegiao(null); return; }
        const ci = Array.isArray(data?.cidades_interesse) ? data.cidades_interesse.find((c) => c && c.uf) : null;
        const uf = String(ci?.uf || data?.endereco_uf || '').trim().toUpperCase();
        const cidade = String(ci?.cidade || data?.endereco_cidade || '').trim();
        setRegiao(uf ? { uf, cidade } : null);
      });
    return () => { vivo = false; };
  }, [querVitrine, effectiveUserId]);

  // Vitrine = o MESMO retrato da Landing (`landing_numeros().vitrine`, mascarado: sem leiloeiro/link/edital,
  // 1x/dia). Nenhuma consulta nova ao acervo, nenhum custo novo.
  const [vitrineRaw, setVitrineRaw] = useState(undefined); // undefined=lendo · {erro} · obj
  useEffect(() => {
    if (!querVitrine) return;
    let vivo = true;
    supabase.rpc('landing_numeros').then(({ data, error }) => {
      if (!vivo) return;
      if (error) { console.warn('[home] vitrine:', error.message); setVitrineRaw({ _erro: error.message }); return; }
      setVitrineRaw(data || {});
    }, (e) => { if (vivo) setVitrineRaw({ _erro: String(e?.message || 'rede') }); });
    return () => { vivo = false; };
  }, [querVitrine]);
  const VITRINE_MAX_H = 48; // mesmo teto da Landing: retrato mais velho que isso não é "hoje"
  const idadeVitH = (() => { const t = Date.parse(vitrineRaw?.vitrine_em || ''); return Number.isFinite(t) ? (Date.now() - t) / 3600000 : null; })();
  const vitrineTodos = Array.isArray(vitrineRaw?.vitrine) && idadeVitH != null && idadeVitH <= VITRINE_MAX_H
    ? vitrineRaw.vitrine.filter((l) => l && l.id) : [];
  const motivoSemVitrine = !querVitrine || vitrineRaw === undefined ? null
    : vitrineRaw._erro ? 'rpc_erro'
    : !Array.isArray(vitrineRaw.vitrine) ? 'sem_chave'
    : idadeVitH == null || idadeVitH > VITRINE_MAX_H ? 'retrato_velho'
    : vitrineTodos.length === 0 ? 'vazia' : null;
  const MOTIVO_TEXTO = {
    rpc_erro: 'Não conseguimos carregar os lotes em destaque agora (falha de leitura).',
    sem_chave: 'A lista de lotes em destaque não veio na resposta do servidor.',
    retrato_velho: 'A lista de lotes em destaque está desatualizada (mais de 48 h) e foi escondida para não mostrar leilão vencido.',
    vazia: 'Hoje não há lotes em destaque na vitrine.',
  };
  useEffect(() => {
    if (!motivoSemVitrine) return;
    registrarEvento('lp_vitrine_ausente', { alvo: `home_${motivoSemVitrine}`, detalhe: `origem=home;${String(vitrineRaw?._erro || '').slice(0, 100)}` });
  }, [motivoSemVitrine]); // eslint-disable-line react-hooks/exhaustive-deps
  // 3 lotes: mesma cidade > mesma UF > qualquer (ordem estável do retrato). Diz quando não achou na região.
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const pontua = (l) => !regiao ? 0 : (String(l.uf || '').toUpperCase() === regiao.uf ? (regiao.cidade && norm(l.cidade) === norm(regiao.cidade) ? 2 : 1) : 0);
  const lotesHero = vitrineTodos.map((l, i) => ({ l, i, p: pontua(l) })).sort((a, b) => b.p - a.p || a.i - b.i).slice(0, 3).map((x) => x.l);
  const lotesNaRegiao = regiao ? lotesHero.filter((l) => pontua(l) > 0).length : 0;
  const abrirLote = (l, pos) => {
    if (amostraUsado === 0) registrarEvento('onboarding_cta', { alvo: 'home_lote', detalhe: `origem=home;imovel=${l.id};pos=${pos};regiao=${pontua(l) > 0 ? 'sim' : 'nao'}` });
    nav(`/imovel/${l.id}`);
  };
  const quandoAula = (() => {
    if (!aulaProxima?.data_hora) return '';
    try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(aulaProxima.data_hora)); }
    catch { return ''; }
  })();

  // Assessorado sem caso aberto → o herói é o próximo passo da assessoria (só com a lista LIDA).
  const ETAPAS_FECHADAS = ['concluido', 'honorarios_pagos'];
  const assessoradoSemCaso = ehAssessorado && casosLidos && !casosErro
    && !meusCasos.some((c) => !ETAPAS_FECHADAS.includes(c.status_etapa));

  const aceitarParceria = async () => {
    if (!concordo || aceitando) return;
    setAceitando(true);
    try {
      const { data, error } = await supabase.rpc('aceitar_parceria', { p_versao: TERMO_PARCEIRO_VERSAO });
      if (!error) { setAceite(data || new Date().toISOString()); setShowTermo(false); window.dispatchEvent(new Event('tsn:parceiro-atualizado')); nav('/minha-rede'); }
      // 19/08: o ramo de erro não existia — o botão "Aceitar" simplesmente não fazia nada.
      else alert(`Não foi possível registrar o aceite: ${error.message}. Tente novamente.`);
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
    <div className="home-grid" style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px', display: 'grid', gridTemplateColumns: mostraConviteParceiro ? 'minmax(0,1fr) 320px' : 'minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
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
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Bem-vindo{nomePlanoSaudacao ? `, ${nomePlanoSaudacao}` : ''}</div>
          <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.15 }}>Olá, {primeiroNome}! 👋</div>
          {/* SELOS DE CAPACIDADE (25/10): o que a pessoa TEM, não só o role. */}
          {selos.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {selos.map((x) => (
                <span key={x.t} style={{ fontSize: 12, fontWeight: 800, background: 'white', color: '#084BA6', borderRadius: 20, padding: '4px 11px' }}>
                  {x.t}{x.d ? <span style={{ fontWeight: 600, color: '#475569' }}> · {x.d}</span> : null}
                </span>
              ))}
            </div>
          )}
          {/* Altura RESERVADA (11/09, achado do dono: "barra azul aparece cortada e em um
              instante fica normal" ao entrar na Home). A cota nasce sem valor e só chega
              depois de um fetch (lerCotas) — a cada MONTAGEM desta tela. Mantendo a MESMA caixa
              (com um esqueleto no lugar do texto) o banner já nasce na altura final.
              25/10: "lendo" e "não lido" deixaram de ser o mesmo texto — a falha agora é dita. */}
          <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 700, minWidth: 160, opacity: cotas === undefined ? 0.55 : 1, flexWrap: 'wrap' }}>
            <BarChart3 size={14} />
            {cotas === undefined
              ? 'Carregando cota…'
              : cotas === null
                ? 'Cota não lida agora: atualize a página em instantes'
                : (pagaImoveis || temVeic) && !equipeVeic
                  // Pagante: um balde por capacidade. "não lido" nunca vira 0.
                  ? [
                      ...(pagaImoveis ? [`Mercado ${fmtBalde(cotas.mercado)}`, `Documental ${fmtBalde(cotas.documental)}`] : []),
                      ...(!pagaImoveis && ehExplorador && restantes != null ? [`Imóveis grátis ${restantes} de ${limiteCota} ${janelaLabel(cotaMercado)}`] : []),
                      ...(temVeic ? [`Veículos ${fmtBalde(cotas.veiculo)}`] : []),
                    ].join(' · ')
                  : restantes != null
                    ? `${restantes} de ${limiteCota} análises disponíveis ${janelaLabel(cotaMercado)}`
                    : cotaMercado?.ilimitado
                      ? 'Análises ilimitadas'
                      : 'Sem cota de análise neste plano'}
          </div>
          {linhaVeic && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, opacity: 0.95 }}>🚗 {linhaVeic}</div>}
        </div>

        {/* Acesso a veículos ILEGÍVEL: estado explícito, nunca rebaixamento a "Explorador". */}
        {veicErro && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#9a3412' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 200 }}>Não conseguimos confirmar agora o seu acesso a <strong>Leilão de Veículos</strong>. Nada mudou no seu plano: é só a leitura que falhou.</span>
            <button onClick={() => setTentativaVeic((n) => n + 1)} style={{ padding: '6px 12px', background: '#9a3412', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Tentar de novo</button>
          </div>
        )}

        {/* HERÓI DA ASSESSORIA (25/10): assessorado sem caso aberto vê o próximo passo, não a grade. */}
        {assessoradoSemCaso && (
          <div style={{ background: 'white', border: '2px solid #bfdbfe', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 1 }}>Próximo passo da sua assessoria</div>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#111', margin: '6px 0 6px', lineHeight: 1.25 }}>Escolha o imóvel e abra o seu acompanhamento</div>
            <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6 }}>Você ainda não tem um acompanhamento aberto. Abra um para o imóvel que te interessa: a equipe valida a operação com você antes do lance.</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <button onClick={() => { registrarEvento('lp_cta', { alvo: 'home_assessoria_caso' }); nav('/caso'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                <Gavel size={15} /> Abrir acompanhamento
              </button>
              <button onClick={() => { registrarEvento('lp_cta', { alvo: 'home_assessoria_chamado' }); nav('/chamados'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 18px', background: '#eff6ff', color: '#084BA6', border: '1px solid #bfdbfe', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                <MessageSquare size={15} /> Falar com a equipe
              </button>
            </div>
          </div>
        )}
        {ehAssessorado && casosErro && (
          <div style={{ fontSize: 12.5, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '8px 12px' }}>
            Não foi possível carregar seus acompanhamentos agora (leitura falhou, nada foi apagado). Detalhe: {casosErro}
          </div>
        )}

        {/* HERÓI DO EXPLORADOR (25/10, arena passo 8): a 1ª tela leva ao 1º relatório — 3 lotes reais
            da vitrine do dia, na região do perfil quando dá. Esgotou a amostra → o herói vira o upgrade. */}
        {ehExplorador && cotas === undefined && (
          <div aria-hidden style={{ minHeight: 220, background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: 18 }} />
        )}
        {querVitrine && (
          <div style={{ background: 'white', border: '2px solid #bfdbfe', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 1 }}>
              {amostra && amostraUsado === 0 ? 'Comece por aqui' : 'Seu próximo relatório'}
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#111', margin: '6px 0 6px', lineHeight: 1.25 }}>
              {!amostra
                ? 'Escolha um imóvel para analisar'
                : amostraUsado === 0
                  ? `Seus ${amostraLimite} relatórios grátis: escolha um imóvel`
                  : amostraRestam > 0
                    ? `Você ainda tem ${amostraRestam} de ${amostraLimite} relatórios grátis: escolha o próximo imóvel`
                    : `Você tem ${creditoSaldo} ${creditoSaldo === 1 ? 'crédito' : 'créditos'}: escolha o próximo imóvel`}
            </div>
            <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6 }}>
              {amostra
                ? 'Escolha um imóvel real e veja em minutos quanto ele vale e até quanto dar de lance: é a forma mais rápida de aprender a ler um leilão.'
                : 'Não conseguimos ler agora quantos relatórios grátis você ainda tem; o número aparece aqui assim que a leitura voltar.'}
            </div>

            {vitrineRaw === undefined ? (
              <div aria-hidden style={{ minHeight: 150, background: '#f8fafc', borderRadius: 12, marginTop: 14 }} />
            ) : motivoSemVitrine ? (
              <div style={{ marginTop: 14, fontSize: 13, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 12px', lineHeight: 1.5 }}>
                {MOTIVO_TEXTO[motivoSemVitrine]} Você pode escolher qualquer imóvel na busca.
              </div>
            ) : (
              <>
                {regiao && (
                  <div style={{ marginTop: 12, fontSize: 12.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MapPin size={13} />
                    {lotesNaRegiao > 0
                      ? `Lotes em destaque perto de ${regiao.cidade || regiao.uf}${lotesNaRegiao < lotesHero.length ? ' e de outras regiões' : ''}`
                      : `Hoje não há lote em destaque em ${regiao.uf}; estes são de outras regiões`}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 10 }}>
                  {lotesHero.map((l, i) => (
                    <button key={l.id} onClick={() => abrirLote(l, i + 1)}
                      style={{ display: 'flex', flexDirection: 'column', padding: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', textAlign: 'left' }}>
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '16/10', background: '#f1f5f9' }}>
                        {l.foto && <img src={l.foto} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                        {Number(l.desconto_pct) > 0 && (
                          <span style={{ position: 'absolute', top: 8, right: 8, background: '#16a34a', color: 'white', fontWeight: 900, fontSize: 12, padding: '2px 7px', borderRadius: 7 }}>-{l.desconto_pct}%</span>
                        )}
                      </div>
                      <div style={{ padding: '9px 11px' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#111', textTransform: 'capitalize' }}>{l.tipo || 'Imóvel'}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{[l.cidade, l.uf].filter(Boolean).join(' / ')}</div>
                        {Number(l.lance_minimo) > 0 && <div style={{ fontSize: 14, fontWeight: 900, color: '#0D63DB', marginTop: 4 }}>Lance {brl(l.lance_minimo)}</div>}
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0d9488', marginTop: 4 }}>Analisar este imóvel →</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <button onClick={() => { if (amostraUsado === 0) registrarEvento('onboarding_cta', { alvo: 'home_buscar', detalhe: 'origem=home' }); nav('/buscar'); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                <Search size={14} /> Escolher outro imóvel
              </button>
              {/* Para quem quer APRENDER antes: a aula ao vivo (live_proxima) ou, sem aula marcada, o curso. */}
              {aulaResolvida && (
                <button onClick={() => {
                  if (amostraUsado === 0) registrarEvento('onboarding_cta', { alvo: aulaProxima?.slug ? 'home_aula' : 'home_curso', detalhe: 'origem=home' });
                  nav(aulaProxima?.slug ? `/live/${aulaProxima.slug}` : cursoBoasVindas ? `/membros/curso/${cursoBoasVindas.id}` : '/membros');
                }} style={{ background: 'none', border: 'none', padding: 0, color: '#475569', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
                  Prefere aprender antes?{' '}
                  <strong style={{ color: '#059669' }}>
                    {aulaProxima?.slug ? `Aula ao vivo${quandoAula ? ` ${quandoAula}` : ''}` : 'Aprenda a não perder dinheiro, com casos reais'} →
                  </strong>
                </button>
              )}
            </div>
          </div>
        )}
        {amostraEsgotada && (
          <div style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#084BA6 100%)', borderRadius: 18, padding: '22px 24px', color: 'white' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 1 }}>Seus relatórios grátis acabaram</div>
            <div style={{ fontSize: 20, fontWeight: 900, margin: '6px 0 6px', lineHeight: 1.25 }}>
              Investidor Pro{planos?.top2?.limite_analises ? `: ${planos.top2.limite_analises} relatórios por mês` : ''}
              {pro && planos?.top2?.limite_analises ? ` (cerca de ${brl(pro.preco / planos.top2.limite_analises)} cada)` : ''} + jurídico + leiloeiro
            </div>
            <div style={{ fontSize: 13.5, color: '#bfdbfe', lineHeight: 1.6 }}>
              Você já viu quanto vale. Antes do lance falta saber quem conduz o leilão e se a documentação esconde uma bomba.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 14 }}>
              <button onClick={() => { registrarEvento('lp_cta', { alvo: 'home_upgrade_pro' }); nav('/checkout?plano=top2'); }}
                style={{ padding: '12px 20px', background: 'white', color: '#084BA6', border: 'none', borderRadius: 10, fontWeight: 900, fontSize: 14, cursor: 'pointer' }}>
                Assinar Investidor Pro{pro ? ` por ${brl(pro.preco)}/mês` : ''} →
              </button>
              <button onClick={() => { registrarEvento('lp_cta', { alvo: 'home_upgrade_creditos' }); nav('/creditos'); }}
                style={{ background: 'none', border: 'none', padding: 0, color: '#bfdbfe', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>
                ou comprar relatórios avulsos
              </button>
            </div>
          </div>
        )}

        {/* VEÍCULOS e ESCADA DE PLANO (25/10) — cada capacidade com o seu cartão; o próximo degrau é
            o que falta a ESTA pessoa (veículos → Combo · Pro → Combo · Pro → Assessoria). */}
        {(temVeic && !equipeVeic) || ehPro ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {temVeic && !equipeVeic && (
              <Acao Icon={Car} titulo="Leilão de Veículos" desc="Busque carros e motos com o leiloeiro liberado e gere o relatório por IA antes do lance." cor="#0f766e" onClick={() => nav('/veiculos')} />
            )}
            {temVeic && !equipeVeic && (
              <Acao Icon={BarChart3} titulo="Relatórios de veículos" desc="Seus relatórios por IA de carros e motos." cor="#0f766e" onClick={() => nav('/analises?aba=veiculos')} />
            )}
            {ehExplorador && temVeic && (
              <Acao Icon={TrendingUp} titulo={`Combo: imóveis + veículos${combo ? ` · ${brl(combo.preco)}/mês` : ''}`}
                desc="Investidor Pro de imóveis junto com o seu Leilão de Veículos. Seu plano Veículos atual é encerrado automaticamente: uma cobrança só."
                cor="#7c3aed" onClick={() => { registrarEvento('lp_cta', { alvo: 'home_escada_veiculos_combo' }); nav(CHECKOUT_COMBO); }} />
            )}
            {ehPro && acessoVeic === false && (
              <Acao Icon={Car} titulo={`Combo: some veículos${effectiveRole === 'top2' && combo && pro && combo.preco > pro.preco ? ` por +${brl(combo.preco - pro.preco)}/mês` : combo ? ` · ${brl(combo.preco)}/mês` : ''}`}
                desc="Seu Pro atual é encerrado automaticamente: uma cobrança só. Leiloeiro, pátio e relatório por IA de cada carro."
                cor="#7c3aed" onClick={() => { registrarEvento('lp_cta', { alvo: 'home_escada_pro_combo' }); nav(CHECKOUT_COMBO); }} />
            )}
            {ehPro && (
              <Acao Icon={ShieldCheck} titulo="Assessoria: um analista valida antes do lance"
                desc={assessoria?.vinculado_arrematacao ? 'Na assessoria você paga só se arrematar.' : 'A equipe acompanha a operação com você, do edital ao pós-arremate.'}
                cor="#0D63DB" onClick={() => { registrarEvento('lp_cta', { alvo: 'home_escada_pro_assessoria' }); nav('/planos?plano=assessorado'); }} />
            )}
          </div>
        ) : null}

        {/* Ações rápidas — para o explorador ficam em "Mais opções" (o herói é o caminho; 8 cartões do
            mesmo peso competiam com ele). Para os demais, abertas como sempre. */}
        {ehExplorador && (
          <button onClick={() => setMaisOpcoes((x) => !x)}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '2px 0', color: '#475569', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
            {maisOpcoes ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Mais opções
          </button>
        )}
        {(!ehExplorador || maisOpcoes) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {/* "Rever vídeo de boas-vindas" — PRIMEIRO card (pedido do dono, 12/09: ficou
              discreto demais como link de texto). Achado real que motivou o link: Neuma ligou
              perguntando pelo vídeo — os 2 concluídos em 9s de diferença (cliques em sequência,
              não visualização), e o BoasVindasModal nunca mais reabre sozinho para quem já
              concluiu, por desenho (11/08). O vídeo continua em /membros/curso/:id; este card
              só torna isso achável sem precisar ligar. */}
          {cursoBoasVindas === undefined ? (
            // Esqueleto do MESMO tamanho do card real (mesma causa do "corte" da barra azul
            // acima: sem isso, o card nasce ausente e SURGE ~1s depois, empurrando os cards
            // abaixo — reflow visível toda vez que a Home monta).
            <div aria-hidden style={{ minHeight: 96, background: '#f8fafc', border: '1px solid #eef2f6', borderRadius: 14 }} />
          ) : cursoBoasVindas ? (
            <Acao Icon={PlayCircle} titulo="Rever vídeo de boas-vindas" desc="Assista de novo a introdução à plataforma, quando quiser." cor={LATAO} onClick={() => nav(`/membros/curso/${cursoBoasVindas.id}`)} />
          ) : null}
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
        )}

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
            <strong>Arremate com segurança.</strong> Cada imóvel tem relatório de viabilidade (e, no Investidor Pro, o jurídico) e, se quiser, você valida a operação com um analista antes do lance, para decidir com confiança.
          </div>
        </div>

        {/* CONVIDE UM AMIGO — para TODO cliente, seja parceiro ou não. Quando há aula marcada o
            convite é para ela (tem data e cartão de compartilhamento, então converte muito mais);
            sem aula no calendário, cai no link geral da plataforma. */}
        <ConvideAmigo codigo={refCodigo} aula={aulaProxima} carregando={!refCodigo || !aulaResolvida} />
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
            Convide investidores para a BidPro. <strong>Todos podem convidar e todos ganham</strong> — inclusive no plano gratuito. Suas indicações ficam vinculadas a você. Todo saque é feito para a sua empresa, contra a <strong>nota fiscal</strong> do valor sacado. A <strong>assinatura</strong> só entra em cena para <strong>sacar acima do teto mensal</strong>; o valor do teto aparece em <strong>Indicações</strong>.
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
                Declaro que li, compreendi e concordo com este Termo de Adesão, os Termos de Uso e a Política de Privacidade, e que vou indicar de acordo com as regras. {DECLARACAO_REPASSE}
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
