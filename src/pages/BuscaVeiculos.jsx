import React, { useEffect, useRef, useState } from 'react';
import { ORIGEM_VENDA, ORIGENS_EXTRAJUDICIAIS } from '../utils/origemVeiculo';
import { useNavigate } from 'react-router-dom';
import { Car, Filter, Loader2, MapPin, X } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { parseDataLocal } from '../utils/format';
import { useIsMobile } from '../utils/useIsMobile';
import { lerSessao, gravarSessao, useRolagemDaLista } from '../utils/estadoLista';

// Card da busca SÓ mostra o veículo e leva à página dele (30/09, dono): FIPE sob demanda, link do
// leiloeiro e proposta de compra direta ficam em VeiculoDetalhe (components/PropostaVeiculoModal).

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const POR_PAGINA = 20;

// Mesma lição de `Busca.jsx` (imóveis): NUNCA `select('*')`. `raw` e `descricao` completa
// (sem truncar no banco) ficam de fora — pesam e não aparecem no card.
const COLUNAS = [
  'id', 'titulo', 'descricao', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'placa', 'km',
  'valor_minimo', 'valor_avaliacao', 'desconto_percentual', 'modalidade', 'origem_venda', 'cidade', 'estado', 'fotos', 'data_leilao', 'leiloeiro',
  // Direto da API do leiloeiro (11/09) — ver supabase/migrations/veiculos_leilao_sinais_leiloeiro.sql
  'sinistro', 'is_sucata', 'financiavel', 'combustivel', 'cambio', 'cor', 'motor_alerta', 'ipva_situacao',
  // Categoria do veículo (13/09, pedido do dono) — ver supabase/migrations/veiculos_leilao_tipo_veiculo.sql
  'tipo_veiculo',
  // Resultado REAL do leilão (21/09) — apurado por api/apurar-resultado-leilao-cron.js
  // revisitando a página de cada lote. Substitui a antiga inferência por data ("negativo").
  'resultado_leilao', 'valor_lance_vencedor', 'teve_lance',
  // Motor declarado pelo leiloeiro (29/09) — ver supabase/migrations/20260929_veiculo_motor_status.sql
  'motor_status',
  // Pátio (29/09): nome do pátio quando o leiloeiro tem vários na mesma cidade ("Guarulhos III").
  'patio',
].join(',');

// RESULTADO DO LEILÃO — mesmo par de opções/critério de Busca.jsx (imóveis), mesma apuração
// (api/apurar-resultado-leilao-cron.js processa os dois acervos no mesmo run). 'sem_lance'
// agrupa 'sem_lance' E 'indeterminado' (pedido do dono, 21/09: "coloque para parecer junto
// com sem lance") — nenhum dos dois tem sinal de venda; a distinção honesta fica só na tela do
// veículo, que reapura contra o leiloeiro ao abrir e resolve o indeterminado quando dá. Já
// 'nao_apurado' aqui é só NULL (nunca tentado).
// MOTOR (29/09, pedido do dono): o que o LEILOEIRO declarou — "motor: funcionando" no bloco de
// vistoria, "motor: danificado", "veículo não funciona". Só ~7% dos lotes dizem alguma coisa
// (LJUD nunca), então "Não informado" é opção de primeira classe e o padrão continua "Qualquer":
// escolher "Funcionando" esconde os 93% desconhecidos, e o rótulo deixa claro que é declaração
// do edital, não garantia nossa.
const MOTOR_OPTS = [
  ['funciona', 'Funcionando (declarado)', 'O leiloeiro declarou o motor funcionando. É informação do edital, não garantia.'],
  ['nao_funciona', 'Não funciona / avariado', 'O leiloeiro declarou motor avariado, danificado, sem funcionar ou sem motor.'],
  ['nao_informado', 'Não informado', 'O leiloeiro não diz nada sobre o motor — a maioria dos lotes.'],
];

