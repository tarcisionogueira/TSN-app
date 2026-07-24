// Google Drive: o link de COMPARTILHAMENTO (".../file/d/ID/view?usp=drive_link",
// "open?id=ID", "uc?id=ID") serve uma PÁGINA HTML, não o arquivo — por isso a capa
// do eBook não aparecia num <img src>. Estas helpers extraem o ID e devolvem:
//  - driveImage: uma URL de IMAGEM exibível (thumbnail, redimensionável);
//  - drivePreview: a URL /preview para EMBUTIR o PDF (iframe do leitor).
// Para qualquer outro host, devolve a URL original inalterada.
const DRIVE_ID = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?(?:[^&]*&)*id=)([\w-]{20,})/;

export function driveId(url) {
  const m = String(url || '').match(DRIVE_ID);
  return m ? m[1] : null;
}

// URL de imagem (capa). sz aceita "w1000", "h800", etc.
export function driveImage(url, sz = 'w1000') {
  const id = driveId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=${sz}` : (url || '');
}

// URL para embutir o PDF num iframe (leitor estilo Kindle).
export function drivePreview(url) {
  const id = driveId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : (url || '');
}

// URL de download direto do arquivo no Drive.
export function driveDownload(url) {
  const id = driveId(url);
  return id ? `https://drive.google.com/uc?export=download&id=${id}` : (url || '');
}
