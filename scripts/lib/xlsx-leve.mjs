// Leitor mínimo de .xlsx (zip + XML) sem dependência além do fflate. Devolve { abas: [{ nome, linhas: [[célula...]] }] }.
// Só valores (número, texto compartilhado, texto inline); fórmula vem pelo valor em cache. Datas ficam como número serial
// do Excel (quem chama converte com serialParaData).
import { unzipSync, strFromU8 } from 'fflate';

const desesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return null; let n = 0; for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };

export function lerXlsx(buf) {
  const z = unzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const txt = (p) => (z[p] ? strFromU8(z[p]) : null);
  const shared = [];
  const ss = txt('xl/sharedStrings.xml');
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(desesc((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  const wb = txt('xl/workbook.xml') || '';
  const rels = txt('xl/_rels/workbook.xml.rels') || '';
  const alvo = {};
  for (const r of rels.match(/<Relationship\b[^>]*>/g) || []) {
    const id = /Id="([^"]+)"/.exec(r)?.[1]; const t = /Target="([^"]+)"/.exec(r)?.[1];
    if (id && t) alvo[id] = t.replace(/^\/?(xl\/)?/, 'xl/');
  }
  const abas = [];
  for (const s of wb.match(/<sheet\b[^>]*>/g) || []) {
    const nome = desesc(/name="([^"]*)"/.exec(s)?.[1] || '');
    const rid = /r:id="([^"]+)"/.exec(s)?.[1];
    const xml = txt(alvo[rid]) || '';
    const linhas = [];
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
      const lin = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = /r="([A-Z]+\d+)"/.exec(c)?.[1]; const t = /t="([^"]+)"/.exec(c)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
        const inl = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1];
        let val = null;
        if (t === 's' && v != null) val = shared[Number(v)] ?? null;
        else if (t === 'inlineStr') val = inl != null ? desesc(inl) : null;
        else if (t === 'str') val = v != null ? desesc(v) : null;
        else if (v != null) val = Number.isFinite(Number(v)) ? Number(v) : desesc(v);
        const i = colIdx(ref); lin[i != null ? i : lin.length] = val;
      }
      linhas.push(lin);
    }
    abas.push({ nome, linhas });
  }
  return { abas };
}

export const serialParaData = (n) => (Number.isFinite(n) ? new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10) : null);
