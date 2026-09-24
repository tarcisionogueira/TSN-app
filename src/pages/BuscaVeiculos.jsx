import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Filter, Loader2, MapPin, ExternalLink, X, Mail, Send } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { parseDataLocal } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';
import { lerSessao, gravarSessao, useRolagemDaLista } from '../utils/estadoLista';

// Proposta de compra direta ao leiloeiro (17/09, pedido do dono) — só para lote com resultado
// REAL apurado "sem lance" (21/09; antes era inferência por data — ver api/apurar-resultado-
// leilao-cron.js e o comentário de RESULTADO_BADGE acima). Restrito à equipe: espelha
// ROLES_PROPOSTA_VEICULO em api/propor-veiculo-leiloeiro.js — a tela só evita mostrar um botão
// que a API recusaria.
const ROLES_PROPOSTA_VEICULO = ['admin', 'analista', 'suporte'];

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const POR_PAGINA = 20;

// Mesma lição de `Busca.jsx` (imóveis): NUNCA `select('*')`. `raw` e `descricao` completa
// (sem truncar no banco) ficam de fora — pesam e não aparecem no card.
const COLUNAS = [
  'id', 'titulo', 'descricao', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'placa', 'km',
  'valor_minimo', 'valor_avaliacao', 'desconto_percentual', 'modalidade', 'cidade', 'estado', 'link_lote', 'fotos', 'data_leilao', 'leiloeiro',
  // Direto da API do leiloeiro (11/09) — ver supabase/migrations/veiculos_leilao_sinais_leiloeiro.sql
  'sinistro', 'is_sucata', 'financiavel', 'combustivel', 'cambio', 'cor', 'motor_alerta', 'ipva_situacao',
  // Categoria do veículo (13/09, pedido do dono) — ver supabase/migrations/veiculos_leilao_tipo_veiculo.sql
  'tipo_veiculo',
  // Valor FIPE de referência (20/09, pedido do dono) — ver supabase/migrations/veiculos_leilao_fipe.sql.
  // Só mostra quando fipe_status é 'ok'/'aproximado' (ver renderização do card); 'sem_match'/'erro'
  // não tem valor_fipe preenchido mesmo, então já ficam de fora sem precisar checar aqui.
  'valor_fipe', 'fipe_status',
  // Resultado REAL do leilão (21/09) — apurado por api/apurar-resultado-leilao-cron.js
  // revisitando a página de cada lote. Substitui a antiga inferência por data ("negativo").
  'resultado_leilao', 'valor_lance_vencedor',
].join(',');

// RESULTADO DO LEILÃO — mesmo par de opções/critério de Busca.jsx (imóveis), mesma apuração
// (api/apurar-resultado-leilao-cron.js processa os dois acervos no mesmo run). 'sem_lance'
// agrupa 'sem_lance' E 'indeterminado' (pedido do dono, 21/09: "coloque para parecer junto
// com sem lance") — nenhum dos dois tem sinal de venda; a distinção honesta fica só na tela do
// veículo, que reapura contra o leiloeiro ao abrir e resolve o indeterminado quando dá. Já
// 'nao_apurado' aqui é só NULL (nunca tentado).
const RESULTADO_OPTS = [
  ['vendido', 'Vendido', 'O leilão teve lance — o lote foi arrematado.'],
  ['sem_lance', 'Sem lance', 'O leilão encerrou sem sinal de venda — inclui os já confirmados "sem lance" e os "indeterminados" (tentamos, mas a página do leiloeiro não deu resposta clara). Oportunidade de propor compra direta.'],
  ['nao_apurado', 'Ainda não apurado', 'O leilão ainda não encerrou, ou encerrou e o cron do fim do dia ainda não chegou nele.'],
];

// "Tipo de veículo" (13/09, pedido do dono) — NÃO é o mesmo campo que `tipoMonta`
// (severidade de dano/sucata, coluna `sinistro`) nem `modalidade` (judicial/extrajudicial).
// Sem opção "não classificado" de propósito: ao contrário de `modalidade`, `tipo_veiculo`
// é inferência best-effort (igual `marca`) — muita coisa ainda fica NULL (marca+modelo sem
// nenhuma palavra de categoria reconhecível), e "Qualquer" já cobre esse caso sem precisar
// de uma opção própria para "não sei".
const TIPOS_VEICULO_LABEL = {
  carro: 'Carro', moto: 'Moto', caminhao: 'Caminhão', onibus: 'Ônibus',
  van_utilitario: 'Van/Utilitário', maquina: 'Máquina/Trator', reboque: 'Reboque', embarcacao: 'Embarcação',
};

// 'nao_identificado' é ESTADO, não ausência — mesmo princípio de classificarPatio() (a
// dúvida também aparece na lista, nunca vira um lote invisível).
const MODALIDADE_LABEL = { judicial: 'Judicial', extrajudicial: 'Extrajudicial', nao_identificado: 'Não identificado' };

