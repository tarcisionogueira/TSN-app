import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { apiCall } from '../utils/apiCall';
import { registrarEvento } from '../utils/tracker.js';
import { supabase } from '../utils/supabase';
import { termosUsoPendente, abrirTermosModal } from '../components/TermosAtualizadosModal';

// Acompanhamento GLOBAL das análises (mercadológica E documental).
// A GERAÇÃO RODA NO SERVIDOR (/api/gerar-analise e /api/gerar-documental): o
// cliente dispara e pode FECHAR a aba — a função continua e grava em
// `analises_mercado` / `analises_documental`. Este contexto lê do banco (fonte da
// verdade, vale entre dispositivos) e usa localStorage só como cache para pintar
// o menu na hora. Exibido no menu "Análises" do topo.
const AnalisesContext = createContext(null);
const LS_KEY = 'bidpro_analises_v1';
const LS_KEY_DOC = 'bidpro_analises_doc_v1';
const LS_KEY_LAUDO = 'bidpro_analises_laudo_v1';
const MAX = 12;

function loadCache(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }

// A função serverless de geração tem maxDuration de 5 min. Se ela morrer (timeout
// da Vercel, OOM, deploy no meio) sem gravar 'concluida'/'erro', a linha fica em
// 'gerando' PARA SEMPRE e o app gira o loader eternamente. Após esta folga,
// tratamos como falha: o card volta a permitir "Gerar" (o cron limpa a linha no
// banco). Assim um relatório NUNCA trava a tela.
const STALE_GERANDO_MS = 9 * 60 * 1000;
const rowToEntry = (r) => {
  const updatedAt = r.updated_at ? Date.parse(r.updated_at) : Date.now();
  let status = r.status, erro = r.erro || null;
  if (status === 'gerando' && (Date.now() - updatedAt) > STALE_GERANDO_MS) {
    status = 'erro';
    erro = erro || 'A geração excedeu o tempo limite. Gere novamente.';
  }
  return {
    imovelId: r.imovel_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
    imovel: r.imovel || null, status, result: r.result || null, erro,
    startedAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    updatedAt,
    // Barra de evolução das etapas. Desde 13/08 vale para os TRÊS relatórios (mercadológico,
    // documental e laudo) — as três tabelas têm a coluna e os três geradores emitem no mesmo
    // formato. Este normalizador é compartilhado, então não há nada a fazer por tabela.
    progresso: r.progresso || null,
    dataLeilao: r.data_leilao || null, // p/ calcular a expiração do relatório na tela
    // Divergências que o DOCUMENTAL achou contra a matrícula (cidade/metragem). O documental
    // já gravava isto em analises_mercado.correcoes_sugeridas, mas NINGUÉM lia de volta: o
    // aviso só existia na resposta HTTP daquela geração e sumia ao recarregar (ou nunca
    // aparecia, se a aba tinha sido fechada). Agora sobrevive ao reload.
    correcoesSugeridas: Array.isArray(r.correcoes_sugeridas?.correcoes) ? r.correcoes_sugeridas.correcoes : null,
  };
};

