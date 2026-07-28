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

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataHora = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }); } catch { return iso || ''; } };

const ESTILOS_CONTRATO = `
  *{box-sizing:border-box;}
  @page{margin:16mm 12mm 22mm;}
  body{font-family:'Inter',Arial,sans-serif;color:#111;line-height:1.6;font-size:12.5px;}
  .cab{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0D63DB;padding-bottom:14px;margin-bottom:20px;}
  .cab .logo{width:32px;height:32px;background:#0D63DB;border-radius:8px;flex-shrink:0;}
  .cab .tit{font-size:16px;font-weight:900;}
  .cab .sub{font-size:10px;color:#0D63DB;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
  h1{font-size:18px;font-weight:900;margin:0 0 12px;}
  .corpo{white-space:pre-wrap;font-size:12.5px;line-height:1.85;color:#1e293b;}
  .quebra{page-break-before:always;}
  .man h2{font-size:15px;font-weight:900;border-bottom:1px solid #e2e8f0;padding-bottom:8px;margin:0 0 12px;}
  .rhead{font-size:11.5px;color:#334155;line-height:1.9;margin-bottom:14px;}
  .rhead b{color:#111;}
  .rhead .muted{color:#64748b;font-size:10.5px;margin-top:4px;}
  .legal{font-size:10.5px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:11px 13px;margin-bottom:18px;line-height:1.65;word-break:break-word;}
  .legal .cert{font-weight:800;color:#15803d;letter-spacing:0.3px;}
  .signer{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:12px;page-break-inside:avoid;}
  .signer .via{font-size:10px;color:#0D63DB;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}
  .signer .sname{font-size:15px;font-weight:800;letter-spacing:2px;}
  .signer .srow{font-size:11.5px;color:#334155;margin-top:4px;}
  .signer .srow b{color:#111;}
  .assimg{max-height:70px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:4px;margin-top:6px;display:block;}
  .auth{margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;font-size:11px;color:#475569;line-height:1.8;}
  .auth b{color:#111;}
  .pagefoot{position:fixed;bottom:6mm;left:0;right:0;text-align:center;font-size:8.5px;color:#94a3b8;}
`;

export function gerarContratoPDF({ contrato, roster = [] } = {}) {
  if (!contrato) { alert('Documento indisponível.'); return; }
  const ds = contrato.dados_signatario || {};
  const titulo = contrato.titulo || 'Contrato';
  const numero = contrato.contrato_grupo_id || contrato.token || '';
  const origin = (typeof window !== 'undefined' && window.location?.origin) || 'https://www.bidprobrasil.com.br';
  const verUrl = contrato.token ? `${origin}/#/c/${esc(contrato.token)}` : '';

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
  const totAssin = partes.filter((p) => p.assinou).length;
  const total = partes.length;
  const completo = total > 0 && totAssin === total;

  // Cartão por signatário no padrão ZapSign ("Assinado via …", nome, data/hora, Token, assinatura,
  // "Pontos de autenticação"). Dados completos só do próprio (p.eu); dos demais, nome + status + data.
  const blocosPartes = partes.map((p) => {
    const meu = !!p.eu;
    const pontos = [];
    if (meu) {
      if (ds.email) pontos.push(`<div>E-mail: ${esc(ds.email)}</div>`);
      if (ds.cpf) pontos.push(`<div>CPF: ${esc(ds.cpf)}</div>`);
      if (ds.cnpj) pontos.push(`<div>CNPJ: ${esc(ds.cnpj)}</div>`);
      if (contrato.assinante_ip) pontos.push(`<div>IP: ${esc(contrato.assinante_ip)}</div>`);
      pontos.push('<div>Nível de segurança: assinatura eletrônica (manuscrita em tela), com carimbo de data/hora do servidor</div>');
    }
    if (p.requer_testemunha) pontos.push(`<div>Testemunha: ${p.testemunha_assinou ? 'assinou' : 'pendente'}${meu && contrato.nome_testemunha ? ' — ' + esc(contrato.nome_testemunha) : ''}</div>`);
    const img = meu && contrato.assinatura ? `<img class="assimg" src="${esc(contrato.assinatura)}" alt="assinatura" />` : '';
    const imgT = meu && contrato.assinatura_testemunha ? `<div class="srow" style="margin-top:6px;"><b>Assinatura da testemunha:</b></div><img class="assimg" src="${esc(contrato.assinatura_testemunha)}" alt="assinatura testemunha" />` : '';
    return `<div class="signer">
      <div class="via">Assinado via BidPro Brasil</div>
      <div class="sname">${esc(p.nome)}${meu ? '' : ''}</div>
      <div class="srow"><b>Status:</b> ${p.assinou ? 'Assinado' : 'Pendente'}</div>
      ${p.assinou && p.assinado_em ? `<div class="srow"><b>Data e hora da assinatura:</b> ${esc(dataHora(p.assinado_em))}</div>` : ''}
      ${meu && contrato.token ? `<div class="srow"><b>Token:</b> ${esc(contrato.token)}</div>` : ''}
      ${meu ? `<div class="srow" style="margin-top:6px;"><b>Assinatura:</b></div>${img || '<div class="srow">(assinatura manuscrita registrada)</div>'}` : ''}
      ${imgT}
      ${pontos.length ? `<div class="auth"><b>Pontos de autenticação:</b>${pontos.join('')}</div>` : ''}
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Contrato - ${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${ESTILOS_CONTRATO}</style></head><body>
  <div class="pagefoot">BidPro Brasil ${esc(numero)} · Documento assinado eletronicamente, conforme MP 2.200-2/2001 e Lei 14.063/2020.</div>
  <div class="cab"><div class="logo"></div><div><div class="sub">BidPro Brasil, Contrato Digital</div><div class="tit">${esc(titulo)}</div></div></div>
  <h1>${esc(titulo)}</h1>
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
    <div class="legal"><span class="cert">INTEGRIDADE CERTIFICADA.</span> Assinaturas eletrônicas têm validade legal, conforme a MP nº 2.200-2/2001 (ICP-Brasil) e a Lei nº 14.063/2020. A integridade é assegurada pelo hash SHA-256 acima; qualquer alteração no texto do contrato invalida as assinaturas.${verUrl ? ` Confira a autenticidade deste documento em ${verUrl}.` : ''}${numero ? ` Este relatório é parte integrante do documento nº ${esc(numero)}.` : ''}</div>
    ${blocosPartes}
  </div>
</body></html>`;

  imprimirHtml(html, `Contrato - ${titulo}`);
}