// Opções de "tipo de monta" (11/09, filtro pedido pelo dono). As 4 classificações padrão do
// mercado segurador — mesmas que `SINISTRO_COR` já reconhece. "grande monta"/"perda total"
// não têm ocorrência no acervo ainda (só SODRE/SUPORTE rodaram), mas são categorias REAIS que
// o leiloeiro usa, não inventadas — ficam disponíveis desde já para quando aparecerem.
const TIPOS_MONTA = ['sem sinistro', 'pequena monta', 'média monta', 'grande monta', 'perda total'];
// "Não informado" (23/09): 8.307 dos ~8.800 veículos ativos vêm SEM classificação de monta do
// leiloeiro — sem esta opção, marcar "Sem sinistro" escondia quase todo o acervo.
const MONTA_NAO_INFORMADA = 'nao_informado';
const OPCOES_MONTA = [...TIPOS_MONTA.map(t => [t, t[0].toUpperCase() + t.slice(1)]), [MONTA_NAO_INFORMADA, 'Não informado']];

// Múltipla escolha num campo do tamanho de um <select> (23/09, pedido do dono: "permitir uma
// múltipla escolha nesse filtro"). Vazio = qualquer. Fecha ao clicar fora.
function MultiEscolha({ valores, opcoes, onChange }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const rotulo = !valores.length ? 'Qualquer'
    : valores.length === 1 ? (opcoes.find(([v]) => v === valores[0])?.[1] || valores[0])
    : `${valores.length} selecionados`;
  const alternar = (v) => onChange(valores.includes(v) ? valores.filter(x => x !== v) : [...valores, v]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setAberto(a => !a)} style={{ ...inp, textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rotulo}</span>
        <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6 }}>▾</span>
      </button>
      {aberto && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 20px rgba(15,23,42,.12)', padding: 6 }}>
          {opcoes.map(([v, l]) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
              <input type="checkbox" checked={valores.includes(v)} onChange={() => alternar(v)} /> {l}
            </label>
          ))}
          {valores.length > 0 && (
            <button type="button" onClick={() => onChange([])} style={{ marginTop: 4, width: '100%', background: 'none', border: 'none', color: '#0D63DB', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 6 }}>Limpar seleção</button>
          )}
        </div>
      )}
    </div>
  );
}

// PRAZO DO LEILÃO — mesma regra de src/pages/Busca.jsx (imóveis, pedido do dono 11/09):
// janelas CUMULATIVAS a partir de hoje, e 'sem_data' como opção EXPLÍCITA (não omissão) —
// leiloeiro que ainda não marcou a praça não pode sumir da lista por causa disso.
// 'negativo' (17/09) SAIU DAQUI em 21/09: era só INFERÊNCIA por data ("a data já passou e o
// veículo continua ativo" — nenhuma fonte informava o resultado de verdade). Virou o filtro
// "Resultado do leilão" abaixo, com apuração REAL (api/apurar-resultado-leilao-cron.js
// revisita a página de cada lote) — mesmo padrão de Busca.jsx (imóveis).
function calcularJanelaPrazo(opcao) {
  if (!opcao) return null;
  if (opcao === 'sem_data') return { tipo: 'sem_data' };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const meses = opcao === 'este_mes' ? 1 : opcao === 'proximo_mes' ? 2 : opcao === 'proximo_trimestre' ? 4 : null;
  if (!meses) return null;
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + meses, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { tipo: 'janela', de: iso(hoje), ate: iso(fim) };
}

