import React, { useEffect, useRef, useState } from 'react';

// Widget Cloudflare Turnstile — usado no cadastro (Login.jsx) para dificultar criação de
// conta em massa/automatizada (achado 16/09: contas de teste com e-mail descartável
// navegando o site inteiro; ver bloqueia_cadastro_email_descartavel.sql, que resolve o
// vetor de DOMÍNIO, mas não o de VOLUME — Turnstile é o complemento).
//
// SEM `VITE_TURNSTILE_SITE_KEY` configurada, o componente não renderiza NADA (retorna null)
// e `onVerify` nunca é chamado — o cadastro segue funcionando exatamente como antes. Isso é
// deliberado: o código pode ir pro ar ANTES da site key existir, sem quebrar ninguém, e o
// gate real (Login.jsx) só passa a EXIGIR o token quando a env var está presente — ver
// `turnstileAtivo` lá.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let scriptPromise = null;
function carregarScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; s.remove(); reject(new Error('Falha ao carregar o Turnstile')); };
    document.head.appendChild(s);
    // Rede que não responde nem com erro (iCloud Private Relay, bloqueador, 5G instável) deixava a
    // promessa pendente PARA SEMPRE: sem widget, sem token, botão travado e nenhum aviso (17/10).
    setTimeout(() => {
      if (window.turnstile) return;
      scriptPromise = null; s.remove();
      reject(new Error('Turnstile não carregou em 12 s'));
    }, 12000);
  });
  return scriptPromise;
}

/**
 * @param {(token: string) => void} onVerify - chamado com o token quando o desafio é resolvido
 * @param {() => void} [onExpire] - token expirou (Turnstile expira em ~5min) — o chamador deve
 *   voltar a bloquear o envio até um novo token chegar
 * @param {string} [resetKey] - troque este valor (ex.: contador de tentativas) para forçar o
 *   widget a recarregar e gerar um token novo — necessário porque um token do Turnstile só
 *   pode ser usado UMA vez; depois de um submit que falhou por outro motivo (senha fraca,
 *   e-mail duplicado…), o token antigo já foi consumido e o Supabase recusaria o próximo
 *   envio silenciosamente com o mesmo token.
 */
export default function TurnstileWidget({ onVerify, onExpire, resetKey }) {
  const elRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelado = false;
    carregarScript()
      .then(() => {
        if (cancelado || !elRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(elRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onVerify?.(token),
          'expired-callback': () => onExpire?.(),
          // Falha do próprio desafio (rede, bloqueio de script por extensão…): não deve
          // travar o cadastro pra sempre numa tela sem saída — melhor deixar o gate normal
          // (sem Turnstile) do que um visitante legítimo preso por causa da infra do captcha.
          'error-callback': () => { setErro(true); onVerify?.(null); },
          'unsupported-callback': () => { setErro(true); onVerify?.(null); },
        });
      })
      .catch((e) => { console.warn('[turnstile]', e?.message); setErro(true); });
    return () => {
      cancelado = true;
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* já removido */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, tentativa]);

  if (!SITE_KEY) return null;
  // O Supabase EXIGE o token: sumir com o widget em silêncio deixava o botão apagado sem
  // explicação (o visitante conclui que o site travou). A falha tem que ser dita, com saída.
  if (erro) {
    return (
      <div role="alert" style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
        Não foi possível carregar a verificação de segurança (Cloudflare). Verifique a conexão,
        desative bloqueadores de conteúdo/VPN ou a Retransmissão Privada do iCloud e tente de novo.
        <button type="button" onClick={() => { setErro(false); setTentativa(n => n + 1); }}
          style={{ display: 'block', marginTop: 8, background: '#92400e', color: 'white', border: 'none', borderRadius: 6, padding: '6px 12px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          Tentar novamente
        </button>
      </div>
    );
  }
  return <div ref={elRef} style={{ margin: '4px 0' }} />;
}

export const turnstileConfigurado = !!SITE_KEY;
