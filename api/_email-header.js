/**
 * Cabeçalho padrão dos e-mails transacionais — extraído de 6 arquivos que duplicavam a MESMA
 * div (só texto, sem logo) com pequenas variações de fonte/padding. Achado 13/09: o dono
 * reportou que o e-mail de eBook parecia "feito por estagiário" — cabeçalho só em texto plano,
 * sem a marca de verdade. Consolidado aqui pra próxima melhoria de marca valer para TODOS os
 * e-mails de uma vez, não só o que alguém lembrar de atualizar.
 *
 * `logo.png` (não `.svg`): Outlook desktop e vários clientes de e-mail não renderizam SVG em
 * `<img>` — PNG é o formato seguro pra e-mail. É a versão BRANCA do lockup (confirmado por
 * amostragem de pixel: predominância de #fff + azul da marca), feita pra fundo escuro — por
 * isso funciona sobre o mesmo `#0f172a` que já era o fundo do cabeçalho antigo.
 */
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

/**
 * @param {{subtitulo?: string, base?: string}} opts  subtitulo default = "Leilão & Investimentos"
 *   (dois e-mails usam texto próprio: "Lembrete de vencimento", "Assessoria em Imóveis de Leilão").
 * @returns {string} HTML do cabeçalho, SEM o `<a>` em volta — quem chama decide se linka.
 */
export function cabecalhoEmailHTML({ subtitulo = 'Leilão &amp; Investimentos', base = BASE } = {}) {
  return `<div style="background:#0f172a;border-radius:16px 16px 0 0;padding:26px 28px;text-align:center;">
      <img src="${base}/logo.png" alt="BidPro Brasil" width="168" style="width:168px;max-width:60%;height:auto;display:inline-block;border:0;">
      <div style="font-size:11px;font-weight:600;color:#94a3b8;margin-top:10px;letter-spacing:2.5px;text-transform:uppercase;">${subtitulo}</div>
    </div>`;
}
