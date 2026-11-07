import React, { useEffect, useState } from 'react';
import { Loader2, FileText, Pencil } from 'lucide-react';
import { AZUL } from '../utils/marca';
import { apiCall } from '../utils/apiCall';

const so = (v) => String(v || '').replace(/\D/g, '');
const mascaraDoc = (v) => {
  const d = so(v).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/**
 * DADOS PARA A NOTA FISCAL (07/11, dono). A emissão ainda não é automática, mas os dados são pedidos na cobrança:
 * completos → resumo com "Alterar" e o pagamento segue; faltando → o formulário pede só o que falta, já preenchido
 * com o que se sabe (o aceite do termo). O documento chega MASCARADO: em branco = manter o já informado.
 * Quem grava é o servidor (api/dados-nota-fiscal.js), que valida tudo de novo.
 */
// alvo: { cobranca_id } (link de cobrança) · { arrematacao_id } (honorário) · { perfil: true } (compras com login).
export default function DadosNotaFiscal({ cobrancaId, alvo: alvoProp, nf, emailSugerido = '', nomeSugerido = '', onSalvo, soCpf = false }) {
  const alvo = alvoProp || { cobranca_id: cobrancaId };
  const [editando, setEditando] = useState(!nf?.completo);
  const [trocarDoc, setTrocarDoc] = useState(!nf?.tem_doc);
  const [d, setD] = useState({
    doc: '', nome: nf?.nome || nomeSugerido || '', email: nf?.email || emailSugerido || '',
    cep: nf?.cep || '', logradouro: nf?.logradouro || '', numero: nf?.numero || '', complemento: nf?.complemento || '',
    bairro: nf?.bairro || '', cidade: nf?.cidade || '', uf: nf?.uf || '',
  });
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const set = (k) => (e) => setD((p) => ({ ...p, [k]: e.target.value }));
  const buscarCep = async (raw) => {
    const cep = so(raw);
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json(); // padrao-ok: ViaCEP devolve 200 com {erro:true} para CEP inexistente; só autopreenche
      if (!j.erro) setD((p) => ({ ...p, cep, logradouro: j.logradouro || p.logradouro, bairro: j.bairro || p.bairro, cidade: j.localidade || p.cidade, uf: j.uf || p.uf }));
    } catch (e) { console.error('[DadosNotaFiscal] CEP', e?.message || e); } // padrao-ok: CEP offline, preenche à mão
    setBuscandoCep(false);
  };

  // CEP que já veio preenchido (do aceite do termo) com a rua vazia: completa o endereço ao abrir, em vez de a
  // pessoa redigitar o que já informou (visto na cobrança do William, 07/11 — a busca só disparava ao digitar).
  useEffect(() => {
    if (editando && so(d.cep).length === 8 && !String(d.logradouro || '').trim()) buscarCep(d.cep);
  }, [editando]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async () => {
    setSalvando(true); setErro('');
    try {
      // apiCall leva o login quando há (o modo perfil exige); a cobrança e o honorário funcionam sem conta.
      const r = await apiCall('/api/dados-nota-fiscal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...alvo, dados: { ...d, doc: trocarDoc ? so(d.doc) : '' } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.nf) throw new Error(j.error || 'Não consegui salvar agora.');
      setEditando(false); setTrocarDoc(false);
      onSalvo?.(j.nf);
    } catch (e) { setErro(e.message); }
    setSalvando(false);
  };

  const box = { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' };
  const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: 'white' };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 };
  const titulo = <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: '#334155' }}><FileText size={14} /> Dados para a nota fiscal</div>;

  if (!editando && nf?.completo) {
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {titulo}
          <div style={{ fontSize: 13, color: '#334155', marginTop: 4, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
            {nf.nome} · {nf.tipo === 'PJ' ? 'CNPJ' : 'CPF'} {nf.doc_mascarado}<br />
            {nf.logradouro}, {nf.numero}{nf.complemento ? ` ${nf.complemento}` : ''} · {nf.bairro} · {nf.cidade}/{nf.uf}
          </div>
        </div>
        <button onClick={() => setEditando(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: AZUL, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>
          <Pencil size={12} /> Alterar
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 9 }}>
      {titulo}
      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
        {nf?.faltando?.length && nf?.tem_doc ? `Falta completar: ${nf.faltando.join(', ')}.` : 'A nota sai em nome de quem paga — pode ser você, outra pessoa ou uma empresa.'}
      </div>
      {trocarDoc ? (
        <div><label style={lbl}>{soCpf ? 'CPF' : 'CPF ou CNPJ'}</label><input style={inp} value={d.doc} inputMode="numeric" placeholder="000.000.000-00" onChange={(e) => setD((p) => ({ ...p, doc: mascaraDoc(e.target.value) }))} /></div>
      ) : (
        <div style={{ fontSize: 13, color: '#334155' }}>
          {nf?.tipo === 'PJ' ? 'CNPJ' : 'CPF'} {nf?.doc_mascarado} <button onClick={() => setTrocarDoc(true)} style={{ background: 'none', border: 'none', color: AZUL, fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }}>trocar</button>
        </div>
      )}
      <div><label style={lbl}>{so(d.doc).length === 14 ? 'Razão social' : 'Nome completo'}</label><input style={inp} value={d.nome} onChange={set('nome')} /></div>
      <div><label style={lbl}>E-mail para a nota</label><input style={inp} type="email" value={d.email} onChange={set('email')} /></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ width: 130 }}><label style={lbl}>CEP</label>
          <input style={inp} value={d.cep} inputMode="numeric" onChange={(e) => { const cep = so(e.target.value).slice(0, 8); setD((p) => ({ ...p, cep })); if (cep.length === 8) buscarCep(cep); }} /></div>
        {buscandoCep && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} />}
      </div>
      <div><label style={lbl}>Rua</label><input style={inp} value={d.logradouro} onChange={set('logradouro')} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={lbl}>Número</label><input style={inp} value={d.numero} onChange={set('numero')} /></div>
        <div style={{ flex: 2 }}><label style={lbl}>Complemento</label><input style={inp} value={d.complemento} onChange={set('complemento')} /></div>
      </div>
      <div><label style={lbl}>Bairro</label><input style={inp} value={d.bairro} onChange={set('bairro')} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 3 }}><label style={lbl}>Cidade</label><input style={inp} value={d.cidade} onChange={set('cidade')} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>UF</label>
          <select style={inp} value={d.uf} onChange={set('uf')}><option value="">—</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
      </div>
      {erro && <div role="alert" style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{erro}</div>}
      <button onClick={salvar} disabled={salvando}
        style={{ padding: 12, background: AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: salvando ? 'default' : 'pointer', opacity: salvando ? 0.7 : 1 }}>
        {salvando ? 'Salvando…' : 'Salvar e continuar para o pagamento'}
      </button>
      <style>{'@keyframes spin{to{transform:rotate(360deg);}}'}</style>
    </div>
  );
}
