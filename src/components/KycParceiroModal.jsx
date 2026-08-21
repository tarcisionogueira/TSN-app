import React, { useState, useEffect } from 'react';
import { Loader2, ShieldCheck, Camera, FileText, CheckCircle2 } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import ContinuarNoCelular from './ContinuarNoCelular';
import CapturaCamera from './CapturaCamera';

// Popup de VERIFICAÇÃO DE IDENTIDADE do PARCEIRO (pedido do dono: "quem vira parceiro e não fez
// o KYC deve ver um popup para preencher o que falta — selfie + documento").
// Antes o KYC só era exigido no SAQUE (e a tela de KYC do Perfil era gated a planos pagos), então
// um EXPLORADOR que virava parceiro nunca era solicitado. Aqui pedimos proativamente a QUALQUER
// parceiro (parceiro_aceite_em preenchido) que ainda não validou a identidade. Reusa o mesmo
// backend do Perfil (bucket privado 'documentos' + usuario_docs + /api/validar-selfie). O bloqueio
// duro continua no saque; este popup é o lembrete/atalho para completar. Dispensável ("Depois").

const ADIAR_KEY = 'tsn_kyc_parceiro_adiado';
const dataUrlDe = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });

export default function KycParceiroModal() {
  // `role` = papel REAL do logado; `impersonate` = modo suporte (admin vendo a conta de outro).
  // NÃO usar effectiveRole aqui: no suporte ele vira o papel do CLIENTE, então o bypass de admin
  // falhava e o popup do PRÓPRIO admin (que aderiu ao programa) aparecia SOBRE a conta do cliente.
  const { user, role, impersonate, cadastroIncompleto } = useAuth();
  const [estado, setEstado] = useState(null); // null=carregando | 'pedir' | 'ok'
  const [docEnviado, setDocEnviado] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [selfieBusy, setSelfieBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [adiado, setAdiado] = useState(() => { try { return sessionStorage.getItem(ADIAR_KEY) === '1'; } catch { return false; } });
  const docRef = React.useRef();
  const selfieArqRef = React.useRef(); // mesma selfie, vinda de arquivo em vez da câmera
  const [camAberta, setCamAberta] = React.useState(false);

  // EQUIPE TAMBÉM VERIFICA IDENTIDADE (decisão do dono, 08/08): "a equipe coloca pra fazer a
  // mesma verificação, batendo a selfie e anexando o documento de identidade". Quem recebe
  // dinheiro da plataforma prova quem é — a regra deixou de valer só para o parceiro. O bloqueio
  // duro vive no saque (`saque.exige_kyc`, escopo "todos"); este popup é o atalho para resolver.
  // O admin segue fora do POPUP (é quem opera o sistema e o vê o dia inteiro), mas NÃO fica fora
  // do gate de saque: se ele for sacar sem identidade validada, a regra barra igual.
  const RECEBE_POR_FUNCAO = ['analista', 'advogado', 'consultor', 'afiliado', 'leiloeiro'];

  useEffect(() => {
    // No modo suporte o popup não aparece (é ação pessoal do usuário — e os documentos iriam
    // para a conta errada). Só o próprio usuário, na sua sessão.
    if (!user?.id || role === 'admin' || impersonate) { setEstado('ok'); return; }
    let vivo = true;
    const precisaDe = (data) =>
      (!!data?.parceiro_aceite_em || RECEBE_POR_FUNCAO.includes(role))
      && !data?.identidade_validada && !data?.identidade_pendente;
    supabase.from('perfis').select('parceiro_aceite_em, identidade_validada, identidade_pendente')
      .eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (vivo) setEstado(precisaDe(data) ? 'pedir' : 'ok'); })
      .catch(() => setEstado('ok'));
    // Reavalia ao aceitar a parceria (o mesmo evento que atualiza o menu).
    const h = () => { setAdiado(false); try { sessionStorage.removeItem(ADIAR_KEY); } catch { /* ignore */ }
      supabase.from('perfis').select('parceiro_aceite_em, identidade_validada, identidade_pendente').eq('id', user.id).maybeSingle()
        .then(({ data }) => setEstado(precisaDe(data) ? 'pedir' : 'ok')).catch(() => {}); };
    window.addEventListener('tsn:parceiro-atualizado', h);
    return () => { vivo = false; window.removeEventListener('tsn:parceiro-atualizado', h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, role, impersonate]);

  // Não briga com o popup de cadastro base (nome/cidade/telefone): deixa aquele terminar antes.
  // E nunca aparece no modo suporte (impersonate) — o admin está só visualizando a conta do cliente.
  if (estado !== 'pedir' || adiado || cadastroIncompleto || !user || impersonate) return null;

  async function armazenarDoc(file, tipo, prefixo) {
    const ext = ((file.name || '').split('.').pop() || 'jpg').toLowerCase();
    const path = `pj/${user.id}/${prefixo}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('documentos').upload(path, file, { upsert: false });
    if (upErr) throw upErr;
    // Grava o PATH, de propósito (08/08): quem assina é o SERVIDOR, na hora, com a service key.
    // A tentativa de `createSignedUrl` aqui era vestigial — o cliente não tem permissão de
    // assinar neste bucket, então ela SEMPRE falhava com 400 e o handler global registrava o
    // erro em `erros_cliente` (3 ocorrências em /minha-rede). Ruído que escondia erro de verdade,
    // para obter algo que já não é usado.
    const { error: insErr } = await supabase.from('usuario_docs').insert({ user_id: user.id, tipo, nome: file.name || `${prefixo}.${ext}`, url: path, tamanho_kb: Math.round((file.size || 0) / 1024) }); // padrao-ok: KYC é do PRÓPRIO parceiro logado — admin nunca deve subir documento como o cliente
    if (insErr) throw insErr;
  }

  async function enviarDoc(file) {
    if (!file) return;
    setDocBusy(true); setErro('');
    try { await armazenarDoc(file, 'kyc_documento_frente', 'kyc-doc-frente'); setDocEnviado(true); }
    catch (e) { setErro(e.message || 'Erro ao enviar o documento.'); }
    setDocBusy(false);
  }

  async function enviarSelfie(file) {
    if (!file) return;
    setSelfieBusy(true); setErro('');
    try {
      // Gravar a selfie é REQUISITO, não bônus (08/08). O catch vazio de antes deixava o
      // fluxo seguir sem a foto no acervo — e sem ela a equipe não tem o que conferir na
      // revisão manual. Caso real: documento gravado, selfie inexistente, identidade nem
      // validada nem pendente, e a pessoa achando que concluiu.
      try {
        await armazenarDoc(file, 'kyc_selfie', 'kyc-rosto');
      } catch (e) {
        setErro(`Não consegui guardar a selfie (${e?.message || 'falha no envio'}). Tente de novo — sem ela a verificação não conclui.`);
        setSelfieBusy(false);
        return;
      }
      const dataUrl = await dataUrlDe(file);
      const r = await apiCall('/api/validar-selfie', { method: 'POST', body: JSON.stringify({ imagem: dataUrl, tipo: 'rosto' }) });
      const d = await r.json().catch(() => ({}));
      // `.ok` checado antes de interpretar o corpo: um 4xx/5xx traz JSON sem `ok`/`pendente`
      // e caía no ramo genérico, escondendo o motivo real.
      if (!r.ok) {
        setErro(d.error || d.mensagem || 'A verificação falhou. Tente novamente em instantes.');
        setSelfieBusy(false);
        return;
      }
      // SÓ fecha em sucesso REAL (d.ok) ou quando foi para revisão manual (d.pendente — a identidade
      // já saiu do estado "pedir"). REJEIÇÃO (rosto não confere/doc ilegível) NÃO fecha: mostra o
      // motivo e mantém o campo p/ refazer. Antes, qualquer resposta com `mensagem` fechava como ok.
      if (d.ok || d.pendente) {
        setEstado('ok');
        window.dispatchEvent(new Event('tsn:parceiro-atualizado'));
        if (d.pendente && d.mensagem) setErro('');
      } else if (d.falta_documento) {
        setDocEnviado(false);
        setErro(d.mensagem || 'Envie primeiro a foto do documento.');
      } else {
        setErro(d.mensagem || d.error || d.motivo || 'Não foi possível validar agora. Tente novamente.');
      }
    } catch { setErro('Erro no envio da selfie.'); }
    setSelfieBusy(false);
  }

  const adiar = () => { try { sessionStorage.setItem(ADIAR_KEY, '1'); } catch { /* ignore */ } setAdiado(true); };

  // O celular terminou de mandar documento + selfie (via QR). O telefone NÃO valida nada — quem
  // pede a conferência é ESTA sessão, autenticada, com a mesma rota de sempre. A diferença é que
  // a selfie já está no acervo, então mandamos `selfie_do_acervo` em vez dos bytes.
  async function concluirPeloCelular() {
    setDocEnviado(true); setSelfieBusy(true); setErro('');
    try {
      const r = await apiCall('/api/validar-selfie', { method: 'POST', body: JSON.stringify({ tipo: 'rosto', selfie_do_acervo: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d.error || d.mensagem || 'A verificação falhou. Tente novamente em instantes.');
        setSelfieBusy(false);
        return;
      }
      if (d.ok || d.pendente) {
        setEstado('ok');
        window.dispatchEvent(new Event('tsn:parceiro-atualizado'));
      } else {
        setErro(d.mensagem || d.error || 'Recebi as fotos, mas não consegui concluir a verificação. Tente a selfie por aqui.');
      }
    } catch { setErro('Recebi as fotos, mas a verificação falhou. Tente novamente.'); }
    setSelfieBusy(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '30px 28px', width: '100%', maxWidth: 440, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ background: '#0D63DB', borderRadius: 10, padding: '8px 10px' }}><ShieldCheck size={18} color="white" /></div>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#111111' }}>Verifique sua identidade</div>
        </div>
        <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: 13.5, lineHeight: 1.6 }}>
          Você entrou no <strong>Programa de Parceiros</strong>. Para receber suas comissões com segurança, precisamos verificar sua identidade: envie uma foto do seu <strong>documento</strong> (RG ou CNH) e uma <strong>selfie</strong>. Leva 1 minuto.
        </p>

        {/* Passo 1 — documento. SEM `capture`: o seletor nativo deixa ESCOLHER câmera OU galeria/
            arquivos/Drive (pedido do dono — igual ao contrato de assessoria/club). Com capture o
            celular abria direto a câmera e não dava p/ carregar um arquivo/PDF já salvo. */}
        <input ref={docRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => enviarDoc(e.target.files[0])} />
        <button onClick={() => docRef.current?.click()} disabled={docBusy}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', marginBottom: 10, border: `1px solid ${docEnviado ? '#86efac' : '#cbd5e1'}`, background: docEnviado ? '#f0fdf4' : '#f8fafc', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 13.5, color: docEnviado ? '#166534' : '#334155' }}>
          {docEnviado ? <CheckCircle2 size={18} color="#16a34a" /> : <FileText size={18} color="#0D63DB" />}
          {docBusy ? 'Enviando documento…' : docEnviado ? 'Documento enviado ✓' : '1. Documento (RG/CNH) — foto ou arquivo'}
        </button>

        {/* Passo 2 — selfie (habilita após o documento). DOIS caminhos explícitos: câmera e
            arquivo já existente. O `capture="user"` sozinho engana no computador — lá o
            atributo é ignorado e abre um seletor de arquivos, sem o usuário ter pedido isso.
            Melhor oferecer os dois com o nome certo (o QR para o celular vem logo abaixo). */}
        <CapturaCamera
          aberto={camAberta}
          onFechar={() => setCamAberta(false)}
          onCapturar={(file) => { setCamAberta(false); enviarSelfie(file); }}
          titulo="Tirar selfie do rosto" />
        <input ref={selfieArqRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => enviarSelfie(e.target.files[0])} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setCamAberta(true)} disabled={!docEnviado || selfieBusy}
            style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 8, padding: '13px 14px', border: 'none', background: (!docEnviado || selfieBusy) ? '#93c5fd' : '#0D63DB', borderRadius: 12, cursor: (!docEnviado || selfieBusy) ? 'default' : 'pointer', fontWeight: 800, fontSize: 14, color: 'white', opacity: (!docEnviado || selfieBusy) ? 0.8 : 1, justifyContent: 'center' }}>
            {selfieBusy ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Verificando…</> : <><Camera size={16} /> 2. Tirar selfie</>}
          </button>
          <button onClick={() => selfieArqRef.current?.click()} disabled={!docEnviado || selfieBusy}
            title="Enviar uma foto que você já tem"
            style={{ flex: 1, padding: '13px 10px', border: '1px solid #cbd5e1', background: 'white', borderRadius: 12, cursor: (!docEnviado || selfieBusy) ? 'default' : 'pointer', fontWeight: 700, fontSize: 12.5, color: '#334155', opacity: (!docEnviado || selfieBusy) ? 0.6 : 1 }}>
            📎 Escolher foto
          </button>
        </div>

        {/* Desvio para o CELULAR (só aparece no computador — no telefone o botão de câmera já
            resolve). Webcam de desktop fotografa documento mal, e era exatamente aqui que o
            cliente parava. O QR leva só este passo para o celular, sem novo login. */}
        <div style={{ margin: '12px 0 2px' }}>
          <ContinuarNoCelular
            fluxo={docEnviado ? 'selfie' : 'kyc'}
            rotulo={docEnviado ? 'Tirar a selfie pelo celular? Ler QR code' : 'Prefere pelo celular? Ler QR code'}
            onConcluido={concluirPeloCelular} />
        </div>

        {erro && <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#dc2626' }}>{erro}</div>}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button onClick={adiar} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>Fazer isso depois</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, color: '#94a3b8', marginTop: 12 }}>
          <ShieldCheck size={11} /> Documentos protegidos conforme a LGPD, com acesso restrito
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
