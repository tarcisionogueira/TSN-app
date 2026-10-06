// DATA BRASILEIRA ("09/10/2026") → ISO ("2026-10-09"). Por que existe (06/10, Alphaville): a data do
// pregão lida do edital chegava como texto BR e `new Date("09/10/2026")` a lê no padrão AMERICANO
// (mês/dia) → 10/09. O lote foi declarado "encerrado em 10/09" a 4 dias do leilão, a geração foi
// recusada e a retenção (15 dias após o leilão) apagaria a análise. Usado na tela e no servidor.
export function dataBrParaIso(v) {
  if (v == null) return v;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D|$)/);
  if (!m) return s;
  const [, dd, mm, aaaa] = m;
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return `${aaaa}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Para gravar em coluna timestamptz: ISO completo ou null (nunca uma data lida no padrão americano).
export function dataLeilaoIso(v) {
  const s = dataBrParaIso(v);
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00-03:00` : s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
