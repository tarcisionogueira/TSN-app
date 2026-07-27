/**
 * Helper — Certidão de Matrícula (leitura para análise) e Registro pós-arrematação
 * via ONR / RI Digital (registradores.onr.org.br).
 *
 * Estratégia (fluxo grátis primeiro, pago sob demanda; ver docs/HANDOFF.md):
 *   1. Se o acervo JÁ tem a matrícula (anexo capturado do leiloeiro), usa ela — grátis.
 *   2. Caso contrário, oferece a CERTIDÃO DIGITAL oficial do ONR — fonte da verdade,
 *      vale para QUALQUER cartório do Brasil, paga por certidão, sob demanda no laudo.
 *
 * Sobre o "automático": o mesmo portal que já autenticamos (_onr.js → ridigital.org.br
 * = registradores.onr.org.br) emite a Certidão Digital em /CertidaoDigital/. Se a NOSSA
 * conta tiver permissão/handler para disparar o pedido via AJAX, `tentarCertidaoAuto`
 * assume; enquanto isso NÃO for CONFIRMADO pela sonda (api/onr-certidao-probe.js) em
 * produção, mantemos o pedido GUIADO — o investidor gera a dele em 2 cliques.
 */

import { onrAjax, invalidateSession } from './_onr.js';

const ONR = 'https://registradores.onr.org.br';

// Portais oficiais (validados via busca ONR/registradores):
export const ONR_LINKS = {
  // (a) Certidão Digital de matrícula — leitura para análise. R$ 68,20 + ISS, ~2h.
  certidaoDigital: `${ONR}/CertidaoDigital/`,
  // (b) Abertura/registro de matrícula pós-arrematação (Registro Online).
  registroOnline: `${ONR}/Servicos/reqaberturamatricula.aspx`,
  // Central de atendimento eletrônico compartilhado (SAEC).
  saec: `${ONR}/PO/DefaultPO.aspx`,
  // Validador de certidão emitida (confere autenticidade do PDF).
  validar: `${ONR}/validacao.aspx`,
};

// Custo/prazo divulgados pela ONR para a Certidão Digital (informativo ao usuário).
export const CERTIDAO_CUSTO = 'R$ 68,20 + ISS do município do cartório';
export const CERTIDAO_PRAZO = 'até 2h (certidão de matrícula) — pode ir a 5 dias úteis em casos especiais';

/** Normaliza texto para casar cidade sem acento/caixa. */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

/**
 * Resolve o(s) Cartório(s) de Registro de Imóveis (CRI) de uma cidade/UF pela
 * central ONR. Reusa o handler já validado em api/onr-cidades.js.
 * Retorna { integrado, cartorios: [{id,nome,cidade,uf}] } — cartorios [] se
 * a cidade não é integrada; integrado:null se a consulta foi inconclusiva.
 */
export async function resolverCartorio(uf, cidade) {
  const UF = String(uf || '').trim().toUpperCase();
  const cid = norm(cidade);
  if (!UF) return { integrado: null, cartorios: [], erro: 'uf obrigatória' };

  try {
    const res = await onrAjax('sitearisp', 'Listagem_cartorios', { uf: UF }, true);
    let cartorios = [];
    if (Array.isArray(res)) {
      cartorios = res.map(r => ({
        id:     String(r[0] ?? r.id ?? ''),
        nome:   String(r[1] ?? r.nome ?? ''),
        cidade: String(r[2] ?? r.cidade ?? ''),
        uf:     String(r[3] ?? r.uf ?? UF),
      })).filter(c => c.nome);
    } else if (res && Array.isArray(res.data)) {
      cartorios = res.data;
    } else if (res && Array.isArray(res.cidades)) {
      cartorios = res.cidades;
    }

    const doMunicipio = cid
      ? cartorios.filter(c => {
          const cc = norm(c.cidade);
          return cc.includes(cid) || cid.includes(cc);
        })
      : cartorios;

    return {
      integrado: doMunicipio.length > 0,
      cartorios: doMunicipio,
      total_uf: cartorios.length,
    };
  } catch (err) {
    if (err.message?.includes('login') || err.message?.includes('session')) {
      invalidateSession();
    }
    console.error('[_onr-certidao] resolverCartorio:', err.message);
    // Inconclusivo (≠ "não integrado"): a via guiada segue funcionando sem o CRI resolvido.
    return { integrado: null, cartorios: [], erro: 'consulta ONR indisponível' };
  }
}

