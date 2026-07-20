import React from 'react';
import { Building2 } from 'lucide-react';
import { fotoCandidatos } from '../utils/foto';

// Foto de imóvel com fallback EM CADEIA — a ÚNICA regra de foto do app. Renderiza
// só a <img> (ou o ícone placeholder); o container/estilo fica com a tela, para
// não quebrar overlays (chips/badges) já posicionados. No onError avança para o
// próximo candidato: self-hosted (supabase) → hotlink direto → padrão Caixa por id
// → proxy (/api/img-proxy). Antes cada tela reimplementava e divergia — a de
// Análises/Arrematados ignorava o self-hosted do CEF e mandava o não-CEF direto ao
// proxy, que sumia no 403; e não havia fallback (o onError só escondia a imagem).
export default function FotoImovel({ imovel, iconSize = 22, imgStyle }) {
  const cands = React.useMemo(() => fotoCandidatos({
    foto: imovel?.foto || imovel?.link_foto,
    fonte: imovel?.fonte,
    fonteId: imovel?.fonteId || imovel?.fonte_id,
  }), [imovel?.foto, imovel?.link_foto, imovel?.fonte, imovel?.fonteId, imovel?.fonte_id]);
  const [idx, setIdx] = React.useState(0);
  const chave = cands.join('|');
  React.useEffect(() => { setIdx(0); }, [chave]);
  const src = cands[idx] || null;
  if (!src) return <Building2 size={iconSize} color="#cbd5e1" />;
  return (
    <img
      src={src}
      alt=""
      style={imgStyle || { width: '100%', height: '100%', objectFit: 'cover' }}
      onError={() => setIdx(i => i + 1)}
    />
  );
}