export function AnalisesProvider({ children }) {
  // No modo suporte (admin visualizando a conta de um cliente), lê/gera pelo
  // usuário efetivo (o cliente), não pelo admin logado — senão a lista vem vazia.
  const { user, effectiveUserId, impersonate } = useAuth();
  const uid = effectiveUserId || user?.id || null;

  // TRAVA de termos atualizados (regra do dono, 30/07): com termos vigentes pendentes
  // de aceite, NENHUM relatório é gerado — reabre o popup e não dispara a API. No modo
  // suporte não trava (os termos são pessoais do usuário, não do admin que atende).
  const exigirTermos = useCallback(async () => {
    if (impersonate) return true;
    if (await termosUsoPendente(user?.id)) { abrirTermosModal('relatorio'); return false; }
    return true;
  }, [user?.id, impersonate]);
  const [analises, setAnalises] = useState(() => loadCache(LS_KEY));
  const [documentais, setDocumentais] = useState(() => loadCache(LS_KEY_DOC));
  const [laudos, setLaudos] = useState(() => loadCache(LS_KEY_LAUDO));

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(analises.slice(0, MAX))); } catch {} }, [analises]);
  useEffect(() => { try { localStorage.setItem(LS_KEY_DOC, JSON.stringify(documentais.slice(0, MAX))); } catch {} }, [documentais]);
  useEffect(() => { try { localStorage.setItem(LS_KEY_LAUDO, JSON.stringify(laudos.slice(0, MAX))); } catch {} }, [laudos]);

  // Imóveis FIXADOS: os que alguma tela pediu explicitamente por id (ver garantirCarregado).
  // Sem isto o corte em MAX descartaria, no mesmo instante, a análise antiga que acabamos de
  // buscar — ela entra ordenada por updated_at e cai fora da fatia por ser velha.
  const fixados = React.useRef(new Set());
  const cortar = (todos) => {
    const ordenados = todos.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const dentro = ordenados.slice(0, MAX);
    const extras = ordenados.slice(MAX).filter(a => fixados.current.has(String(a.imovelId)));
    return extras.length ? dentro.concat(extras) : dentro;
  };

  const mergeInto = useCallback((setter) => (rows) => {
    setter(prev => {
      const byId = {};
      for (const a of prev) byId[a.imovelId] = a;
      for (const r of rows) { const e = rowToEntry(r); byId[e.imovelId] = { ...byId[e.imovelId], ...e }; }
      return cortar(Object.values(byId));
    });
  }, []);
  const mergeRows = useCallback((rows) => mergeInto(setAnalises)(rows), [mergeInto]);
  const mergeDocRows = useCallback((rows) => mergeInto(setDocumentais)(rows), [mergeInto]);
  const mergeLaudoRows = useCallback((rows) => mergeInto(setLaudos)(rows), [mergeInto]);

  // ESTE `limit(MAX)` É CACHE DO MENU DO TOPO — não é a janela de dados do app, e a partir de
  // 12/08 nada que precisa de completude depende dele: a lista de "Minhas Análises" vem da RPC
  // `minhas_analises_lista` (uma linha por imóvel, montada no servidor) e a tela de detalhe usa
  // `garantirCarregado(imovelId)`. A regra `mesma-janela-em-tabelas-diferentes` do
  // `verificar:padroes` marca este ponto de propósito: se alguém voltar a montar uma lista
  // cruzando estas três leituras truncadas, o corte cai em datas diferentes e a análise aparece
  // pela metade — foi exatamente assim que "o mercadológico sumiu" do painel do dono.
  const recarregar = useCallback(async () => {
    if (!uid) return;
    const [{ data: m }, { data: d }, { data: l }] = await Promise.all([
      supabase.from('analises_mercado').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(MAX),
      supabase.from('analises_documental').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(MAX),
      supabase.from('analises_laudo').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(MAX),
    ]);
    if (Array.isArray(m)) mergeRows(m);
    if (Array.isArray(d)) mergeDocRows(d);
    if (Array.isArray(l)) mergeLaudoRows(l);
  }, [uid, mergeRows, mergeDocRows, mergeLaudoRows]);

  // Ao logar (ou trocar o usuário efetivo no suporte), carrega do banco.
  useEffect(() => { setAnalises([]); setDocumentais([]); setLaudos([]); if (uid) recarregar(); }, [uid, recarregar]);

  // GARANTE que os relatórios DESTE imóvel estejam em memória, mesmo que ele esteja fora dos
  // MAX mais recentes. Por que existe (12/08): `recarregar` traz 12 linhas de CADA tabela; a
  // tela de detalhe lia só isso, então abrir uma análise antiga mostrava "não gerado" para um
  // relatório que estava no banco — e um clique em Gerar reprocessava a IA à toa. O `limit(12)`
  // é tamanho de cache do menu do topo; nunca foi para ser a janela de dados do app.
  const garantirCarregado = useCallback(async (imovelId) => {
    const id = imovelId ? String(imovelId) : '';
    if (!uid || !id) return true;
    fixados.current.add(id);
    const porImovel = (tabela) => supabase.from(tabela).select('*').eq('user_id', uid).eq('imovel_id', id).limit(1);
    const [m, d, l] = await Promise.all([porImovel('analises_mercado'), porImovel('analises_documental'), porImovel('analises_laudo')]);
    // `{ data, error }` do postgrest-js NÃO lança em não-2xx: sem checar `error`, uma falha de
    // leitura viraria "este imóvel não tem relatório" — que é o defeito que esta função conserta.
    const falha = m.error || d.error || l.error;
    if (falha) {
      registrarEvento('api_erro', { alvo: 'analises_por_imovel', detalhe: `imovel=${id}: ${falha.message || 'erro'}` });
      return false;
    }
    if (m.data?.length) mergeRows(m.data);
    if (d.data?.length) mergeDocRows(d.data);
    if (l.data?.length) mergeLaudoRows(l.data);
    return true;
  }, [uid, mergeRows, mergeDocRows, mergeLaudoRows]);

  // VARREDURA anti-fantasma: um 'gerando' pode existir SÓ no cache local (sem linha no banco
  // p/ o merge corrigir) quando a aba fecha no meio, o servidor bloqueia no gate (cota/crédito)
  // antes de criar a linha, ou a sequência automática dispara e é interrompida. Aí o card gira
  // "Gerando…" para sempre e o polling nunca para. Aqui rebaixamos qualquer 'gerando' mais velho
  // que STALE_GERANDO_MS para 'erro' (mesmo sem linha no banco) — some o spinner e para o polling.
  useEffect(() => {
    const demote = (list) => {
      let mudou = false;
      const out = list.map(a => {
        // Régua = `updatedAt` (o carimbo que o SERVIDOR desliza a cada upsert), igual ao
        // rowToEntry acima. Com `startedAt` primeiro, uma REGERAÇÃO era rebaixada em ≤30s: o
        // startedAt vem do `created_at` da linha — a data da 1ª geração, não desta —, então
        // `Date.now() - startedAt` já nascia acima do limite. A tela dizia "excedeu o tempo
        // limite" com o servidor ainda gerando, o polling parava (temGerando=false) e o
        // resultado real nunca chegava; clicar de novo consumia cota outra vez.
        if (a.status === 'gerando' && Date.now() - (a.updatedAt || a.startedAt || 0) > STALE_GERANDO_MS) {
          mudou = true;
          return { ...a, status: 'erro', erro: a.erro || 'A geração excedeu o tempo limite. Gere novamente.' };
        }
        return a;
      });
      return mudou ? out : list; // mesma referência quando nada muda → React não re-renderiza à toa
    };
    const varrer = () => { setAnalises(demote); setDocumentais(demote); setLaudos(demote); };
    varrer();
    const t = setInterval(varrer, 30000);
    return () => clearInterval(t);
  }, []);

  // Enquanto houver geração em andamento (de qualquer tipo), faz polling.
  const temGerando = analises.some(a => a.status === 'gerando') || documentais.some(a => a.status === 'gerando') || laudos.some(a => a.status === 'gerando');
  useEffect(() => {
    if (!uid || !temGerando) return;
    const t = setInterval(recarregar, 12000);
    return () => clearInterval(t);
  }, [uid, temGerando, recarregar]);

  const upsertInto = useCallback((setter) => (entry) => {
    setter(prev => {
      const old = prev.find(a => a.imovelId === entry.imovelId) || {};
      const rest = prev.filter(a => a.imovelId !== entry.imovelId);
      return cortar([{ ...old, ...entry, updatedAt: Date.now() }, ...rest]);
    });
  }, []);
  const upsert = useCallback((e) => upsertInto(setAnalises)(e), [upsertInto]);
  const upsertDoc = useCallback((e) => upsertInto(setDocumentais)(e), [upsertInto]);
  const upsertLaudo = useCallback((e) => upsertInto(setLaudos)(e), [upsertInto]);

  // ═══ FALHA DE REDE NÃO É FALHA DE GERAÇÃO (14/08) ═══════════════════════════════════════
  // Caso real, imóvel em Itapevi: clique em Gerar às 13:00:15; a conexão do fetch caiu às
  // 13:01:58 ("Load failed"); o SERVIDOR seguiu trabalhando e concluiu às 13:03:40. A tela,
  // porém, pintou "Falha de conexão ao gerar. Tente novamente." no instante da queda, e só
  // voltou ao normal quando o polling releu o banco — o cliente viu um erro que nunca existiu
  // e a análise "se consertou sozinha". Além de custar credibilidade, convida ao clique em
  // Gerar de novo, que QUEIMA COTA e reprocessa IA de um relatório que já estava pronto.
  //
  // A geração é server-side e persistente (o cabeçalho deste arquivo diz: o cliente pode
  // FECHAR A ABA). Logo, perder a conexão HTTP significa "perdi o canal ao vivo", não
  // "a geração falhou" — e o banco é a fonte da verdade. Antes de acusar erro, perguntamos
  // ao banco. Isto também cobre o 504 do gateway, que hoje cai neste mesmo catch (o corpo
  // HTML quebra o `r.json()`).
  //
  // Se não houver linha nenhuma depois das tentativas, aí sim foi falha de verdade (o pedido
  // não chegou) e o erro aparece como antes. O teto é curto de propósito: ~24s de spinner no
  // pior caso é melhor que um erro falso, e o watchdog de STALE_GERANDO_MS segue como rede.
  const RECONCILIAR_TENTATIVAS = 3;
  const RECONCILIAR_INTERVALO_MS = 8000;
  const reconciliarFalhaDeRede = useCallback(async ({ imovelId, tabela, alvo, merge }) => {
    if (!uid || !imovelId) return false;
    for (let i = 0; i < RECONCILIAR_TENTATIVAS; i++) {
      // `{ data, error }` do postgrest-js NÃO lança em não-2xx: sem checar `error`, uma falha
      // de leitura viraria "não existe linha" e voltaríamos a acusar o erro que não houve.
      const { data, error } = await supabase.from(tabela).select('*')
        .eq('user_id', uid).eq('imovel_id', imovelId).limit(1);
      if (!error && data?.length) {
        merge(data); // pinta o estado REAL do servidor (inclusive um 'erro' legítimo dele)
        if (data[0].status === 'gerando' || data[0].status === 'concluida') {
          // Erro que o cliente NÃO viu: invisível na tela, visível no Cliente 360 (pedido do
          // dono). Sem este evento, um problema de rede recorrente ficaria indistinguível de
          // "nada aconteceu" — some da tela e some do diagnóstico junto.
          registrarEvento('geracao_recuperada', {
            alvo,
            detalhe: `conexão caiu, servidor seguiu (${data[0].status}) imovel=${imovelId}`,
          });
        }
        return true;
      }
      if (i < RECONCILIAR_TENTATIVAS - 1) await new Promise(r => setTimeout(r, RECONCILIAR_INTERVALO_MS));
    }
    return false;
  }, [uid]);

  // meta: { imovelId, titulo, cidade, estado, imovel } ; payload: { mercadoInputs, parecerInputs }
  const iniciar = useCallback(async (meta, payload) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    if (!(await exigirTermos())) return; // termos pendentes → popup, sem gerar
    upsert({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-analise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, paraUserId: meta.paraUserId || undefined, ...payload }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsert({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) { registrarEvento('api_erro', { alvo: 'gerar-analise', detalhe: `erro_corpo imovel=${imovelId}: ${d.error}` }); upsert({ imovelId, status: 'erro', erro: d.error }); }
      // Resposta sem result nem error → NUNCA deixa preso em 'gerando' (o recarregar
      // reconcilia com o banco caso o servidor ainda esteja processando de verdade).
      else { registrarEvento('api_erro', { alvo: 'gerar-analise', detalhe: `resposta_vazia imovel=${imovelId}` }); upsert({ imovelId, status: 'erro', erro: 'Não foi possível gerar agora. Tente novamente.' }); }
      recarregar();
    }).catch(async () => {
      registrarEvento('api_erro', { alvo: 'gerar-analise', detalhe: `falha_ou_500 imovel=${imovelId}` });
      // Pergunta ao banco antes de acusar erro — ver reconciliarFalhaDeRede.
      if (await reconciliarFalhaDeRede({ imovelId, tabela: 'analises_mercado', alvo: 'gerar-analise', merge: mergeRows })) return;
      upsert({ imovelId, status: 'erro', erro: 'Falha de conexão ao gerar. Tente novamente.' });
      recarregar();
    });
  }, [upsert, recarregar, exigirTermos, reconciliarFalhaDeRede, mergeRows]);

  // Documental: dispara /api/gerar-documental (server-side, persistente).
  // payload pode trazer textoEdital/textoMatricula/processoNumero/processoNome/urlEdital.
  const iniciarDocumental = useCallback(async (meta, payload = {}) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    if (!(await exigirTermos())) return; // termos pendentes → popup, sem gerar
    upsertDoc({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-documental', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, paraUserId: meta.paraUserId || undefined, ...payload }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsertDoc({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) { registrarEvento('api_erro', { alvo: 'gerar-documental', detalhe: `erro_corpo imovel=${imovelId}: ${d.error}` }); upsertDoc({ imovelId, status: 'erro', erro: d.error }); }
      else { registrarEvento('api_erro', { alvo: 'gerar-documental', detalhe: `resposta_vazia imovel=${imovelId}` }); upsertDoc({ imovelId, status: 'erro', erro: 'Não foi possível gerar agora. Tente novamente.' }); }
      recarregar();
    }).catch(async () => {
      registrarEvento('api_erro', { alvo: 'gerar-documental', detalhe: `falha_ou_500 imovel=${imovelId}` });
      if (await reconciliarFalhaDeRede({ imovelId, tabela: 'analises_documental', alvo: 'gerar-documental', merge: mergeDocRows })) return;
      upsertDoc({ imovelId, status: 'erro', erro: 'Falha de conexão ao gerar. Tente novamente.' });
      recarregar();
    });
  }, [upsertDoc, recarregar, exigirTermos, reconciliarFalhaDeRede, mergeDocRows]);

  // Laudo de viabilidade (3º documento): consolida mercadológico + documental no
  // servidor (/api/gerar-laudo-viabilidade). Não reprocessa fontes pagas.
  const iniciarLaudo = useCallback(async (meta) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    if (!(await exigirTermos())) return; // termos pendentes → popup, sem gerar
    upsertLaudo({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-laudo-viabilidade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, paraUserId: meta.paraUserId || undefined }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsertLaudo({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) { registrarEvento('api_erro', { alvo: 'gerar-laudo-viabilidade', detalhe: `erro_corpo imovel=${imovelId}: ${d.error}` }); upsertLaudo({ imovelId, status: 'erro', erro: d.error }); }
      else { registrarEvento('api_erro', { alvo: 'gerar-laudo-viabilidade', detalhe: `resposta_vazia imovel=${imovelId}` }); upsertLaudo({ imovelId, status: 'erro', erro: 'Não foi possível gerar agora. Tente novamente.' }); }
      recarregar();
    }).catch(async () => {
      registrarEvento('api_erro', { alvo: 'gerar-laudo-viabilidade', detalhe: `falha_ou_500 imovel=${imovelId}` });
      if (await reconciliarFalhaDeRede({ imovelId, tabela: 'analises_laudo', alvo: 'gerar-laudo-viabilidade', merge: mergeLaudoRows })) return;
      upsertLaudo({ imovelId, status: 'erro', erro: 'Falha de conexão ao gerar. Tente novamente.' });
      recarregar();
    });
  }, [upsertLaudo, recarregar, exigirTermos, reconciliarFalhaDeRede, mergeLaudoRows]);

  const getAnalise = useCallback((imovelId) => analises.find(a => a.imovelId === imovelId) || null, [analises]);
  const getDocumental = useCallback((imovelId) => documentais.find(a => a.imovelId === imovelId) || null, [documentais]);
  const getLaudo = useCallback((imovelId) => laudos.find(a => a.imovelId === imovelId) || null, [laudos]);

  const remover = useCallback(async (imovelId) => {
    setAnalises(prev => prev.filter(a => a.imovelId !== imovelId));
    setDocumentais(prev => prev.filter(a => a.imovelId !== imovelId));
    setLaudos(prev => prev.filter(a => a.imovelId !== imovelId));
    if (uid) {
      try { await supabase.from('analises_mercado').delete().eq('user_id', uid).eq('imovel_id', imovelId); } catch {}
      try { await supabase.from('analises_documental').delete().eq('user_id', uid).eq('imovel_id', imovelId); } catch {}
      try { await supabase.from('analises_laudo').delete().eq('user_id', uid).eq('imovel_id', imovelId); } catch {}
    }
  }, [uid]);

  const emAndamento = analises.filter(a => a.status === 'gerando').length + documentais.filter(a => a.status === 'gerando').length + laudos.filter(a => a.status === 'gerando').length;

  return (
    <AnalisesContext.Provider value={{ analises, documentais, laudos, iniciar, iniciarDocumental, iniciarLaudo, getAnalise, getDocumental, getLaudo, remover, emAndamento, recarregar, garantirCarregado }}>
      {children}
    </AnalisesContext.Provider>
  );
}

export function useAnalises() {
  return useContext(AnalisesContext) || { analises: [], documentais: [], laudos: [], iniciar: () => {}, iniciarDocumental: () => {}, iniciarLaudo: () => {}, getAnalise: () => null, getDocumental: () => null, getLaudo: () => null, remover: () => {}, emAndamento: 0, recarregar: () => {}, garantirCarregado: async () => true };
}
