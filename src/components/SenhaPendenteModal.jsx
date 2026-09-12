import React, { useEffect, useState } from 'react';
import { X, KeyRound, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { senhaForte, MSG_SENHA_FRACA } from '../lib/senha';
import { useVezDoModal } from '../utils/filaModais';

/**
 * POP-UP "DEFINA SUA SENHA" — quem entrou pela inscrição na aula ao vivo optando por
 * "explorar agora" (RedefinirSenha.jsx) nunca digitou uma senha própria: a conta nasceu com
 * uma senha aleatória em api/live-inscrever.js. Sem isto, o único jeito de definir senha
 * depois é lembrar de "Esqueci minha senha" — pedido do dono (11-12/09): "agradecendo o
 * acesso... e solicitar que ele cadastre naquele momento a senha dele, bem simples".
 *
 * A dívida é `perfis.senha_pendente` (ver supabase/migrations/perfis_senha_pendente.sql) —
 * só fica `true` para quem nasceu por este caminho especificamente; todo outro cadastro já
 * pede senha própria no próprio formulário e nunca liga esta flag. Mesmo padrão do
 * BoasVindasModal: pode fechar ("agora não"), e volta no próximo acesso até resolver.
 *
 * SÓ UM CAMPO, DE PROPÓSITO ("bem simples", pedido do dono) — sem confirmar senha nem
 * medidor de força, diferente de RedefinirSenha.jsx (que é a troca de senha "séria", motivada
 * por um link de recuperação). Aqui é o primeiro contato: menos fricção, mesma regra de força
 * por trás (`senhaForte`), erro só aparece se a pessoa tentar salvar algo fraco.
 */
const DISPENSA_KEY = 'tsn_senhapendente_dispensado'; // por SESSÃO: volta no próximo acesso

export default function SenhaPendenteModal() {
  const { user, impersonate, effectiveUserId } = useAuth();
  const [pendente, setPendente] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    // Modo suporte: o que vale é o atendimento, não a ficha de quem a equipe está olhando.
    if (!user || impersonate) return;
    if (sessionStorage.getItem(DISPENSA_KEY) === '1') { setCarregado(true); return; }
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.from('perfis').select('senha_pendente')
        .eq('id', effectiveUserId || user.id).single();
      if (cancelado) return;
      // Falha de leitura não é "não deve nada" — silenciar aqui faria o popup nunca aparecer
      // pra ninguém num soluço de rede, sem deixar rastro (mesma régua do BoasVindasModal).
      if (error) { console.warn('[senha-pendente] leitura falhou:', error.message); setCarregado(true); return; }
      setPendente(!!data?.senha_pendente);
      setCarregado(true);
    })();
    return () => { cancelado = true; };
  }, [user, impersonate, effectiveUserId]);

  useEffect(() => { if (carregado && pendente) setAberto(true); }, [carregado, pendente]);

  const minhaVez = useVezDoModal('senha-pendente', aberto);
  if (!minhaVez) return null;

  function fechar() {
    sessionStorage.setItem(DISPENSA_KEY, '1');
    setAberto(false);
  }

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    if (!senhaForte(senha)) { setErro(MSG_SENHA_FRACA); return; }
    setSalvando(true);
    try {
      const { error: eSenha } = await supabase.auth.updateUser({ password: senha });
      if (eSenha) throw eSenha;
      const uid = effectiveUserId || user.id;
      const { error: ePerfil } = await supabase.from('perfis').update({ senha_pendente: false }).eq('id', uid);
      // A senha JÁ foi trocada — não perder isso por causa de um UPDATE que falhou. O popup só
      // voltaria por engano no próximo acesso, e a senha nova continua valendo.
      if (ePerfil) console.warn('[senha-pendente] nao desligou a flag:', ePerfil.message);
      setPendente(false);
      setAberto(false);
    } catch (err) {
      setErro(err?.message || 'Não foi possível salvar a senha agora. Tente de novo.');
    }
    setSalvando(false);
  }

  return (
    <div
      onClick={(ev) => { if (ev.target === ev.currentTarget) fechar(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(3px)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ background: 'white', borderRadius: 18, maxWidth: 460, width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '20px 22px 0' }}>
          <div style={{ width: 42, height: 42, minWidth: 0, borderRadius: 12, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <KeyRound size={20} color="#0D63DB" />
          </div>
          <button onClick={fechar} aria-label="Fechar"
            style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <X size={16} color="#475569" />
          </button>
        </div>

        <div style={{ padding: '14px 22px 0' }}>
          <h2 style={{ fontSize: 19, fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>
            Você já está dentro! 🎉
          </h2>
          <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: '0 0 4px' }}>
            Seu acesso à BidPro Brasil já está liberado — e com certeza você vai encontrar por
            aqui a oportunidade ideal pra você, ou pode acompanhar o acervo sempre que quiser.
            Pra aproveitar melhor, dá uma olhada no vídeo de orientação inicial que vem a seguir.
          </p>
          <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: '10px 0 0' }}>
            Só uma coisa antes: crie sua senha para poder voltar sempre que quiser, de onde
            estiver. É rápido — menos de 10 segundos:
          </p>
        </div>

        <form onSubmit={salvar} style={{ padding: '14px 22px 22px' }}>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <input
              type={mostrar ? 'text' : 'password'}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Crie sua senha"
              autoFocus
              style={{ width: '100%', padding: '13px 44px 13px 14px', border: '1px solid #cbd5e1', borderRadius: 11, fontSize: 15, boxSizing: 'border-box', color: '#0f172a', fontFamily: 'inherit' }}
            />
            <button type="button" onClick={() => setMostrar((v) => !v)}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
              {mostrar ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {erro && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>{erro}</div>
          )}
          <button type="submit" disabled={salvando}
            style={{ width: '100%', padding: 13, background: salvando ? '#94a3b8' : '#0D63DB', color: '#fff', border: 'none', borderRadius: 11, fontWeight: 800, fontSize: 14.5, cursor: salvando ? 'default' : 'pointer', fontFamily: 'inherit', marginBottom: 8 }}>
            {salvando ? 'Salvando…' : 'Criar senha e continuar explorando'}
          </button>
          <button type="button" onClick={fechar}
            style={{ width: '100%', background: 'transparent', border: 'none', color: '#64748b', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '4px' }}>
            Prefiro decidir depois
          </button>
        </form>
      </div>
    </div>
  );
}
