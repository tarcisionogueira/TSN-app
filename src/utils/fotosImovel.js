// REGISTRO FOTOGRÁFICO do imóvel nos relatórios (01/10, pedido do dono: "incluir as fotos no
// relatório mercadológico, assim como no dos carros — ver as projeções de números e ver as fotos ao
// final do relatório"). Mesma ideia de `fotosDoVeiculo` (AnaliseVeiculo.jsx), com a regra de foto
// do imóvel: `fotos` (galeria, quando a fonte traz) + `link_foto` (capa), sem placeholder de
// "sem imagem" e sem repetir. Cada foto passa pela MESMA escolha de URL da Busca (utils/foto.js):
// host que barra hotlink ou serve original pesado vai pelo proxy; o resto, direto.
import { fotoCandidatos } from './foto';

const PLACEHOLDER = /no-image|nao-?disp|sem-?foto|semfoto|placeholder|indisponivel|default\.(?:jpe?g|png|webp)/i;
export const MAX_FOTOS_RELATORIO = 24;

export function fotosDoImovel({ fotos, linkFoto, fonte, fonteId, imovelId } = {}) {
  const brutas = [...(Array.isArray(fotos) ? fotos : []), linkFoto]
    .filter((u) => typeof u === 'string' && /^https?:\/\//.test(u) && !PLACEHOLDER.test(u));
  const unicas = [...new Set(brutas)].slice(0, MAX_FOTOS_RELATORIO);
  // 1º candidato de cada foto, em largura de impressão (meia folha A4 ≈ 1000 px).
  return unicas.map((u) => fotoCandidatos({ foto: u, fonte, fonteId, imovelId, largura: 1000 })[0]).filter(Boolean);
}
