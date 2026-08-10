import React, { useState, useEffect } from 'react';
import { Loader2, ShieldCheck, ArrowLeft } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import CidadeAutocomplete from './CidadeAutocomplete';
import LogoB from './LogoB';

// Popup pós-login que completa o cadastro pedindo UM campo por vez (só o que falta).
// Base do explorador grátis: nome, cidade+UF, telefone e aceite LGPD. O CPF NÃO entra
// aqui — é exigido só na hora de pagar (checkout) e de sacar. A cidade é obrigatória
// porque alimenta o filtro por região e os alertas por e-mail.

const inp = {
  width: '100%', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10,
  fontSize: 14, background: 'white', color: '#111111', boxSizing: 'border-box',
};
const maskTel = (v) => {
  const d = (v || '').replace(/\D/g, '').slice(0, 11);
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
};

const CAMPO = {
  nome:     { titulo: 'Como você se chama?', sub: 'Seu nome completo.' },
  cidade:   { titulo: 'Qual a sua cidade?', sub: 'Usamos para mostrar os imóveis da sua região e nos seus alertas por e-mail.' },
  telefone: { titulo: 'Seu telefone / WhatsApp', sub: 'Com DDD — para contato e avisos importantes.' },
  lgpd:     { titulo: 'Só falta o aceite', sub: 'Confirme os termos para concluir.' },
};

