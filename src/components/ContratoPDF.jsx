// DOCUMENTO DE CONTRATO ASSINADO (PDF via impressão) — o contrato + o RELATÓRIO DE ASSINATURAS
// no MESMO documento, MODELADO no padrão ZapSign (a plataforma usada no contrato de referência do
// Rafael). Elementos de validade jurídica (MP 2.200-2/2001 ICP-Brasil + Lei 14.063/2020):
// Status, Documento, Número, Data da criação, Hash SHA-256, "Assinaturas X de Y", fuso UTC-03:00,
// e por signatário — data/hora, Token, imagem da assinatura e "Pontos de autenticação"
// (e-mail, CPF, IP, nível de segurança). Rodapé de página repetido com o nº do documento + base legal.
//
// Gerado no cliente a partir do que o token expõe: dados COMPLETOS do próprio signatário +
// situação das DEMAIS partes (nome + data), sem vazar CPF/IP/assinatura de terceiros. Retroativo.
import { imprimirHtml } from './pdfImprimir';
import { mascararDoc, mascararEmail, mascararTel } from '../utils/cnpjCep';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataHora = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch { return iso || ''; } };

const ESTILOS_CONTRATO = `
  *{box-sizing:border-box;}
  @page{margin:11mm 12mm 16mm;}
  body{font-family:'Inter',Arial,sans-serif;color:#111;line-height:1.55;font-size:12.5px;}
  /* Cabeçalho COMPACTO — o título fica só aqui (antes havia um <h1> repetindo o mesmo título,
     empurrando o conteúdo e ajudando a gerar uma 1ª página quase em branco). */
  .cab{display:flex;align-items:center;gap:10px;border-bottom:2px solid #0D63DB;padding-bottom:8px;margin-bottom:12px;}
  .cab .logo{width:26px;height:26px;background:#0D63DB;border-radius:7px;flex-shrink:0;}
  .cab .tit{font-size:16px;font-weight:900;line-height:1.15;}
  .cab .sub{font-size:9.5px;color:#0D63DB;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
  .corpo{white-space:pre-wrap;font-size:12.5px;line-height:1.8;color:#1e293b;}
  /* Documento anexo em imagem: cabe em UMA página (cap de altura) — antes, sem limite, uma
     digitalização A4 alta não cabia sob o cabeçalho e ia inteira para a página 2. */
  .docimg{display:block;margin:0 auto;max-width:100%;max-height:242mm;border:1px solid #e2e8f0;border-radius:8px;}
  .quebra{page-break-before:always;}
  .man h2{font-size:14px;font-weight:900;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin:0 0 8px;}
  .rhead{font-size:11px;color:#334155;line-height:1.7;margin-bottom:9px;}
  .rhead b{color:#111;}
  .rhead .muted{color:#64748b;font-size:10px;margin-top:3px;}
  .legal{font-size:9.5px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 11px;margin-bottom:12px;line-height:1.55;word-break:break-word;}
  .legal .cert{font-weight:800;color:#15803d;letter-spacing:0.3px;}
  /* Cartão do signatário COMPACTO — cabem vários por página (antes, um por página). */
  .signer{border:1px solid #e2e8f0;border-radius:9px;padding:9px 12px;margin-bottom:8px;page-break-inside:avoid;}
  .signer .via{font-size:9.5px;color:#0D63DB;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;}
  .signer .sname{font-size:13px;font-weight:800;letter-spacing:1px;}
  .signer .srow{font-size:11px;color:#334155;margin-top:2px;}
  .signer .srow b{color:#111;}
  .assimg{max-height:56px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:3px;margin-top:4px;display:block;}
  .auth{margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0;font-size:10px;color:#475569;line-height:1.65;}
  .auth b{color:#111;}
  .pagefoot{position:fixed;bottom:4mm;left:8mm;right:8mm;text-align:center;font-size:8px;line-height:1.3;color:#94a3b8;word-break:break-all;}
`;

