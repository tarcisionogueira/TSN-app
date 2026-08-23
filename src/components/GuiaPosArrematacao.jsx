import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Scale, FileSearch, AlertTriangle, Info, ExternalLink } from 'lucide-react';
import { setItemSeguro } from '../utils/storageSeguro.js';

// ── Dados dos checklists ──────────────────────────────────────────────────────

const FASES_JUDICIAL = [
  {
    id: 'j1', cor: '#0D63DB', titulo: 'Pagamento e Formalização',
    itens: [
      { id: 'j1a', texto: 'Pagar o saldo do preço da arrematação no prazo fixado no edital', lei: 'Art. 892 CPC (Lei 13.105/2015)', dica: null, integracao: null },
      { id: 'j1b', texto: 'Assinar o Auto de Arrematação junto ao Escrivão do Juízo', lei: 'Art. 901 CPC', dica: null, integracao: null },
      { id: 'j1c', texto: 'Aguardar homologação judicial da arrematação pelo Juiz (decisão publicada nos autos)', lei: 'Art. 903 CPC', dica: 'Monitorar os autos pelo CNJ DataJud', integracao: 'cnj' },
      { id: 'j1d', texto: 'Obter a Carta de Arrematação emitida pelo Juízo (após trânsito em julgado da homologação)', lei: 'Art. 901 §1° CPC', dica: 'Peticioná-la nos próprios autos da execução', integracao: 'cnj' },
    ],
  },
  {
    id: 'j2', cor: '#7c3aed', titulo: 'Tributação e Registro',
    itens: [
      { id: 'j2a', texto: 'Calcular e recolher o ITBI junto à Prefeitura do município do imóvel (base de cálculo: valor do lance)', lei: 'Art. 156, II CF/88, alíquota municipal de 2% a 3%', dica: null, integracao: null },
      { id: 'j2b', texto: 'Obter Certidão Negativa de Débitos (CND) federal e Dívida Ativa PGFN para compor o dossiê de registro', lei: 'Art. 47 Lei 8.212/91', dica: 'Use as Certidões Fiscais do sistema', integracao: 'certidoes' },
      { id: 'j2c', texto: 'Protocolar no Cartório de Registro de Imóveis (CRI): Carta de Arrematação + guia ITBI quitada + certidões', lei: 'Art. 167, I, 26 e 37 Lei 6.015/73 (LRP)', dica: null, integracao: null },
      { id: 'j2d', texto: 'Acompanhar a abertura/atualização da matrícula em nome do arrematante', lei: 'Arts. 176 e 228 Lei 6.015/73', dica: null, integracao: null },
    ],
  },
  {
    id: 'j3', cor: '#059669', titulo: 'Imissão na Posse',
    itens: [
      { id: 'j3a', texto: 'Verificar situação de ocupação do imóvel (desocupado, devedor, terceiros)', lei: null, dica: null, integracao: null },
      { id: 'j3b', texto: 'Solicitar ao Juízo o mandado de imissão na posse (petição simples nos autos da execução)', lei: 'Art. 626 CPC, via simples petição nos autos', dica: 'Protocolar nos autos monitorados pelo CNJ DataJud', integracao: 'cnj' },
      { id: 'j3c', texto: 'Aguardar cumprimento do mandado pelo Oficial de Justiça (prazo médio 15 a 60 dias)', lei: 'Art. 538 CPC', dica: null, integracao: null },
      { id: 'j3d', texto: 'Se houver resistência: solicitar ao Juízo auxílio de força policial para cumprimento coercitivo', lei: 'Art. 538 §3° CPC', dica: null, integracao: null },
      { id: 'j3e', texto: 'Documentar estado do imóvel com fotos e vídeos na data da imissão', lei: null, dica: null, integracao: null },
    ],
  },
  {
    id: 'j4', cor: '#d97706', titulo: 'Dívidas Sub-rogadas e Regularização',
    itens: [
      { id: 'j4a', texto: 'Verificar débitos de condomínio, sub-rogação das últimas 5 contribuições anteriores à arrematação', lei: 'STJ Súmula 478, Art. 908 §1° CPC', dica: null, integracao: null },
      { id: 'j4b', texto: 'Verificar e negociar IPTU em aberto com a Prefeitura, responsabilidade propter rem sub-roga ao imóvel', lei: 'Art. 130 CTN (Lei 5.172/1966)', dica: 'Verifique via Certidões do sistema', integracao: 'certidoes' },
      { id: 'j4c', texto: 'Verificar na matrícula ônus remanescentes não cancelados (hipotecas, penhoras, gravames)', lei: 'Art. 1.473 CC (Lei 10.406/2002)', dica: null, integracao: null },
      { id: 'j4d', texto: 'Transferir titularidade do IPTU na Prefeitura municipal', lei: 'Art. 34 CTN', dica: null, integracao: null },
      { id: 'j4e', texto: 'Transferir titularidade de água (concessionária local) e energia elétrica (distribuidora)', lei: 'Resolução ANEEL 1.000/2021, Art. 18 Lei 8.987/95', dica: null, integracao: null },
    ],
  },
  {
    id: 'j5', cor: '#dc2626', titulo: 'Monitoramento de Riscos Pós-Arrematação',
    itens: [
      { id: 'j5a', texto: 'Monitorar prazo de embargos à arrematação (15 dias após assinatura do Auto), pode ensejar desfazimento', lei: 'Art. 903 §1° CPC', dica: 'Monitore movimentações pelo CNJ DataJud do sistema', integracao: 'cnj', risco: true },
      { id: 'j5b', texto: 'Verificar se há recurso pendente nos autos (agravo de petição, apelação, embargos de terceiro)', lei: 'Arts. 674 e 1.015 CPC', dica: 'Acompanhe via CNJ DataJud', integracao: 'cnj', risco: true },
      { id: 'j5c', texto: 'Verificar se há ação anulatória da arrematação proposta por terceiros (prazo prescricional: 10 anos)', lei: 'Art. 903 §4° CPC, Art. 205 CC', dica: null, integracao: 'cnj', risco: true },
      { id: 'j5d', texto: 'Após imissão: contratar seguro patrimonial para o imóvel', lei: null, dica: null, integracao: null },
    ],
  },
];

