// TRAVA DE CLIQUE DUPLO EM TODO BOTÃO (30/10, dono: "deve registrar apenas 1x o comando para não
// enviar vários ou criar repetições de comando desnecessárias").
//
// Um ouvinte só, no documento, na fase de CAPTURA — roda antes do React (que escuta na raiz) e
// cobre de uma vez os ~centenas de botões do app, inclusive os que gravam direto no Supabase sem
// passar pelo apiCall. O 2º clique no MESMO botão dentro de 600 ms (duplo-clique do mouse, toque
// duplo no celular) é descartado antes de chegar ao onClick.
//
// Fora da trava, de propósito:
//  · botão de 1–2 caracteres ("+", "−", "‹", "›", "×") — passo de quantidade, carrossel: clicar
//    rápido várias vezes É o uso;
//  · qualquer elemento com `data-repetir` (para abrir exceção sem mexer aqui);
//  · campos (checkbox, select, input de texto) — não são comando.
// Clique em botão DIFERENTE nunca é barrado; só o mesmo elemento repetido.
// O que demora mais que 600 ms (envio, geração) é coberto pela trava de pedido idêntico em voo
// do apiCall e pelos `disabled` de cada tela; a repetição pela rede, por api/_pedido-unico.js.

const JANELA_MS = 600;
const ultimo = new WeakMap();

export function instalarCliqueUnico() {
  if (typeof document === 'undefined' || document.__cliqueUnico) return;
  document.__cliqueUnico = true;
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('button, [role="button"], input[type="submit"], input[type="button"]');
    if (!el || el.closest('[data-repetir]')) return;
    const rotulo = (el.innerText || el.value || '').trim();
    if (rotulo && rotulo.length <= 2) return;
    const agora = performance.now();
    const antes = ultimo.get(el);
    ultimo.set(el, agora);
    if (antes != null && agora - antes < JANELA_MS) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}
