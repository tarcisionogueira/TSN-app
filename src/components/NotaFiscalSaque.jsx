// NOTA FISCAL DO SAQUE — componente ÚNICO das duas telas de saque (Minha Rede, dos parceiros, e
// Comissões, da equipe). Antes de 16/10 o anexo só existia em Comissões, que parceiro não acessa:
// acima do teto ele recebia "anexe a nota" numa tela sem lugar para anexar.
//
// REGRA (dono, 16/10 — `regra_negocio.saque.exige_nf_sempre`): TODO saque exige nota fiscal de
// serviço da empresa do beneficiário contra a BidPro, no valor BRUTO EXATO do saque. A BidPro
// repassa o bruto; tributos e encargos sobre a parte do parceiro são dele. A IA lê a nota
// (api/saque-nf.js); sem confirmação no verificador da prefeitura, a equipe confere.
//
// ANEXADA, NÃO SAI (dono): não há botão de excluir, e não é só a tela — o parceiro não tem
// política de exclusão nem de alteração em `saque_nf` nem no bucket, e o servidor recusa uma
// segunda nota enquanto houver uma ativa. Trocar é decisão da equipe (Admin → Financeiro → Notas
// fiscais de saque → "Liberar substituição"); a nota antiga fica guardada.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { ACEITA_DOCUMENTO } from '../utils/arquivo';

// Tomador da nota. Cópia do rodapé (Footer.jsx) e dos Termos de Uso — é dado público da empresa.
// O servidor confere o tomador contra `EMPRESA_CNPJ` (variável de ambiente), não contra isto.
const TOMADOR = 'Nogueira Empreendimentos LTDA (BidPro Brasil) — CNPJ 02.311.492/0001-61';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ROTULO = {
  revisao_manual: { txt: 'Em conferência pela equipe', cor: '#a16207', fundo: '#fef9c3' },
  aprovada:       { txt: 'Aprovada — pronta para o saque', cor: '#047857', fundo: '#d1fae5' },
  reprovada:      { txt: 'Não aceita', cor: '#b91c1c', fundo: '#fee2e2' },
  substituida:    { txt: 'Substituída (liberada pela equipe)', cor: '#475569', fundo: '#f1f5f9' },
};