const FASES_EXTRAJUDICIAL = [
  {
    id: 'e1', cor: '#0D63DB', titulo: 'Pagamento e Formalização',
    itens: [
      { id: 'e1a', texto: 'Pagar o saldo do lance no prazo do edital (geralmente 30 dias corridos do leilão)', lei: 'Art. 27 Lei 9.514/97 (alienação fiduciária), contrato de compra e venda nas demais modalidades', dica: null, integracao: null },
      { id: 'e1b', texto: 'Obter o Auto/Certidão de Arrematação emitido e autenticado pelo leiloeiro oficial', lei: 'Art. 24 Decreto 21.981/1932, instrumento hábil para transferência de propriedade', dica: null, integracao: null },
      { id: 'e1c', texto: 'Confirmar quitação total do sinal/caução pago na entrada', lei: null, dica: null, integracao: null },
    ],
  },
  {
    id: 'e2', cor: '#7c3aed', titulo: 'Tributação e Registro',
    itens: [
      { id: 'e2a', texto: 'Calcular e recolher o ITBI junto à Prefeitura municipal (base: valor do lance)', lei: 'Art. 156, II CF/88, alíquota municipal de 2% a 3%', dica: null, integracao: null },
      { id: 'e2b', texto: 'Obter CND Receita Federal e Dívida Ativa PGFN para compor dossiê de registro', lei: 'Art. 47 Lei 8.212/91', dica: 'Use as Certidões Fiscais do sistema', integracao: 'certidoes' },
      { id: 'e2c', texto: 'Protocolar no CRI: Auto de Arrematação + ITBI quitado + certidões exigidas pelo cartório', lei: 'Art. 167, I, 37 Lei 6.015/73, Art. 26 §7° Lei 9.514/97', dica: null, integracao: null },
      { id: 'e2d', texto: 'Acompanhar emissão da nova matrícula em nome do arrematante', lei: 'Arts. 176 e 228 Lei 6.015/73', dica: null, integracao: null },
    ],
  },
  {
    id: 'e3', cor: '#059669', titulo: 'Posse e Desocupação',
    itens: [
      { id: 'e3a', texto: 'Verificar situação de ocupação do imóvel antes de entrar', lei: null, dica: null, integracao: null },
      { id: 'e3b', texto: 'Se desocupado: imissão imediata de posse com o registro da nova matrícula', lei: 'Art. 1.204 CC (Lei 10.406/2002)', dica: null, integracao: null },
      { id: 'e3c', texto: 'Se ocupado (alienação fiduciária, Lei 9.514/97): notificar o ocupante pelo CRI concedendo 60 dias para desocupação voluntária', lei: 'Art. 30 Lei 9.514/97 (incluído pela Lei 13.465/2017)', dica: null, integracao: null },
      { id: 'e3d', texto: 'Se ocupado por terceiros sem título: propor ação de imissão de posse ou reintegração (prazo 15 dias para liminar)', lei: 'Art. 626 CPC, Art. 1.210 CC', dica: null, integracao: null },
      { id: 'e3e', texto: 'Documentar estado do imóvel com fotos e vídeos imediatamente após imissão na posse', lei: null, dica: null, integracao: null },
    ],
  },
  {
    id: 'e4', cor: '#d97706', titulo: 'Dívidas Sub-rogadas e Regularização',
    itens: [
      { id: 'e4a', texto: 'Verificar débitos de condomínio, responsabilidade pelas últimas 5 contribuições anteriores ao leilão', lei: 'STJ Súmula 478, confirmada no EREsp 1.610.860/MG (2017)', dica: null, integracao: null },
      { id: 'e4b', texto: 'Verificar e negociar IPTU em aberto com a Prefeitura', lei: 'Art. 130 CTN (Lei 5.172/1966)', dica: 'Verifique via Certidões do sistema', integracao: 'certidoes' },
      { id: 'e4c', texto: 'Verificar na matrícula ônus remanescentes (hipotecas, penhoras, servidões)', lei: 'Art. 1.473 CC', dica: null, integracao: null },
      { id: 'e4d', texto: 'Transferir titularidade do IPTU junto à Prefeitura', lei: 'Art. 34 CTN', dica: null, integracao: null },
      { id: 'e4e', texto: 'Transferir contas de água (concessionária), energia elétrica e gás', lei: 'Resolução ANEEL 1.000/2021, Art. 18 Lei 8.987/95', dica: null, integracao: null },
    ],
  },
  {
    id: 'e5', cor: '#64748b', titulo: 'Regularização Complementar',
    itens: [
      { id: 'e5a', texto: 'Verificar regularidade perante o Município: Habite-se, Alvará (comercial), AVCB (Corpo de Bombeiros)', lei: 'Lei 10.257/2001 (Estatuto da Cidade), lei municipal de uso e ocupação do solo', dica: null, integracao: null },
      { id: 'e5b', texto: 'Averbar eventuais construções/reformas não registradas na matrícula', lei: 'Art. 167, II, 4 Lei 6.015/73', dica: null, integracao: null },
      { id: 'e5c', texto: 'Verificar existência de usufruto, servidões ou cláusulas restritivas no título original', lei: 'Arts. 1.390 a 1.416 CC', dica: null, integracao: null },
      { id: 'e5d', texto: 'Contratar seguro patrimonial após imissão na posse', lei: null, dica: null, integracao: null },
    ],
  },
];

