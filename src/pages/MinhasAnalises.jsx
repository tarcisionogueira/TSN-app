import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Loader2, CheckCircle2, XCircle, Search, Building2, Plus, Home, Briefcase, Trophy, FileWarning } from 'lucide-react';
import { useAnalises } from '../contexts/AnalisesContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { reportarErroCliente } from '../utils/reportarErro';
import { useIsMobile } from '../utils/useIsMobile';
import FotoImovel from '../components/FotoImovel';

// Etapa do acompanhamento assistido (caso) em rótulo curto para o cliente.
const ETAPA_CURTA = {
  analise_solicitada: 'Análise solicitada', analises_prontas: 'Análises prontas',
  reuniao_agendada: 'Reunião agendada', reuniao_realizada: 'Reunião realizada',
  juridico_solicitado: 'No jurídico', juridico_concluido: 'Parecer pronto',
  segunda_reuniao: '2ª reunião', arrematado: 'Arrematado', honorarios_pagos: 'Concluído',
  procuracao_assinada: 'Procuração assinada', pos_arrematacao: 'Pós-arrematação',
};

// Tela inicial das Análises: lista de imóveis analisados (mercado + documental por
// imóvel). Clicar num imóvel abre a análise específica dele (relatórios + agenda
// com o analista). Substitui o antigo popup do topo por uma página navegável.
const CHIP = {
  verde:   { bg: '#dcfce7', c: '#15803d' },
  ambar:   { bg: '#fef3c7', c: '#92400e' },
  vermelho:{ bg: '#fee2e2', c: '#b91c1c' },
  neutro:  { bg: '#f1f5f9', c: '#475569' },
};

