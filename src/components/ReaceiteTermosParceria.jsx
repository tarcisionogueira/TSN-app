import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { TermoParceiroModal, TERMO_PARCEIRO_VERSAO } from './ConviteParceiro';
import { TermoJuridicoModal, TERMO_JURIDICO_VERSAO } from './TermoJuridico';

// ─── NOVO ACEITE OBRIGATÓRIO (10/10, pedido do dono) ─────────────────────────────────────────
// Quem JÁ aceitou o termo de parceiro ou o jurídico numa versão anterior precisa aceitar a atual
// (parceiro v10 / jurídico v7 trazem a cláusula "a BidPro recebe e repassa; responde fiscalmente
// só pela própria parcela"). Bloqueante: não fecha sem aceitar. Quem nunca aceitou continua no
// fluxo de sempre (card de convite / portal do advogado) — aqui só entra a versão VENCIDA.
// Não aparece no modo suporte nem na simulação: o aceite é pessoal.
// Prova: a RPC grava versão e data no perfil; /api/registrar-aceite guarda IP + hash.
export default function ReaceiteTermosParceria() {
  const { user, impersonate, roleSimulado } = useAuth();
  const [pend, setPend] = useState(null); // 'parceiro' | 'juridico' | null
  const [concordo, setConcordo] = useState(false);
  const [aceitando, setAceitando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!user?.id || impersonate || roleSimulado) { setPend(null); return; }
    let vivo = true;
    supabase.from('perfis').select('role,parceiro_aceite_em,parceiro_aceite_versao,juridico_aceite_em,juridico_aceite_versao').eq('id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        // Leitura falhou → não bloqueia a conta por falha nossa (o próximo login tenta de novo).
        if (error || !data) { if (error) console.error('[reaceite] leitura do perfil:', error.message); return; }
        if (data.role === 'advogado' && data.juridico_aceite_em && data.juridico_aceite_versao !== TERMO_JURIDICO_VERSAO) setPend('juridico');
        else if (data.role !== 'admin' && data.parceiro_aceite_em && data.parceiro_aceite_versao !== TERMO_PARCEIRO_VERSAO) setPend('parceiro');
        else setPend(null);
      });
    return () => { vivo = false; };
  }, [user?.id, impersonate, roleSimulado]);

  if (!pend) return null;

  const aceitar = async () => {
    if (!concordo || aceitando) return;
    setAceitando(true); setErro('');
    const versao = pend === 'juridico' ? TERMO_JURIDICO_VERSAO : TERMO_PARCEIRO_VERSAO;
    const { data, error } = await supabase.rpc(pend === 'juridico' ? 'aceitar_termo_juridico' : 'aceitar_parceria', { p_versao: versao });
    if (error || !data) {
      setAceitando(false);
      setErro(error?.message || 'Não foi possível registrar o aceite. Tente de novo.');
      return;
    }
    // Prova forte (IP + hash). O gate já está satisfeito; falha aqui só fica no log.
    apiCall('/api/registrar-aceite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plano_key: pend === 'juridico' ? 'termo_juridico' : 'termo_parceiro', valor: null, user_agent: navigator.userAgent, termos_versao: versao }),
    }).catch((e) => console.error('[reaceite] registrar-aceite:', e?.message));
    setAceitando(false); setConcordo(false); setPend(null);
  };

  const aviso = (
    <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 4001, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, maxWidth: 520, textAlign: 'center' }}>
      Atualizamos o termo: a BidPro apenas recebe e repassa a sua parte. Para continuar, aceite a nova versão.
      {erro && <div style={{ color: '#b91c1c', marginTop: 4 }}>{erro}</div>}
    </div>
  );
  return (
    <>
      {aviso}
      {pend === 'juridico'
        ? <TermoJuridicoModal bloqueante onFechar={() => {}} onAceitar={aceitar} concordo={concordo} setConcordo={setConcordo} aceitando={aceitando} />
        : <TermoParceiroModal bloqueante onFechar={() => {}} onAceitar={aceitar} concordo={concordo} setConcordo={setConcordo} aceitando={aceitando} />}
    </>
  );
}