// ── Componente ────────────────────────────────────────────────────────────────

export default function GuiaPosArrematacao({ modalidade = 'extrajudicial', imovelId, onNavCNJ, onNavCertidoes }) {
  const fases = modalidade === 'judicial' ? FASES_JUDICIAL : FASES_EXTRAJUDICIAL;
  const storageKey = `guia_pos_${imovelId || 'default'}`;

  const [marcados, setMarcados] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  });
  const [fasesAbertas, setFasesAbertas] = useState(() => {
    const init = {};
    fases.forEach((f, i) => { init[f.id] = i === 0; });
    return init;
  });

  useEffect(() => {
    setItemSeguro(storageKey, JSON.stringify(marcados));
  }, [marcados, storageKey]);

  const toggleItem = useCallback((id) => {
    setMarcados(p => ({ ...p, [id]: !p[id] }));
  }, []);

  const toggleFase = useCallback((id) => {
    setFasesAbertas(p => ({ ...p, [id]: !p[id] }));
  }, []);

  const totalItens = fases.reduce((acc, f) => acc + f.itens.length, 0);
  const totalMarcados = fases.reduce((acc, f) => acc + f.itens.filter(i => marcados[i.id]).length, 0);
  const pct = totalItens > 0 ? Math.round((totalMarcados / totalItens) * 100) : 0;

  const corProgresso = pct < 33 ? '#dc2626' : pct < 66 ? '#d97706' : pct < 100 ? '#0D63DB' : '#059669';

  return (
    <div style={{ fontFamily: 'inherit' }}>

      {/* Header do guia */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', borderRadius: 14, padding: '18px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ background: modalidade === 'judicial' ? '#dc2626' : '#059669', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 800, color: 'white', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {modalidade === 'judicial' ? 'Leilão Judicial' : 'Leilão Extrajudicial'}
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>Checklist pós-arrematação</span>
        </div>

        {/* Barra de progresso */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{totalMarcados} de {totalItens} etapas concluídas</span>
            <span style={{ fontSize: 13, fontWeight: 900, color: corProgresso }}>{pct}%</span>
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: corProgresso, borderRadius: 99, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {pct === 100 && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(5,150,105,0.2)', borderRadius: 8, fontSize: 12, color: '#34d399', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} /> Todas as etapas concluídas! Regularização completa.
          </div>
        )}
      </div>

      {/* Aviso legal */}
      <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 8 }}>
        <AlertTriangle size={14} color="#92400e" style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 11.5, color: '#92400e', lineHeight: 1.6 }}>
          Este guia tem caráter orientativo e educacional. Prazos e procedimentos podem variar conforme o edital, comarca, município e as características específicas do imóvel. Consulte sempre um advogado habilitado para seu caso concreto.
        </p>
      </div>

      {/* Fases */}
      {fases.map((fase) => {
        const itensFeitos = fase.itens.filter(i => marcados[i.id]).length;
        const faseConcluida = itensFeitos === fase.itens.length;
        const aberta = fasesAbertas[fase.id];

        return (
          <div key={fase.id} style={{ marginBottom: 10, border: `1px solid ${faseConcluida ? '#86efac' : '#e2e8f0'}`, borderRadius: 12, overflow: 'hidden', background: 'white' }}>
            {/* Header da fase */}
            <button onClick={() => toggleFase(fase.id)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', background: faseConcluida ? '#f0fdf4' : 'white', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: faseConcluida ? '#059669' : fase.cor, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: faseConcluida ? '#059669' : '#111111' }}>{fase.titulo}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: fase.cor, background: `${fase.cor}15`, padding: '3px 8px', borderRadius: 20 }}>
                {itensFeitos}/{fase.itens.length}
              </span>
              {aberta ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
            </button>

            {/* Itens */}
            {aberta && (
              <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {fase.itens.map((item) => {
                  const feito = !!marcados[item.id];
                  return (
                    <div key={item.id}
                      style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 10, background: feito ? '#f0fdf4' : '#f8fafc', border: `1px solid ${feito ? '#86efac' : '#e2e8f0'}`, cursor: 'pointer', transition: 'background 0.15s' }}
                      onClick={() => toggleItem(item.id)}>
                      <div style={{ flexShrink: 0, marginTop: 1 }}>
                        {feito
                          ? <CheckCircle2 size={17} color="#059669" />
                          : <Circle size={17} color={item.risco ? '#dc2626' : '#94a3b8'} />
                        }
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: 13, color: feito ? '#059669' : item.risco ? '#7f1d1d' : '#111111', fontWeight: feito ? 600 : 500, lineHeight: 1.5, textDecoration: feito ? 'line-through' : 'none' }}>
                          {item.texto}
                        </p>
                        {item.lei && (
                          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'flex-start', gap: 4, lineHeight: 1.4 }}>
                            <Scale size={10} style={{ flexShrink: 0, marginTop: 2 }} />
                            {item.lei}
                          </p>
                        )}
                        {item.risco && !feito && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 10.5, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '2px 7px', borderRadius: 20 }}>
                            <AlertTriangle size={10} /> Risco de desfazimento
                          </span>
                        )}
                        {item.dica && (
                          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Info size={11} color="#0D63DB" />
                            <span style={{ fontSize: 11, color: '#0D63DB', fontWeight: 600 }}>{item.dica}</span>
                            {item.integracao === 'cnj' && onNavCNJ && (
                              <button onClick={(e) => { e.stopPropagation(); onNavCNJ(); }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: '#0D63DB', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 5, padding: '2px 7px', cursor: 'pointer', fontWeight: 700 }}>
                                <ExternalLink size={9} /> Abrir CNJ
                              </button>
                            )}
                            {item.integracao === 'certidoes' && onNavCertidoes && (
                              <button onClick={(e) => { e.stopPropagation(); onNavCertidoes(); }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: '#059669', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 5, padding: '2px 7px', cursor: 'pointer', fontWeight: 700 }}>
                                <FileSearch size={9} /> Certidões
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: '14px 0 0' }}>
        Progresso salvo automaticamente neste dispositivo
      </p>
    </div>
  );
}