export default function MinhasAnalises() {
  const { analises, documentais, laudos, emAndamento, remover } = useAnalises();
  const { effectiveUserId, impersonate } = useAuth();
  const nav = useNavigate();
  const isMobile = useIsMobile();

  // Acompanhamento assistido: se o imóvel analisado já virou um caso (fluxo /caso),
  // conectamos os dois no mesmo lugar — o cliente pula direto para o acompanhamento.
  const [casosPorImovel, setCasosPorImovel] = React.useState({});
  React.useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('casos').select('id, imovel_id, status_etapa').eq('cliente_id', effectiveUserId)
      .then(({ data }) => {
        const by = {};
        (data || []).forEach(c => { if (c.imovel_id) by[String(c.imovel_id)] = c; });
        setCasosPorImovel(by);
      });
  }, [effectiveUserId]);

  // Imóveis JÁ arrematados (fonte da verdade = tabela arrematados) — quando arrematado, some o
  // botão de AÇÃO "Arrematei" e aparece o ESTADO "Arrematado".
  const [arrematadosSet, setArrematadosSet] = React.useState(new Set());
  React.useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('arrematados').select('imovel_id').eq('user_id', effectiveUserId)
      .then(({ data }) => setArrematadosSet(new Set((data || []).map(r => String(r.imovel_id)).filter(Boolean))));
  }, [effectiveUserId]);

  // FONTE DA LISTA = RPC `minhas_analises_lista` (uma linha por imóvel, montada no servidor).
  //
  // Por que NÃO vem mais do contexto: ele lê as três tabelas com `.limit(12)` CADA UMA, e os
  // cortes caem em datas diferentes. Um imóvel com documental recente e mercadológico antigo
  // aparecia aqui com o chip "Jurídico: risco médio" e nenhum chip de mercado — o relatório
  // estava no banco o tempo todo. Também trocava o TÍTULO do card (a documental grava o
  // endereço da matrícula, a mercadológica grava o título do lote) e perdia a `data_leilao`,
  // que costuma vir nula na documental — sumindo o aviso "Leilão em … arrematou?".
  // O contexto continua valendo para o que está GERANDO agora (ver o overlay abaixo).
  const [lista, setLista] = React.useState(null); // null = ainda carregando
  const [erroLista, setErroLista] = React.useState(null);
  const carregarLista = React.useCallback(async () => {
    if (!effectiveUserId) return;
    const { data, error } = await supabase.rpc('minhas_analises_lista', { p_user_id: effectiveUserId });
    if (error) {
      // Lista vazia por falha de leitura é indistinguível de "você não tem análises" — e essa
      // confusão é exatamente o que faz o cliente achar que os relatórios sumiram. Diz o que houve.
      setErroLista(error.message || 'Não foi possível carregar suas análises.');
      reportarErroCliente({ msg: `minhas_analises_lista: ${error.message || 'erro'}` });
      return;
    }
    setErroLista(null);
    setLista(Array.isArray(data) ? data : []);
  }, [effectiveUserId]);
  React.useEffect(() => { carregarLista(); }, [carregarLista]);

  const ts = (v) => (typeof v === 'number' ? v : (Date.parse(v || 0) || 0));
  // Do `result` completo (que o contexto tem em memória) para as mesmas flags leves que a RPC
  // devolve — assim o card desenha igual venha de onde vier.
  const flagsDe = (tipo, result) => {
    const r = result || null;
    if (tipo === 'documental') return { precisaDocumentos: !!r?.precisaDocumentos, emCaptura: !!r?.emCaptura, nivelRisco: r?.nivelRisco || null };
    if (tipo === 'laudo') return { precisaRelatorios: !!r?.precisaRelatorios, veredito: r?.veredito || null };
    // mercado: `parecerPendente` = mercado veio mas a redação do parecer saiu vazia (caso Marcelo).
    // Concluída na tabela, mas NÃO é "pronta" — o self-heal está recompletando.
    return { temResultado: !!r, parecerPendente: !!r?.parecerPendente || (!!r && !r?.mercadoVazio && !(r?.parecer || '').trim()) };
  };

  const itens = React.useMemo(() => {
    const by = {};
    (lista || []).forEach(r => {
      if (!r?.imovelId) return;
      by[r.imovelId] = { ...r, reports: { ...(r.relatorios || {}) } };
    });
    // OVERLAY do que está acontecendo AGORA: geração em curso (a linha do banco pode nem existir
    // ainda) e erro recém-recebido. Só sobrepõe nesses casos — o estado persistido é a verdade.
    const overlay = (arr, tipo) => (arr || []).forEach(a => {
      if (!a?.imovelId) return;
      const it = by[a.imovelId] || (by[a.imovelId] = {
        imovelId: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado,
        imovel: a.imovel || null, dataLeilao: a.dataLeilao || null, updatedAt: a.updatedAt || 0, reports: {},
      });
      const persistido = it.reports[tipo];
      // Só sobrepõe quando o contexto sabe de algo que o banco ainda não mostra: geração em
      // curso, imóvel que nem linha tem, ou erro sobre algo que NÃO está concluído. Um 'erro'
      // velho no cache local não pode apagar da tela um relatório concluído no banco.
      const vale = a.status === 'gerando' || !persistido
        || (a.status === 'erro' && persistido.status !== 'concluida');
      if (vale) {
        it.reports[tipo] = { status: a.status, flags: flagsDe(tipo, a.result) };
        it.updatedAt = Math.max(ts(it.updatedAt), ts(a.updatedAt));
      }
      if (!it.titulo && a.titulo) it.titulo = a.titulo;
      if (!it.imovel && a.imovel) it.imovel = a.imovel;
    });
    overlay(analises, 'mercado');
    overlay(documentais, 'documental');
    overlay(laudos, 'laudo');
    return Object.values(by).sort((x, y) => ts(y.updatedAt) - ts(x.updatedAt));
  }, [lista, analises, documentais, laudos]);

  const abrir = (a) => nav('/analise', { state: { imovel: a.imovel || { id: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado } } });

  // "Arrematei este imóvel": o cliente sinaliza o arremate → mantém os documentos
  // (Retenção Etapa 2). Autoconsentido; só protege, nunca apaga.
  const [sinalizados, setSinalizados] = React.useState({});
  const [sinalizando, setSinalizando] = React.useState(null);
  const sinalizarArremate = async (e, a) => {
    e.stopPropagation();
    // Modo suporte é só visualização: /api/sinalizar-arremate usa o token REAL (admin) e
    // registraria o arremate na conta do admin, não do cliente. Bloqueia.
    if (impersonate) { window.alert('No modo suporte a conta é só para visualização. Saia do suporte para registrar em seu próprio nome.'); return; }
    if (sinalizados[a.imovelId] || sinalizando) return;
    const raw = window.prompt(`Confirme o arremate de "${a.titulo || 'este imóvel'}".\n\nPor quanto você arrematou? (somente números inteiros em reais, ex: 250000)`);
    if (raw == null) return; // cancelou
    const valor = Number(String(raw).replace(/[^\d]/g, ''));
    if (!valor || valor <= 0) { window.alert('Informe um valor de arremate válido (somente números).'); return; }
    setSinalizando(a.imovelId);
    try {
      const res = await apiCall('/api/sinalizar-arremate', { method: 'POST', body: JSON.stringify({ imovel_id: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado, valor }) });
      if (res.ok) setSinalizados(p => ({ ...p, [a.imovelId]: true }));
      else { const d = await res.json().catch(() => ({})); window.alert(d.error || 'Não foi possível registrar o arremate.'); }
    } catch { /* ok */ }
    setSinalizando(null);
  };

  // Status GERAL do imóvel na lista. Um documental "concluida" mas com
  // result.precisaDocumentos ainda está capturando/preparando os documentos —
  // NÃO é "Pronta" (era o que fazia a lista dizer Pronta e a tela abrir "carregando").
  // A captura automática promete "docs em ~1 min, gera sozinho". Passado esse tempo com folga,
  // se ainda faltam documentos é porque NÃO vem sozinho (fonte sem matrícula on-line, captura
  // que falhou, etc.). Antes o card girava "Preparando documentos…" p/ sempre — havia relatórios
  // presos assim há horas/dias. Agora, além do prazo, vira um estado ACIONÁVEL (anexar), sem spinner.
  const CAPTURA_MAX_MS = 20 * 60 * 1000; // 20 min (a mensagem promete ~1 min)
  const statusGeral = (it) => {
    const rs = Object.values(it.reports);
    const anyGer = rs.some(r => r.status === 'gerando');
    const docFlags = it.reports.documental?.status === 'concluida' ? (it.reports.documental.flags || {}) : null;
    if (anyGer) return { Icon: Loader2, cor: '#0d9488', txt: 'Gerando…', spin: true };
    if (docFlags?.precisaDocumentos) {
      const capturandoAgora = docFlags.emCaptura && it.updatedAt && (Date.now() - ts(it.updatedAt)) < CAPTURA_MAX_MS;
      return capturandoAgora
        ? { Icon: Loader2, cor: '#b45309', txt: 'Preparando documentos…', spin: true }
        : { Icon: FileWarning, cor: '#b45309', txt: 'Faltam documentos — anexe', spin: false };
    }
    // DOCUMENTAL SEM MERCADOLÓGICO. O servidor já exige a ordem (gate em gerar-documental), mas
    // sobraram análises anteriores a essa regra — e o card delas mostrava só o chip jurídico,
    // com cara de análise completa. Dizer o que falta é melhor do que a lacuna muda.
    if (it.reports.documental?.status === 'concluida' && !it.reports.mercado) {
      return { Icon: FileWarning, cor: '#b45309', txt: 'Mercadológico pendente — gere primeiro', spin: false };
    }
    // Mercado concluído mas com o PARECER em branco (caso Marcelo): finalizando, não "pronto".
    if (it.reports.mercado?.status === 'concluida' && it.reports.mercado.flags?.parecerPendente) {
      return { Icon: Loader2, cor: '#4338ca', txt: 'Finalizando relatório…', spin: true };
    }
    const anyOk = rs.some(r => r.status === 'concluida');
    const anyErr = rs.some(r => r.status === 'erro');
    if (anyErr && !anyOk) return { Icon: XCircle, cor: '#dc2626', txt: 'Erro ao gerar' };
    return null; // pronto: os chips por relatório mostram o veredito
  };

  // "Arrematei" SÓ aparece quando os 3 relatórios estão realmente prontos — é o gatilho da
  // retenção (guardar os documentos do arremate). Antes o botão aparecia em qualquer análise,
  // mesmo incompleta/em um só relatório, o que confundia (parecia disponível "para todos").
  const tresProntos = (it) => {
    const r = it.reports || {};
    const ok = (x) => x?.status === 'concluida';
    return ok(r.mercado) && !r.mercado?.flags?.parecerPendente
      && ok(r.documental) && !r.documental?.flags?.precisaDocumentos
      && ok(r.laudo) && !r.laudo?.flags?.precisaRelatorios;
  };

  // JANELA PARA REGISTRAR O ARREMATE (regra do dono, 07/08). Desde hoje o lote com data vencida
  // sai da busca, e o relatório é apagado depois do prazo — então o investidor que GANHOU o
  // leilão precisa conseguir registrar isso, e precisa ser lembrado. Duas consequências aqui:
  //   • depois do leilão, "Arrematei" aparece SEMPRE. O gate dos 3 relatórios existe para não
  //     confundir quem ainda está analisando; depois do pregão ele só impediria o registro de uma
  //     compra real — e sem registro o cliente perde relatório e documentos do imóvel que comprou.
  //   • o card avisa, com a data, que a janela está correndo.
  const leilaoPassou = (it) => {
    const d = it.dataLeilao ? new Date(it.dataLeilao) : null;
    if (!d || Number.isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
  };

  // Chips de veredito por relatório: dá pra ver na lista o que tem potencial de evoluir.
  const chipsDe = (it) => {
    const rs = it.reports, out = [];
    if (rs.mercado?.status === 'concluida') {
      const v = it.imovel?.analise_viavel;
      out.push(rs.mercado.flags?.parecerPendente
        ? { t: 'Mercado: finalizando…', ...CHIP.neutro }
        : v === true ? { t: 'Mercado: viável', ...CHIP.verde } : v === false ? { t: 'Mercado: reprovado', ...CHIP.vermelho } : { t: 'Mercado ✓', ...CHIP.neutro });
    }
    if (rs.documental?.status === 'concluida' && !rs.documental.flags?.precisaDocumentos) {
      const nr = rs.documental.flags?.nivelRisco;
      out.push(nr === 'verde' ? { t: 'Jurídico: risco baixo', ...CHIP.verde } : nr === 'vermelho' ? { t: 'Jurídico: risco alto', ...CHIP.vermelho } : { t: 'Jurídico: risco médio', ...CHIP.ambar });
    }
    if (rs.laudo?.status === 'concluida' && rs.laudo.flags?.veredito) {
      const v = rs.laudo.flags.veredito;
      out.push(v === 'aprovado' ? { t: 'Laudo: aprovado', ...CHIP.verde } : v === 'reprovado' ? { t: 'Laudo: reprovado', ...CHIP.vermelho } : { t: 'Laudo: com ressalvas', ...CHIP.ambar });
    }
    return out;
  };

  const acao = (label, Icon, cor, onClick) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'white', color: cor, border: `1px solid ${cor}33`, borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '16px 12px' : '28px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>BidPro Brasil</div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 9 }}>
            <BarChart3 size={22} color="#0D63DB" /> Minhas Análises
          </h1>
        </div>
        {emAndamento > 0 && (
          <span style={{ fontSize: 12, fontWeight: 800, color: '#0d9488', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 20, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> {emAndamento} em andamento
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {acao('Buscar imóveis', Search, '#0D63DB', () => nav('/buscar'))}
        {acao('Incluir lote manual (URL/anexos)', Plus, '#7c3aed', () => nav('/analise', { state: { manual: true } }))}
        {acao('Meus arrematados', Home, '#059669', () => nav('/arrematados'))}
      </div>

      {erroLista ? (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: '#b91c1c' }}>
            <XCircle size={17} /> Não foi possível carregar suas análises
          </div>
          <div style={{ fontSize: 13, color: '#7f1d1d', marginTop: 6, lineHeight: 1.5 }}>
            Nenhuma análise foi apagada — é a leitura que falhou. Detalhe técnico: {erroLista}
          </div>
          <button onClick={carregarLista} style={{ marginTop: 12, padding: '9px 16px', background: '#b91c1c', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Tentar de novo
          </button>
        </div>
      ) : lista === null && itens.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '40px 24px', textAlign: 'center', color: '#64748b', fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
          <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Carregando suas análises…
        </div>
      ) : itens.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
          <BarChart3 size={40} color="#cbd5e1" />
          <div style={{ fontSize: 15, fontWeight: 800, color: '#334155', margin: '14px 0 6px' }}>Você ainda não tem análises</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18, lineHeight: 1.5 }}>Busque um imóvel e gere sua primeira análise de viabilidade.</div>
          <button onClick={() => nav('/buscar')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            <Search size={16} /> Buscar imóveis
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {itens.map(a => {
            const s = statusGeral(a);
            const chips = chipsDe(a);
            const caso = casosPorImovel[String(a.imovelId)];
            // JÁ arrematado: tem registro em arrematados, já sinalizou, ou o caso passou do arremate.
            const jaArr = arrematadosSet.has(String(a.imovelId)) || !!sinalizados[a.imovelId]
              || ['segunda_reuniao', 'arrematado', 'pos_arrematacao', 'procuracao_assinada', 'honorarios_pagos'].includes(caso?.status_etapa);
            return (
              <div key={a.imovelId} onClick={() => abrir(a)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, cursor: 'pointer', transition: 'box-shadow .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e2e8f0'; }}>
                <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FotoImovel imovel={a.imovel} iconSize={22} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.titulo || 'Imóvel'}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[a.cidade, a.estado].filter(Boolean).join(', ')}</div>
                  {/* Janela do arremate: o lote já saiu da busca (leilão vencido) e o relatório
                      tem prazo. Quem ganhou precisa ver isto — e agir pelo botão ao lado. */}
                  {!jaArr && leilaoPassou(a) && (
                    <div style={{ fontSize: 11.5, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '5px 8px', marginTop: 5, lineHeight: 1.45 }}>
                      Leilão em {new Date(a.dataLeilao).toLocaleDateString('pt-BR')} — <strong>arrematou?</strong> Registre em &quot;Arrematei&quot; para manter o relatório e os documentos.
                    </div>
                  )}
                  <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {s && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <s.Icon size={12} color={s.cor} style={s.spin ? { animation: 'spin 1s linear infinite' } : undefined} />
                        <span style={{ color: s.cor, fontWeight: 700 }}>{s.txt}</span>
                      </span>
                    )}
                    {chips.map((c, i) => (
                      <span key={i} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.c }}>{c.t}</span>
                    ))}
                  </div>
                </div>
                {caso ? (
                  <button onClick={(e) => { e.stopPropagation(); nav('/caso/' + caso.id); }}
                    title="Abrir acompanhamento com a equipe"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <Briefcase size={13} /> {ETAPA_CURTA[caso.status_etapa] || 'Acompanhamento'}
                  </button>
                ) : jaArr && (
                  <button onClick={(e) => { e.stopPropagation(); nav('/arrematados'); }}
                    title="Imóvel arrematado — abrir em Meus Arrematados"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <Briefcase size={13} /> Arrematado
                  </button>
                )}
                {/* "Arrematei" é AÇÃO de sinalizar — some quando o imóvel já está arrematado. */}
                {!jaArr && (tresProntos(a) || leilaoPassou(a)) && (
                <button onClick={(e) => sinalizarArremate(e, a)}
                  disabled={sinalizando === a.imovelId}
                  title="Confirmo que arrematei este imóvel (mantém os documentos)"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <Trophy size={13} /> {sinalizando === a.imovelId ? 'Enviando…' : 'Arrematei'}
                </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Remover esta análise? Os relatórios mercadológico, documental e laudo deste imóvel serão apagados e não há como desfazer.')) { setLista(prev => (prev || []).filter(r => r.imovelId !== a.imovelId)); Promise.resolve(remover(a.imovelId)).then(carregarLista); } }} title="Remover" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4, flexShrink: 0 }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
