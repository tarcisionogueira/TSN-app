import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { registrarEvento } from '../utils/tracker.js';
import { termoDoProduto, versaoTermoProduto } from '../utils/termos';

// ─── RE-ACEITE DE TERMOS ATUALIZADOS (pedido do dono, 30/07) ─────────────────────
// Quando a versão vigente dos termos muda, todo usuário logado vê este popup ao
// entrar: pode ACEITAR ou FECHAR. Fechar deixa navegar, mas a GERAÇÃO DE RELATÓRIOS
// fica travada (gate em AnalisesContext → dispara 'abrir-termos-modal') até aceitar.
// O aceite grava: perfis.termos_uso_versao/aceito_em (gate barato) + linha em
// aceites_plano via /api/registrar-aceite (prova com IP + hash por trigger).
// NÃO aparece no modo suporte (impersonate): os termos são pessoais do usuário —
// mesma regra do KycParceiroModal (lição da sessão 17).

const VERSAO_VIGENTE = versaoTermoProduto('termos_uso');

// Cache do gate (evita 1 select por clique em "Gerar"). null = ainda não sabido.
let _pendenteCache = null;
export function invalidarCacheTermos() { _pendenteCache = null; }

// Usado pelo gate de relatórios: true = usuário precisa aceitar os termos vigentes.
export async function termosUsoPendente(userId) {
  if (!userId) return false;
  if (_pendenteCache !== null) return _pendenteCache;
  try {
    const { data } = await supabase.from('perfis').select('termos_uso_versao').eq('id', userId).maybeSingle();
    _pendenteCache = (data ? data.termos_uso_versao : null) !== VERSAO_VIGENTE;
  } catch { _pendenteCache = false; } // indisponível → não trava o produto por falha nossa
  return _pendenteCache;
}

export function abrirTermosModal(origem = '') {
  try { window.dispatchEvent(new CustomEvent('abrir-termos-modal', { detail: { origem } })); } catch { /* ignora */ }
}