/**
 * Monta o PEDIDO GUIADO de certidão de matrícula — o "passo a passo para o
 * investidor gerar a dele". Não depende de credencial: aponta pro portal oficial
 * do ONR com os dados já resolvidos (UF/cidade/cartório/matrícula).
 */
export function montarPedidoGuiado({ uf, cidade, matricula, cartorio }) {
  const UF = String(uf || '').trim().toUpperCase();
  const cid = String(cidade || '').trim();
  const buscarCartorio =
    `https://www.registradores.org.br/servicos/buscar-cartorio` +
    `?cidade=${encodeURIComponent(cid)}&uf=${encodeURIComponent(UF)}`;

  return {
    modo: 'guiado',
    portal: ONR_LINKS.certidaoDigital,
    buscar_cartorio: buscarCartorio,
    validar_certidao: ONR_LINKS.validar,
    custo: CERTIDAO_CUSTO,
    prazo: CERTIDAO_PRAZO,
    campos: {
      uf: UF || null,
      cidade: cid || null,
      cartorio: cartorio?.nome || null,
      cartorio_id: cartorio?.id || null,
      matricula: matricula ? String(matricula).trim() : null,
    },
    passos: [
      { n: 1, texto: `Acesse a Central de Certidões do ONR (Certidão Digital).` },
      { n: 2, texto: UF && cid
          ? `Selecione ${cid}/${UF}${cartorio?.nome ? ` e o cartório "${cartorio.nome}"` : ' e o Cartório de Registro de Imóveis do imóvel'}.`
          : `Selecione o estado, a cidade e o Cartório de Registro de Imóveis do imóvel.` },
      { n: 3, texto: matricula
          ? `Informe o número da matrícula (${String(matricula).trim()}) e escolha "Certidão Digital de Matrícula".`
          : `Informe o número da matrícula do imóvel e escolha "Certidão Digital de Matrícula".` },
      { n: 4, texto: `Pague a taxa (${CERTIDAO_CUSTO}). A certidão digital sai em ${CERTIDAO_PRAZO}.` },
      { n: 5, texto: `Baixe o PDF assinado e anexe aqui — a análise documental é completada com a matrícula oficial.` },
    ],
  };
}

/**
 * Tenta emitir a certidão AUTOMATICAMENTE pela conta ONR autenticada.
 *
 * Guardado por flag: só roda com ONR_CERTIDAO_AUTO='1'. Enquanto a sonda
 * (api/onr-certidao-probe.js) NÃO confirmar, em produção, que a nossa conta
 * tem acesso ao serviço CertidaoDigital e qual o handler/método AJAX, esta
 * função retorna "não disponível" com motivo claro — em vez de chutar um
 * fluxo não verificado e cobrar o usuário por um pedido que pode falhar.
 *
 * Quando a sonda confirmar o handler, implementamos aqui o pedido real
 * (seleção de cartório + matrícula → protocolo → download do PDF) e o
 * endpoint passa a usar 'auto' antes do 'guiado'.
 */
export async function tentarCertidaoAuto({ uf, cidade, matricula, cartorio } = {}) {
  if (process.env.ONR_CERTIDAO_AUTO !== '1') {
    return { disponivel: false, motivo: 'auto_desligado' };
  }
  // Capacidade ainda não confirmada pela sonda em produção — não fabricar pedido.
  return { disponivel: false, motivo: 'pendente_confirmacao_sonda' };
}
