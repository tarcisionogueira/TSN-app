import React, { useEffect, useState } from 'react';
import { apiCall } from '../utils/apiCall';

/**
 * GERADOR DE MENSAGENS DO GRUPO — aquecimento diário do grupo de WhatsApp da aula ao vivo.
 *
 * ⚠️ ESTA TELA NÃO POSTA NO GRUPO. Gera o texto com o dado REAL da semana (evento vivo,
 * depoimento curado, vagas) e você copia e cola — mesma mecânica assistida do "Convidar por
 * WhatsApp" (DisparoWhatsApp.jsx) e da caixa do Instagram: a IA/o sistema não tem como postar
 * num grupo de WhatsApp sozinho (não é DM, e a API oficial exige template aprovado pela Meta).
 *
 * ZERO GERAÇÃO POR IA. Cada tipo de mensagem só reorganiza dado que já existe: o depoimento de
 * "case de sucesso" vem de `eventos_live.depoimentos` (curado à mão pelo dono), o mito/verdade
 * da educação jurídica é o que VOCÊ escreve aqui, e convite/urgência usam só título, data e
 * vagas reais do evento. Ver api/_mensagens-grupo.js para o porquê disso ser deliberado.
 */

const TIPOS = [
  { valor: 'convite', rotulo: '📅 Convite / motivação', desc: 'Convite pra aula, com um destaque real do apresentador (opcional).' },
  { valor: 'case', rotulo: '🏠 Case de sucesso', desc: 'Um depoimento real, já cadastrado na aula.' },
  { valor: 'educacao', rotulo: '🔍 Educação (mito ou verdade)', desc: 'Você escreve o mito e a verdade — a tela só formata.' },
  { valor: 'enquete', rotulo: '📊 Enquete', desc: 'Pergunta + até 4 opções.' },
  { valor: 'urgencia', rotulo: '⏰ Urgência pré-live', desc: 'Escalada por estágio (2h, 1h, 30min, sala aberta).' },
  { valor: 'followup', rotulo: '👋 Follow-up pós-live', desc: 'Convite pra plataforma depois da aula.' },
  { valor: 'oportunidade', rotulo: '🏠 Oportunidade real', desc: 'Um imóvel real do acervo — o link já mostra foto, cidade e preço no WhatsApp.' },
];

const ESTAGIOS = [
  { valor: 't-2h', rotulo: 'Faltam 2 horas' },
  { valor: 't-1h', rotulo: 'Falta 1 hora' },
  { valor: 't-30min', rotulo: 'Menos de 30 minutos' },
  { valor: 't-10min', rotulo: 'Sala aberta' },
];

const S = {
  caixa: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 6 },
  input: { width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', fontSize: 13.5, boxSizing: 'border-box' },
};

