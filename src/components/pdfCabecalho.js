// Cabeçalho PADRÃO dos relatórios em PDF (mercadológico, documental, laudo — e, por herança, o
// combinado). Um só lugar para a IDENTIFICAÇÃO: marca BidPro Brasil, o relatório, o imóvel, a
// matrícula, o executado, o processo, e QUEM solicitou (assinante + nível/role) + data. Antes cada
// PDF tinha seu próprio bloco .hdr duplicado e sem essas informações.

const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Nome amigável do nível do solicitante (role do plano/equipe).
const ROLE_NIVEL = {
  explorador: 'Explorador', top2: 'Investidor Pro', top2_anual: 'Investidor Pro (anual)',
  assessorado: 'Assessorado', assessorado_anual: 'Assessorado (anual)',
  clube: 'Leilão Club', clube_anual: 'Leilão Club (anual)',
  analista: 'Analista', advogado: 'Advogado', consultor: 'Consultor', admin: 'Administrador',
};

// CSS do cabeçalho — concatenado aos ESTILOS_* de cada PDF (o combinado une os 3; classes iguais).
export const ESTILOS_CABECALHO = `
  .bp-hdr{border-bottom:3px solid #0D2A54;padding-bottom:12px;margin-bottom:16px;}
  .bp-hdr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}
  .bp-brand{font-size:22px;font-weight:900;color:#0D2A54;text-transform:uppercase;letter-spacing:.5px;line-height:1;}
  .bp-tag{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-top:3px;}
  .bp-docbox{text-align:right;flex-shrink:0;font-size:9px;color:#64748b;line-height:1.55;}
  .bp-title{font-size:14px;font-weight:900;color:#0f172a;margin-top:10px;}
  .bp-meta{display:grid;grid-template-columns:1fr 1fr;gap:1px 18px;margin-top:8px;}
  .bp-meta div{font-size:10px;color:#334155;line-height:1.55;}
  .bp-meta b{color:#0f172a;}
`;

/**
 * Monta o HTML do cabeçalho. Todos os campos são opcionais — só aparece o que tiver dado.
 * @param titulo    Título do relatório (ex.: "ANÁLISE DOCUMENTAL E JURÍDICA").
 * @param subtitulo Linha auxiliar (ex.: "Leitura de documentos + processo").
 * @param docSeq    Sequência (ex.: "Documento 2 de 3").
 * @param imovel    { tipo, endereco, cidade, estado, leiloeiro }.
 * @param matricula Nº da matrícula (quando extraído).
 * @param executado Parte executada/ex-mutuário (quando houver).
 * @param processo  Nº do processo (CNJ).
 * @param solicitante { nome, role }.
 * @param geradoEm  ISO/date da geração.
 */
export function cabecalhoBidPro({ titulo = '', subtitulo = '', docSeq = '', imovel = {}, matricula = '', executado = '', processo = '', solicitante = {}, geradoEm } = {}) {
  const data = (() => { try { return new Date(geradoEm || Date.now()).toLocaleDateString('pt-BR'); } catch { return new Date().toLocaleDateString('pt-BR'); } })();
  const local = [imovel.cidade, imovel.estado].filter(Boolean).join('/');
  const endereco = [imovel.tipo ? String(imovel.tipo).toUpperCase() : '', imovel.endereco || '', local].filter(Boolean).join(' · ');
  const nivel = ROLE_NIVEL[solicitante.role] || solicitante.role || '';
  const quem = solicitante.nome ? `${solicitante.nome}${nivel ? ` — ${nivel}` : ''}` : nivel;
  const linha = (rot, val) => val ? `<div><b>${escH(rot)}:</b> ${escH(val)}</div>` : '';
  return `
<div class="bp-hdr av">
  <div class="bp-hdr-top">
    <div>
      <div class="bp-brand">BidPro Brasil</div>
      <div class="bp-tag">Aquisição em Leilão &amp; Investimentos Estratégicos</div>
    </div>
    <div class="bp-docbox">
      <div><b style="color:#0f172a;">Data:</b> ${data}</div>
      ${docSeq ? `<div>${escH(docSeq)}</div>` : ''}
      ${subtitulo ? `<div>${escH(subtitulo)}</div>` : ''}
    </div>
  </div>
  <div class="bp-title">${escH(titulo)}</div>
  <div class="bp-meta">
    ${linha('Imóvel', endereco)}
    ${linha('Matrícula', matricula)}
    ${linha('Executado', executado)}
    ${linha('Processo', processo)}
    ${linha('Solicitado por', quem)}
    ${linha('Leiloeiro', imovel.leiloeiro)}
  </div>
</div>`;
}