export default function TermosAtualizadosModal() {
  const { user, impersonate } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [origem, setOrigem] = useState('');       // '' = login · 'relatorio' = trava do gerar
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [verTexto, setVerTexto] = useState(false);

  const termo = termoDoProduto('termos_uso');

  // NÃO ABRE MAIS SOZINHO AO LOGAR (15/08, decisão do dono: "veja a melhor hora para colocar
  // para aceitar novamente, como num upgrade de plano ou na hora de solicitar um saque").
  //
  // Antes, subir a versão dos termos fazia TODO usuário logado levar um popup de cara ao entrar
  // — um pedido burocrático no meio de qualquer coisa que a pessoa fosse fazer, e a primeira
  // coisa que ela via depois de uma atualização de texto que não pediu. Era também mais um
  // concorrente pela tela, no dia em que descobrimos que seis modais podiam se empilhar.
  //
  // O aceite passa a ser pedido NO MOMENTO EM QUE IMPORTA, por quem precisa dele:
  //   · gerar relatório  → AnalisesContext (já existia)
  //   · upgrade de plano → Checkout
  //   · pedido de saque  → Minha Rede (aqui o servidor JÁ exige: `saque.exige_termos_vigentes`;
  //                        sem este gate o cliente só descobriria pela recusa)
  // Todos chamam `abrirTermosModal(origem)`, que o efeito abaixo escuta.
  //
  // O aceite continua sendo pré-requisito real de saque no servidor — o que mudou é ONDE se
  // pergunta, não SE se exige. Ninguém passa a sacar sem aceitar.

  // Trava do relatório (ou qualquer outro ponto) pede para re-abrir.
  useEffect(() => {
    const h = (e) => { setOrigem(e?.detail?.origem || ''); setErro(''); setAberto(true); };
    window.addEventListener('abrir-termos-modal', h);
    return () => window.removeEventListener('abrir-termos-modal', h);
  }, []);

  const fechar = useCallback(() => {
    try { sessionStorage.setItem('tsn_termos_fechado', VERSAO_VIGENTE); } catch { /* ignora */ }
    try { registrarEvento('click', { alvo: 'Termos atualizados: fechou sem aceitar', detalhe: VERSAO_VIGENTE }); } catch { /* ignora */ }
    setAberto(false);
  }, []);

  const aceitar = useCallback(async () => {
    if (!user || salvando) return;
    setSalvando(true); setErro('');
    try {
      // 1) Gate barato no perfil (o que o app consulta).
      const { error: e1 } = await supabase.from('perfis')
        .update({ termos_uso_versao: VERSAO_VIGENTE, termos_uso_aceito_em: new Date().toISOString() })
        .eq('id', user.id);
      if (e1) throw e1;
      // 2) Prova forte: aceite com IP capturado no servidor + hash por trigger.
      apiCall('/api/registrar-aceite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plano_key: 'termos_uso', valor: null, user_agent: navigator.userAgent, termos_versao: VERSAO_VIGENTE }),
      }).catch(() => { /* best-effort: o gate já está satisfeito */ });
      _pendenteCache = false;
      try { window.dispatchEvent(new CustomEvent('termos-uso-aceitos')); } catch { /* ignora */ }
      setAberto(false);
    } catch {
      setErro('Não foi possível registrar o aceite agora. Tente novamente.');
    } finally { setSalvando(false); }
  }, [user, salvando]);

  if (!aberto || !user || impersonate) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 16, maxWidth: 560, width: '100%', maxHeight: '86vh', overflowY: 'auto', padding: '26px 26px 20px', boxShadow: '0 24px 70px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#111' }}>📜 Atualizamos os termos da plataforma</h3>
          <button onClick={fechar} title="Fechar sem aceitar" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>✕</button>
        </div>

        {/* Comentários/explicações do re-aceite (pedido do dono: o popup deve explicar) */}
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: '12px 0 0' }}>
          Os <a href="#/termos" target="_blank" rel="noreferrer" style={{ color: '#0D63DB', fontWeight: 700 }}>Termos de Uso</a> e a{' '}
          <a href="#/privacidade" target="_blank" rel="noreferrer" style={{ color: '#0D63DB', fontWeight: 700 }}>Política de Privacidade</a>{' '}
          foram atualizados (versão <b>{VERSAO_VIGENTE}</b>). A nova versão deixa mais claros pontos importantes para você:
        </p>
        <ul style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6, margin: '8px 0 0', paddingLeft: 18 }}>
          <li>os relatórios e análises são <b>informação e apoio à decisão</b> — não são garantia de resultado nem recomendação de investimento;</li>
          <li>parte das análises usa <b>inteligência artificial</b> e fontes públicas de terceiros, que podem conter imprecisões — confira sempre o edital e a matrícula nas fontes oficiais;</li>
          <li>a BidPro <b>não é leiloeiro nem banco</b> e não conduz os leilões divulgados;</li>
          <li>a arrematação em leilão envolve <b>riscos que correm por conta do arrematante</b> (ocupação, débitos, anulação do certame, custos extras);</li>
          <li>como seus <b>dados pessoais</b> são tratados (LGPD) e como este aceite é registrado (data, hora, IP e código de verificação).</li>
        </ul>

        <div style={{ marginTop: 10 }}>
          <button onClick={() => setVerTexto(v => !v)} style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>
            {verTexto ? 'Ocultar a declaração de aceite' : 'Ver a declaração de aceite completa'}
          </button>
          {verTexto && (
            <p style={{ fontSize: 11.5, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{termo.texto}</p>
          )}
        </div>

        {origem === 'relatorio' && (
          <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#92400e' }}>
            ⚠️ Para <b>gerar relatórios</b> é necessário aceitar os termos atualizados. Sem o aceite, a geração permanece bloqueada.
          </div>
        )}
        <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#64748b' }}>
          Você pode <b>fechar</b> esta janela e continuar navegando normalmente. Porém, enquanto não aceitar,
          a <b>geração de novos relatórios fica bloqueada</b> — ao tentar gerar, esta janela reaparece.
          O aceite é registrado com data, hora, IP e código de verificação, e vale como sua concordância eletrônica.
        </div>

        {erro && <div style={{ marginTop: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, color: '#b91c1c' }}>{erro}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={aceitar} disabled={salvando}
            style={{ flex: 1, padding: '12px', background: salvando ? '#94a3b8' : '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: salvando ? 'wait' : 'pointer' }}>
            {salvando ? 'Registrando…' : 'Li e aceito os termos atualizados'}
          </button>
          <button onClick={fechar} style={{ padding: '12px 16px', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}