export default function NotaFiscalSaque({ userId, valorSugerido, somenteLeitura = false, onAprovada }) {
  const [notas, setNotas] = useState(null);       // null = carregando
  const [erroLeitura, setErroLeitura] = useState('');
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null); // { tipo, txt }

  const carregar = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.from('saque_nf')
      .select('id,status,valor_nf,valor_pedido,numero,motivo,criado_em,lancamento_id')
      .eq('user_id', userId).order('criado_em', { ascending: false }).limit(6);
    // Leitura que falhou não é "nenhuma nota": dizer isso abriria o anexo para quem já tem uma.
    if (error) { setErroLeitura('Não consegui consultar suas notas fiscais agora. Recarregue a página.'); return; }
    setErroLeitura('');
    setNotas(data || []);
  }, [userId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (Number(valorSugerido) > 0) setValor(String(valorSugerido)); }, [valorSugerido]);

  const ativa = (notas || []).find((n) => !n.lancamento_id && (n.status === 'revisao_manual' || n.status === 'aprovada'));
  const historico = (notas || []).filter((n) => n !== ativa).slice(0, 4);

  async function enviar(file) {
    const v = Math.round(Number(valor) * 100) / 100;
    if (!file) return;
    if (!(v > 0)) { setResultado({ tipo: 'erro', txt: 'Informe o valor do saque — a nota deve ser exatamente desse valor.' }); return; }
    setEnviando(true); setResultado(null);
    try {
      const ext = ((file.name || '').split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
      const path = `nf/${userId}/nf-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('documentos').upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const res = await apiCall('/api/saque-nf', { method: 'POST', body: JSON.stringify({ storage_path: path, valor: v }) });
      const d = await res.json().catch(() => ({}));
      // `.ok` antes do corpo: um 4xx traz JSON sem `status` e a tela diria "enviada".
      if (!res.ok) { setResultado({ tipo: 'erro', txt: d.error || 'Não consegui enviar a nota.' }); }
      else {
        setResultado({
          tipo: d.status === 'aprovada' ? 'ok' : d.status === 'reprovada' ? 'erro' : 'aviso',
          txt: d.status === 'aprovada' ? `Nota aprovada. Agora solicite o saque de ${fmt(v)}.`
            : d.status === 'reprovada' ? (d.motivo || 'Nota não aceita.')
            : (d.motivo || 'Nota recebida e em conferência da equipe.'),
        });
        if (d.status === 'aprovada' && onAprovada) onAprovada(v);
      }
    } catch (e) {
      setResultado({ tipo: 'erro', txt: e?.message || 'Falha ao enviar a nota.' });
    } finally {
      setEnviando(false);
      carregar();
    }
  }

  const corRes = { ok: '#047857', erro: '#b91c1c', aviso: '#a16207' };

  return (
    <div style={{ marginTop: 12, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#9a3412', marginBottom: 4 }}>🧾 Nota fiscal do saque</div>
      <div style={{ fontSize: 11.5, color: '#9a3412', lineHeight: 1.6 }}>
        Todo saque exige a <strong>nota fiscal de serviço</strong> emitida pela sua empresa (o CNPJ cadastrado) contra{' '}
        <strong>{TOMADOR}</strong>, no <strong>valor bruto exato do saque</strong>. O repasse é feito pelo valor bruto:
        os tributos e encargos sobre ele são da sua empresa. A nota é lida automaticamente e, quando não dá para
        confirmar a emissão na prefeitura, nossa equipe confere.
      </div>

      {erroLeitura && <div style={{ marginTop: 8, fontSize: 12, color: '#b45309', fontWeight: 700 }}>{erroLeitura}</div>}

      {ativa ? (
        <div style={{ marginTop: 10, background: 'white', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 99, color: ROTULO[ativa.status].cor, background: ROTULO[ativa.status].fundo }}>
              {ROTULO[ativa.status].txt}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a' }}>{fmt(ativa.valor_nf ?? ativa.valor_pedido)}</span>
            {ativa.numero && <span style={{ fontSize: 11.5, color: '#64748b' }}>nº {ativa.numero}</span>}
          </div>
          {ativa.motivo && <div style={{ marginTop: 5, fontSize: 11.5, color: '#475569', lineHeight: 1.5 }}>{ativa.motivo}</div>}
          <div style={{ marginTop: 6, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
            A nota anexada não pode ser removida. Se precisar trocá-la, fale com a equipe — só ela libera a substituição.
          </div>
        </div>
      ) : notas && !erroLeitura && !somenteLeitura ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" min="0.01" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)}
            placeholder="Valor do saque (R$)" disabled={enviando}
            style={{ border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 10px', fontSize: 13, width: 160, background: 'white' }} />
          <label style={{ display: 'inline-block', padding: '8px 16px', background: enviando ? '#94a3b8' : '#ea580c', color: 'white', borderRadius: 8, fontWeight: 800, fontSize: 12.5, cursor: enviando ? 'default' : 'pointer' }}>
            {enviando ? 'Lendo a nota…' : 'Anexar nota fiscal'}
            <input type="file" accept={ACEITA_DOCUMENTO} disabled={enviando} style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; enviar(f); }} />
          </label>
        </div>
      ) : null}

      {resultado && (
        <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, lineHeight: 1.55, color: corRes[resultado.tipo] }}>{resultado.txt}</div>
      )}

      {historico.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Notas anteriores</div>
          {historico.map((n) => (
            <div key={n.id}>
              {new Date(n.criado_em).toLocaleDateString('pt-BR')} · {fmt(n.valor_nf ?? n.valor_pedido)} ·{' '}
              {n.lancamento_id ? 'usada em saque' : (ROTULO[n.status]?.txt || n.status)}
              {n.status === 'reprovada' && n.motivo ? ` — ${n.motivo}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
