import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';
import { termoDoProduto, versaoTermoProduto } from '../utils/termos';
import PagamentoServico from '../components/PagamentoServico';
import BoletoHonorario from '../components/BoletoHonorario';
import AssinaturaCanvas from '../components/AssinaturaCanvas';
import { honorarioComTaxa, TAXA_CARTAO_MP_PCT, gatewayDoBoleto } from '../utils/taxaHonorario';
import { AZUL, VERDE } from '../utils/marca';

// CPF ou CNPJ pelo dígito verificador — só para avisar na hora; o servidor revalida (api/_cpf.js).
function docValido(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const dv = (f) => { let s = 0; for (let i = 0; i < f - 1; i++) s += Number(d[i]) * (f - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(10) === Number(d[9]) && dv(11) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const dv = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = p.reduce((s, x, i) => s + Number(d[i]) * x, 0) % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  return false;
}

const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Checkout dos honorários de êxito de uma arrematação — nossa própria página (Transparente),
// não um link hospedado do Mercado Pago. NÃO exige login (18/09, pedido do dono): o
// arrematante pode repassar o link a outra pessoa pagar em seu nome (raro, mas acontece) —
// mesmo modelo de acesso do antigo link hospedado do MP. O uuid da arrematação (imprevisível,
// conhecido só por quem recebeu o link) é a credencial deste fluxo; os dados vêm de
// /api/honorario-info (público, service key, só os 3 campos que a tela precisa — ver o
// comentário daquele arquivo) em vez do supabase-js client (que dependeria de sessão pra
// passar pela RLS). Quando HÁ sessão logada, o e-mail vem pré-preenchido; sem sessão, quem
// está pagando digita o próprio.
export default function PagarHonorario() {
  const { arrematacaoId } = useParams();
  const { user } = useAuth();
  const [arr, setArr] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [aceite, setAceite] = useState(false);
  const [pago, setPago] = useState(false);
  const [email, setEmail] = useState('');
  const [meio, setMeio] = useState(null); // 'boleto' | 'cartao' — Pix saiu dos honorários (30/09)
  // QUEM PAGA (30/09): nem sempre é o assessorado — pode ser outra pessoa ou uma empresa. O documento
  // vai no boleto (Asaas) e como pagador do cartão (MP); o servidor revalida.
  const [pagadorNome, setPagadorNome] = useState('');
  const [pagadorDoc, setPagadorDoc] = useState('');
  // PROCURAÇÃO JUNTO COM O PAGAMENTO (10/10, pedido do dono): a procuração particular à Nogueira
  // Empreendimentos (e a quem ela delegar) é assinada aqui, antes de pagar — em vez de pedir depois.
  // O documento vem de /api/honorario-procuracao e a assinatura passa pelo /api/assinar-contrato
  // (mesma prova de todo documento: IP do servidor, carimbo de tempo, hash do texto).
  const [proc, setProc] = useState(null);           // { token, titulo, conteudo, status } | null
  const [procCpf, setProcCpf] = useState('');
  const [procAss, setProcAss] = useState('');
  const [procAssinando, setProcAssinando] = useState(false);
  const [procErro, setProcErro] = useState('');

  useEffect(() => {
    if (user?.email) setEmail(e => e || user.email);
  }, [user]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/honorario-info?id=${encodeURIComponent(arrematacaoId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancel) return;
        if (!res.ok || !data?.id) { setErro('Esta cobrança não foi encontrada.'); setCarregando(false); return; }
        setArr(data);
        // Pré-preenche com o e-mail do próprio arrematante quando a sessão logada não já
        // preencheu (ex.: link aberto sem login, que é o caso comum). Continua editável —
        // quem repassou o link a outra pessoa pagar troca por outro e-mail na hora.
        if (data.email_sugerido) setEmail(e => e || data.email_sugerido);
        setCarregando(false);
      } catch (e) {
        console.error('[PagarHonorario] carregar cobrança falhou:', e?.message || e);
        if (!cancel) { setErro('Não foi possível carregar esta cobrança agora. Tente novamente em instantes.'); setCarregando(false); }
      }
    })();
    return () => { cancel = true; };
  }, [arrematacaoId]);

  useEffect(() => {
    if (!arr?.id || ['pago', 'distribuido'].includes(arr.honorarios_status)) return;
    let vivo = true;
    fetch(`/api/honorario-procuracao?id=${encodeURIComponent(arr.id)}`)
      .then(r => r.json().catch(() => ({})).then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (vivo) setProc(ok ? (d.procuracao || null) : null); })
      .catch((e) => console.error('[PagarHonorario] procuração:', e?.message || e)); // sem procuração, o pagamento segue
    return () => { vivo = false; };
  }, [arr?.id, arr?.honorarios_status]);

  // Outorgante = o cliente da arrematação (o nome já está no texto da procuração).
  const outorgante = (String(proc?.conteudo || '').match(/OUTORGANTE:\s*([^,\n]+)/) || [])[1]?.trim() || '';
  const procPendente = !!proc && proc.status !== 'assinado';
  const assinarProcuracao = async () => {
    const cpf = procCpf.replace(/\D/g, '');
    if (cpf.length !== 11 && cpf.length !== 14) { setProcErro('Informe o CPF (ou CNPJ) do titular da arrematação.'); return; }
    if (!procAss) { setProcErro('Assine no quadro acima.'); return; }
    setProcAssinando(true); setProcErro('');
    try {
      const r = await fetch('/api/assinar-contrato', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: proc.token, tipo_pessoa: cpf.length === 14 ? 'pj' : 'pf', dados: { nome: outorgante, ...(cpf.length === 14 ? { cnpj: cpf } : { cpf }), email }, assinatura: procAss }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.error) throw new Error(d?.error || `HTTP ${r.status}`);
      setProc(p => ({ ...p, status: 'assinado' }));
    } catch (e) { setProcErro(`Não foi possível assinar agora: ${e.message}`); }
    finally { setProcAssinando(false); }
  };

  const registrarAceite = async (gateway = 'mercadopago') => {
    try {
      await apiCall('/api/registrar-aceite', {
        method: 'POST',
        body: JSON.stringify({
          plano_key: 'assessorado', valor: arr.honorarios_valor, arrematacao_id: arr.id,
          termos_versao: versaoTermoProduto('assessorado'), gateway,
        }),
      });
    } catch { /* padrao-ok: registro de aceite é best-effort — nunca bloqueia o pagamento já feito */ }
  };

  const handlePago = async () => {
    await registrarAceite();
    setPago(true);
  };

  const wrap = { minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' };
  const card = { background: 'white', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: 460, width: '100%' };

  if (carregando) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center', color: '#64748b' }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: AZUL }} />
          <div style={{ marginTop: 12 }}>Carregando...</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
        </div>
      </div>
    );
  }

  if (erro) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <AlertCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px' }} />
          <div style={{ color: '#dc2626', fontWeight: 700 }}>{erro}</div>
        </div>
      </div>
    );
  }

  const jaPago = pago || ['pago', 'distribuido'].includes(arr.honorarios_status);
  if (jaPago) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle2 size={48} color={VERDE} style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 19, fontWeight: 800, color: VERDE }}>Honorários pagos!</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
            Obrigado. A equipe já foi avisada{proc?.status === 'assinado' ? ' e a procuração ficou registrada junto com o pagamento' : ' e o próximo passo (procuração) segue automaticamente'}.
          </div>
        </div>
      </div>
    );
  }

  const termo = termoDoProduto('assessorado', { valorLabel: fmtBRL(arr.honorarios_valor), modelo: 'parcelado' });
  // TAXA DO MEIO REPASSADA (30/09, decisão do dono) — mesma conta que o servidor cobra.
  const saldoDevido = Number(arr.honorarios_saldo_restante ?? arr.honorarios_valor) || 0;
  const boletoPeloMp = gatewayDoBoleto(saldoDevido) === 'mp';
  const viaBoleto = honorarioComTaxa(saldoDevido, boletoPeloMp ? 'boleto_mp' : 'boleto_asaas');
  const viaCartao = honorarioComTaxa(saldoDevido, 'cartao_mp');

  return (
    <div style={wrap}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Honorários de êxito</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>BidPro Brasil</div>
        </div>

        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '14px 16px', fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.55 }}>
          Você agora é <strong>assessorado(a)</strong> da BidPro Brasil. O valor abaixo são os
          <strong> honorários de êxito (10%)</strong> referentes à sua arrematação de{' '}
          <strong>{fmtBRL(arr.valor_arrematado)}</strong>.
        </div>

        {/* Honorário em partes (17/09): quando já há recebimento confirmado por fora (Pix
            direto, cheque), o valor a pagar aqui é o SALDO, não o total — mesmo número que
            api/mp-checkout.js efetivamente cobra. Mostrar o total sem o abatimento faria a
            pessoa ver um valor e o cartão cobrar outro, menor. */}
        {arr.honorarios_recebido > 0 && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#166534' }}>
            <div style={{ marginBottom: 8 }}>
              Já recebemos <strong>{fmtBRL(arr.honorarios_recebido)}</strong> do total de {fmtBRL(arr.honorarios_valor)}:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(arr.honorarios_partes || []).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, gap: 8 }}>
                  <span>
                    {{ pix_externo: 'Pix', cheque: 'Cheque', cartao_mp: 'Cartão', cartao_asaas: 'Cartão', boleto_asaas: 'Boleto', boleto_mp: 'Boleto', pix_mp: 'Pix', pix_asaas: 'Pix', dinheiro: 'Dinheiro', transferencia: 'Transferência' }[p.metodo] || p.metodo}
                    {p.metodo === 'cheque' && (p.banco || p.numero_cheque) && (
                      <span style={{ color: '#4d7c0f', fontWeight: 400 }}> ({p.banco || '—'}{p.numero_cheque ? ` nº ${p.numero_cheque}` : ''})</span>
                    )}
                  </span>
                  <span style={{ fontWeight: 700, flexShrink: 0 }}>{fmtBRL(p.valor)}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontWeight: 700 }}>O valor abaixo é o saldo restante.</div>
          </div>
        )}

        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Honorário a pagar</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(saldoDevido)}</div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>+ taxa do meio de pagamento escolhido, paga por quem paga</div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            E-mail de quem está pagando
          </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seuemail@exemplo.com"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
            Quem vai pagar? Pode ser você, outra pessoa ou uma empresa — o boleto/recibo sai em nome de quem paga.
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Nome ou razão social de quem paga
            </label>
            <input value={pagadorNome} onChange={e => setPagadorNome(e.target.value)} placeholder="Nome completo ou razão social"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              CPF ou CNPJ de quem paga
            </label>
            <input value={pagadorDoc} onChange={e => setPagadorDoc(e.target.value)} inputMode="numeric" placeholder="000.000.000-00 ou 00.000.000/0000-00"
              style={{ width: '100%', padding: '10px 12px', border: `1px solid ${pagadorDoc && !docValido(pagadorDoc) ? '#fca5a5' : '#e2e8f0'}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
            {pagadorDoc && !docValido(pagadorDoc) && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>Documento inválido — confira os números.</div>}
          </div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
            Li e aceito os <strong>termos de adesão como Assessorado</strong>.
            <details style={{ marginTop: 4 }}>
              <summary style={{ color: AZUL, cursor: 'pointer', fontWeight: 600 }}>Ver termo (versão {termo.versao})</summary>
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#64748b', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                {termo.texto}
              </p>
            </details>
          </span>
        </label>

        {proc && (
          <div style={{ marginTop: 10, padding: '12px 14px', background: procPendente ? '#fffbeb' : '#f0fdf4', border: `1px solid ${procPendente ? '#fde68a' : '#bbf7d0'}`, borderRadius: 10 }}>
            {!procPendente ? (
              <div style={{ fontSize: 12.5, color: '#166534', fontWeight: 700 }}>✓ Procuração particular assinada — a Nogueira Empreendimentos já pode resolver as questões da arrematação em seu nome.</div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#92400e' }}>Procuração para resolvermos a arrematação por você</div>
                <div style={{ fontSize: 11.5, color: '#78350f', lineHeight: 1.55, marginTop: 4 }}>
                  Para não precisarmos pedir depois, assine aqui a procuração particular que autoriza a <b>Nogueira Empreendimentos</b> (e quem ela indicar) a representar {outorgante || 'o titular'} junto a cartórios, prefeitura, leiloeiro e demais órgãos <b>desta arrematação</b>. Ela não permite receber dinheiro nem dispor do imóvel.
                </div>
                <details style={{ marginTop: 6 }}>
                  <summary style={{ color: AZUL, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Ler a procuração completa</summary>
                  <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#475569', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>{proc.conteudo}</p>
                </details>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', margin: '10px 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}>CPF do titular ({outorgante || 'outorgante'})</label>
                <input value={procCpf} onChange={e => setProcCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: 'white' }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', margin: '10px 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Assinatura do titular</div>
                <AssinaturaCanvas onChange={setProcAss} altura={140} />
                {procErro && <div style={{ fontSize: 11.5, color: '#dc2626', marginTop: 6 }}>{procErro}</div>}
                <button onClick={assinarProcuracao} disabled={procAssinando}
                  style={{ marginTop: 10, width: '100%', padding: '10px', border: 'none', borderRadius: 10, background: procAssinando ? '#94a3b8' : AZUL, color: 'white', fontWeight: 800, fontSize: 13, cursor: procAssinando ? 'wait' : 'pointer' }}>
                  {procAssinando ? 'Registrando assinatura…' : 'Assinar a procuração'}
                </button>
              </>
            )}
          </div>
        )}

        {!aceite || procPendente || !/\S+@\S+\.\S+/.test(email) || !docValido(pagadorDoc) || pagadorNome.trim().length < 3 ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
            {!aceite ? 'Aceite os termos acima' : procPendente ? 'Assine a procuração acima' : !/\S+@\S+\.\S+/.test(email) ? 'Informe um e-mail válido' : pagadorNome.trim().length < 3 ? 'Informe o nome de quem vai pagar' : 'Informe um CPF ou CNPJ válido de quem vai pagar'} para continuar com o pagamento.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 12 }}>Como você quer pagar?</div>
            {!meio && (
              <div style={{ display: 'grid', gap: 10 }}>
                {[
                  { k: 'boleto', t: 'Boleto bancário', d: `taxa do boleto ${fmtBRL(viaBoleto.taxa)} · compensa em 1 a 3 dias úteis`, v: viaBoleto.total },
                  { k: 'cartao', t: 'Cartão de crédito', d: `taxa do cartão ${String(TAXA_CARTAO_MP_PCT).replace('.', ',')}% (${fmtBRL(viaCartao.taxa)}) · parcelamento com juros da operadora`, v: viaCartao.total },
                ].map(o => (
                  <button key={o.k} onClick={() => setMeio(o.k)}
                    style={{ textAlign: 'left', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 12, background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <span>
                      <span style={{ display: 'block', fontWeight: 800, fontSize: 14, color: '#0f172a' }}>{o.t}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{o.d}</span>
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 15, color: AZUL, whiteSpace: 'nowrap' }}>{fmtBRL(o.v)}</span>
                  </button>
                ))}
              </div>
            )}
            {meio && (
              <button onClick={() => setMeio(null)} style={{ background: 'none', border: 'none', color: AZUL, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
                ← trocar forma de pagamento
              </button>
            )}
            {meio === 'boleto' && (
              <BoletoHonorario arrematacaoId={arr.id} email={email} nome={pagadorNome.trim()} documento={pagadorDoc.replace(/\D/g, '')} previsto={viaBoleto} saldo={saldoDevido} onGerado={(g) => registrarAceite(g === 'mp' ? 'mercadopago' : 'asaas')} />
            )}
            {meio === 'cartao' && (
              <>
                <div style={{ fontSize: 12.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', lineHeight: 1.6, marginBottom: 10 }}>
                  Honorário {fmtBRL(viaCartao.honorario)} + taxa do cartão {fmtBRL(viaCartao.taxa)} = <strong>{fmtBRL(viaCartao.total)}</strong>
                </div>
                <PagamentoServico
                  servico={{ nome: 'Honorários de êxito', valor: viaCartao.total, proposito: 'honorario_exito' }}
                  extra={{ arrematacao_id: arr.id, pagador_doc: pagadorDoc.replace(/\D/g, ''), pagador_nome: pagadorNome.trim(), honorario_saldo: saldoDevido }}
                  email={email}
                  parcelasSemJuros={1}
                  soCartao
                  embutido
                  onPago={handlePago}
                  onCancelar={() => setMeio(null)}
                />
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 10.5, color: '#94a3b8' }}>
          <ShieldCheck size={12} /> {boletoPeloMp ? 'Boleto e cartão processados pelo Mercado Pago' : 'Boleto processado pelo Asaas · cartão pelo Mercado Pago'}
        </div>
      </div>
    </div>
  );
}
