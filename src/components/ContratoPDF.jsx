// DOCUMENTO DE CONTRATO ASSINADO (PDF via impressão) — o contrato + o MANIFESTO DE ASSINATURAS
// no MESMO documento, com os elementos que dão validade jurídica (MP 2.200-2/2001 ICP-Brasil +
// Lei 14.063/2020): identificação dos signatários, data/hora, IP, método e código de verificação
// (hash SHA-256). Modelado no padrão das plataformas de assinatura eletrônica (página de
// assinaturas ao final). Antes era um .txt "comprovante" solto — sem valor de documento.
//
// Gerado no cliente a partir do que o token expõe: dados COMPLETOS do próprio signatário
// (nome/CPF/IP/assinatura desenhada) + situação das DEMAIS partes (nome + data), sem vazar
// CPF/assinatura de terceiros. Funciona para contrato já assinado (retroativo).
import { imprimirHtml } from './pdfImprimir';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataHora = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch { return iso || ''; } };

const ESTILOS_CONTRATO = `
  *{box-sizing:border-box;}
  body{font-family:'Inter',Arial,sans-serif;color:#111;padding:34px 42px;line-height:1.6;font-size:12.5px;}
  .cab{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0D63DB;padding-bottom:14px;margin-bottom:20px;}
  .cab .logo{width:32px;height:32px;background:#0D63DB;border-radius:8px;flex-shrink:0;}
  .cab .tit{font-size:16px;font-weight:900;}
  .cab .sub{font-size:10px;color:#0D63DB;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
  h1{font-size:18px;font-weight:900;margin:0 0 12px;}
  .corpo{white-space:pre-wrap;font-size:12.5px;line-height:1.85;color:#1e293b;}
  .quebra{page-break-before:always;}
  .man h2{font-size:15px;font-weight:900;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 6px;}
  .legal{font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin:12px 0 18px;line-height:1.65;}
  .parte{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:12px;page-break-inside:avoid;}
  .parte .nome{font-size:14px;font-weight:800;}
  .parte .st{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;}
  .parte .st.ok{background:#dcfce7;color:#15803d;}
  .parte .st.pend{background:#fef3c7;color:#b45309;}
  .kv{font-size:11.5px;color:#334155;margin-top:6px;line-height:1.9;}
  .kv b{color:#111;}
  .assimg{max-height:72px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:4px;margin-top:8px;display:block;}
  .hash{font-size:10.5px;color:#64748b;word-break:break-all;margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;}
  .foot{margin-top:24px;font-size:10px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:12px;}
  .log{margin-top:20px;}
  .log h3{font-size:12px;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;}
  .logitem{font-size:11.5px;color:#475569;padding:5px 0;border-bottom:1px dashed #eef2f7;line-height:1.5;}
  .logitem b{color:#111;}
  .verif{margin-top:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-size:11px;color:#334155;line-height:1.8;word-break:break-all;}
  .verif .lbl{color:#64748b;font-weight:700;}
`;

