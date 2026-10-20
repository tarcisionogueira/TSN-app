// CAPTCHA FORA DO LOGIN.JSX (#234, 20/10). O Supabase Auth exige `captchaToken` em signUp e no login por senha
// (`/token?grant_type=password`): sem ele, "400 captcha protection: request disallowed (no captcha_token found)"
// — medido no auth_logs de 19/10. O Login.jsx já mandava; Checkout, Promo, ProdutoLanding, ProdutoPublico e
// ConviteEquipe não, então o login automático depois de criar a conta falhava SEMPRE ("Conta criada! Não
// conseguimos entrar automaticamente…"). Este hook concentra o que o Login.jsx faz à mão:
//   const captcha = useCaptcha();
//   … {captcha.widget}  (no formulário, perto do botão)
//   await supabase.auth.signInWithPassword({ email, password, options: captcha.opcoes() });
// `opcoes()` devolve { captchaToken } e já pede um token NOVO ao widget (o do Turnstile é de uso único).
// Sem a site key configurada, nada aparece e `opcoes()` devolve {} — mesmo rollout seguro do Login.jsx.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import TurnstileWidget, { turnstileConfigurado } from '../components/TurnstileWidget.jsx';

export function useCaptcha() {
  const [token, setToken] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  const tokenRef = useRef(null);

  const receber = useCallback((t) => { tokenRef.current = t || null; setToken(t || null); }, []);
  const expirar = useCallback(() => { tokenRef.current = null; setToken(null); }, []);

  // Consome o token atual e recarrega o widget para o próximo envio.
  const opcoes = useCallback(() => {
    if (!turnstileConfigurado) return {};
    const t = tokenRef.current;
    tokenRef.current = null; setToken(null); setTentativa((n) => n + 1);
    return t ? { captchaToken: t } : {};
  }, []);

  // Para o login AUTOMÁTICO depois de criar a conta: entre o clique e o login há o código por e-mail (#251), e o
  // token pode ter expirado (~5 min) ou já ter sido usado. Espera o widget emitir um novo (até `ms`) em vez de mandar
  // sem token e cair em "não conseguimos entrar automaticamente".
  const aguardarOpcoes = useCallback(async (ms = 20000) => {
    if (!turnstileConfigurado) return {};
    const fim = Date.now() + ms;
    while (!tokenRef.current && Date.now() < fim) await new Promise((ok) => setTimeout(ok, 250));
    return opcoes();
  }, [opcoes]);

  const widget = useMemo(() => (turnstileConfigurado
    ? <TurnstileWidget onVerify={receber} onExpire={expirar} resetKey={tentativa} />
    : null), [receber, expirar, tentativa]);

  return {
    widget,
    opcoes,
    aguardarOpcoes,
    // true enquanto o desafio não terminou — os formulários travam o botão com isto.
    pendente: turnstileConfigurado && !token,
    configurado: turnstileConfigurado,
  };
}
