import React from 'react';
import { X, Download, BookOpen } from 'lucide-react';

// Converte links do Google Drive para os formatos de leitura/download.
// Aceita também URLs diretas de PDF (usadas como estão).
function parseDriveUrl(url) {
  if (!url) return { preview: '', download: '' };
  const m = url.match(/\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
  if (m) {
    const id = m[1];
    return {
      preview: `https://drive.google.com/file/d/${id}/preview`,
      download: `https://drive.google.com/uc?export=download&id=${id}`,
    };
  }
  // URL direta de PDF
  return { preview: url, download: url };
}

// Leitor de eBook em tela cheia, responsivo (mobile/desktop), estilo Kindle.
// Mostra o PDF embutido e oferece botão para baixar o arquivo.
export default function LeitorEbook({ ebook, onClose }) {
  if (!ebook) return null;
  const { preview, download } = parseDriveUrl(ebook.arquivo_url);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,0.92)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Barra superior — overlay fullscreen (fixed inset:0) cobre a barra de status;
          paddingTop com env(safe-area-inset-top) evita que título/Baixar/✕ fiquem atrás dela. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
        background: '#111111', color: 'white', flexShrink: 0,
      }}>
        <BookOpen size={18} color="#818cf8" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {ebook.titulo}
          </div>
        </div>
        {download && (
          <a href={download} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              background: '#0D63DB', color: 'white', borderRadius: 8, fontWeight: 700,
              fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
            <Download size={14} /> Baixar
          </a>
        )}
        <button onClick={onClose}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, background: 'rgba(255,255,255,0.1)', color: 'white',
            border: 'none', borderRadius: 8, cursor: 'pointer',
          }}>
          <X size={18} />
        </button>
      </div>

      {/* Conteúdo do PDF */}
      <div style={{ flex: 1, background: '#111111', overflow: 'hidden' }}>
        {preview ? (
          <iframe
            title={ebook.titulo}
            src={preview}
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="autoplay"
          />
        ) : (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: 60 }}>
            Este eBook ainda não tem arquivo cadastrado.
          </div>
        )}
      </div>
    </div>
  );
}
