// Traz arquivos de um link do Google Drive para os documentos de um caso (15/10, dono: "baixe os arquivos do
// drive do matheus e traga você"). Cliente que manda LINK do Drive em vez de anexo não entra pelo fluxo de
// e-mail (inbound → arquivar-anexos → caso-documentos-cron). Este script faz o papel do e-mail: baixa cada
// arquivo (só funciona com compartilhamento "qualquer pessoa com o link"), sobe para o bucket privado
// `documentos` em email/<id>/ e grava UMA linha em email_caixa ligada ao caso, com os anexos já arquivados.
// A partir daí o caso-documentos-cron lê e classifica como qualquer outro anexo.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, CASO_ID, DRIVE_IDS (separados por vírgula), ASSUNTO, DE_EMAIL.
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const CASO_ID = (process.env.CASO_ID || '').trim();
const IDS = (process.env.DRIVE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ASSUNTO = (process.env.ASSUNTO || 'Documentos importados do Google Drive').slice(0, 200);
const DE_EMAIL = (process.env.DE_EMAIL || '').trim() || null;
const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}` };

if (!SUPABASE_URL || !KEY) { console.error('sem credencial do Supabase'); process.exit(2); }
if (!/^[0-9a-f-]{36}$/i.test(CASO_ID)) { console.error('CASO_ID inválido'); process.exit(2); }
if (!IDS.length || IDS.some((id) => !/^[A-Za-z0-9_-]{20,80}$/.test(id))) { console.error('DRIVE_IDS inválido'); process.exit(2); }

const limparNome = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

function nomeDoCabecalho(cd) {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd || '') || /filename="?([^";]+)"?/i.exec(cd || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; } // padrao-ok: nome cru é aceitável quando não decodifica
}

const caso = await fetch(`${SUPABASE_URL}/rest/v1/casos?id=eq.${CASO_ID}&select=id`, { headers: hdr });
if (!caso.ok || !(await caso.json()).length) { console.error(`caso ${CASO_ID} não encontrado (HTTP ${caso.status})`); process.exit(1); }

const emailId = randomUUID();
const anexos = [];
const falhas = [];
for (const [i, id] of IDS.entries()) {
  const r = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, { redirect: 'follow' });
  const tipo = (r.headers.get('content-type') || '').split(';')[0];
  // Arquivo não público volta 200 com a PÁGINA de login/aviso em HTML: isso é falha, não documento.
  if (!r.ok || tipo === 'text/html') { falhas.push(`${id}: HTTP ${r.status} ${tipo} (o link precisa estar aberto a qualquer pessoa)`); continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  const nome = nomeDoCabecalho(r.headers.get('content-disposition')) || `${id}`;
  const arquivo = `email/${emailId}/${i}_${limparNome(nome)}`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${arquivo}`, {
    method: 'POST', headers: { ...hdr, 'Content-Type': tipo || 'application/octet-stream', 'x-upsert': 'true' }, body: buf,
  });
  if (!up.ok) { falhas.push(`${nome}: upload HTTP ${up.status} ${(await up.text()).slice(0, 150)}`); continue; }
  anexos.push({ id: randomUUID(), nome, arquivo, tamanho: buf.length, content_type: tipo || 'application/octet-stream', arquivado_em: new Date().toISOString() });
  console.log(`ok  ${nome} (${buf.length} bytes)`);
}
for (const f of falhas) console.error(`FALHOU ${f}`);
if (!anexos.length) { console.error('nenhum arquivo baixado'); process.exit(1); }

const linha = {
  id: emailId, direcao: 'entrada', pasta: 'entrada', caixa: 'tarcisio@bidprobrasil.com.br', categoria: 'juridico',
  de_email: DE_EMAIL, assunto: ASSUNTO, caso_id: CASO_ID, lido: true, anexos,
  texto: `Arquivos importados do Google Drive (${anexos.length} de ${IDS.length}). Origem: links compartilhados por e-mail.`,
};
const ins = await fetch(`${SUPABASE_URL}/rest/v1/email_caixa`, {
  method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(linha),
});
const gravado = ins.ok ? await ins.json() : [];
if (!gravado.length) { console.error(`gravar email_caixa: HTTP ${ins.status} ${(await ins.text().catch(() => '')).slice(0, 200)}`); process.exit(1); }
console.log(`email_caixa ${emailId}: ${anexos.length} anexo(s) no caso ${CASO_ID}`);
if (falhas.length) process.exit(1);