export function gerarContratoPDF({ contrato, roster = [] } = {}) {
  if (!contrato) { alert('Documento indisponível.'); return; }
  const ds = contrato.dados_signatario || {};
  const titulo = contrato.titulo || 'Contrato';

  // Corpo do documento: texto do contrato, ou o arquivo anexo (imagem embutida / link).
  let corpoDoc;
  if (contrato.arquivo_url && /\.(jpg|jpeg|png|gif|webp)$/i.test(contrato.arquivo_url)) {
    corpoDoc = `<img src="${esc(contrato.arquivo_url)}" style="max-width:100%;border:1px solid #e2e8f0;border-radius:8px;" alt="Documento" />`;
  } else if (contrato.arquivo_url) {
    corpoDoc = `<p class="corpo">Documento anexo: <a href="${esc(contrato.arquivo_url)}">${esc(contrato.arquivo_nome || contrato.arquivo_url)}</a></p>`;
  } else {
    corpoDoc = `<div class="corpo">${esc(contrato.conteudo || '')}</div>`;
  }

  // Partes: usa o roster (todas as partes) quando disponível; senão, cai na própria linha do token.
  const partes = (Array.isArray(roster) && roster.length)
    ? roster
    : [{ nome: ds.nome || ds.razao_social || contrato.assinante_email, assinou: contrato.status === 'assinado', assinado_em: contrato.assinado_em, eu: true, requer_testemunha: !!contrato.testemunha_em, testemunha_assinou: !!contrato.testemunha_em }];

  const blocosPartes = partes.map((p) => {
    const meu = !!p.eu;
    const det = [];
    if (p.assinou && p.assinado_em) det.push(`<div><b>Assinado em:</b> ${esc(dataHora(p.assinado_em))} (horário de Brasília)</div>`);
    if (meu) {
      if (ds.cpf) det.push(`<div><b>CPF:</b> ${esc(ds.cpf)}</div>`);
      if (ds.cnpj) det.push(`<div><b>CNPJ:</b> ${esc(ds.cnpj)}</div>`);
      if (ds.email) det.push(`<div><b>E-mail:</b> ${esc(ds.email)}</div>`);
      if (contrato.assinante_ip) det.push(`<div><b>IP de origem:</b> ${esc(contrato.assinante_ip)}</div>`);
      det.push('<div><b>Método:</b> assinatura eletrônica (manuscrita em tela)</div>');
    }
    if (p.requer_testemunha) det.push(`<div><b>Testemunha:</b> ${p.testemunha_assinou ? 'assinou' : 'pendente'}${meu && contrato.nome_testemunha ? ' — ' + esc(contrato.nome_testemunha) : ''}</div>`);
    const img = meu && contrato.assinatura ? `<img class="assimg" src="${esc(contrato.assinatura)}" alt="assinatura" />` : '';
    const imgT = meu && contrato.assinatura_testemunha ? `<div style="margin-top:8px;font-size:11px;color:#475569;">Assinatura da testemunha:</div><img class="assimg" src="${esc(contrato.assinatura_testemunha)}" alt="assinatura testemunha" />` : '';
    return `<div class="parte">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span class="nome">${esc(p.nome)}${meu ? ' (você)' : ''}</span>
        <span class="st ${p.assinou ? 'ok' : 'pend'}">${p.assinou ? 'ASSINOU' : 'PENDENTE'}</span>
      </div>
      <div class="kv">${det.join('')}</div>
      ${img}${imgT}
    </div>`;
  }).join('');

  // HISTÓRICO (log de eventos), no padrão ZapSign: criação + cada assinatura com data/hora GMT-03:00
  // (e IP do próprio signatário). Base = carimbos do servidor gravados em contratos_link.
  const logItens = [];
  if (contrato.criado_em) logItens.push(`<div class="logitem"><b>Documento criado</b> — ${esc(dataHora(contrato.criado_em))} (GMT-03:00)</div>`);
  partes.filter((p) => p.assinou && p.assinado_em).forEach((p) => {
    logItens.push(`<div class="logitem"><b>Assinado por ${esc(p.nome)}</b> — ${esc(dataHora(p.assinado_em))} (GMT-03:00)${p.eu && contrato.assinante_ip ? ` · IP ${esc(contrato.assinante_ip)}` : ''}</div>`);
  });
  if (contrato.testemunha_em) logItens.push(`<div class="logitem"><b>Testemunha assinou</b>${contrato.nome_testemunha ? ' (' + esc(contrato.nome_testemunha) + ')' : ''} — ${esc(dataHora(contrato.testemunha_em))} (GMT-03:00)</div>`);

  // VERIFICAÇÃO (padrão ZapSign): hash de integridade + código de verificação (token) + URL de
  // autenticidade para conferir o documento online.
  const origin = (typeof window !== 'undefined' && window.location?.origin) || 'https://www.bidprobrasil.com.br';
  const verUrl = contrato.token ? `${origin}/#/c/${esc(contrato.token)}` : '';
  const verif = `<div class="verif">
    ${contrato.assinatura_hash ? `<div><span class="lbl">Hash do documento (SHA-256):</span> ${esc(contrato.assinatura_hash)}</div>` : ''}
    ${contrato.token ? `<div><span class="lbl">Código de verificação:</span> ${esc(contrato.token)}</div>` : ''}
    ${verUrl ? `<div><span class="lbl">Autenticidade:</span> consulte este documento em ${verUrl}</div>` : ''}
  </div>`;

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Contrato - ${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${ESTILOS_CONTRATO}</style></head><body>
  <div class="cab"><div class="logo"></div><div><div class="sub">BidPro Brasil, Contrato Digital</div><div class="tit">${esc(titulo)}</div></div></div>
  <h1>${esc(titulo)}</h1>
  ${corpoDoc}
  <div class="quebra man">
    <h2>Página de Assinaturas</h2>
    <div class="legal">Este documento foi assinado eletronicamente pelas partes abaixo, com validade jurídica nos termos da Medida Provisória nº 2.200-2/2001 (ICP-Brasil) e da Lei nº 14.063/2020. A integridade do conteúdo é assegurada pelo hash SHA-256 abaixo; qualquer alteração no texto do contrato invalida as assinaturas.</div>
    ${blocosPartes}
    <div class="log"><h3>Histórico do documento</h3>${logItens.join('') || '<div class="logitem">Sem eventos registrados.</div>'}</div>
    ${verif}
    <div class="foot">Documento gerado por BidPro Brasil. Assinaturas eletrônicas registradas com carimbo de data/hora do servidor (GMT-03:00) e endereço IP de origem.</div>
  </div>
</body></html>`;

  imprimirHtml(html, `Contrato - ${titulo}`);
}