export default function CompletarCadastroModal() {
  const { user, cadastroIncompleto, setCadastroIncompleto } = useAuth();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [passos, setPassos] = useState([]); // campos que faltam, na ordem
  const [idx, setIdx] = useState(0);
  const [dados, setDados] = useState({ nome: '', telefone: '', cidade: '', uf: '', lgpd: false });

  useEffect(() => {
    if (!user?.id || !cadastroIncompleto) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const { data, error } = await supabase.from('perfis')
        .select('nome, telefone, endereco_cidade, endereco_uf, lgpd_aceito')
        .eq('id', user.id).single();
      if (!vivo) return;
      // FALHA DE LEITURA NÃO É "CADASTRO INCOMPLETO" (10/08). O postgrest-js não lança em
      // não-2xx: devolve `{data:null,error}`. Com `data` nulo, todo campo virava "faltando" e
      // o app ficava atrás de um popup por causa de um 500 transitório. Some-se a isto o fato
      // de `passos` poder dar VAZIO (ver abaixo) e o resultado era uma cortina cinza sem saída.
      // Sem conseguir ler, o certo é NÃO bloquear: o gate de verdade é o servidor.
      if (error) { setCadastroIncompleto(false); setCarregando(false); return; }
      // MESMO CRITÉRIO DO AuthContext (`fetchPerfil`: `!data?.nome`). Antes o modal aceitava o
      // `full_name` do metadata do Auth como nome válido, então para uma conta social com
      // `perfis.nome` vazio o contexto dizia "incompleto" e o modal concluía "nada falta" —
      // discordância que produzia o overlay vazio E se auto-perpetuava, porque o patch só grava
      // `passos.includes('nome')` e `perfis.nome` nunca era preenchido. Agora o passo aparece
      // com o nome do metadata JÁ PREENCHIDO: o usuário confirma, o `perfis.nome` é gravado e
      // as duas leituras passam a concordar.
      const nomePerfil = String(data?.nome || '').trim();
      const nome = nomePerfil || user.user_metadata?.full_name || user.user_metadata?.name || '';
      const tel = data?.telefone || '';
      const cidade = data?.endereco_cidade || '';
      const uf = data?.endereco_uf || '';
      const lgpd = !!data?.lgpd_aceito;
      const falta = [];
      if (!nomePerfil) falta.push('nome');
      if (!cidade || !uf) falta.push('cidade');
      if (!tel) falta.push('telefone');
      if (!lgpd) falta.push('lgpd');
      setDados({ nome, telefone: tel ? maskTel(tel) : '', cidade, uf, lgpd });
      setPassos(falta);
      setIdx(0);
      setErro('');
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [user, cadastroIncompleto]);

  // NADA A PEDIR = NADA A MOSTRAR. O `passos.length === 0 ? null` vivia DENTRO do JSX da
  // cortina: sobrava um retângulo cinza em tela cheia com o cabeçalho "Complete seu cadastro" e
  // mais nada — sem campo, sem botão, sem X, sem clique-fora. Não havia caminho de saída na
  // interface e o app inteiro ficava inutilizável. Além de não renderizar (early return abaixo),
  // o estado é DESLIGADO aqui — em efeito, nunca durante o render, que atualizaria o contexto no
  // meio da renderização de outro componente. Sem desligar, a condição voltaria no próximo
  // render e o usuário ficaria preso do mesmo jeito.
  const vazio = !carregando && cadastroIncompleto && !!user && passos.length === 0;
  useEffect(() => { if (vazio) setCadastroIncompleto(false); }, [vazio, setCadastroIncompleto]);

  if (!cadastroIncompleto || !user || vazio) return null;

  const passo = passos[idx];
  const ultimo = idx >= passos.length - 1;

  const validarPasso = () => {
    if (passo === 'nome') return dados.nome.trim().length >= 3 ? true : 'Informe seu nome completo.';
    if (passo === 'cidade') return (dados.cidade && dados.uf) ? true : 'Selecione sua cidade na lista (com o estado).';
    if (passo === 'telefone') return dados.telefone.replace(/\D/g, '').length >= 10 ? true : 'Informe um telefone/WhatsApp com DDD.';
    if (passo === 'lgpd') return dados.lgpd ? true : 'É necessário aceitar os Termos e a Política de Privacidade.';
    return true;
  };

  const avancar = async () => {
    setErro('');
    const v = validarPasso();
    if (v !== true) { setErro(v); return; }
    if (!ultimo) { setIdx(i => i + 1); return; }
    // Último passo → grava só o que faltava.
    setSalvando(true);
    try {
      const patch = {};
      if (passos.includes('nome')) patch.nome = dados.nome.trim();
      if (passos.includes('telefone')) patch.telefone = dados.telefone.replace(/\D/g, '');
      if (passos.includes('cidade')) {
        patch.endereco = `${dados.cidade} - ${dados.uf}`;
        patch.endereco_cidade = dados.cidade;
        patch.endereco_uf = dados.uf;
        patch.cidades_interesse = [{ cidade: dados.cidade, uf: dados.uf, raio_km: 50 }];
      }
      if (passos.includes('lgpd')) { patch.lgpd_aceito = true; patch.lgpd_data = new Date().toISOString(); }
      const { error } = await supabase.from('perfis').update(patch).eq('id', user.id);
      if (error) throw error;
      supabase.auth.updateUser({ data: { nome: patch.nome ?? dados.nome, telefone: patch.telefone } }).catch(() => {});
      setCadastroIncompleto(false); // fecha o popup e libera o app
    } catch (e) {
      setErro(e.message || 'Não foi possível salvar. Tente novamente.');
      setSalvando(false);
    }
  };

  const info = CAMPO[passo] || {};

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '32px 28px', width: '100%', maxWidth: 430, boxShadow: '0 24px 60px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{ background: '#0D63DB', borderRadius: 10, padding: '8px 10px' }}><LogoB size={18} /></div>
          <div style={{ fontWeight: 900, fontSize: 15, color: '#111111' }}>Complete seu cadastro</div>
        </div>

        {carregando ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '28px 0', color: '#64748b', fontSize: 14 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Carregando…
          </div>
        ) : passos.length === 0 ? null : (
          <>
            {/* Progresso */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {passos.map((_, i) => (
                <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i <= idx ? '#0D63DB' : '#e2e8f0' }} />
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>Passo {idx + 1} de {passos.length}</div>
            <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 20, color: '#111111' }}>{info.titulo}</h2>
            <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: 13.5, lineHeight: 1.55 }}>{info.sub}</p>

            {/* Campo do passo atual */}
            {passo === 'nome' && (
              <input value={dados.nome} onChange={e => setDados(d => ({ ...d, nome: e.target.value }))}
                placeholder="Seu nome completo" autoFocus style={inp} />
            )}
            {passo === 'cidade' && (
              <div>
                <CidadeAutocomplete value={dados.cidade} placeholder="Digite e selecione sua cidade…"
                  onSelect={({ cidade, uf }) => setDados(d => ({ ...d, cidade, uf }))} />
                {dados.cidade && dados.uf
                  ? <div style={{ fontSize: 11.5, color: '#059669', marginTop: 6, fontWeight: 600 }}>✓ {dados.cidade} — {dados.uf}</div>
                  : <div style={{ fontSize: 11.5, color: '#d97706', marginTop: 6 }}>Selecione a cidade na lista para vincular o estado (UF).</div>}
              </div>
            )}
            {passo === 'telefone' && (
              <input value={dados.telefone} onChange={e => setDados(d => ({ ...d, telefone: maskTel(e.target.value) }))}
                placeholder="(00) 00000-0000" inputMode="numeric" autoFocus style={inp} />
            )}
            {passo === 'lgpd' && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#475569', lineHeight: 1.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={dados.lgpd} onChange={e => setDados(d => ({ ...d, lgpd: e.target.checked }))}
                  style={{ marginTop: 3, flexShrink: 0 }} />
                <span>Li e aceito os <a href="#/termos" target="_blank" style={{ color: '#0D63DB', fontWeight: 700 }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" style={{ color: '#0D63DB', fontWeight: 700 }}>Política de Privacidade</a>, conforme a LGPD.</span>
              </label>
            )}

            {erro && <div style={{ marginTop: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#dc2626' }}>{erro}</div>}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 22 }}>
              {idx > 0 && (
                <button onClick={() => { setErro(''); setIdx(i => i - 1); }} disabled={salvando}
                  style={{ padding: '11px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowLeft size={15} /> Voltar
                </button>
              )}
              <button onClick={avancar} disabled={salvando}
                style={{ flex: 1, padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: salvando ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: salvando ? 0.7 : 1 }}>
                {salvando ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</> : (ultimo ? 'Concluir' : 'Avançar')}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 11, color: '#94a3b8', marginTop: 16 }}>
              <ShieldCheck size={11} /> Seus dados são protegidos conforme a LGPD
            </div>
          </>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
