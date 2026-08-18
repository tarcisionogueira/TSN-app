import { supabase } from './supabase';
import { registrarEvento } from './tracker.js';

/**
 * Wrapper para fetch das APIs internas.
 * Injeta automaticamente o token de autenticação do usuário logado.
 */
export async function apiCall(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const rota = String(path).split('?')[0].slice(0, 120);
  let res;
  try {
    res = await fetch(path, { ...options, headers });
  } catch (e) {
    // Falha de REDE (offline/timeout/DNS) lançava antes de qualquer registro → o catch do
    // chamador engolia e o Cliente 360 nunca via. Registra e RE-LANÇA (contrato inalterado).
    try { registrarEvento('api_falha_rede', { alvo: rota, detalhe: String(e?.message || e).slice(0, 120) }); } catch { /* ignora */ }
    // 18/08: a mensagem que sobe daqui é EXIBIDA ao cliente — `Checkout.jsx` tem 7 telas de
    // erro que imprimem `e.message` direto. Quem tentou assinar o Top2 quatro vezes entre
    // 06 e 17/08 leu, na tela de pagamento, o texto do NAVEGADOR: "Failed to fetch". Sem
    // idioma, sem causa, sem próximo passo — e seguiu Explorador.
    // A causa era dele (extensão que substitui `window.fetch`; mesmo fenômeno já
    // diagnosticado em 08/08 e descrito em `reportarErro.js`), mas a mensagem é NOSSA:
    // não conseguimos consertar a extensão, e conseguimos dizer o que fazer.
    // O erro original vai em `cause` — nada se perde para quem depurar.
    //
    // SÓ falha de rede de verdade. `fetch` também rejeita quando a requisição é ABORTADA:
    // `AbortSignal.timeout` é usado em /api/proximidades-imovel (35 s) e em
    // /api/gerar-contrato-ia (180 s). Ali o servidor está lento, não inalcançável — mandar
    // o cliente "desativar o bloqueador" seria trocar uma mensagem inútil por uma ERRADA,
    // que é pior. Rede caída chega como TypeError; abort/timeout, como DOMException.
    const ehRede = e instanceof TypeError && e?.name !== 'AbortError' && e?.name !== 'TimeoutError';
    if (!ehRede) throw e;
    throw Object.assign(
      new Error('Não conseguimos falar com o servidor. Verifique sua conexão e, se você usa bloqueador de anúncios ou extensões de privacidade, desative para este site e tente de novo.'),
      { cause: e, falhaDeRede: true },
    );
  }
  // Diagnóstico (Cliente 360): registra falhas de API sem alterar o retorno.
  if (!res.ok) {
    try { registrarEvento('api_erro', { alvo: rota, detalhe: `HTTP ${res.status}` }); } catch { /* ignora */ }
  } else if (/gerar-analise|gerar-documental|gerar-laudo|indice-mercado|indice-consulta/.test(rota)) {
    // RESULTADO das ações-chave: um 200 pode vir "vazio" (mercadoVazio) ou com erro no corpo — o
    // dono quer o clique E o DESFECHO. Espia o corpo por CLONE (não consome o retorno do chamador),
    // só nessas rotas (baixa frequência) para não pesar. Best-effort.
    try {
      const b = await res.clone().json();
      if (b && (b.error || b.mercadoVazio || b.motivo === 'sem_amostras' || b.mapeado === false)) {
        registrarEvento('api_vazio', { alvo: rota, detalhe: String(b.error || (b.mercadoVazio ? 'relatório sem estimativa' : b.mapeado === false ? 'região não mapeada' : b.motivo)).slice(0, 120) });
      }
    } catch { /* peek best-effort */ }
  }
  return res;
}