export function gerarContratoPDF({ contrato, roster = [] } = {}) {
  if (!contrato) { alert('Documento indisponível.'); return; }
  const ds = contrato.dados_signatario || {};
  const titulo = contrato.titulo || 'Contrato';
  const numero = contrato.contrato_grupo_id || contrato.token || '';
  const origin = (typeof window !== 'undefined' && window.location?.origin) || 'https://www.bidprobrasil.com.br';
  const verUrl = contrato.token ? `${origin}/#/c/${esc(contrato.token)}` : '';

  // Corpo do documento: texto do contrato, ou o arquivo anexo. A URL do arquivo é ASSINADA
  // (…/object/sign/…?token=…) → termina em querystring, não na extensão; por isso detectamos o
  // tipo pelo NOME do arquivo (ou pela extensão antes de ?/#), senão a imagem caía como "link".
  const nomeArq = contrato.arquivo_nome || contrato.arquivo_url || '';
  const ehImg = /\.(jpe?g|png|gif|webp)($|\?|#)/i.test(nomeArq) || /\.(jpe?g|png|gif|webp)($|\?|#)/i.test(contrato.arquivo_url || '');
  let corpoDoc;
  if (contrato.arquivo_url && ehImg) {
    corpoDoc = `<img class="docimg" src="${esc(contrato.arquivo_url)}" alt="Documento" />`;
  } else if (contrato.arquivo_url) {
    corpoDoc = `<p class="corpo">Documento anexo: <a href="${esc(contrato.arquivo_url)}">${esc(contrato.arquivo_nome || 'documento')}</a><br/><span style="font-size:11px;color:#64748b;">(abra o link para visualizar o documento original assinado)</span></p>`;
  } else {
    corpoDoc = `<div class="corpo">${esc(contrato.conteudo || '')}</div>`;
  }

  // Partes: usa o roster (todas as partes) quando disponível; senão, cai na própria linha do token.
  const partes = (Array.isArray(roster) && roster.length)
    ? roster
    : [{ nome: ds.nome || ds.razao_social || contrato.assinante_email, assinou: contrato.status === 'assinado', assinado_em: contrato.assinado_em, eu: true, requer_testemunha: !!contrato.testemunha_em, testemunha_assinou: !!contrato.testemunha_em }];
  const totAssin = partes.filter((p) => p.assinou).length;
  const total = partes.length;
  const completo = total > 0 && totAssin === total;

  // Cartão por signatário no padrão ZapSign ("Assinado via …", nome, data/hora, Token, assinatura,
  // "Pontos de autenticação"). Dados completos: do próprio (p.eu, vindo de contrato.*) OU de CADA
  // parte quando o chamador passa o roster COMPLETO (p._full — caso do admin, que tem acesso às
  // linhas inteiras). Sem esses, mostra só nome + status + data (visão do signatário sobre os outros).
  const blocosPartes = partes.map((p) => {
    const meu = !!p.eu;
    const full = p._full === true; // roster com dados completos por parte (admin)
    const detalhar = meu || full;
    const pds = full ? (p.dados_signatario || {}) : ds;
    const pAssinatura = full ? p.assinatura : (meu ? contrato.assinatura : null);
    const pIp = full ? p.assinante_ip : (meu ? contrato.assinante_ip : null);
    const pGeo = full ? p.assinante_geo : (meu ? contrato.assinante_geo : null);
    const pUa = full ? p.assinante_user_agent : (meu ? contrato.assinante_user_agent : null);
    const pComplEm = full ? p.dados_complementados_em : (meu ? contrato.dados_complementados_em : null);
    const pToken = full ? p.token : (meu ? contrato.token : null);
    const pAssTest = full ? p.assinatura_testemunha : (meu ? contrato.assinatura_testemunha : null);
    const pNomeTest = full ? p.nome_testemunha : (meu ? contrato.nome_testemunha : null);
    // PRIVACIDADE (LGPD / exposição no segmento de leilões): os pontos de autenticação exibem os
    // dados MASCARADOS (o registro completo fica na plataforma, disponível às partes e à Justiça).
    // Endereço NÃO é exibido — a presença é autenticada pela localização aproximada + IP + dispositivo.
    const pontos = [];
    if (detalhar) {
      if (pds.telefone) pontos.push(`<div>Telefone: ${esc(mascararTel(pds.telefone))}</div>`);
      if (pds.email || p.email) pontos.push(`<div>E-mail: ${esc(mascararEmail(pds.email || p.email))}</div>`);
      if (pds.cpf) pontos.push(`<div>CPF: ${esc(mascararDoc(pds.cpf))}</div>`);
      if (pds.cnpj) pontos.push(`<div>CNPJ: ${esc(mascararDoc(pds.cnpj))}</div>`);
      if (p.assinou) pontos.push('<div>Nível de segurança: assinatura eletrônica (manuscrita em tela), com carimbo de data/hora do servidor</div>');
      if (pGeo && Number.isFinite(Number(pGeo.lat)) && Number.isFinite(Number(pGeo.lng))) pontos.push(`<div>Localização aproximada: ${esc(Number(pGeo.lat).toFixed(6))}, ${esc(Number(pGeo.lng).toFixed(6))}</div>`);
      if (pIp) pontos.push(`<div>IP: ${esc(pIp)}</div>`);
      if (pUa) pontos.push(`<div>Dispositivo: ${esc(pUa)}</div>`);
      if (pComplEm) pontos.push(`<div style="color:#94a3b8;">(dispositivo/localização complementados em ${esc(dataHora(pComplEm))})</div>`);
    }
    if (p.requer_testemunha) pontos.push(`<div>Testemunha: ${p.testemunha_assinou ? 'assinou' : 'pendente'}${pNomeTest ? ' — ' + esc(pNomeTest) : ''}</div>`);
    const img = pAssinatura ? `<img class="assimg" src="${esc(pAssinatura)}" alt="assinatura" />` : '';
    const imgT = pAssTest ? `<div class="srow" style="margin-top:6px;"><b>Assinatura da testemunha:</b></div><img class="assimg" src="${esc(pAssTest)}" alt="assinatura testemunha" />` : '';
    return `<div class="signer">
      <div class="via">Assinado via BidPro Brasil</div>
      <div class="sname">${esc(p.nome)}</div>
      <div class="srow"><b>Status:</b> ${p.assinou ? 'Assinado' : 'Pendente'}</div>
      ${p.assinou && p.assinado_em ? `<div class="srow"><b>Data e hora da assinatura:</b> ${esc(dataHora(p.assinado_em))}</div>` : ''}
      ${detalhar && pToken ? `<div class="srow"><b>Token:</b> ${esc(pToken)}</div>` : ''}
      ${detalhar && p.assinou ? `<div class="srow" style="margin-top:6px;"><b>Assinatura:</b></div>${img || '<div class="srow">(assinatura manuscrita registrada)</div>'}` : ''}
      ${imgT}
      ${pontos.length ? `<div class="auth"><b>Pontos de autenticação:</b>${pontos.join('')}</div>` : ''}
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Contrato - ${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${ESTILOS_CONTRATO}</style></head><body>
  <div class="pagefoot">BidPro Brasil · Documento nº ${esc(numero)}${contrato.assinatura_hash ? ` · Hash SHA-256: ${esc(contrato.assinatura_hash)}` : ''} · assinado eletronicamente (MP 2.200-2/2001 · Lei 14.063/2020)</div>
  <div class="cab"><div class="logo"></div><div><div class="sub">BidPro Brasil, Contrato Digital</div><div class="tit">${esc(titulo)}</div></div></div>
  ${corpoDoc}
  <div class="quebra man">
    <h2>Relatório de Assinaturas</h2>
    <div class="rhead">
      <div><b>Status:</b> ${completo ? 'Assinado' : 'Aguardando assinaturas'}</div>
      <div><b>Documento:</b> ${esc(titulo)}</div>
      ${numero ? `<div><b>Número:</b> ${esc(numero)}</div>` : ''}
      ${contrato.criado_em ? `<div><b>Data da criação:</b> ${esc(dataHora(contrato.criado_em))}</div>` : ''}
      ${contrato.assinatura_hash ? `<div><b>Hash do documento (SHA-256):</b> ${esc(contrato.assinatura_hash)}</div>` : ''}
      <div><b>Assinaturas:</b> ${totAssin} de ${total}</div>
      <div class="muted">Datas e horários em UTC-03:00 (America/Sao_Paulo).</div>
    </div>
    <div class="legal"><span class="cert">INTEGRIDADE CERTIFICADA.</span> Assinaturas eletrônicas têm validade legal, conforme a MP nº 2.200-2/2001 (ICP-Brasil) e a Lei nº 14.063/2020. A integridade é assegurada pelo hash SHA-256 acima; qualquer alteração no texto do contrato invalida as assinaturas.${verUrl ? ` Confira a autenticidade deste documento em ${verUrl}.` : ''}${numero ? ` Este relatório é parte integrante do documento nº ${esc(numero)}.` : ''} Para proteção dos assinantes (LGPD, Lei nº 13.709/2018), os dados pessoais são exibidos de forma parcial; o registro completo (incluindo os pontos de autenticação) é mantido pela plataforma e disponibilizado às partes e às autoridades competentes mediante solicitação.</div>
    ${blocosPartes}
  </div>
</body></html>`;

  // Nome do arquivo no "Salvar como PDF": nome do contrato + situação (Assinado / Aguardando
  // assinaturas) — pedido do dono. Antes o arquivo saía com o título da SPA (nome do site).
  imprimirHtml(html, `${titulo} - ${completo ? 'Assinado' : 'Aguardando assinaturas'}`);
}