const RESULTADO_OPTS = [
  ['vendido', 'Com lance', 'O leilão recebeu lance — arrematado, ou lance abaixo da reserva aguardando o comitente.'],
  ['sem_lance', 'Sem lance', 'Confirmado na página do leiloeiro: o leilão encerrou sem nenhum lance. Oportunidade de propor compra direta.'],
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

// Opções de "tipo de monta" (11/09, filtro pedido pelo dono). As 4 classificações padrão do
// mercado segurador — mesmas que `SINISTRO_COR` já reconhece. "grande monta"/"perda total"
// não têm ocorrência no acervo ainda (só SODRE/SUPORTE rodaram), mas são categorias REAIS que
// o leiloeiro usa, não inventadas — ficam disponíveis desde já para quando aparecerem.
// Avaliação/desconto (24/09): só ~2% dos lotes de veículo trazem avaliação do leiloeiro — o
// filtro é honesto (não inventa valor), mas precisa DIZER que deixa de fora quem não informa,
// senão a lista curta parece "não há oportunidade".
const AVISO_SEM_AVALIACAO = 'Poucos leiloeiros de veículos informam avaliação — este filtro mostra só os lotes que informam.';
const avisoCobertura = { display: 'block', marginTop: 4, fontSize: 11, color: '#64748b', lineHeight: 1.3 };

const TIPOS_MONTA = ['sem sinistro', 'pequena monta', 'média monta', 'grande monta', 'perda total'];
// "Não informado" (23/09): 8.307 dos ~8.800 veículos ativos vêm SEM classificação de monta do
// leiloeiro — sem esta opção, marcar "Sem sinistro" escondia quase todo o acervo.
const MONTA_NAO_INFORMADA = 'nao_informado';
const OPCOES_MONTA = [...TIPOS_MONTA.map(t => [t, t[0].toUpperCase() + t.slice(1)]), [MONTA_NAO_INFORMADA, 'Não informado']];

// Múltipla escolha num campo do tamanho de um <select> (23/09, pedido do dono: "permitir uma
// múltipla escolha nesse filtro"). Vazio = qualquer. Fecha ao clicar fora.
const chaveBusca = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function MultiEscolha({ valores, opcoes, onChange, busca = false, vazio = 'Qualquer' }) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const rotulo = !valores.length ? vazio
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
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: busca ? 'auto' : 0, minWidth: '100%', width: busca ? 260 : undefined, marginTop: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 20px rgba(15,23,42,.12)', padding: 6, maxHeight: 320, overflowY: 'auto' }}>
          {busca && (
            <input autoFocus placeholder="Buscar…" value={termo} onChange={e => setTermo(e.target.value)}
              style={{ ...inp, marginBottom: 4, position: 'sticky', top: 0 }} />
          )}
          {valores.length > 0 && (
            <button type="button" onClick={() => onChange([])} style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 8px' }}>Limpar seleção</button>
          )}
          {busca && !opcoes.length && <div style={{ padding: '6px 8px', fontSize: 12, color: '#94a3b8' }}>Carregando…</div>}
          {opcoes.filter(([v, l]) => !busca || !termo || valores.includes(v) || chaveBusca(l).includes(chaveBusca(termo))).map(([v, l]) => (
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
// Só DUAS saídas para o cliente (dono, 24/09): "Com lance" ou "Sem lance". 'indeterminado' continua
// no banco (a reapuração usa), mas não aparece: sem sinal de lance, é tratado como sem lance.
// `teve_lance` (24/09): lance registrado na fonte (SUPERBID: preço acima do mínimo) — o Ka e o Compass
// do dono tinham lance abaixo da reserva e apareciam como "indeterminado" dentro de "Sem lance".
const RESULTADO_BADGE = {
  vendido: { texto: 'Com lance', bg: '#dcfce7', fg: '#15803d' },
  sem_lance: { texto: 'Sem lance', bg: '#f3e8ff', fg: '#6d28d9' },
};
// 24/09 (tarde, Montana SUPERBID do dono): 'indeterminado' NÃO é sem lance — na SUPERBID quase
// sempre é lance abaixo da reserva (condicional). Sem confirmação não há selo nem filtro: fica
// como "ainda não apurado" até a apuração decidir. Continuam só duas saídas visíveis.
// só vale depois de apurado: leilão ainda aberto com lance não tem RESULTADO
const chaveResultado = (v) => (v.teve_lance && v.resultado_leilao ? 'vendido' : v.resultado_leilao);

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
    estado: [], cidade: [], tipoVeiculo: '', marca: '', modelo: '', anoMin: '', anoMax: '', valorMax: '',
    valorAvaliacaoMax: '', descontoMin: '', tipoMonta: [], origem: '', prazo: '', resultadoLeilao: '', motor: '', ordenacao: 'atualizado_desc',
  };
}

// Filtros da busca como FUNÇÃO (24/09): a mesma régua serve à busca e ao diagnóstico do "nenhum
// veículo" — `ign` tira filtros para medir quanto cada um corta. Uma cópia só da regra.
function aplicarFiltros(q, f, ign = new Set()) {
  // ESTADO e CIDADE DO PÁTIO em múltipla escolha (29/09, pedido do dono). A cidade vem normalizada
  // pelo nome oficial do IBGE (trigger trg_zz_veiculo_local) e o valor é "Cidade|UF" — há
  // municípios homônimos em estados diferentes, então o par é comparado junto.
  if (!ign.has('estado') && f.estado.length) q = q.in('estado', f.estado);
  if (!ign.has('cidade') && f.cidade.length) {
    const pares = f.cidade.map((c) => { const [nome, uf] = String(c).split('|'); return `and(cidade.eq."${nome.replace(/"/g, '')}",estado.eq.${uf})`; });
    q = q.or(pares.join(','));
  }
  if (!ign.has('tipoVeiculo') && f.tipoVeiculo) q = q.eq('tipo_veiculo', f.tipoVeiculo);
  // Marca: OR com o título (24/09) — 30% dos lotes vêm sem `marca` (SODRE/SUPERBID trazem só
  // "HONDA CG 160..." no título) e o ilike só na coluna os escondia, como o `modelo` acima.
  if (!ign.has('marca') && f.marca.trim()) { const t = f.marca.trim(); q = q.or(`marca.ilike.%${t}%,titulo.ilike.%${t}%`); }
  // Nome/modelo: OR com o título — SUPORTE ainda não separa marca/modelo (~117 de 237
  // linhas sem `modelo`), e o nome do carro vem só dentro do título nesses casos. Buscar
  // só em `modelo` esconderia esse leiloeiro inteiro do filtro.
  if (!ign.has('modelo') && f.modelo.trim()) { const t = f.modelo.trim(); q = q.or(`modelo.ilike.%${t}%,titulo.ilike.%${t}%`); }
  if (!ign.has('anoMin') && f.anoMin) q = q.gte('ano_fabricacao', Number(f.anoMin));
  if (!ign.has('anoMax') && f.anoMax) q = q.lte('ano_fabricacao', Number(f.anoMax));
  if (!ign.has('valorMax') && f.valorMax) q = q.lte('valor_minimo', Number(f.valorMax));
  if (!ign.has('valorAvaliacaoMax') && f.valorAvaliacaoMax) q = q.lte('valor_avaliacao', Number(f.valorAvaliacaoMax));
  if (!ign.has('descontoMin') && f.descontoMin) q = q.gte('desconto_percentual', Number(f.descontoMin));
  if (!ign.has('tipoMonta') && f.tipoMonta.length) {
    const montas = f.tipoMonta.filter(t => t !== MONTA_NAO_INFORMADA);
    const conds = [];
    if (montas.length) conds.push(`sinistro.in.(${montas.map(t => `"${t}"`).join(',')})`);
    if (f.tipoMonta.includes(MONTA_NAO_INFORMADA)) conds.push('sinistro.is.null');
    q = q.or(conds.join(','));
  }
  // Origem da venda (25/09): "extrajudicial" agrupa todas as origens sem processo.
  if (!ign.has('origem') && f.origem) q = f.origem === 'extrajudicial' ? q.in('origem_venda', ORIGENS_EXTRAJUDICIAIS) : q.eq('origem_venda', f.origem);
  const janelaPrazo = ign.has('prazo') ? null : calcularJanelaPrazo(f.prazo);
  if (janelaPrazo?.tipo === 'sem_data') q = q.is('data_leilao', null);
  else if (janelaPrazo?.tipo === 'janela') q = q.gte('data_leilao', janelaPrazo.de).lte('data_leilao', janelaPrazo.ate);
  // RESULTADO DO LEILÃO (21/09) — mesma régua de Busca.jsx (imóveis): 'sem_lance' agrupa
  // 'sem_lance' E 'indeterminado' (nenhum tem sinal de venda); 'nao_apurado' é só NULL.
  if (ign.has('resultadoLeilao')) { /* ignorado no diagnóstico */ }
  else if (f.resultadoLeilao === 'sem_lance') q = q.eq('resultado_leilao', 'sem_lance').eq('teve_lance', false);
  else if (f.resultadoLeilao === 'nao_apurado') q = q.is('resultado_leilao', null);
  else if (f.resultadoLeilao === 'vendido') q = q.or('resultado_leilao.eq.vendido,and(teve_lance.is.true,resultado_leilao.not.is.null)');
  else if (f.resultadoLeilao) q = q.eq('resultado_leilao', f.resultadoLeilao);
  if (ign.has('motor') || !f.motor) { /* sem filtro */ }
  else if (f.motor === 'nao_informado') q = q.is('motor_status', null);
  else q = q.eq('motor_status', f.motor);
  return q;
}

// Rótulo de cada filtro no diagnóstico do resultado vazio.
const ROTULO_FILTRO = { estado: 'Estado', cidade: 'Cidade do pátio', tipoVeiculo: 'Tipo de veículo', marca: 'Marca', modelo: 'Modelo', anoMin: 'Ano de', anoMax: 'Ano até', valorMax: 'Lance máx.', valorAvaliacaoMax: 'Avaliação máx.', descontoMin: 'Desconto mín.', tipoMonta: 'Tipo de monta', origem: 'Origem da venda', prazo: 'Prazo do leilão', resultadoLeilao: 'Resultado do leilão', motor: 'Motor' };
const filtroAtivo = (f, k) => Array.isArray(f[k]) ? f[k].length > 0 : String(f[k] ?? '').trim() !== '';

// `embutido` (29/09, pedido do dono): a aba Veículos do Admin mostra lotes e filtros direto, sem
// navegar para esta página — mesmo componente, sem título e sem margens de página.
export default function BuscaVeiculos({ embutido = false } = {}) {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  // Filtros e página sobrevivem a abrir um veículo e voltar (pedido do dono, 24/09) — por aba,
  // em sessionStorage (ver utils/estadoLista.js). Mescla com o vazio para chave nova não faltar.
  const [filtros, setFiltros] = useState(() => {
    const salvo = { ...filtrosVazios(), ...(lerSessao('veic_filtros', null) || {}) };
    // Sessão de antes de 29/09 guardava estado/cidade como TEXTO: vira lista (cidade livre não
    // tem UF para formar o par, então é descartada em vez de filtrar errado).
    if (!Array.isArray(salvo.estado)) salvo.estado = salvo.estado ? [salvo.estado] : [];
    if (!Array.isArray(salvo.cidade)) salvo.cidade = [];
    return salvo;
  });
  // Opções de cidade: só onde HÁ veículo ativo, com contagem (RPC veiculos_cidades) — a lista
  // acompanha a coleta sozinha, e segue os estados marcados.
  const [cidadesOpc, setCidadesOpc] = useState([]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc('veiculos_cidades', { p_ufs: filtros.estado.length ? filtros.estado : null });
      if (!vivo) return;
      if (error) { console.warn('[veiculos] cidades do filtro:', error.message); setCidadesOpc([]); return; }
      const variosUf = filtros.estado.length !== 1;
      setCidadesOpc((data || []).map((r) => [`${r.cidade}|${r.estado}`, `${r.cidade}${variosUf ? ` — ${r.estado}` : ''} (${r.n})`]));
    })();
    return () => { vivo = false; };
  }, [filtros.estado.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mostrarFiltros, setMostrarFiltros] = useState(!isMobile);
  const [resultados, setResultados] = useState([]);
  const [total, setTotal] = useState(0);
  const [diagnostico, setDiagnostico] = useState(null); // resultado vazio: quanto cada filtro corta
  const [pagina, setPagina] = useState(() => Math.max(1, Number(lerSessao('veic_pagina', 1)) || 1));
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');


  // RESULTADO VAZIO EXPLICADO (24/09, print do dono: carro + sem lance + ano + lance + avaliação +
  // monta → 0, sem dizer por quê). Tira UM filtro por vez e conta quantos voltariam — só roda quando
  // a busca vem vazia (contagens `head`, sem trazer linhas). Motivo real do caso: 43 dos 47 carros
  // "sem lance" (Superbid) não informam avaliação nem monta, e o filtro por esses campos os exclui.
  async function diagnosticarVazio(f) {
    const ativos = Object.keys(ROTULO_FILTRO).filter(k => filtroAtivo(f, k));
    if (ativos.length < 2) return;
    const base = () => supabase.from('veiculos_leilao').select('id', { count: 'exact', head: true }).eq('ativo', true).eq('status_patio', 'confirmado');
    try {
      const contagens = await Promise.all(ativos.map(async k => {
        const { count, error } = await aplicarFiltros(base(), f, new Set([k]));
        return error ? null : { k, n: count || 0 };
      }));
      const ok = contagens.filter(Boolean);
      if (ok.length !== ativos.length) return; // alguma contagem falhou: melhor não sugerir nada do que sugerir errado
      const umSo = ok.filter(c => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
      if (umSo.length || ativos.length > 7) { setDiagnostico(umSo); return; }
      // Nenhum filtro sozinho destrava (o caso do print: avaliação E monta cortam os mesmos
      // veículos) → testa PARES. Até 21 contagens, e só quando a busca vem vazia.
      const pares = [];
      for (let i = 0; i < ativos.length; i++) for (let j = i + 1; j < ativos.length; j++) pares.push([ativos[i], ativos[j]]);
      const cp = await Promise.all(pares.map(async ks => {
        const { count, error } = await aplicarFiltros(base(), f, new Set(ks));
        return error ? null : { ks, n: count || 0 };
      }));
      if (cp.some(c => !c)) return;
      setDiagnostico(cp.filter(c => c.n > 0).sort((a, b) => b.n - a.n).slice(0, 3));
    } catch (e) {
      console.warn('[veiculos] diagnóstico do resultado vazio falhou:', e?.message || e);
    }
  }

  async function buscar(p, f) {
    setLoading(true); setErro('');
    try {
      let q = supabase.from('veiculos_leilao').select(COLUNAS, { count: 'estimated' })
        .eq('ativo', true)
        // Rede de segurança pública (11/09, pedido do dono): só bens já CONFIRMADOS em
        // pátio — nunca em posse do executado. `indefinido` é o default conservador de
        // `classificarPatio()` e não deve aparecer para o cliente.
        .eq('status_patio', 'confirmado');
      q = aplicarFiltros(q, f);
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
      setDiagnostico(null);
      if (!(data || []).length && p === 1) diagnosticarVazio(f);
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
    <div style={{ maxWidth: embutido ? 'none' : 1280, margin: embutido ? 0 : '0 auto', padding: embutido ? 0 : (isMobile ? '12px' : '20px'), display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: embutido ? 'flex-end' : 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, display: embutido ? 'none' : 'block' }}>
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
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 14, display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={lbl}>Estado</label>
            <MultiEscolha valores={filtros.estado} opcoes={ESTADOS.map(uf => [uf, uf])} vazio="Todos" busca
              onChange={v => setFiltros(f => ({
                ...f, estado: v,
                // Desmarcar um estado tira as cidades dele — senão o filtro pede cidade de UF fora da lista e zera.
                cidade: v.length ? f.cidade.filter(c => v.includes(String(c).split('|')[1])) : f.cidade,
              }))} />
          </div>
          <div>
            <label style={lbl}>Cidade do pátio</label>
            <MultiEscolha valores={filtros.cidade} opcoes={cidadesOpc} vazio="Todas" busca
              onChange={v => setFiltros(f => ({ ...f, cidade: v }))} />
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
            <input style={inp} type="number" placeholder="Ex.: 2010" value={filtros.anoMin} onChange={e => setFiltros(f => ({ ...f, anoMin: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Ano até</label>
            <input style={inp} type="number" placeholder="Ex.: 2024" value={filtros.anoMax} onChange={e => setFiltros(f => ({ ...f, anoMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Lance máx. (R$)</label>
            <input style={inp} type="number" placeholder="Ex.: 50000" value={filtros.valorMax} onChange={e => setFiltros(f => ({ ...f, valorMax: e.target.value }))} />
          </div>
          <div>
            <label style={lbl}>Avaliação máx. (R$)</label>
            <input style={inp} type="number" placeholder="Ex.: 80000" value={filtros.valorAvaliacaoMax} onChange={e => setFiltros(f => ({ ...f, valorAvaliacaoMax: e.target.value }))} />
            {filtros.valorAvaliacaoMax && <small style={avisoCobertura}>{AVISO_SEM_AVALIACAO}</small>}
          </div>
          <div>
            <label style={lbl}>Desconto mín.</label>
            <select style={inp} value={filtros.descontoMin} onChange={e => setFiltros(f => ({ ...f, descontoMin: e.target.value }))}>
              <option value="">Qualquer</option>
              <option value="20">20% ou mais</option>
              <option value="40">40% ou mais</option>
              <option value="60">60% ou mais</option>
            </select>
            {filtros.descontoMin && <small style={avisoCobertura}>{AVISO_SEM_AVALIACAO}</small>}
          </div>
          <div>
            <label style={lbl}>Tipo de monta</label>
            <MultiEscolha valores={filtros.tipoMonta} opcoes={OPCOES_MONTA} onChange={v => setFiltros(f => ({ ...f, tipoMonta: v }))} />
          </div>
          <div>
            <label style={lbl} title="Quem está vendendo o veículo">Origem da venda</label>
            <select style={inp} value={filtros.origem} onChange={e => setFiltros(f => ({ ...f, origem: e.target.value }))}>
              <option value="">Qualquer</option>
              <option value="judicial">Judicial (com processo)</option>
              <option value="extrajudicial">Extrajudicial (todas abaixo)</option>
              {ORIGENS_EXTRAJUDICIAIS.map(k => <option key={k} value={k}>  · {ORIGEM_VENDA[k].rotulo}</option>)}
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
            <label style={lbl}>Motor</label>
            <select style={inp} value={filtros.motor || ''} onChange={e => setFiltros(f => ({ ...f, motor: e.target.value }))}>
              <option value="">Qualquer</option>
              {MOTOR_OPTS.map(([val, label, desc]) => <option key={val} value={val} title={desc}>{label}</option>)}
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
          {diagnostico?.length > 0 ? (
            <div style={{ fontSize: 13, color: '#334155', maxWidth: 520, margin: '8px auto 0', textAlign: 'left' }}>
              <div style={{ marginBottom: 6 }}>A combinação de filtros não fecha. {diagnostico[0]?.ks ? 'Tirando dois deles:' : <>Tirando <strong>um</strong> deles:</>}</div>
              {diagnostico.map(d => { const ks = d.ks || [d.k]; return (
                <div key={ks.join('+')} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 6 }}>
                  <span>sem <strong>{ks.map(k => ROTULO_FILTRO[k]).join(' e ')}</strong> → {d.n} veículo{d.n > 1 ? 's' : ''}</span>
                  <button onClick={() => setFiltros(prev => { const nf = { ...prev }; ks.forEach(k => { nf[k] = Array.isArray(prev[k]) ? [] : ''; }); return nf; })}
                    style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap' }}>{ks.length > 1 ? 'Tirar estes filtros' : 'Tirar este filtro'}</button>
                </div>
              ); })}
              {diagnostico.some(d => (d.ks || [d.k]).some(k => k === 'valorAvaliacaoMax' || k === 'tipoMonta')) && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Muitos leiloeiros (ex.: Superbid) não informam avaliação nem tipo de monta — esses veículos saem quando você filtra por esses campos. Em "Tipo de monta", marque também "Não informado" para incluí-los.</div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12.5 }}>Ajuste os filtros ou volte mais tarde — o piloto ainda está em expansão para novas fontes.</div>
          )}
        </div>
      )}

      {!loading && !erro && resultados.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          {resultados.map(v => {
            const desc = desconto(v);
            const fotos = fotosArray(v);
            const cont = contagemLeilao(v.data_leilao);
            const anoLabel = [v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/');
            return (
              <div key={v.id}
                style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onClick={e => { if (e.target.closest('a,button')) return; nav(`/admin/veiculos-leilao/${v.id}`, { state: { deBusca: true } }); }}
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
                    <MapPin size={9} style={{ flexShrink: 0 }} />{[v.patio ? `Pátio ${v.patio}` : null, [v.cidade, v.estado].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {/* Sinal do próprio leiloeiro (11/09) — sinistro, sucata, financiamento e
                      alerta de motor. Nunca inventado: o que ele não informa fica de fora. */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    {ORIGEM_VENDA[v.origem_venda] && v.origem_venda !== 'nao_identificado' && (
                      <span title={ORIGEM_VENDA[v.origem_venda].dica} style={{ fontSize: 9, fontWeight: 700, background: ORIGEM_VENDA[v.origem_venda].fundo, color: ORIGEM_VENDA[v.origem_venda].cor, padding: '1px 6px', borderRadius: 8 }}>{ORIGEM_VENDA[v.origem_venda].rotulo}</span>
                    )}
                    {v.sinistro && (() => { const c = corSinistro(v.sinistro); return (
                      <span title="Classificação do sinistro, informada pelo leiloeiro" style={{ fontSize: 9, fontWeight: 700, background: c.bg, color: c.fg, padding: '1px 6px', borderRadius: 8, textTransform: 'capitalize' }}>{v.sinistro}</span>
                    ); })()}
                    {v.is_sucata && (
                      <span title="Vendido sem ATPV-E — só certificado de baixa; a transferência não é a padrão" style={{ fontSize: 9, fontWeight: 800, background: '#fecaca', color: '#991b1b', padding: '1px 6px', borderRadius: 8 }}>⚠️ Sucata</span>
                    )}
                    {v.motor_status === 'funciona' && (
                      <span title="O leiloeiro declarou o motor funcionando — informação do edital, não garantia" style={{ fontSize: 9, fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '1px 6px', borderRadius: 8 }}>🔧 Motor funcionando</span>
                    )}
                    {(v.motor_alerta || v.motor_status === 'nao_funciona') && (
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
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                    {/* Resultado REAL (21/09) — quando já apurado, é o sinal que importa;
                        a contagem de data abaixo é só complemento, nunca contradiz este. */}
                    {chaveResultado(v) && RESULTADO_BADGE[chaveResultado(v)] && (() => { const rb = RESULTADO_BADGE[chaveResultado(v)]; return (
                      <span title={chaveResultado(v) === 'vendido' ? 'Apurado na página do leiloeiro — o lote recebeu lance' : 'Apurado na página do leiloeiro — encerrou sem lance, candidato a proposta de venda direta'} style={{ fontSize: 9, fontWeight: 800, background: rb.bg, color: rb.fg, padding: '1px 6px', borderRadius: 8 }}>{rb.texto}</span>
                    ); })()}
                    {cont
                      ? <span title="Data do leilão" style={{ fontSize: 9, fontWeight: 800, background: cont.bg, color: cont.fg, padding: '1px 6px', borderRadius: 8 }}>🗓 {cont.texto}</span>
                      : <span style={{ fontSize: 9, color: '#94a3b8' }}>🗓 {fmtDataLeilao(v.data_leilao)}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
                  {/* Página interna primeiro (24/09, pedido do dono): dados do leiloeiro, local do pátio,
                      documentos e FIPE sob demanda; o site do leiloeiro vira o botão secundário. */}
                  <button onClick={e => { e.stopPropagation(); nav(`/admin/veiculos-leilao/${v.id}`, { state: { deBusca: true } }); }}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 4px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    Ver detalhes
                  </button>
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

    </div>
  );
}
