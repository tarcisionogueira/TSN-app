// Helpers de documentos da Caixa (venda-imoveis.caixa.gov.br).

const ehCaixa = (fonte) => /caixa|cef/i.test(fonte || '');

// Matrícula da Caixa: PDF ESTÁTICO em /editais/matricula/<UF>/<numero>.pdf.
// O antigo matricula.asp?hdniip= foi REMOVIDO (HTTP 404). Este PDF é acessível por
// hotlink direto no navegador do usuário (o IP de datacenter é bloqueado, igual às
// fotos). `numero` é o id do imóvel na Caixa (dígitos do fonte_id / hdnimovel).
export function caixaMatriculaUrl({ fonte, estado, fonteId, numero } = {}) {
  if (!ehCaixa(fonte)) return null;
  const num = String(numero || fonteId || '').replace(/\D/g, '');
  const uf = String(estado || '').trim().toUpperCase();
  if (!num || uf.length !== 2) return null;
  return `https://venda-imoveis.caixa.gov.br/editais/matricula/${uf}/${num}.pdf`;
}