const fmtBRL = (v) => (v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

function fmtDataLeilao(d) {
  if (!d) return 'A confirmar';
  const dt = parseDataLocal(d);
  if (!dt) return d;
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Mesmo estilo de contagem regressiva de `Busca.jsx` — reescrito aqui em vez de
// importado porque o de lá carrega premissas de modalidade de imóvel que não existem
// em veículo (venda_direta/venda_online).
// dias < 0 (17/09, copy corrigida 21/09): NÃO vira null — o leilão já passou, ponto; deixou de
// AFIRMAR "sem comprador" aqui porque agora existe sinal REAL pra isso (`v.resultado_leilao`,
// renderizado à parte no card) — esta função só descreve DATA, nunca resultado.
function contagemLeilao(d) {
  if (!d) return null;
  const dt = parseDataLocal(d);
  if (!dt) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const dias = Math.round((alvo - hoje) / 86400000);
  const data = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  if (dias < 0) return { dias, encerrado: true, texto: `Leilão encerrado · ${data}`, bg: '#f1f5f9', fg: '#475569' };
  const texto = dias === 0 ? `Encerra hoje · ${data}` : dias === 1 ? `Encerra amanhã · ${data}` : `Encerra em ${dias} dias · ${data}`;
  const cor = dias <= 3 ? { bg: '#fee2e2', fg: '#b91c1c' } : dias <= 10 ? { bg: '#fef3c7', fg: '#92400e' } : { bg: '#eff6ff', fg: '#084BA6' };
  return { dias, texto, ...cor };
}

// Badge de RESULTADO REAL (21/09) — distinto da contagem de data acima. Só aparece quando a
// apuração já rodou; ausente = "ainda não apurado" (nada exibido, não é "sem resultado").
// 'indeterminado' aparece no CARD com o nome honesto — o filtro "Sem lance" já o inclui junto
// (pedido do dono, 21/09), mas o rótulo individual não pode fingir confirmação que não existe.
const RESULTADO_BADGE = {
  vendido: { texto: 'Vendido', bg: '#dcfce7', fg: '#15803d' },
  sem_lance: { texto: 'Sem lance', bg: '#f3e8ff', fg: '#6d28d9' },
  indeterminado: { texto: 'Indeterminado', bg: '#f1f5f9', fg: '#64748b' },
};

// Desconto = quanto o lance mínimo está abaixo da avaliação do PRÓPRIO leiloeiro. Sem
// avaliação (comum quando a API não a traz), não há desconto para mostrar — melhor
// omitir do que inventar um número. Trava contra outlier (avaliação absurdamente baixa
// ou lance acima da avaliação) na mesma linha do que já existe para imóveis.
function desconto(v) {
  // Prefere a coluna gravada pelo scraper (11/09) — mesmo cálculo, só evita reprocessar em
  // todo render. Recalcula só para linha antiga que ainda não passou pela migração/backfill.
  if (v.desconto_percentual != null) return v.desconto_percentual;
  const min = Number(v.valor_minimo) || 0;
  const aval = Number(v.valor_avaliacao) || 0;
  if (!min || !aval || min >= aval) return null;
  const pct = Math.round((1 - min / aval) * 100);
  if (pct <= 0 || pct > 95) return null;
  return pct;
}

// Cores por severidade — "monta" é a classificação padrão do mercado segurador
// (pequena/média/grande monta, perda total). Vem DIRETO do leiloeiro (lot_sinister), não é
// inferência nossa.
const SINISTRO_COR = {
  'pequena monta': { bg: '#fef3c7', fg: '#92400e' },
  'média monta': { bg: '#fed7aa', fg: '#9a3412' },
  'grande monta': { bg: '#fecaca', fg: '#991b1b' },
  'perda total': { bg: '#fecaca', fg: '#991b1b' },
};
const corSinistro = (s) => SINISTRO_COR[String(s || '').toLowerCase()] || { bg: '#f1f5f9', fg: '#475569' };

function fotosArray(v) {
  const f = v?.fotos;
  if (Array.isArray(f)) return f.filter(Boolean);
  return [];
}

// Mesmo componente de `Busca.jsx`: só carrega a imagem quando entra na viewport, e
// avança para o próximo candidato se o primeiro link quebrar (hotlink do leiloeiro cai
// com frequência).
function LazyImage({ src, alt, style }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const cands = Array.isArray(src) ? src.filter(Boolean) : (src ? [src] : []);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [Array.isArray(src) ? src.join('|') : src]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '100px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const atual = cands[idx] || null;
  return (
    <div ref={ref} style={{ ...style, background: '#f1f5f9', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {visible && atual
        ? <img src={atual} alt={alt} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={() => setIdx(i => i + 1)} />
        : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#cbd5e1', width: '100%', height: '100%' }}>
            <Car size={28} strokeWidth={1.5} />
            <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600 }}>Sem foto</span>
          </div>
      }
    </div>
  );
}

const inp = { width: '100%', padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', color: '#111111', boxSizing: 'border-box' };
const lbl = { fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };

function filtrosVazios() {
  return {
    estado: '', cidade: '', tipoVeiculo: '', marca: '', modelo: '', anoMin: '', anoMax: '', valorMax: '',
    valorAvaliacaoMax: '', descontoMin: '', tipoMonta: [], modalidade: '', prazo: '', resultadoLeilao: '', ordenacao: 'atualizado_desc',
  };
}

export default function BuscaVeiculos() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { role } = useAuth();
  const podePropor = ROLES_PROPOSTA_VEICULO.includes(role);
  // Filtros e página sobrevivem a abrir um veículo e voltar (pedido do dono, 24/09) — por aba,
  // em sessionStorage (ver utils/estadoLista.js). Mescla com o vazio para chave nova não faltar.
  const [filtros, setFiltros] = useState(() => ({ ...filtrosVazios(), ...(lerSessao('veic_filtros', null) || {}) }));
  const [mostrarFiltros, setMostrarFiltros] = useState(!isMobile);
  const [resultados, setResultados] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(() => Math.max(1, Number(lerSessao('veic_pagina', 1)) || 1));
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  // Proposta de compra direta ao leiloeiro (17/09) — mesmo padrão de "Pedir ao leiloeiro"
  // (Analise.jsx): PREVIEW monta o rascunho editável (não manda nada); ENVIAR manda o texto
  // atual da caixa (editado ou não). `propondoVeiculo` guarda o veículo em edição; `null`
  // fecha o modal.
  const [propondoVeiculo, setPropondoVeiculo] = useState(null);
  const [propostaTexto, setPropostaTexto] = useState('');
  const [propostaInfo, setPropostaInfo] = useState(null); // { linkLote, contatoDisponivel } | null
  const [propostaCarregando, setPropostaCarregando] = useState(false);
  const [propostaEnviando, setPropostaEnviando] = useState(false);
  const [propostaMsg, setPropostaMsg] = useState(''); // { texto, tipo: 'success'|'error' } via string+cor abaixo
  const [propostaMsgTipo, setPropostaMsgTipo] = useState('error');

  const abrirProposta = async (v) => {
    setPropondoVeiculo(v);
    setPropostaTexto(''); setPropostaInfo(null); setPropostaMsg(''); setPropostaCarregando(true);
    try {
      const r = await apiCall('/api/propor-veiculo-leiloeiro', { method: 'POST', body: JSON.stringify({ veiculo_id: v.id, action: 'preview' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) { setPropostaMsgTipo('error'); setPropostaMsg(j?.error || 'Não foi possível preparar a proposta agora.'); return; }
      setPropostaTexto(j.texto || ''); setPropostaInfo({ linkLote: j.linkLote, contatoDisponivel: j.contatoDisponivel, redator: j.redator || null, textoPadrao: j.textoPadrao || '' });
    } catch {
      setPropostaMsgTipo('error'); setPropostaMsg('Não foi possível preparar a proposta agora.');
    } finally { setPropostaCarregando(false); }
  };

  const enviarProposta = async () => {
    if (!propondoVeiculo || propostaEnviando) return;
    setPropostaEnviando(true); setPropostaMsg('');
    try {
      const r = await apiCall('/api/propor-veiculo-leiloeiro', { method: 'POST', body: JSON.stringify({ veiculo_id: propondoVeiculo.id, action: 'enviar', texto: propostaTexto }) });
      const j = await r.json().catch(() => ({}));
      if (j?.semContato) { setPropostaInfo(i => ({ ...i, contatoDisponivel: false })); setPropostaMsgTipo('error'); setPropostaMsg('Este leiloeiro ainda não tem e-mail de contato cadastrado — copie o texto acima e envie manualmente.'); return; }
      if (!r.ok || j?.error) { setPropostaMsgTipo('error'); setPropostaMsg(j?.error || 'Não foi possível enviar a proposta agora.'); return; }
      setPropostaMsgTipo('success'); setPropostaMsg(`Proposta enviada ao leiloeiro (${j.destinatario}). A resposta cai direto no seu e-mail.`);
    } catch {
      setPropostaMsgTipo('error'); setPropostaMsg('Não foi possível enviar a proposta agora.');
    } finally { setPropostaEnviando(false); }
  };

  const fecharProposta = () => { setPropondoVeiculo(null); setPropostaTexto(''); setPropostaInfo(null); setPropostaMsg(''); };

  async function buscar(p, f) {
    setLoading(true); setErro('');
    try {
      let q = supabase.from('veiculos_leilao').select(COLUNAS, { count: 'estimated' })
        .eq('ativo', true)
        // Rede de segurança pública (11/09, pedido do dono): só bens já CONFIRMADOS em
        // pátio — nunca em posse do executado. `indefinido` é o default conservador de
        // `classificarPatio()` e não deve aparecer para o cliente.
        .eq('status_patio', 'confirmado');
      if (f.estado) q = q.eq('estado', f.estado);
      if (f.cidade.trim()) q = q.ilike('cidade', `%${f.cidade.trim()}%`);
      if (f.tipoVeiculo) q = q.eq('tipo_veiculo', f.tipoVeiculo);
      if (f.marca.trim()) q = q.ilike('marca', `%${f.marca.trim()}%`);
      // Nome/modelo: OR com o título — SUPORTE ainda não separa marca/modelo (~117 de 237
      // linhas sem `modelo`), e o nome do carro vem só dentro do título nesses casos. Buscar
      // só em `modelo` esconderia esse leiloeiro inteiro do filtro.
      if (f.modelo.trim()) { const t = f.modelo.trim(); q = q.or(`modelo.ilike.%${t}%,titulo.ilike.%${t}%`); }
      if (f.anoMin) q = q.gte('ano_fabricacao', Number(f.anoMin));
      if (f.anoMax) q = q.lte('ano_fabricacao', Number(f.anoMax));
      if (f.valorMax) q = q.lte('valor_minimo', Number(f.valorMax));
      if (f.valorAvaliacaoMax) q = q.lte('valor_avaliacao', Number(f.valorAvaliacaoMax));
      if (f.descontoMin) q = q.gte('desconto_percentual', Number(f.descontoMin));
      if (f.tipoMonta.length) {
        const montas = f.tipoMonta.filter(t => t !== MONTA_NAO_INFORMADA);
        const conds = [];
        if (montas.length) conds.push(`sinistro.in.(${montas.map(t => `"${t}"`).join(',')})`);
        if (f.tipoMonta.includes(MONTA_NAO_INFORMADA)) conds.push('sinistro.is.null');
        q = q.or(conds.join(','));
      }
      if (f.modalidade) q = q.eq('modalidade', f.modalidade);
      const janelaPrazo = calcularJanelaPrazo(f.prazo);
      if (janelaPrazo?.tipo === 'sem_data') q = q.is('data_leilao', null);
      else if (janelaPrazo?.tipo === 'janela') q = q.gte('data_leilao', janelaPrazo.de).lte('data_leilao', janelaPrazo.ate);
      // RESULTADO DO LEILÃO (21/09) — mesma régua de Busca.jsx (imóveis): 'sem_lance' agrupa
      // 'sem_lance' E 'indeterminado' (nenhum tem sinal de venda); 'nao_apurado' é só NULL.
      if (f.resultadoLeilao === 'sem_lance') q = q.or('resultado_leilao.eq.sem_lance,resultado_leilao.eq.indeterminado');
      else if (f.resultadoLeilao === 'nao_apurado') q = q.is('resultado_leilao', null);
      else if (f.resultadoLeilao) q = q.eq('resultado_leilao', f.resultadoLeilao);
      const [coluna, dir] = f.ordenacao === 'valor_asc' ? ['valor_minimo', true]
        : f.ordenacao === 'valor_desc' ? ['valor_minimo', false]
        : f.ordenacao === 'ano_desc' ? ['ano_fabricacao', false]
        : f.ordenacao === 'desconto_desc' ? ['desconto_percentual', false]
        : ['atualizado_em', false];
      q = q.order(coluna, { ascending: dir, nullsFirst: false });
      const de = (p - 1) * POR_PAGINA;
      const { data, error, count } = await q.range(de, de + POR_PAGINA - 1);
      if (error) { setErro('Não foi possível carregar os veículos agora. Tente de novo em instantes.'); setResultados([]); setTotal(0); return; }
      setResultados(data || []); setTotal(count || 0);
    } catch {
      setErro('Não foi possível carregar os veículos agora. Tente de novo em instantes.');
    } finally { setLoading(false); }
  }

  // Carga inicial na página LEMBRADA (voltar do detalhe cai onde estava, não na página 1).
  useEffect(() => { buscar(pagina, filtros); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { gravarSessao('veic_filtros', filtros); }, [filtros]);
  useEffect(() => { gravarSessao('veic_pagina', pagina); }, [pagina]);
  useRolagemDaLista('veiculos', !loading && resultados.length > 0);

  // Busca reativa (11/09, pedido do dono: "retire o botão buscar, deixe interativo... como é
  // o dos imóveis") — mesmo padrão de debounce de 600ms de Busca.jsx. `primeiraRef` evita
  // duplicar a carga inicial (o efeito acima já busca uma vez no mount).
  const primeiraRef = useRef(true);
  const buscarDebounceRef = useRef(null);
  useEffect(() => {
    if (primeiraRef.current) { primeiraRef.current = false; return; }
    clearTimeout(buscarDebounceRef.current);
    buscarDebounceRef.current = setTimeout(() => { setPagina(1); buscar(1, filtros); }, 600);
    return () => clearTimeout(buscarDebounceRef.current);
  }, [filtros]); // eslint-disable-line react-hooks/exhaustive-deps

  const limparFiltros = () => { const f = filtrosVazios(); setFiltros(f); setPagina(1); buscar(1, f); };
  const irPara = (p) => { setPagina(p); buscar(p, filtros); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '12px' : '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Car size={22} color="#0D63DB" />
            <h1 style={{ fontSize: 20, fontWeight: 900, color: '#111111', margin: 0 }}>Leilão de Veículos</h1>
            <span style={{ fontSize: 10, fontWeight: 800, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 8 }}>PILOTO</span>
          </div>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '4px 0 0' }}>
            Só veículos já recolhidos ao pátio do leiloeiro — nunca em posse do executado. Fonte(s) de acesso gratuito, em expansão.
          </p>
        </div>
        <button onClick={() => setMostrarFiltros(v => !v)}
          style={{ display: isMobile ? 'flex' : 'none', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
          <Filter size={14} /> Filtros
        </button>
      </div>

      {mostrarFiltros && (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 14, display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={lbl}>Estado</label>
            <select style={inp} value={filtros.estado} onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))}>
              <option value="">Todos</option>
              {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Cidade</label>
            <input style={inp} placeholder="Ex.: Campinas" value={filtros.cidade} onChange={e => setFiltros(f => ({ ...f, cidade: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Tipo de veículo</label>
            <select style={inp} value={filtros.tipoVeiculo} onChange={e => setFiltros(f => ({ ...f, tipoVeiculo: e.target.value }))}>
              <option value="">Qualquer</option>
              {Object.entries(TIPOS_VEICULO_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Marca</label>
            <input style={inp} placeholder="Ex.: Fiat" value={filtros.marca} onChange={e => setFiltros(f => ({ ...f, marca: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Modelo</label>
            <input style={inp} placeholder="Ex.: Uno" value={filtros.modelo} onChange={e => setFiltros(f => ({ ...f, modelo: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Ano de</label>
            <input style={inp} type="number" placeholder="2010" value={filtros.anoMin} onChange={e => setFiltros(f => ({ ...f, anoMin: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Ano até</label>
            <input style={inp} type="number" placeholder="2024" value={filtros.anoMax} onChange={e => setFiltros(f => ({ ...f, anoMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Lance máx. (R$)</label>
            <input style={inp} type="number" placeholder="50000" value={filtros.valorMax} onChange={e => setFiltros(f => ({ ...f, valorMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Avaliação máx. (R$)</label>
            <input style={inp} type="number" placeholder="80000" value={filtros.valorAvaliacaoMax} onChange={e => setFiltros(f => ({ ...f, valorAvaliacaoMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Desconto mín.</label>
            <select style={inp} value={filtros.descontoMin} onChange={e => setFiltros(f => ({ ...f, descontoMin: e.target.value }))}>
              <option value="">Qualquer</option>
              <option value="20">20% ou mais</option>
              <option value="40">40% ou mais</option>
              <option value="60">60% ou mais</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Tipo de monta</label>
            <MultiEscolha valores={filtros.tipoMonta} opcoes={OPCOES_MONTA} onChange={v => setFiltros(f => ({ ...f, tipoMonta: v }))} />
          </div>
          <div>
            <label style={lbl}>Modalidade</label>
            <select style={inp} value={filtros.modalidade} onChange={e => setFiltros(f => ({ ...f, modalidade: e.target.value }))}>
              <option value="">Qualquer</option>
              <option value="judicial">Judicial</option>
              <option value="extrajudicial">Extrajudicial</option>
              <option value="nao_identificado">Não identificado</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Prazo do leilão</label>
            <select style={inp} value={filtros.prazo} onChange={e => setFiltros(f => ({ ...f, prazo: e.target.value }))}>
              <option value="">Qualquer</option>
              <option value="este_mes">Este mês</option>
              <option value="proximo_mes">Próximo mês</option>
              <option value="proximo_trimestre">Próximo trimestre</option>
              <option value="sem_data">Sem data definida</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Resultado do leilão</label>
            <select style={inp} value={filtros.resultadoLeilao} onChange={e => setFiltros(f => ({ ...f, resultadoLeilao: e.target.value }))}>
              <option value="">Qualquer</option>
              {RESULTADO_OPTS.map(([val, label, desc]) => <option key={val} value={val} title={desc}>{label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Ordenar por</label>
            <select style={inp} value={filtros.ordenacao} onChange={e => setFiltros(f => ({ ...f, ordenacao: e.target.value }))}>
              <option value="atualizado_desc">Mais recentes</option>
              <option value="valor_asc">Menor lance</option>
              <option value="valor_desc">Maior lance</option>
              <option value="ano_desc">Ano (mais novo)</option>
              <option value="desconto_desc">Maior desconto</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={limparFiltros} title="Limpar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#64748b', fontSize: 12.5, fontWeight: 700 }}>
              <X size={14} /> Limpar
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '60px 0', color: '#64748b' }}>
          <Loader2 size={18} className="animate-spin" /> Carregando veículos…
        </div>
      )}

      {!loading && erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', color: '#b91c1c', fontSize: 13 }}>{erro}</div>
      )}

      {!loading && !erro && resultados.length === 0 && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: '50px 20px', textAlign: 'center', color: '#64748b' }}>
          <Car size={32} color="#cbd5e1" style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 700, color: '#111111', marginBottom: 4 }}>Nenhum veículo encontrado</div>
          <div style={{ fontSize: 12.5 }}>Ajuste os filtros ou volte mais tarde — o piloto ainda está em expansão para novas fontes.</div>
        </div>
      )}

      {!loading && !erro && resultados.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 12 }}>
          {resultados.map(v => {
            const desc = desconto(v);
            const fotos = fotosArray(v);
            const cont = contagemLeilao(v.data_leilao);
            const anoLabel = [v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/');
            return (
              <div key={v.id}
                style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onClick={e => { if (e.target.closest('a,button')) return; nav(`/admin/veiculos-leilao/${v.id}`); }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                <div style={{ width: '100%', height: isMobile ? 180 : 150, position: 'relative' }}>
                  <LazyImage src={fotos} alt={v.titulo} style={{ width: '100%', height: '100%' }} />
                  {desc != null && (
                    <div style={{ position: 'absolute', top: 8, right: 8, background: desc >= 40 ? '#16a34a' : desc >= 20 ? '#d97706' : '#dc2626', color: 'white', fontWeight: 900, fontSize: 13, padding: '3px 8px', borderRadius: 8 }}>
                      -{desc}%
                    </div>
                  )}
                  {v.leiloeiro && (
                    <div title={`Leiloeiro: ${v.leiloeiro}`} style={{ position: 'absolute', bottom: 8, left: 8, maxWidth: 'calc(100% - 16px)', background: 'rgba(15,23,42,0.82)', color: 'white', fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🔨 {v.leiloeiro}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontWeight: 700, color: '#111111', fontSize: isMobile ? 14 : 12, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {[v.marca, v.modelo].filter(Boolean).join(' ') || v.titulo || 'Veículo'}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {anoLabel && <span>{anoLabel}</span>}
                    {v.km != null && <span>· {Number(v.km).toLocaleString('pt-BR')} km</span>}
                    {v.placa && <span>· {v.placa}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    <MapPin size={9} style={{ flexShrink: 0 }} />{[v.cidade, v.estado].filter(Boolean).join(', ') || '—'}
                  </div>
                  {/* Sinal do próprio leiloeiro (11/09) — sinistro, sucata, financiamento e
                      alerta de motor. Nunca inventado: o que ele não informa fica de fora. */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    {v.modalidade && v.modalidade !== 'nao_identificado' && (
                      <span title="Modalidade da venda, informada pelo leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: v.modalidade === 'judicial' ? '#ede9fe' : '#e0f2fe', color: v.modalidade === 'judicial' ? '#6d28d9' : '#075985', padding: '1px 6px', borderRadius: 8 }}>{MODALIDADE_LABEL[v.modalidade]}</span>
                    )}
                    {v.sinistro && (() => { const c = corSinistro(v.sinistro); return (
                      <span title="Classificação do sinistro, informada pelo leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: c.bg, color: c.fg, padding: '1px 6px', borderRadius: 8, textTransform: 'capitalize' }}>{v.sinistro}</span>
                    ); })()}
                    {v.is_sucata && (
                      <span title="Vendido sem ATPV-E — só certificado de baixa; a transferência não é a padrão" style={{ fontSize: 9, fontWeight: 800, background: '#fecaca', color: '#991b1b', padding: '1px 6px', borderRadius: 8 }}>⚠️ Sucata</span>
                    )}
                    {v.motor_alerta && (
                      <span title="Menção de dano no motor na descrição do leiloeiro" style={{ fontSize: 9, fontWeight: 800, background: '#fecaca', color: '#991b1b', padding: '1px 6px', borderRadius: 8 }}>⚠️ Motor</span>
                    )}
                    {v.financiavel === false && (
                      <span title="Não financiável — só à vista, conforme o leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 8 }}>À vista</span>
                    )}
                    {v.financiavel === true && (
                      <span title="Aceita financiamento, conforme o leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 8 }}>💳 Financiável</span>
                    )}
                    {v.ipva_situacao && (
                      <span style={{ fontSize: 9, color: '#94a3b8' }}>IPVA {v.ipva_situacao.toLowerCase()}</span>
                    )}
                  </div>
                  {(v.cambio || v.combustivel || v.cor) && (
                    <div style={{ fontSize: 9.5, color: '#94a3b8' }}>
                      {[v.cambio, v.combustivel, v.cor].filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join(' · ')}
                    </div>
                  )}
                  {v.descricao && (
                    <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {v.descricao}
                    </div>
                  )}
                  <div style={{ marginTop: 2 }}>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Lance Mín.</div>
                    <div style={{ fontWeight: 900, color: '#111111', fontSize: isMobile ? 18 : 15 }}>{fmtBRL(v.valor_minimo)}</div>
                    {v.valor_avaliacao > 0 && <div style={{ fontSize: 10, color: '#64748b' }}>Aval. {fmtBRL(v.valor_avaliacao)}</div>}
                    {v.valor_fipe > 0 && (v.fipe_status === 'ok' || v.fipe_status === 'aproximado') && (
                      <div style={{ fontSize: 10, color: '#0369a1' }} title={v.fipe_status === 'aproximado' ? 'Valor aproximado — mais de uma versão do modelo bateu com o ano informado' : 'Valor de referência da tabela FIPE'}>
                        FIPE {v.fipe_status === 'aproximado' ? '≈ ' : ''}{fmtBRL(v.valor_fipe)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                    {/* Resultado REAL (21/09) — quando já apurado, é o sinal que importa;
                        a contagem de data abaixo é só complemento, nunca contradiz este. */}
                    {v.resultado_leilao && RESULTADO_BADGE[v.resultado_leilao] && (() => { const rb = RESULTADO_BADGE[v.resultado_leilao]; return (
                      <span title={v.resultado_leilao === 'sem_lance' ? 'Apurado na página do leiloeiro — encerrou sem lance, candidato a proposta de venda direta' : 'Apurado na página do leiloeiro — o lote foi arrematado'} style={{ fontSize: 9, fontWeight: 800, background: rb.bg, color: rb.fg, padding: '1px 6px', borderRadius: 8 }}>{rb.texto}</span>
                    ); })()}
                    {cont
                      ? <span title="Data do leilão" style={{ fontSize: 9, fontWeight: 800, background: cont.bg, color: cont.fg, padding: '1px 6px', borderRadius: 8 }}>🗓 {cont.texto}</span>
                      : <span style={{ fontSize: 9, color: '#94a3b8' }}>🗓 {fmtDataLeilao(v.data_leilao)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
                  <button onClick={e => { e.stopPropagation(); if (v.link_lote) window.open(v.link_lote, '_blank', 'noopener'); }} disabled={!v.link_lote}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 4px', background: v.link_lote ? '#0D63DB' : '#e2e8f0', color: v.link_lote ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: v.link_lote ? 'pointer' : 'default' }}>
                    Ver no leiloeiro <ExternalLink size={12} />
                  </button>
                  {/* Gate de "Propor" trocado de inferência por data para resultado REAL
                      apurado (21/09) — evita propor compra num lote que na verdade vendeu. */}
                  {podePropor && v.resultado_leilao === 'sem_lance' && (
                    <button onClick={e => { e.stopPropagation(); abrirProposta(v); }} title="Propor compra direta ao leiloeiro — leilão já ocorreu sem comprador"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px', background: '#6d28d9', color: 'white', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      <Mail size={12} /> Propor
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && totalPaginas > 1 && (
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '12px 18px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <button onClick={() => irPara(Math.max(1, pagina - 1))} disabled={pagina === 1}
            style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: pagina === 1 ? 'not-allowed' : 'pointer', background: pagina === 1 ? '#f8fafc' : 'white', color: pagina === 1 ? '#cbd5e1' : '#334155' }}>
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Página {pagina} de {totalPaginas}</span>
          <button onClick={() => irPara(Math.min(totalPaginas, pagina + 1))} disabled={pagina === totalPaginas}
            style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: pagina === totalPaginas ? 'not-allowed' : 'pointer', background: pagina === totalPaginas ? '#f8fafc' : 'white', color: pagina === totalPaginas ? '#cbd5e1' : '#334155' }}>
            Próxima →
          </button>
        </div>
      )}

      <button onClick={() => nav('/admin?aba=Veiculos')} style={{ alignSelf: 'center', marginTop: 4, background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
        ← Voltar para Veículos
      </button>

      {propondoVeiculo && (
        <div onClick={fecharProposta} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Mail size={17} color="#6d28d9" />
                <h2 style={{ fontSize: 15, fontWeight: 900, color: '#111111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Propor compra direta</h2>
              </div>
              <button onClick={fecharProposta} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 14px' }}>
              {[propondoVeiculo.marca, propondoVeiculo.modelo, propondoVeiculo.ano_fabricacao].filter(Boolean).join(' ') || propondoVeiculo.titulo} — leilão já ocorrido, sem sinal de comprador.
            </p>

            {propostaCarregando ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: '#64748b', fontSize: 13 }}>
                <Loader2 size={16} className="animate-spin" /> Preparando rascunho…
              </div>
            ) : (
              <>
                {propostaInfo?.contatoDisponivel === false && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: '#92400e', marginBottom: 10 }}>
                    Este leiloeiro ainda não tem e-mail de contato cadastrado. Copie o texto abaixo e envie manualmente
                    {propostaInfo.linkLote ? <> (a página do lote fica <a href={propostaInfo.linkLote} target="_blank" rel="noopener noreferrer" style={{ color: '#92400e', fontWeight: 700 }}>aqui</a>)</> : null}.
                  </div>
                )}
                {propostaInfo?.redator && (
                  <div style={{ fontSize: 11.5, marginBottom: 6, color: propostaInfo.redator.usado ? '#15803d' : '#92400e' }}>
                    {propostaInfo.redator.usado
                      ? `✍️ Rascunho no seu estilo, aprendido dos seus ${propostaInfo.redator.exemplos} último(s) e-mail(s) a leiloeiros — revise antes de enviar.`
                      : `Texto padrão (o redator não usou: ${propostaInfo.redator.motivo}).`}
                    {propostaInfo.redator.usado && propostaInfo.textoPadrao && (
                      <button type="button" onClick={() => { setPropostaTexto(propostaInfo.textoPadrao); setPropostaInfo(i => ({ ...i, redator: { ...i.redator, usado: false, motivo: 'você voltou ao texto padrão' } })); }}
                        style={{ marginLeft: 8, background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, cursor: 'pointer', fontSize: 11.5 }}>usar texto padrão</button>
                    )}
                  </div>
                )}
                <textarea value={propostaTexto} onChange={e => setPropostaTexto(e.target.value)} rows={10}
                  style={{ width: '100%', padding: 10, border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', color: '#111111', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }} />
                {propostaMsg && (
                  <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: propostaMsgTipo === 'success' ? '#15803d' : '#b91c1c' }}>{propostaMsg}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={fecharProposta} style={{ padding: '9px 16px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>
                    {propostaMsgTipo === 'success' ? 'Fechar' : 'Cancelar'}
                  </button>
                  {propostaMsgTipo !== 'success' && (
                    <button onClick={enviarProposta} disabled={propostaEnviando || !propostaTexto.trim()}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px', background: propostaEnviando ? '#c4b5fd' : '#6d28d9', color: 'white', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: propostaEnviando ? 'default' : 'pointer' }}>
                      {propostaEnviando ? <><Loader2 size={14} className="animate-spin" /> Enviando…</> : <><Send size={13} /> Enviar proposta</>}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