export default function GeradorMensagensGrupo() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [tipo, setTipo] = useState('convite');
  const [gerando, setGerando] = useState(false);
  const [texto, setTexto] = useState('');
  const [copiado, setCopiado] = useState(false);

  // Campos extras por tipo — ficam todos aqui em vez de um estado por tipo, porque só um
  // tipo está ativo por vez e resetar tudo ao trocar de aba evita mensagem misturada
  // (ex.: mito de uma pergunta indo pra dentro de uma enquete de outra).
  const [destaqueIndex, setDestaqueIndex] = useState(0);
  const [depoimentoIndex, setDepoimentoIndex] = useState(0);
  const [imovelIndex, setImovelIndex] = useState(0);
  const [mito, setMito] = useState('');
  const [verdade, setVerdade] = useState('');
  const [pergunta, setPergunta] = useState('Qual tipo de imóvel faz mais sentido pra você agora?');
  const [opcoes, setOpcoes] = useState(['Apartamento', 'Casa', 'Terreno', 'Galpão/comercial']);
  const [estagio, setEstagio] = useState('t-2h');

  async function carregar() {
    setCarregando(true); setErro('');
    try {
      const r = await apiCall('/api/admin-mensagens-grupo');
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) throw new Error(j?.error || 'Falhou ao carregar');
      setDados(j);
    } catch (e) { setErro(String(e.message || e)); }
    finally { setCarregando(false); }
  }
  useEffect(() => { carregar(); }, []);

  async function gerar() {
    setGerando(true); setErro(''); setTexto(''); setCopiado(false);
    const extras = {
      convite: { destaque_index: destaqueIndex },
      case: { depoimento_index: depoimentoIndex },
      educacao: { mito, verdade },
      enquete: { pergunta, opcoes },
      urgencia: { estagio },
      followup: {},
      oportunidade: { imovel_index: imovelIndex },
    }[tipo];
    try {
      const r = await apiCall('/api/admin-mensagens-grupo', { method: 'POST', body: JSON.stringify({ tipo, dados: extras }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) throw new Error(j?.error === 'dado_insuficiente' ? (j.detalhe || 'Falta informação pra montar esta mensagem.') : (j?.error || 'Falhou ao gerar'));
      setTexto(j.texto);
      carregar(); // atualiza "gerado hoje" sem esperar o próximo reload
    } catch (e) { setErro(String(e.message || e)); }
    finally { setGerando(false); }
  }

  async function copiar() {
    let ok = false;
    try { await navigator.clipboard.writeText(texto); ok = true; } catch { /* clipboard bloqueado */ }
    if (ok) { setCopiado(true); setTimeout(() => setCopiado(false), 2500); }
    else { window.prompt('Copie o texto:', texto); }
  }

  if (carregando) return <div style={{ padding: 28, fontFamily: 'system-ui' }}>Carregando…</div>;
  if (erro && !dados) return <div style={{ padding: 28, color: '#991b1b', fontFamily: 'system-ui' }}>{erro}</div>;
  if (!dados?.evento) return <div style={{ padding: 28, fontFamily: 'system-ui' }}>Nenhuma aula futura ativa.</div>;

  const ev = dados.evento;
  const tipoAtual = TIPOS.find((t) => t.valor === tipo);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 18px 60px', fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Mensagens do grupo</h1>
      <p style={{ fontSize: 14, color: '#475569', margin: '0 0 6px' }}>
        {ev.titulo} — <strong>{ev.quando}</strong>
      </p>
      <p style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, padding: '10px 12px', lineHeight: 1.6 }}>
        Esta tela <strong>não posta no grupo</strong>. Gera o texto pronto — você confere,
        copia e cola no WhatsApp. Nada aqui inventa número: cada tipo só usa dado real
        (depoimento cadastrado, vagas do evento, ou o que você mesmo escrever).
      </p>

      {erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '10px 12px', fontSize: 13, marginBottom: 14 }}>{erro}</div>
      )}

      <div style={S.caixa}>
        <label style={S.label}>Tipo de mensagem</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {TIPOS.map((t) => (
            <button key={t.valor} onClick={() => { setTipo(t.valor); setTexto(''); setErro(''); }}
              style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                border: tipo === t.valor ? '2px solid #0D63DB' : '1px solid #cbd5e1',
                background: tipo === t.valor ? '#eff6ff' : '#fff', color: tipo === t.valor ? '#0D63DB' : '#475569',
              }}>
              {t.rotulo}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12.5, color: '#64748b' }}>{tipoAtual?.desc}</div>
      </div>

      {/* Campos extras — só o do tipo selecionado aparece */}
      {tipo === 'convite' && ev.apresentador_destaques?.length > 0 && (
        <div style={S.caixa}>
          <label style={S.label}>Destaque do apresentador (opcional)</label>
          <select value={destaqueIndex} onChange={(e) => setDestaqueIndex(Number(e.target.value))} style={S.input}>
            <option value={-1}>— nenhum —</option>
            {ev.apresentador_destaques.map((d, i) => <option key={i} value={i}>{d.slice(0, 90)}</option>)}
          </select>
        </div>
      )}

      {tipo === 'case' && (
        <div style={S.caixa}>
          <label style={S.label}>Depoimento real</label>
          {ev.depoimentos?.length > 0 ? (
            <select value={depoimentoIndex} onChange={(e) => setDepoimentoIndex(Number(e.target.value))} style={S.input}>
              {ev.depoimentos.map((d, i) => <option key={i} value={i}>{d.nome}{d.local ? ` (${d.local})` : ''} — {d.tag}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 13, color: '#b45309' }}>Nenhum depoimento cadastrado nesta aula ainda — cadastre em Admin → Aula ao vivo.</div>
          )}
        </div>
      )}

      {tipo === 'educacao' && (
        <div style={S.caixa}>
          <label style={S.label}>Mito (a frase que as pessoas acreditam, errada)</label>
          <textarea value={mito} onChange={(e) => setMito(e.target.value)} rows={2} style={{ ...S.input, marginBottom: 10, resize: 'vertical' }}
            placeholder="Ex.: Imóvel de leilão fica marcado pra sempre no documento" />
          <label style={S.label}>Verdade (o fato real — curto e verificável)</label>
          <textarea value={verdade} onChange={(e) => setVerdade(e.target.value)} rows={3} style={{ ...S.input, resize: 'vertical' }}
            placeholder="Ex.: Depois de 30 dias da arrematação, o registro sai normal." />
        </div>
      )}

      {tipo === 'enquete' && (
        <div style={S.caixa}>
          <label style={S.label}>Pergunta</label>
          <input value={pergunta} onChange={(e) => setPergunta(e.target.value)} style={{ ...S.input, marginBottom: 10 }} />
          <label style={S.label}>Opções (até 4 — deixe em branco pra não usar)</label>
          {opcoes.map((o, i) => (
            <input key={i} value={o} onChange={(e) => setOpcoes((arr) => arr.map((v, j) => (j === i ? e.target.value : v)))}
              style={{ ...S.input, marginBottom: 6 }} />
          ))}
        </div>
      )}

      {tipo === 'oportunidade' && (
        <div style={S.caixa}>
          <label style={S.label}>Imóvel do acervo</label>
          {dados.oportunidades?.length > 0 ? (
            <select value={imovelIndex} onChange={(e) => setImovelIndex(Number(e.target.value))} style={S.input}>
              {dados.oportunidades.map((im, i) => (
                <option key={i} value={i}>
                  {im.tipo ? `${im.tipo} · ` : ''}{im.cidade}/{im.estado} — {Math.round(im.desconto_percentual)}% off
                  {im.data_leilao ? '' : ' · sem praça marcada'}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: 13, color: '#b45309' }}>Nenhum imóvel com desconto ≥30% e foto no acervo agora.</div>
          )}
        </div>
      )}

      {tipo === 'urgencia' && (
        <div style={S.caixa}>
          <label style={S.label}>Estágio</label>
          <select value={estagio} onChange={(e) => setEstagio(e.target.value)} style={S.input}>
            {ESTAGIOS.map((e2) => <option key={e2.valor} value={e2.valor}>{e2.rotulo}</option>)}
          </select>
          {!ev.vagas_max && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Sem teto de vagas cadastrado — a mensagem sai sem a linha de vagas (correto: não inventa teto).</div>
          )}
        </div>
      )}

      <button onClick={gerar} disabled={gerando}
        style={{ width: '100%', padding: 14, background: gerando ? '#cbd5e1' : '#0D63DB', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 15, cursor: gerando ? 'default' : 'pointer', fontFamily: 'inherit', marginBottom: 16 }}>
        {gerando ? 'Gerando…' : 'Gerar mensagem →'}
      </button>

      {texto && (
        <div style={{ border: '2px solid #16a34a', borderRadius: 14, padding: 16, marginBottom: 22, background: '#f0fdf4' }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6, background: '#fff', border: '1px solid #d1fae5', borderRadius: 10, padding: 12, margin: '0 0 14px', fontFamily: 'inherit', color: '#334155' }}>{texto}</pre>
          <button onClick={copiar}
            style={{ width: '100%', padding: 13, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
            {copiado ? '✓ Copiado!' : 'Copiar →'}
          </button>
        </div>
      )}

      {dados.geradas_hoje === null && (
        <div style={{ fontSize: 12, color: '#b45309' }}>(não consegui ler o que já foi gerado hoje)</div>
      )}
      {Array.isArray(dados.geradas_hoje) && dados.geradas_hoje.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', margin: '0 0 8px' }}>Já gerado nesta edição ({dados.geradas_hoje.length})</div>
          {dados.geradas_hoje.map((g, i) => {
            const t = TIPOS.find((x) => x.valor === g.tipo);
            const hora = new Date(g.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 2px', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                <span style={{ color: '#94a3b8', minWidth: 42 }}>{hora}</span>
                <span>{t?.rotulo || g.tipo}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
