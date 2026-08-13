import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, Tag, Building2, FileText, ExternalLink, BarChart2, AlertTriangle, CheckCircle, Clock, Home, Banknote, Paperclip, Upload, Trash2, ChevronDown, ChevronUp, UserCheck, ScrollText, ShieldCheck, Share2, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import ScoreRisco from '../components/ScoreRisco';
import { fmtBRL, fmtData, MODAL_LABEL, explicacaoData } from '../utils/format';
import { scoreBidPro, scoreLabel } from '../utils/score';
import { leilaoEncerrado, pracaMaisDescontada, dataBR } from '../utils/leilaoEncerrado';
import { caixaMatriculaUrl, caixaRegrasVendaUrl } from '../utils/caixa';
import { assinarAnexos } from '../utils/docUrl';
import { formatarDescricaoImovel } from '../utils/descricao';
import { fotoCandidatos } from '../utils/foto';
import { trackImovelVisualizado } from '../utils/gtag';
import { lerCotaMercado } from '../utils/cotaAnalise';

// Botões de documento só aparecem quando o valor é uma URL real — o scraper da
// Caixa às vezes grava rótulos ("Venda Direta Online", "Leilão SFI - Edital Único").
const ehUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());
// Documento REAL = ARQUIVO (PDF, com ou sem querystring) ou objeto no NOSSO Storage.
// Uma PÁGINA (matricula.asp, detalhe-imovel.asp, /imoveis/…) NÃO é documento — a
// auditoria por leiloeiro mostrou milhares de "matrículas"/"editais" que na verdade
// são a página do lote. Sem isto, o botão "Matrícula"/"Edital" abre um site, não o doc.
const ehDocArquivo = (v) => ehUrl(v) && (/\.pdf(\?|#|$)/i.test(v.trim()) || /\/storage\/v1\/object\/(sign|public)\//i.test(v));
const ehMatriculaValida = (v) => ehDocArquivo(v) && !/matricula\.asp/i.test(v);
// "Regras de venda" só é um DOCUMENTO de verdade quando não é a própria página do
// anúncio no portal (detalhe-imovel.asp da Caixa = mesmo destino do url_lote, já
// coberto pelo botão "Ver no portal"). Senão o botão abre o site, não um arquivo.
const ehRegrasDoc = (v, urlLote) => ehUrl(v) && !/detalhe-imovel\.asp/i.test(v) && v.trim() !== (urlLote || '').trim();

const TIPO_LABEL = { casa:'Casa', apartamento:'Apartamento', terreno:'Terreno/Lote', comercial:'Comercial', rural:'Rural', galpao:'Galpão', sala:'Sala Comercial', vaga:'Vaga de Garagem', imovel:'Imóvel' };

const TIPO_ANEXO_LABEL = {
  edital: 'Edital', auto_arrematacao: 'Auto de Arrematação', carta_arrematacao: 'Carta de Arrematação',
  matricula: 'Matrícula', contrato: 'Contrato', procuracao: 'Procuração', outro: 'Outro',
};
const TIPO_DOC_LABEL = {
  identidade: 'Identidade/CPF', comprovante_pagamento: 'Comprovante de Pagamento',
  procuracao: 'Procuração', cnd: 'CND/Certidão', outro: 'Outro',
};
const TIPO_DOC_IMOVEL = { matricula: 'Matrícula', edital: 'Edital', regras_venda: 'Regras de venda online' };
const STATUS_ARR = {
  em_processo: { label: 'Em Processo', bg: '#fef9c3', color: '#92400e' },
  finalizado:  { label: 'Finalizado',  bg: '#dcfce7', color: '#166534' },
  cancelado:   { label: 'Cancelado',   bg: '#fee2e2', color: '#991b1b' },
};

// Categorias de pontos próximos (legenda + cor dos pins). Chaves = as do cron.
const CATS_PROX = {
  praia:      { label: 'Praia',      emoji: '🏖️', cor: '#0891b2' },
  transporte: { label: 'Transporte', emoji: '🚌', cor: '#7c3aed' },
  mercado:    { label: 'Mercado',    emoji: '🛒', cor: '#16a34a' },
  farmacia:   { label: 'Farmácia',   emoji: '💊', cor: '#dc2626' },
  saude:      { label: 'Saúde',      emoji: '🏥', cor: '#ef4444' },
  escola:     { label: 'Escola',     emoji: '🏫', cor: '#f59e0b' },
  shopping:   { label: 'Shopping',   emoji: '🛍️', cor: '#db2777' },
};
const fmtDist = m => m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : `${m} m`;

// Distância REAL do pino do imóvel ao ponto (haversine). Recalculada aqui no
// render para o número SEMPRE bater com o mapa — o dist_m salvo pode ter sido
// calculado de uma coordenada antiga (antes de o pino ser reposicionado).
function distHaversine(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v == null || isNaN(Number(v)))) return null;
  const R = 6371000, toRad = d => Number(d) * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
// Distância do ponto ao imóvel: usa o cálculo vivo (bate com o mapa) e cai no
// dist_m salvo só se faltar coordenada.
const distPonto = (imLat, imLng, p) => distHaversine(imLat, imLng, p?.lat, p?.lng) ?? p?.dist_m ?? 0;

// Mapa embutido (Leaflet/OpenStreetMap) com o imóvel + pontos de interesse próximos.
// `nivel` (geocod_nivel) define a PRECISÃO: endereco/rua = pino exato; bairro/cidade
// = círculo de área aproximada (o dado não permite apontar o lote exato, então não
// fingimos precisão — evita a "localização errada" que na verdade é imprecisão).
function MiniMapa({ lat, lng, pontos, nivel }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const roRef = useRef(null);
  const aproximado = nivel === 'bairro' || nivel === 'cidade';
  const raioM = nivel === 'cidade' ? 6000 : nivel === 'bairro' ? 1200 : 0;
  const zoomBase = nivel === 'cidade' ? 11 : nivel === 'bairro' ? 14 : 16;
  // Enquadra o imóvel + pontos próximos — usado só na CARGA inicial.
  const enquadrar = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const grupo = [[lat, lng]];
    for (const [key, p] of Object.entries(pontos || {})) {
      if (!p?.lat || !p?.lng || !CATS_PROX[key]) continue;
      grupo.push([p.lat, p.lng]);
    }
    try {
      if (grupo.length > 1) map.fitBounds(grupo, { padding: [30, 30], maxZoom: aproximado ? zoomBase : 16 });
      else map.setView([lat, lng], zoomBase);
    } catch (_) { /* mapa ainda sem tamanho válido */ }
  }, [lat, lng, pontos, aproximado, zoomBase]);

  // Botão "centralizar": leva o imóvel ao centro MANTENDO o zoom atual do usuário
  // (ele deu zoom para ver as ruas; não queremos reiniciar o enquadramento).
  const centralizarNoImovel = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    try { map.setView([lat, lng], map.getZoom(), { animate: true }); } catch (_) { /* */ }
  }, [lat, lng]);

  useEffect(() => {
    let cancel = false;
    const timers = [];
    import('leaflet').then(({ default: L }) => {
      if (cancel || !ref.current || mapRef.current) return;
      const map = L.map(ref.current, { scrollWheelZoom: false, attributionControl: false }).setView([lat, lng], zoomBase);
      // Basemap com FALLBACK automático: o tile.openstreetmap.org BLOQUEIA tráfego
      // de app em produção (mapa em branco) — por isso usamos CARTO e, se ele também
      // acumular erros de tile (bloqueio), o mapa cai sozinho para o Esri.
      // Esri PRIMÁRIO (token-free e confiável). O CARTO no-token passou a devolver
      // tile em branco com HTTP 200 (sem erro), então o mapa ficava vazio e o
      // fallback por 'tileerror' nunca disparava. CARTO fica só como reserva.
      const BASEMAPS = [
        // Esri Light Gray Canvas (base limpa + rótulos) — visual agradável tipo Positron.
        { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', labels: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', opts: { maxNativeZoom: 16, maxZoom: 19 } },
        { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19 } },
        { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', opts: { subdomains: 'abcd', maxZoom: 19 } },
      ];
      let baseIdx = 0, tileErros = 0, refLayer = null;
      // `vivo()`: o mapa ainda está montado E é este mapa? Todo retorno ASSÍNCRONO abaixo
      // precisa perguntar isso antes de tocar no Leaflet.
      //
      // FOI EXATAMENTE AQUI QUE QUEBROU (erro de cliente em 11/08, rota /imovel/:id:
      // "Cannot read properties of undefined (reading '_leaflet_pos')", 2 ocorrências).
      // `tileerror` chega da REDE, e a rede não sabe que a pessoa já saiu da página. Quem
      // navegava entre imóveis com tile falhando disparava o fallback DEPOIS do
      // `map.remove()` da limpeza: `layer.addTo(map)` num mapa removido faz o Leaflet
      // procurar o `_mapPane`, que não existe mais → estouro na cara do cliente.
      // `map.remove()` para as animações sozinho, mas não cancela handler nosso preso a
      // resposta de rede pendente — isso é conosco.
      const vivo = () => !cancel && mapRef.current === map;
      const montarBase = () => {
        const b = BASEMAPS[baseIdx];
        const layer = L.tileLayer(b.url, { ...b.opts, zIndex: 1 });
        tileErros = 0;
        layer.on('tileerror', () => {
          // Na PRIMEIRA montagem `mapRef.current` ainda é null (só recebe o mapa no fim do
          // efeito), então aqui basta "não foi desmontado" — o `vivo()` completo vale para
          // os callbacks que rodam depois, quando a referência já existe.
          if (cancel) return;
          tileErros += 1;
          if (tileErros >= 6 && baseIdx < BASEMAPS.length - 1) {
            baseIdx += 1;
            try { map.removeLayer(layer); } catch { /* */ }
            try { if (refLayer) { map.removeLayer(refLayer); refLayer = null; } } catch { /* */ }
            montarBase();
          }
        });
        try {
          layer.addTo(map);
          if (b.labels) { refLayer = L.tileLayer(b.labels, { maxNativeZoom: 16, maxZoom: 19, zIndex: 2 }); refLayer.addTo(map); }
        } catch { /* mapa saiu do ar entre o erro de tile e a troca de basemap */ }
      };
      montarBase();
      // Imóvel: pino exato (endereço/rua) OU círculo de área aproximada (bairro/cidade)
      if (aproximado && raioM) {
        L.circle([lat, lng], { radius: raioM, color: '#0D63DB', weight: 1, fillColor: '#0D63DB', fillOpacity: 0.12 })
          .addTo(map).bindTooltip(`Área aproximada (${nivel})`);
        L.circleMarker([lat, lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#0D63DB', fillOpacity: 0.6, dashArray: '2' })
          .addTo(map).bindTooltip('Centro aproximado');
      } else {
        L.circleMarker([lat, lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#0D63DB', fillOpacity: 1 }).addTo(map).bindTooltip('Imóvel');
      }
      // Pontos próximos
      for (const [key, p] of Object.entries(pontos || {})) {
        if (!p?.lat || !p?.lng) continue;
        const c = CATS_PROX[key]; if (!c) continue;
        L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: c.cor, fillOpacity: 0.95 })
          .addTo(map).bindTooltip(`${c.emoji} ${c.label}${p.nome ? ' · ' + p.nome : ''} (${fmtDist(distPonto(lat, lng, p))})`);
      }
      mapRef.current = map;
      enquadrar();
      // Robustez contra "mapa em branco": o container pode ter 0px na 1ª pintura
      // (a foto acima ainda ajustando o layout, ou a remontagem ao carregar os
      // pontos próximos). Reinvalida o tamanho algumas vezes e também quando o
      // elemento ganha dimensão real — sem isso o Leaflet fica cinza/vazio.
      [120, 400, 800].forEach(t => timers.push(setTimeout(() => {
        if (!vivo()) return;
        try { map.invalidateSize(); enquadrar(); } catch { /* container já sem tamanho válido */ }
      }, t)));
      if (typeof ResizeObserver !== 'undefined' && ref.current) {
        const ro = new ResizeObserver(() => {
          if (!vivo()) return;
          try { map.invalidateSize(); } catch { /* */ }
        });
        ro.observe(ref.current);
        roRef.current = ro;
      }
    });
    return () => {
      cancel = true;
      // Timers cancelados de verdade, não só ignorados: o guarda protege contra tocar no
      // mapa, mas timer pendente segura a closure inteira (mapa, camadas, pontos) na
      // memória até disparar. Em quem navega entre imóveis, isso se acumula.
      timers.forEach(clearTimeout);
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} style={{ height: 260, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }} />
      {/* Botão para reenquadrar no imóvel quando o usuário se perde ao dar zoom */}
      <button type="button" onClick={centralizarNoImovel} title="Centralizar no imóvel (mantém o zoom)"
        style={{ position: 'absolute', right: 10, bottom: 10, zIndex: 500, display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'white', border: '1px solid #e2e8f0', borderRadius: 9, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          padding: '7px 11px', fontSize: 12, fontWeight: 700, color: '#0D63DB', cursor: 'pointer' }}>
        <MapPin size={14} /> Centralizar no imóvel
      </button>
    </div>
  );
}

// Imóveis semelhantes e próximos (mesma cidade/tipo, prioriza o mesmo bairro).
function ImoveisSimilares({ imovel, nav }) {
  const [itens, setItens] = useState([]);
  useEffect(() => {
    if (!imovel?.cidade) return;
    (async () => {
      let q = supabase.from('imoveis_leilao')
        .select('id,titulo,bairro,cidade,estado,valor_minimo,valor_avaliacao,link_foto,tipo,area_m2,fonte,fonte_id')
        .eq('ativo', true).eq('cidade', imovel.cidade).neq('id', imovel.id).limit(12);
      // SEMPRE junto do estado: há cidades homônimas em UFs diferentes (ex.: Palmas/TO
      // e Palmas/PR). Sem este filtro, os "semelhantes" misturavam imóveis de outro estado.
      if (imovel.estado) q = q.eq('estado', imovel.estado);
      if (imovel.tipo) q = q.eq('tipo', imovel.tipo);
      const { data } = await q;
      let lista = data || [];
      // mesmo bairro primeiro
      lista.sort((a, b) => (b.bairro === imovel.bairro) - (a.bairro === imovel.bairro));
      setItens(lista.slice(0, 6));
    })();
  }, [imovel?.id, imovel?.cidade]);

  if (!itens.length) return null;
  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px', marginTop: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Home size={18} color="#0D63DB" /> Imóveis semelhantes e próximos
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {itens.map(it => {
          const desc = it.valor_avaliacao > 0 && it.valor_minimo ? Math.round((1 - it.valor_minimo / it.valor_avaliacao) * 100) : null;
          // Foto: mesma regra da Busca/detalhe (utils/foto.js). Tenta o link_foto
          // real primeiro e cai no padrão da Caixa/proxy — antes esta cópia ignorava
          // o link_foto do CEF e montava F<id>21.jpg (URL errada → "Sem foto").
          const cands = fotoCandidatos({ foto: it.link_foto, fonte: it.fonte, fonteId: it.fonte_id });
          return (
            <button key={it.id} onClick={() => { nav('/imovel/' + it.id); window.scrollTo(0, 0); }}
              style={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: 'white', cursor: 'pointer', padding: 0 }}>
              <div style={{ height: 110, background: '#f1f5f9', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Sem foto</span>
                {cands.length > 0 && (
                  <img src={cands[0]} data-idx="0" alt="" loading="lazy"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => {
                      const el = e.currentTarget;
                      const next = Number(el.dataset.idx) + 1;
                      if (next < cands.length) { el.dataset.idx = String(next); el.src = cands[next]; }
                      else el.style.display = 'none';
                    }} />
                )}
                {desc > 0 && <span style={{ position: 'absolute', top: 8, right: 8, background: '#16a34a', color: 'white', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8, zIndex: 1 }}>-{desc}%</span>}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111', lineHeight: 1.3, height: 32, overflow: 'hidden' }}>{it.bairro || it.titulo}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 6px' }}>{it.cidade}/{it.estado}{it.area_m2 ? ` · ${it.area_m2} m²` : ''}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#0D63DB' }}>{fmtBRL(it.valor_minimo)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SecaoArrematacao({ imovelId, imovelTitulo }) {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const [dados, setDados] = useState(null); // { arrematacao, anexos, docs }
  const [fluxoOk, setFluxoOk] = useState(false); // pipeline completo (até parecer jurídico)
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState({ processo: true, pessoal: true });
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState({ arrematante_email: '', valor_arrematado: '', data_leilao: '', leiloeiro: '', numero_processo: '', observacoes: '' });
  const [salvando, setSalvando] = useState(false);
  const [uploadando, setUploadando] = useState({});
  const inputProcessoRef = useRef();
  const inputPessoalRef = useRef();

  const ROLES_ESCRITA = ['admin', 'analista'];
  const ROLES_LEITURA = ['admin', 'analista', 'advogado', 'consultor'];
  const podeVer = ROLES_LEITURA.includes(role) || dados?.arrematacao?.arrematante_id === user?.id;
  const podeEscrever = ROLES_ESCRITA.includes(role);
  const podeAnexo = podeEscrever || role === 'advogado';

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token;

  const carregar = async () => {
    setLoading(true);
    try {
      const t = await token();
      const r = await fetch(`/api/arrematacoes?imovel_id=${imovelId}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) setDados(await r.json());
      // Só libera "Registrar Arrematação" após o fluxo: análise + relatórios +
      // reunião + devolutiva jurídica (status_etapa >= juridico_concluido).
      const ETAPAS_PRONTO = ['juridico_concluido', 'segunda_reuniao', 'arrematado', 'honorarios_pagos', 'procuracao_assinada', 'pos_arrematacao'];
      const { data: cs } = await supabase.from('casos').select('status_etapa').eq('imovel_id', imovelId);
      setFluxoOk((cs || []).some(c => ETAPAS_PRONTO.includes(c.status_etapa)));
    } finally { setLoading(false); }
  };

  useEffect(() => { if (user && (ROLES_LEITURA.includes(role) || role === 'assessorado' || role === 'explorador')) carregar(); else setLoading(false); }, [user, role]); // eslint-disable-line

  const registrar = async () => {
    setSalvando(true);
    try {
      // O arrematante é resolvido pelo e-mail NO SERVIDOR (/api/arrematacoes): `perfis` não tem
      // coluna `email` — o filtro .ilike('email', …) daqui devolvia 400 e a tela dizia SEMPRE
      // "Usuário não encontrado com esse email", mesmo com o cliente cadastrado.
      const t = await token();
      const r = await fetch('/api/arrematacoes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imovel_id: imovelId, arrematante_email: form.arrematante_email.trim(), valor_arrematado: parseFloat(form.valor_arrematado) || null, data_leilao: form.data_leilao || null, leiloeiro: form.leiloeiro, numero_processo: form.numero_processo, observacoes: form.observacoes }),
      });
      if (r.ok) { setModalAberto(false); carregar(); }
      else { const e = await r.json(); alert(e.error || 'Erro ao registrar'); }
    } finally { setSalvando(false); }
  };

  const atualizarStatus = async (status) => {
    const t = await token();
    await fetch(`/api/arrematacoes?id=${dados.arrematacao.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    carregar();
  };

  const uploadAnexo = async (file, tabela) => {
    if (!file) return;
    const key = `${tabela}_${file.name}`;
    setUploadando(u => ({ ...u, [key]: true }));
    try {
      const t = await token();
      const arrId = dados?.arrematacao?.id || 'geral';
      const tipo = tabela === 'imovel' ? 'outro' : 'outro';
      const nomeArq = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // Pega URL assinada
      const signR = await fetch(`/api/arrematacoes?signed_url=1&arrematacao_id=${arrId}&tipo=${tipo}&nome=${nomeArq}&tabela=${tabela}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!signR.ok) { alert('Erro ao preparar upload'); return; }
      const { signedURL, publicUrl } = await signR.json();

      // Upload direto para Storage
      const upR = await fetch(signedURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      if (!upR.ok) { alert('Erro no upload'); return; }

      // Salva registro
      if (tabela === 'imovel') {
        const r = await fetch(`/api/arrematacoes?anexo=1`, {
          method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ arrematacao_id: arrId, imovel_id: imovelId, tipo, nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) }),
        });
        if (!r.ok) alert('Erro ao registrar anexo');
      } else {
        await supabase.from('usuario_docs').insert({ user_id: user.id, arrematacao_id: arrId, tipo, nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) });
      }
      carregar();
    } finally { setUploadando(u => ({ ...u, [key]: false })); }
  };

  const deletarAnexo = async (id, tabela) => {
    if (!confirm('Remover documento?')) return;
    const t = await token();
    await fetch(`/api/arrematacoes?id=${id}&tabela=${tabela}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
    carregar();
  };

  const deletarDocPessoal = async (id) => {
    if (!confirm('Remover documento?')) return;
    await supabase.from('usuario_docs').delete().eq('id', id).eq('user_id', user.id);
    carregar();
  };

  if (!user || loading) return null;
  if (!podeVer && !podeEscrever) return null;

  const arr = dados?.arrematacao;
  const statusInfo = arr ? (STATUS_ARR[arr.status] || STATUS_ARR.em_processo) : null;

  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: arr ? 16 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCheck size={18} color="#7c3aed" />
          <span style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Arrematação</span>
          {arr && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {arr && (podeEscrever || role === 'advogado') && (
            <button
              onClick={() => nav('/contratos/novo', { state: { tipo: 'procuracao', contexto: `Procuração para arrematação do imóvel: ${imovelTitulo}. Processo nº ${arr.numero_processo || 'não informado'}. Arrematante: ${arr.arrematante_nome || arr.arrematante_id}.` } })}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: 'none', background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              <ScrollText size={12} /> Gerar Procuração
            </button>
          )}
          {arr && podeEscrever && arr.status === 'em_processo' && (
            <button onClick={() => atualizarStatus('finalizado')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>✓ Finalizar</button>
          )}
          {arr && podeEscrever && arr.status !== 'cancelado' && (
            <button onClick={() => atualizarStatus('cancelado')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#fee2e2', color: '#991b1b', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>✕ Cancelar</button>
          )}
          {!arr && podeEscrever && fluxoOk && (
            <button onClick={() => setModalAberto(true)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Registrar Arrematação</button>
          )}
          {!arr && podeEscrever && !fluxoOk && (
            <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', maxWidth: 320, textAlign: 'right' }}>
              Disponível após concluir análise, relatórios, reunião e o parecer jurídico.
            </span>
          )}
        </div>
      </div>

      {arr && (
        <>
          {/* Info da arrematação */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 14 }}>
            {arr.arrematante_nome && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>ARREMATANTE</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.arrematante_nome}</div></div>}
            {arr.valor_arrematado && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>VALOR ARREMATADO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>R$ {Number(arr.valor_arrematado).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>}
            {arr.data_leilao && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>DATA DO LEILÃO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{new Date(arr.data_leilao + 'T12:00:00').toLocaleDateString('pt-BR')}</div></div>}
            {arr.leiloeiro && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>LEILOEIRO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.leiloeiro}</div></div>}
            {arr.numero_processo && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Nº PROCESSO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.numero_processo}</div></div>}
          </div>
          {arr.observacoes && <div style={{ fontSize: 13, color: '#475569', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>{arr.observacoes}</div>}

          {/* Documentos do processo */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12 }}>
            <button onClick={() => setAberto(a => ({ ...a, processo: !a.processo }))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#111' }}>
                <Paperclip size={14} color="#7c3aed" /> Documentos do Processo
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>({(dados.anexos || []).length})</span>
              </div>
              {aberto.processo ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
            </button>
            {aberto.processo && (
              <div style={{ padding: '0 16px 14px' }}>
                {(dados.anexos || []).length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>Nenhum documento adicionado.</div>}
                {(dados.anexos || []).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileText size={14} color="#7c3aed" />
                      <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0D63DB', fontWeight: 600, textDecoration: 'none' }}>{a.nome}</a>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{TIPO_ANEXO_LABEL[a.tipo] || a.tipo}</span>
                    </div>
                    {podeEscrever && <button onClick={() => deletarAnexo(a.id, 'imovel_anexos')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>}
                  </div>
                ))}
                {podeAnexo && (
                  <div style={{ marginTop: 10 }}>
                    <input ref={inputProcessoRef} type="file" style={{ display: 'none' }} onChange={e => { uploadAnexo(e.target.files[0], 'imovel'); e.target.value = ''; }} />
                    <button onClick={() => inputProcessoRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px dashed #c4b5fd', background: '#faf5ff', color: '#7c3aed', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      <Upload size={13} /> Adicionar documento
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Documentos pessoais (só o arrematante e admin/analista) */}
          {(arr.arrematante_id === user?.id || podeEscrever) && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <button onClick={() => setAberto(a => ({ ...a, pessoal: !a.pessoal }))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#111' }}>
                  👤 Meus Documentos
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>({(dados.docs || []).length}) · privado</span>
                </div>
                {aberto.pessoal ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
              </button>
              {aberto.pessoal && (
                <div style={{ padding: '0 16px 14px' }}>
                  {(dados.docs || []).length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>Nenhum documento pessoal adicionado.</div>}
                  {(dados.docs || []).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={14} color="#0891b2" />
                        <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0D63DB', fontWeight: 600, textDecoration: 'none' }}>{d.nome}</a>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{TIPO_DOC_LABEL[d.tipo] || d.tipo}</span>
                      </div>
                      <button onClick={() => deletarDocPessoal(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <div style={{ marginTop: 10 }}>
                    <input ref={inputPessoalRef} type="file" style={{ display: 'none' }} onChange={async e => {
                      const file = e.target.files[0]; if (!file) return;
                      const key = `pessoal_${file.name}`; setUploadando(u => ({ ...u, [key]: true }));
                      try {
                        const t = await token();
                        const arrId = dados?.arrematacao?.id || 'geral';
                        const nomeArq = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const signR = await fetch(`/api/arrematacoes?signed_url=1&arrematacao_id=${arrId}&tipo=outro&nome=${nomeArq}&tabela=usuario`, { headers: { Authorization: `Bearer ${t}` } });
                        if (!signR.ok) { alert('Erro ao preparar upload'); return; }
                        const { signedURL, publicUrl } = await signR.json();
                        const upR = await fetch(signedURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
                        if (!upR.ok) { alert('Erro no upload'); return; }
                        await supabase.from('usuario_docs').insert({ user_id: user.id, arrematacao_id: arrId, tipo: 'outro', nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) });
                        carregar();
                      } finally { setUploadando(u => ({ ...u, [key]: false })); e.target.value = ''; }
                    }} />
                    <button onClick={() => inputPessoalRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px dashed #bae6fd', background: '#f0f9ff', color: '#0891b2', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      <Upload size={13} /> Adicionar meu documento
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal registrar arrematação */}
      {modalAberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setModalAberto(false); }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Registrar Arrematação</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>{imovelTitulo}</div>
            {[
              { label: 'E-mail do arrematante *', key: 'arrematante_email', type: 'email', placeholder: 'usuario@email.com' },
              { label: 'Valor arrematado (R$)', key: 'valor_arrematado', type: 'number', placeholder: '0,00' },
              { label: 'Data do leilão', key: 'data_leilao', type: 'date' },
              { label: 'Leiloeiro', key: 'leiloeiro', type: 'text', placeholder: 'Nome do leiloeiro' },
              { label: 'Nº do Processo', key: 'numero_processo', type: 'text', placeholder: '0000000-00.0000.0.00.0000' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>{label}</label>
                <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
              </div>
            ))}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Observações</label>
              <textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} rows={3} placeholder="Informações adicionais..."
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModalAberto(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#475569' }}>Cancelar</button>
              <button onClick={registrar} disabled={salvando || !form.arrematante_email} style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: salvando ? '#c4b5fd' : '#7c3aed', color: 'white', fontWeight: 700, fontSize: 13, cursor: salvando ? 'default' : 'pointer' }}>{salvando ? 'Salvando...' : 'Registrar Arrematação'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Ficha técnica da Caixa — campos extras da página de detalhe capturados no
// enriquecimento (ficha_cef). Complementa a tela com o que o CSV não traz:
// aceite de FGTS/consórcio/financiamento, áreas, matrícula, inscrição, comarca,
// ofício e responsabilidade das despesas. Só renderiza os campos presentes.
function FichaTecnicaCEF({ ficha }) {
  if (!ficha || typeof ficha !== 'object' || !Object.keys(ficha).length) return null;
  const m2 = (v) => (v == null || v === '' ? null : `${v} m²`);
  const areas = [
    ['Área privativa', m2(ficha.area_privativa)],
    ['Área total', m2(ficha.area_total)],
    ['Área construída', m2(ficha.area_construida)],
    ['Terreno', m2(ficha.area_terreno)],
  ].filter(([, v]) => v);
  const refs = [
    ['Matrícula', ficha.matricula],
    ['Cartório', ficha.cartorio],
    ['Inscrição imobiliária', ficha.inscricao_imobiliaria],
    ['Comarca', ficha.comarca],
    ['Ofício', ficha.oficio],
  ].filter(([, v]) => v);
  const aceites = [
    ['Financiamento', ficha.financiamento],
    ['FGTS', ficha.fgts],
    ['Consórcio', ficha.consorcio],
  ].filter(([, v]) => typeof v === 'boolean');
  if (!areas.length && !refs.length && !aceites.length && !ficha.ocupacao && !ficha.despesas_por_conta) return null;

  const Chip = ({ label, ok }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
      background: ok ? '#f0fdf4' : '#fef2f2', color: ok ? '#15803d' : '#b91c1c', border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}` }}>
      {ok ? <CheckCircle size={13} /> : <AlertTriangle size={13} />} {label}: {ok ? 'Aceita' : 'Não aceita'}
    </span>
  );
  const Linha = ({ rot, val }) => (
    <div className="kv-linha" style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, flexWrap: 'wrap', minWidth: 0 }}>
      <span className="kv-rot" style={{ color: '#94a3b8', minWidth: 140 }}>{rot}:</span>
      <span style={{ fontWeight: 700, color: '#334155', minWidth: 0, overflowWrap: 'anywhere' }}>{val}</span>
    </div>
  );

  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Building2 size={18} color="#0D63DB" /> Ficha técnica
      </h2>
      <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 16px' }}>Dados da página oficial e da matrícula do imóvel.</p>

      {aceites.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: (areas.length || refs.length || ficha.ocupacao) ? 16 : 0 }}>
          {aceites.map(([label, ok]) => <Chip key={label} label={label} ok={ok} />)}
        </div>
      )}

      {areas.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: (refs.length || ficha.ocupacao || ficha.despesas_por_conta) ? 16 : 0 }}>
          {areas.map(([rot, val]) => (
            <div key={rot} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6 }}>{rot}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {ficha.ocupacao && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
            <span className="kv-rot" style={{ color: '#94a3b8', minWidth: 140 }}>Situação:</span>
            <span style={{ fontWeight: 700, color: ficha.ocupacao === 'Desocupado' ? '#15803d' : '#b45309' }}>{ficha.ocupacao}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>(confirmar em visita, o status da Caixa costuma divergir)</span>
          </div>
        )}
        {refs.map(([rot, val]) => <Linha key={rot} rot={rot} val={val} />)}
        {ficha.despesas_por_conta && (
          <Linha rot="Despesas (IPTU/condomínio)" val={`Por conta do ${ficha.despesas_por_conta.toLowerCase()}`} />
        )}
      </div>
    </div>
  );
}

// Raio-X jurídico (Fase 1) — selos e campos derivados do laudo documental,
// persistidos no imóvel (ficha_juridica). Só aparece após uma análise documental.
const OCUP_LABEL = {
  desocupado: 'Desocupado', proprietario: 'Ocupado pelo proprietário', locatario: 'Ocupado por locatário',
  posseiro: 'Ocupado por posseiro', comodato: 'Ocupado (comodato)', invasao: 'Ocupado (invasão)',
};
function AnaliseJuridicaCard({ fj }) {
  if (!fj || typeof fj !== 'object') return null;
  const temAlgo = fj.fraudeExecucao || fj.direitoPreferencia || fj.ocupacaoTipo || fj.debitosAssumidos ||
    fj.proprietariosNaCadeia > 0 || fj.primeiraPraca || fj.certidoesPendentes > 0;
  if (!temAlgo) return null;
  const brl = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const dataBR = (s) => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ''); };
  const fraudeCor = fj.fraudeExecucao === 'alto' ? '#b91c1c' : '#b45309';

  const Selo = ({ bg, cor, br, children }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, padding: '5px 12px', borderRadius: 999, background: bg, color: cor, border: `1px solid ${br}` }}>{children}</span>
  );
  const Linha = ({ rot, val, cor }) => (
    <div className="kv-linha" style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, flexWrap: 'wrap', minWidth: 0 }}>
      <span className="kv-rot" style={{ color: '#94a3b8', minWidth: 150 }}>{rot}:</span>
      <span style={{ fontWeight: 700, color: cor || '#334155', minWidth: 0, overflowWrap: 'anywhere' }}>{val}</span>
    </div>
  );

  const selos = [];
  if (fj.fraudeExecucao) selos.push(<Selo key="fr" bg="#fef2f2" cor={fraudeCor} br="#fecaca"><AlertTriangle size={13} /> Risco de fraude à execução: {fj.fraudeExecucao}</Selo>);
  if (fj.direitoPreferencia) selos.push(<Selo key="dp" bg="#fffbeb" cor="#b45309" br="#fde68a"><AlertTriangle size={13} /> Sujeito a direito de preferência</Selo>);
  if (fj.nivelRisco) {
    const c = fj.nivelRisco === 'vermelho' ? ['#fef2f2', '#b91c1c', '#fecaca'] : fj.nivelRisco === 'amarelo' ? ['#fffbeb', '#b45309', '#fde68a'] : ['#f0fdf4', '#15803d', '#bbf7d0'];
    selos.push(<Selo key="nr" bg={c[0]} cor={c[1]} br={c[2]}><ShieldCheck size={13} /> Risco jurídico {fj.nivelRisco}</Selo>);
  }

  const linhas = [];
  if (fj.ocupacaoTipo) {
    const prazo = fj.desocupacaoPrazoMeses ? ` · desocupação ~${fj.desocupacaoPrazoMeses} ${fj.desocupacaoPrazoMeses > 1 ? 'meses' : 'mês'}` : '';
    const custo = fj.desocupacaoCusto ? ` · custo est. ${brl(fj.desocupacaoCusto)}` : '';
    linhas.push(<Linha key="oc" rot="Ocupação" val={`${OCUP_LABEL[fj.ocupacaoTipo] || fj.ocupacaoTipo}${prazo}${custo}`} cor={fj.ocupacaoTipo === 'desocupado' ? '#15803d' : '#b45309'} />);
  }
  if (fj.debitosAssumidos) linhas.push(<Linha key="db" rot="Débitos que você assume" val={`${brl(fj.debitosAssumidos)} (propter rem)`} cor="#b45309" />);
  else if (fj.debitosALevantar) linhas.push(<Linha key="db2" rot="Débitos propter rem" val="a levantar (IPTU/condomínio)" />);
  if (fj.proprietariosNaCadeia > 0) linhas.push(<Linha key="cd" rot="Cadeia dominial" val={`${fj.proprietariosNaCadeia} proprietário(s)/ato(s) na matrícula`} />);
  if (fj.primeiraPraca || fj.segundaPraca) {
    const p = [fj.primeiraPraca && `1ª praça ${dataBR(fj.primeiraPraca)}`, fj.segundaPraca && `2ª praça ${dataBR(fj.segundaPraca)}`].filter(Boolean).join(' · ');
    linhas.push(<Linha key="cr" rot="Cronograma do leilão" val={p} />);
  }
  if (fj.prazoPagamento) linhas.push(<Linha key="pp" rot="Prazo de pagamento" val={fj.prazoPagamento} />);
  if (fj.certidoesPendentes > 0) linhas.push(<Linha key="ce" rot="Certidões recomendadas" val={`${fj.certidoesPendentes} no laudo documental`} />);

  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ScrollText size={18} color="#1e3a8a" /> Análise jurídica
      </h2>
      <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 16px' }}>Resumo do laudo documental. Detalhes e diligências no relatório completo.</p>
      {selos.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: linhas.length ? 16 : 0 }}>{selos}</div>}
      {linhas.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{linhas}</div>}
    </div>
  );
}

export default function ImovelDetalhe() {
  const nav = useNavigate();
  const loc = useLocation();
  const { id: paramId } = useParams();
  const { user, role } = useAuth();
  const [imovel, setImovel] = useState(loc.state?.imovel || null);
  const [cota, setCota] = useState(null); // quanto ainda dá para analisar — vira o texto do botão
  const [anexosDocs, setAnexosDocs] = useState([]);
  const [buscandoDocs, setBuscandoDocs] = useState('');
  const [filaDocs, setFilaDocs] = useState(null); // status da fila de captura CEF (persiste no F5)
  const [loading, setLoading] = useState(!loc.state?.imovel);
  const [imgIdx, setImgIdx] = useState(0); // índice do candidato de foto atual (fallback em cascata)
  const [compartilhado, setCompartilhado] = useState(false); // feedback "link copiado"
  const [proxStatus, setProxStatus] = useState('idle'); // idle|loading|ok|empty|error — pontos próximos
  const [proxTry, setProxTry] = useState(0); // incrementa p/ "tentar novamente"

  const id = loc.state?.imovel?.id || paramId;

  // Compartilhar o imóvel: usa o menu nativo do celular (WhatsApp etc.) quando existe;
  // no desktop copia o link. Link SEM hash (/i/:id): o preview do WhatsApp mostra
  // título/cidade/lance/FOTO do imóvel (og-share) e redireciona quem clica para
  // /#/imovel/:id — sem conta cai no teaser (ImovelGate) e entra/cadastra para ver.
  const compartilhar = async () => {
    const url = id ? `${window.location.origin}/i/${id}` : window.location.href;
    const titulo = imovel?.titulo || 'Imóvel em leilão — BidPro Brasil';
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: titulo, text: `Veja este imóvel em leilão: ${titulo}`, url }); }
      catch { /* usuário cancelou — sem ação */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCompartilhado(true);
      setTimeout(() => setCompartilhado(false), 2500);
    } catch { /* clipboard indisponível */ }
  };

  // Abre sempre no TOPO (foto primeiro) — não herda a rolagem da lista/busca.
  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  // Fase B.1 — registra a VISUALIZAÇÃO do imóvel (upsert com contador) para o
  // monitoramento 360º. Só CLIENTES (não staff), uma vez por imóvel aberto.
  const vistoRef = useRef(null);
  useEffect(() => {
    const STAFF = ['admin', 'analista', 'consultor', 'advogado', 'leiloeiro'];
    if (!user || STAFF.includes(role) || !id || !imovel || imovel.id !== id) return;
    if (vistoRef.current === id) return;
    vistoRef.current = id;
    supabase.rpc('registrar_imovel_visto', {
      p_imovel_id: String(id),
      p_titulo: imovel.titulo || imovel.endereco || null,
      p_cidade: imovel.cidade || null,
      p_estado: imovel.estado || null,
      p_tipo: imovel.tipo || null,
      p_valor: imovel.valorMinimo ?? imovel.valorAvaliacao ?? null,
    }).then(() => {}).catch(() => {});
    // ViewContent (Meta Pixel + Google Ads) — sinal de INTERESSE por imóvel, usado para
    // retargeting e otimização. Aproveita o mesmo gate deduplicado (cliente, 1× por imóvel).
    try { trackImovelVisualizado(String(id), imovel.tipo || null, imovel.valorMinimo ?? imovel.valorAvaliacao ?? 0); } catch { /* nunca quebra a tela */ }
  }, [user, role, id, imovel]);

  // Cota do usuário, para o botão dizer o que ele já tem. `lerCotaMercado` nunca lança: se a
  // leitura falhar, `cota` fica null e o botão volta ao texto genérico — falha de rede não pode
  // virar "você não tem análise".
  useEffect(() => {
    if (!user) { setCota(null); return; }
    let vivo = true;
    lerCotaMercado(supabase, user.id).then((c) => { if (vivo) setCota(c); });
    return () => { vivo = false; };
  }, [user]);

  useEffect(() => {
    // A busca por raio passa o imóvel no state SEM edital/matrícula/descrição.
    // Se esses documentos faltam, busca o registro completo no banco (o state
    // serve só para o paint imediato, sem spinner).
    // Já temos ESTE imóvel COMPLETO (linha inteira do banco)? então não precisa buscar.
    // Antes o guard usava linkEdital/descrição — mas o objeto vindo da BUSCA tem esses
    // campos e NÃO tem `anexos` (a busca não seleciona), então o guard cortava o fetch e o
    // EDITAL-PDF dos anexos nunca carregava (ex.: GRUPOLANCE → botão virava "Acessar
    // leiloeiro" em vez de abrir o edital). `anexos` só existe (array OU null) depois do
    // .select('*') abaixo → é o sinal fiel de "linha completa carregada".
    const jaCarregado = imovel && imovel.id === id && imovel.anexos !== undefined;
    if (jaCarregado) return;
    if (!id) { nav('/buscar'); return; }
    // Navegou para outro imóvel (ex.: card de similares) → recarrega do zero.
    if (!imovel || imovel.id !== id) { setLoading(true); setImgIdx(0); setAnexosDocs([]); }
    supabase.from('imoveis_leilao').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (!data) { if (!imovel) nav('/buscar'); return; }
        setImovel({
          id: data.id, titulo: data.titulo, tipo: data.tipo, modalidade: data.modalidade,
          estado: data.estado, cidade: data.cidade, bairro: data.bairro, endereco: data.endereco,
          valorAvaliacao: data.valor_avaliacao, valorMinimo: data.valor_minimo,
          descontoPercentual: data.desconto_percentual, areaM2: data.area_m2, descricao: data.descricao,
          urlLote: data.url_lote || data.link_edital || data.link_regras_venda, linkEdital: data.link_edital, linkMatricula: data.link_matricula, linkRegrasVenda: data.link_regras_venda,
          foto: data.link_foto, leiloeiro: data.leiloeiro, dataLeilao: data.data_leilao,
          valorMinimo2: data.valor_minimo_2 ?? null, dataLeilao2: data.data_leilao_2 ?? null,
          pagamento: [data.forma_pagamento], fonte: data.fonte, fonteId: data.fonte_id,
          numeroEdital: data.numero_edital, numeroMatricula: data.numero_matricula,
          numeroProcesso: data.numero_processo, anexos: data.anexos || null, enriquecidoEm: data.enriquecido_em,
          latitude: data.latitude, longitude: data.longitude, pontosProximos: data.pontos_proximos, geocodNivel: data.geocod_nivel,
          scoreFinanceiro: data.score_financeiro ?? null,
          scoreJuridico: data.score_juridico ?? null,
          scoreLocalizacao: data.score_localizacao ?? null,
          valorMercado: data.valor_mercado ?? null,
          analiseViavel: data.analise_viavel ?? null,
          fichaCef: data.ficha_cef || null,
          fichaJuridica: data.ficha_juridica || null,
          ocupacao: data.ocupacao || null,
          // Fatos lidos no edital/matrícula (nome do condomínio, despesas mensais, custos da
          // arrematação, área da matrícula) — publicados por quem leu o documento.
          nomeCondominio: data.nomecondominio || null,
          docFatos: data.doc_fatos || null, docFatosEm: data.doc_fatos_em || null,
        });
      })
      .finally(() => setLoading(false));
  }, [id]);

  // On-demand: ao abrir o imóvel, tenta MELHORAR a precisão da localização na
  // hora (cruzando IBGE + Correios + Nominatim), sem esperar o cron. Só dispara
  // se ainda não está no nível rua/endereço. Se melhorar, atualiza a coordenada
  // e zera as proximidades (o efeito abaixo recalcula no local certo).
  useEffect(() => {
    if (!imovel?.id) return;
    if (imovel.geocodNivel === 'endereco' || imovel.geocodNivel === 'rua') return;
    let cancel = false;
    apiCall(`/api/geocodificar-imovel?imovel_id=${imovel.id}`).then(r => r.json()).then(d => {
      if (cancel || !d?.alterado) return;
      setImovel(prev => prev ? { ...prev, latitude: d.lat, longitude: d.lng, geocodNivel: d.nivel, pontosProximos: null } : prev);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [imovel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // On-demand: ao abrir um imóvel de LEILOEIRO (não-CEF) ainda não vasculhado,
  // varre a página do lote atrás de matrícula/edital/regras/anexos/foto e traz
  // pra cá. Cada leiloeiro guarda esses arquivos em lugar diferente — o servidor
  // vasculha o HTML inteiro (api/enriquecer-lote). Só dispara uma vez por imóvel.
  useEffect(() => {
    if (!imovel?.id) return;
    const isCef = imovel.fonte === 'CEF' || imovel.fonte === 'caixa';
    const isVendaDireta = /venda[_ ]?direta/i.test(imovel.modalidade || '');
    // Leiloeiro: busca DOCUMENTOS enquanto não tiver (não trava por enriquecidoEm —
    // uma tentativa que falhou não pode esconder os docs para sempre). CEF: busca a
    // DATA do leilão/licitação (fica na página do imóvel, não no CSV) quando ainda
    // não temos e não é venda direta. O backend tem throttle de 12h.
    const temDocs = imovel.linkMatricula || imovel.linkRegrasVenda || (imovel.anexos && imovel.anexos.length);
    // Falta data = sem o início OU sem o ENCERRAMENTO. Só olhar o início fazia o lote parecer
    // completo e nunca buscar o prazo real, que é o que o cliente precisa para dar lance.
    const faltaData = (!imovel.dataLeilao || !imovel.dataLeilao2) && !isVendaDireta;
    const precisa = isCef ? faltaData : (!temDocs || faltaData);
    if (!precisa) return;
    let cancel = false;
    apiCall(`/api/enriquecer-lote?imovel_id=${imovel.id}`).then(r => r.json()).then(d => {
      if (cancel || !d) return;
      setImovel(prev => prev ? {
        ...prev,
        enriquecidoEm: new Date().toISOString(),
        dataLeilao: prev.dataLeilao || d.data_leilao || null,
        dataLeilao2: prev.dataLeilao2 || d.data_leilao_2 || null,
        anexos: (d.anexos && d.anexos.length) ? d.anexos : prev.anexos,
        linkMatricula: prev.linkMatricula || d.matricula || null,
        linkEdital: prev.linkEdital || d.edital || null,
        linkRegrasVenda: prev.linkRegrasVenda || d.regras || null,
        foto: prev.foto || d.foto || null,
      } : prev);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [imovel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // On-demand: se o imóvel tem coordenada mas ainda não tem pontos próximos,
  // calcula na hora (não espera o cron) — útil para imóveis recém-abertos.
  useEffect(() => {
    const la = imovel?.latitude ?? imovel?.lat, lo = imovel?.longitude ?? imovel?.lng;
    const temC = la != null && lo != null && !(Number(la) === 0 && Number(lo) === 0);
    // Já veio com pontos (do banco) → nada a buscar.
    if (imovel?.pontosProximos && Object.keys(imovel.pontosProximos).length) { setProxStatus('ok'); return; }
    if (!imovel?.id || !temC) return;
    let cancel = false;
    setProxStatus('loading');
    // ANTES: fetch sem checar res.ok, .catch(()=>{}) engolia tudo, e o backend
    // devolvia 200 com pontos:null em falha → a UI ficava eternamente em branco
    // ("não carrega nem após 1 min"). Agora há timeout, checagem de status e estados
    // explícitos (loading/empty/error) com "tentar novamente".
    (async () => {
      try {
        const r = await apiCall(`/api/proximidades-imovel?imovel_id=${imovel.id}`, { signal: AbortSignal.timeout(35000) });
        if (!r.ok) throw new Error('http_' + r.status);
        const d = await r.json();
        const pontos = (d && d.pontos && typeof d.pontos === 'object') ? d.pontos : null;
        if (cancel) return;
        if (pontos && Object.keys(pontos).length) {
          setImovel(prev => prev ? { ...prev, pontosProximos: pontos } : prev);
          setProxStatus('ok');
        } else {
          setProxStatus('empty'); // resposta válida e vazia (sem POIs mapeados por perto)
        }
      } catch {
        if (!cancel) setProxStatus('error'); // falha/timeout → botão "tentar novamente"
      }
    })();
    return () => { cancel = true; };
  }, [imovel?.id, imovel?.latitude, imovel?.longitude, imovel?.lat, imovel?.lng, proxTry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Documentos do imóvel (matrícula/edital/regra) capturados/anexados — clientes
  // logados podem ver e baixar (RLS libera esses tipos).
  useEffect(() => {
    if (!imovel?.id) return;
    let cancel = false;
    // Inclui 'laudo' e 'outro': leiloeiros com URL OPACA (ex.: SUPERBID) têm o
    // edital/matrícula salvos como 'outro' — sem isso o PDF capturado ficava
    // invisível e o cliente só via o link do site. Mostramos TODO doc capturado.
    (async () => {
      const { data } = await supabase.from('imovel_anexos').select('id,tipo,nome,url').eq('imovel_id', imovel.id)
        .in('tipo', ['matricula', 'edital', 'regras_venda', 'laudo', 'outro']).not('storage_path', 'is', null);
      if (cancel) return;
      const lista = Array.isArray(data) ? data : [];
      if (!lista.length) { setAnexosDocs([]); return; }
      // O `url` gravado é uma signed URL de 1h (gerar-documental) que EXPIRA →
      // depois disso o link abria 404 mesmo com o arquivo salvo no bucket. Re-assina
      // EM LOTE (uma chamada) pelo /api/doc-url; em falha mantém o url guardado.
      const frescos = await assinarAnexos(lista);
      if (!cancel) setAnexosDocs(frescos);
    })();
    return () => { cancel = true; };
  }, [imovel?.id]);


  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
        <div style={{ fontWeight: 600 }}>Carregando imóvel…</div>
      </div>
    </div>
  );

  if (!imovel) return null;

  const desc = imovel.descontoPercentual || 0;
  const descLabel = Number(desc).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const descColor = desc >= 40 ? '#15803d' : desc >= 20 ? '#92400e' : '#dc2626';
  const descBg    = desc >= 40 ? '#dcfce7' : desc >= 20 ? '#fef9c3' : '#fee2e2';

  // Foto da Caixa: hotlink DIRETO (navegador do usuário; o IP da Vercel é bloqueado
  // pela Caixa). Padrão F{numero}21.jpg. onError no <img> cai no placeholder.
  const caixaFotoUrl = () => {
    const id = (imovel.fonteId || '').replace(/^(caixa_|cef_)/, '');
    return id ? `https://venda-imoveis.caixa.gov.br/fotos/F${id}21.jpg` : null;
  };
  // Candidatos de foto, em ordem de preferência. O <img> tenta o primeiro e,
  // no onError, avança para o próximo (imgIdx). A LISTA de similares carrega a
  // foto por hotlink DIRETO e funciona — então no detalhe priorizamos o mesmo
  // hotlink direto e só caímos no proxy/padrão-Caixa se ele falhar.
  const getImgCandidates = () => {
    const foto = imovel.foto;
    const isCef = imovel.fonte === 'CEF' || imovel.fonte === 'caixa';
    // Já hospedado por nós (supabase) ou caminho local: usa direto.
    if (foto && (foto.includes('supabase.co') || foto.startsWith('/'))) return [foto];
    const cands = [];
    if (foto && /^https?:\/\//.test(foto)) cands.push(foto);                 // 1) hotlink direto (igual à lista)
    if (isCef) { const c = caixaFotoUrl(); if (c) cands.push(c); }           // 2) padrão de foto da Caixa por id
    else if (foto && /^https?:\/\//.test(foto)) cands.push(`/api/img-proxy?url=${encodeURIComponent(foto)}`); // 3) proxy (fontes que bloqueiam hotlink por referer)
    return cands;
  };
  const imgCandidates = getImgCandidates();
  const imgDetalheSrc = imgCandidates[imgIdx] || null;
  // Quem pode SOLICITAR análise. Investidor Pro (top2/top2_anual) e Leilão Club
  // pagam por análises (a cota mensal — ex.: 15/mês — é aplicada no servidor).
  // Explorador e consultor TÊM análise mercadológica (limite_ia > 0): devem ver o
  // botão "Solicitar Análise" normal. O bloqueio por cota/plano acontece na tela de
  // análises (a documental é gated lá; a mercadológica cobra a cota e, esgotada,
  // direciona ao upgrade) — não mais como "Fazer upgrade para analisar" já no imóvel.
  const PLANOS_ANALISE = ['admin', 'analista', 'assessorado', 'clube', 'top2', 'top2_anual', 'explorador', 'consultor'];
  const podeFazerAnalise = PLANOS_ANALISE.includes(role);

  // O QUE O BOTÃO PROMETE (09/08). Ele se chamava só "Solicitar Análise" — que soa como pedido
  // a uma equipe, e possivelmente pago. Em 5 semanas foi clicado 3 vezes, por 3 pessoas, e as 3
  // geraram relatório: quem clica converte, o problema é ninguém clicar. O explorador tem 3
  // amostras GRÁTIS e não fazia ideia (90 disponíveis entre os 30 cadastrados, 3 usadas). Dizer
  // o que a pessoa já tem no bolso é o que muda o clique — e vale para o pagante também, que
  // precisa saber quantos relatórios do mês ainda lhe restam antes de gastar um.
  const rotuloAnalise = (() => {
    if (!cota || cota.ilimitado) return 'Solicitar Análise';
    if (cota.restantes <= 0) {
      return cota.amostra ? 'Análises grátis esgotadas' : 'Cota do mês esgotada';
    }
    return cota.amostra
      ? `Analisar grátis (${cota.restantes} de ${cota.limite})`
      : `Analisar (${cota.restantes} de ${cota.limite} deste mês)`;
  })();
  // A barra fixa do mobile divide a largura com "Acessar leiloeiro" — o rótulo longo estoura.
  const rotuloAnaliseCurto = (() => {
    if (!cota || cota.ilimitado) return 'Solicitar Análise';
    if (cota.restantes <= 0) return cota.amostra ? 'Grátis esgotadas' : 'Cota esgotada';
    return cota.amostra ? `Analisar grátis (${cota.restantes})` : `Analisar (${cota.restantes})`;
  })();
  // LEILÃO ENCERRADO (07/08): o servidor já recusava gerar relatório de lote vencido, mas a tela
  // seguia oferecendo o botão — o cliente só descobria depois de clicar, e para ele o relatório
  // "continuava disponível". Mesma regra dos dois lados (src/utils/leilaoEncerrado.js).
  const encerrado = leilaoEncerrado(imovel);
  const economia = imovel.valorAvaliacao && imovel.valorMinimo ? imovel.valorAvaliacao - imovel.valorMinimo : null;
  const precoM2 = imovel.areaM2 > 0 && imovel.valorMinimo ? imovel.valorMinimo / imovel.areaM2 : null;

  // Documentos: links DIRETOS, montados na hora (sem captura/armazenamento/espera).
  // Matrícula CEF: PDF estático em /editais/matricula/<UF>/<num>.pdf (o matricula.asp
  // dá 404). Hotlink direto funciona no navegador do usuário.
  const matriculaUrl = caixaMatriculaUrl({ fonte: imovel.fonte, estado: imovel.estado, fonteId: imovel.fonteId })
    || (ehMatriculaValida(imovel.linkMatricula) ? imovel.linkMatricula : null);
  // Venda direta → "Regras de venda online"; leilão → "Edital". MAS só rotulamos
  // como o documento quando o link é um ARQUIVO de verdade. Quando é apenas a
  // página do anúncio no portal (detalhe-imovel.asp = mesmo destino do url_lote),
  // o botão na prática abre o site do leiloeiro → rótulo honesto "Acessar leiloeiro".
  const isVendaDireta = (imovel.modalidade || '') === 'venda_direta';
  // Venda direta da Caixa: o ARQUIVO de regras é o PDF padrão da Caixa (o link
  // azul "?" do portal). Preferimos ele — é o documento de fato, não a página.
  const caixaRegras = isVendaDireta ? caixaRegrasVendaUrl({ fonte: imovel.fonte }) : null;
  const docRegrasRaw = isVendaDireta ? imovel.linkRegrasVenda : imovel.linkEdital;
  // Descarta o "edital" que na verdade é a MATRÍCULA (CEF grava link_edital = matrícula
  // em licitação/leilão) — senão o botão "Edital" abriria a matrícula.
  const ehMesmaMatricula = (v) => !!(v && matriculaUrl && v === matriculaUrl);
  const docRegras = ehMesmaMatricula(docRegrasRaw) ? null : docRegrasRaw;
  // Edital REAL a partir dos anexos, quando o link_edital não é um ARQUIVO (é a página do
  // lote — padrão da maioria dos leiloeiros: a auditoria mostrou link_edital = url_lote em
  // ~100% de SUPERBID/GRUPOLANCE/BIASI/SOLD/VIP…). Prioriza o PDF capturado no nosso Storage.
  const editalDeAnexo = (!isVendaDireta && !ehDocArquivo(docRegras)) ? (
    (Array.isArray(anexosDocs) ? anexosDocs : []).find(a => /edital/i.test(a.tipo || a.nome || '') && ehDocArquivo(a.url) && !ehMesmaMatricula(a.url))?.url
    || (Array.isArray(imovel.anexos) ? imovel.anexos : []).find(a => /edital/i.test(a.tipo || a.nome || '') && ehDocArquivo(a.url) && !ehMesmaMatricula(a.url))?.url
    || null
  ) : null;
  // Documento OFICIAL (arquivo): venda direta = regras da Caixa (ou página de regras online);
  // leilão = edital-PDF (do link_edital OU dos anexos). Só então rotula "Regras"/"Edital";
  // caso contrário o botão é honesto "Acessar leiloeiro" (abre a página, não finge ser doc).
  const docOficial = caixaRegras
    || (isVendaDireta
        ? (ehRegrasDoc(docRegras, imovel.urlLote) ? docRegras : null)
        : (ehDocArquivo(docRegras) ? docRegras : editalDeAnexo));
  const regrasEhDocReal = !!docOficial;
  const regrasEditalUrl = docOficial
    || ((ehUrl(docRegras) && !ehMesmaMatricula(docRegras)) ? docRegras
        : (ehUrl(imovel.urlLote) && imovel.urlLote !== matriculaUrl ? imovel.urlLote : null));
  const regrasEditalLabel = regrasEhDocReal
    ? (isVendaDireta ? 'Regras de venda online' : 'Edital')
    : 'Acessar leiloeiro';
  const temNumerosRef = !!(imovel.numeroEdital || imovel.numeroMatricula || imovel.numeroProcesso);
  // SEM REPETIÇÃO (pedido do dono: "todos os anexos que o leiloeiro disponibiliza devem constar,
  // mas apenas 1x"). Mantém TODOS os anexos (inclusive proposta/parcelamento etc.), mas: (1) dedup
  // por NOME dentro de cada lista; (2) a lista do leiloeiro não repete o que já saiu como OFICIAL
  // (matrícula/edital) nem o que já está em "Documentos do lote" (capturado no nosso Storage).
  const chaveNome = (a) => String(a?.nome || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const dedupDocs = (arr) => { const seen = new Set(); const out = []; for (const a of arr) { const k = chaveNome(a) || a.url; if (seen.has(k)) continue; seen.add(k); out.push(a); } return out; };
  const urlsOficiais = new Set([matriculaUrl, regrasEditalUrl].filter(Boolean));
  // Documentos capturados no nosso Storage (PDF de alta qualidade) — a fonte mais confiável; vêm primeiro.
  const anexosCapturados = dedupDocs((Array.isArray(anexosDocs) ? anexosDocs : [])
    .filter(a => a && a.url && !urlsOficiais.has(a.url)));
  const chavesCap = new Set(anexosCapturados.flatMap(a => [chaveNome(a), a.url]).filter(Boolean));
  // Anexos vasculhados na página do leiloeiro: só o que NÃO é oficial e NÃO repete um documento
  // já capturado (por nome ou url) — assim cada anexo aparece 1× só.
  const anexosLeiloeiro = dedupDocs((Array.isArray(imovel.anexos) ? imovel.anexos : [])
    .filter(a => a && a.url && !urlsOficiais.has(a.url)
      && !(chaveNome(a) && chavesCap.has(chaveNome(a))) && !chavesCap.has(a.url)));
  const temCardDocumentos = !!matriculaUrl || !!regrasEditalUrl || temNumerosRef || anexosLeiloeiro.length > 0 || anexosCapturados.length > 0;
  const TIPO_DOC_LABEL = { matricula: 'Matrícula', edital: 'Edital', regras: 'Regras de venda', regras_venda: 'Regras de venda', laudo: 'Laudo de avaliação', outro: 'Documento', anexo: 'Anexo' };

  // Localização no Google: Street View por coordenadas (quando geocodificado) ou
  // busca pelo endereço. Sem chave de API — usa as URLs públicas do Google Maps.
  const _lat = imovel.latitude ?? imovel.lat;
  const _lng = imovel.longitude ?? imovel.lng;
  const temCoord = _lat != null && _lng != null && !(Number(_lat) === 0 && Number(_lng) === 0);
  const enderecoCompleto = [imovel.endereco, imovel.bairro, imovel.cidade, imovel.estado, 'Brasil'].filter(Boolean).join(', ');
  const temLocal = temCoord || !!(imovel.endereco || imovel.cidade);
  // Endereço completo (rua + número) é mais preciso que a coordenada geocodificada
  // (que costuma cair no centro do bairro/cidade). Quando há endereço, priorizamos.
  const temEnderecoPreciso = !!(imovel.endereco && /\d/.test(imovel.endereco));
  const qEndereco = encodeURIComponent(enderecoCompleto);
  // PRECISÃO da localização: coordenada exata (endereço/rua) vs aproximada
  // (bairro/cidade = centro da região). 95% do acervo é aproximado — não podemos
  // apontar Street View no lote, então nesse caso caímos na BUSCA por endereço.
  const nivelGeo = imovel.geocodNivel || imovel.geocod_nivel;
  const localPrecisa = temEnderecoPreciso || nivelGeo === 'endereco' || nivelGeo === 'rua';
  const nivelTxt = { endereco: 'endereço exato', rua: 'rua', bairro: 'bairro', cidade: 'cidade/município' }[nivelGeo];
  // STREET VIEW só faz sentido com coordenada PRECISA; no aproximado o pano cairia
  // numa rua qualquer do bairro → usamos a busca pelo endereço (mais honesto).
  // Usamos cbll (ancora no panorama MAIS PRÓXIMO da coordenada) + cbp com PITCH
  // NIVELADO no horizonte — o `map_action=pano&viewpoint=` deixava o Google
  // escolher uma orientação arbitrária (olhando pro céu/parede) e dava tela preta.
  const streetViewUrl = (temCoord && localPrecisa)
    ? `https://www.google.com/maps?q=&layer=c&cbll=${_lat},${_lng}&cbp=11,0,0,0,0`
    : `https://www.google.com/maps/search/?api=1&query=${qEndereco}`;
  // Google Maps: coordenada só quando precisa; caso contrário busca pelo texto do
  // endereço (o Google mostra a região sem fingir um pino exato no lugar errado).
  const mapaUrl = (temCoord && localPrecisa)
    ? `https://www.google.com/maps/search/?api=1&query=${_lat},${_lng}`
    : `https://www.google.com/maps/search/?api=1&query=${qEndereco}`;

  return (
    <div className="detalhe-page" style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 80 }}>

      {/* Breadcrumb */}
      <div style={{ background: '#111111', padding: '12px 20px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>
            <ArrowLeft size={15} /> Voltar à busca
          </button>
          <span style={{ color: '#334155', fontSize: 13 }}>/</span>
          <span style={{ color: '#64748b', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{imovel.titulo || 'Imóvel'}</span>
          <button onClick={compartilhar} title="Compartilhar este imóvel"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, background: compartilhado ? '#16a34a' : 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', color: compartilhado ? '#fff' : '#e2e8f0', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {compartilhado ? <><Check size={14} /> Link copiado</> : <><Share2 size={14} /> Compartilhar</>}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }} className="detalhe-grid">

          {/* Coluna esquerda */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Foto + badges */}
            <div style={{ borderRadius: 16, overflow: 'hidden', position: 'relative', background: '#111111', minHeight: 260 }}>
              {imgDetalheSrc ? (
                <img src={imgDetalheSrc} alt={imovel.titulo} onError={() => setImgIdx(i => i + 1)}
                  style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#475569' }}>
                  <Home size={48} color="#334155" />
                  <span style={{ fontSize: 13 }}>Sem foto disponível</span>
                </div>
              )}
              <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {imovel.tipo && <span style={{ background: '#111111', color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{TIPO_LABEL[imovel.tipo] || imovel.tipo}</span>}
                {imovel.modalidade && <span style={{ background: '#084BA6', color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{MODAL_LABEL[imovel.modalidade] || imovel.modalidade}</span>}
              </div>
              {desc > 0 && (
                <div style={{ position: 'absolute', top: 16, right: 16, background: descBg, color: descColor, fontWeight: 900, fontSize: 18, padding: '6px 12px', borderRadius: 10, lineHeight: 1 }}>
                  -{descLabel}%
                </div>
              )}
            </div>

            {/* Título e localização */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h1 style={{ fontSize: 'clamp(16px, 3vw, 22px)', fontWeight: 800, color: '#111111', margin: '0 0 12px', lineHeight: 1.3 }}>
                {imovel.titulo || 'Imóvel em leilão'}
              </h1>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: '#64748b', fontSize: 14 }}>
                {(imovel.endereco || imovel.cidade) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={14} color="#0D63DB" />
                    {[imovel.endereco, imovel.bairro, imovel.cidade, imovel.estado].filter(Boolean).join(', ')}
                  </span>
                )}
                {imovel.areaM2 > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Building2 size={14} color="#8b5cf6" /> {imovel.areaM2} m²
                  </span>
                )}
                {imovel.leiloeiro && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag size={14} color="#0891b2" /> {imovel.leiloeiro}
                  </span>
                )}
                {imovel.ocupacao && (() => {
                  const desocup = /desocupad/i.test(imovel.ocupacao);
                  return (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, padding: '2px 10px', borderRadius: 999,
                      background: desocup ? '#f0fdf4' : '#fffbeb', color: desocup ? '#15803d' : '#b45309', border: `1px solid ${desocup ? '#bbf7d0' : '#fde68a'}` }}>
                      {desocup ? '✓' : '⚠'} {imovel.ocupacao}
                    </span>
                  );
                })()}
              </div>
              {/* Localização: mapa embutido + botões para abrir no Google */}
              {temLocal && (
                <div style={{ marginTop: 16 }}>
                  {temCoord && <MiniMapa key={imovel.pontosProximos ? 'm-com-pontos' : 'm-so-imovel'} lat={Number(_lat)} lng={Number(_lng)} pontos={imovel.pontosProximos} nivel={nivelGeo} />}
                  {/* Selo de precisão, honesto sobre coordenada exata vs aproximada */}
                  {temCoord && (
                    <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
                      background: localPrecisa ? '#f0fdf4' : '#fffbeb', color: localPrecisa ? '#15803d' : '#b45309', border: `1px solid ${localPrecisa ? '#bbf7d0' : '#fde68a'}` }}>
                      <MapPin size={12} />
                      {localPrecisa
                        ? 'Localização exata (endereço)'
                        : `Localização aproximada${nivelTxt ? `, nível ${nivelTxt}` : ''}: o círculo mostra a região, não o lote exato`}
                    </div>
                  )}
                  {/* Legenda dos pontos próximos (atratividade) */}
                  {temCoord && imovel.pontosProximos && Object.keys(imovel.pontosProximos).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {Object.entries(CATS_PROX).filter(([k]) => imovel.pontosProximos[k]).map(([k]) => {
                        const p = imovel.pontosProximos[k], c = CATS_PROX[k];
                        return (
                          <span key={k} title={p.nome || c.label}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#334155', background: '#f8fafc', border: `1px solid ${c.cor}33`, borderLeft: `3px solid ${c.cor}`, borderRadius: 8, padding: '4px 10px' }}>
                            {c.emoji} {c.label} <strong style={{ color: c.cor }}>{fmtDist(distPonto(imovel.latitude, imovel.longitude, p))}</strong>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {/* Estados explícitos dos pontos próximos (nunca mais "gira p/ sempre") */}
                  {temCoord && proxStatus === 'loading' && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={13} /> Buscando pontos de interesse próximos…
                    </div>
                  )}
                  {temCoord && proxStatus === 'empty' && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
                      Nenhum ponto de interesse mapeado nas proximidades.
                    </div>
                  )}
                  {temCoord && proxStatus === 'error' && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      Não foi possível carregar os pontos próximos agora.
                      <button onClick={() => setProxTry(t => t + 1)}
                        style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#c2410c', borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        Tentar novamente
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                    <a href={streetViewUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, color: '#4338ca', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      👁️ Street View
                    </a>
                    <a href={mapaUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 10, color: '#0e7490', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      <MapPin size={14} /> Abrir no Google Maps
                    </a>
                    {!temCoord && (
                      <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                        Localização aproximada pelo endereço
                      </span>
                    )}
                  </div>
                </div>
              )}
              {(imovel.scoreFinanceiro !== null || imovel.scoreJuridico !== null) && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                  <ScoreRisco scoreFinanceiro={imovel.scoreFinanceiro} scoreJuridico={imovel.scoreJuridico} size="md" />
                </div>
              )}
            </div>

            {/* Valores */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Banknote size={18} color="#0D63DB" /> Valores
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
                {(() => {
                  // DUAS PRAÇAS: as fontes divergem em qual coluna guarda a 1ª/2ª (judicial x CEF).
                  // Ordenamos por VALOR — 1ª praça = maior; 2ª praça = menor (mais descontada) — e
                  // pareamos cada valor com a SUA data, para o rótulo ficar sempre correto.
                  const vMin = Number(imovel.valorMinimo) || 0;
                  const vMin2 = Number(imovel.valorMinimo2) || 0;
                  const temDuas = vMin > 0 && vMin2 > 0 && vMin !== vMin2;
                  if (!temDuas) {
                    return (
                      <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Lance mínimo</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#111111' }}>{fmtBRL(imovel.valorMinimo)}</div>
                        {imovel.dataLeilao && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>a partir de {fmtData(imovel.dataLeilao, imovel.modalidade)}</div>}
                      </div>
                    );
                  }
                  const pares = [
                    { valor: vMin, data: imovel.dataLeilao },
                    { valor: vMin2, data: imovel.dataLeilao2 },
                  ].sort((a, b) => b.valor - a.valor);
                  const p1 = pares[0], p2 = pares[1];
                  return (
                    <>
                      <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Lance mínimo (1ª praça)</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#111111' }}>{fmtBRL(p1.valor)}</div>
                        {p1.data && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>a partir de {fmtData(p1.data, imovel.modalidade)}</div>}
                      </div>
                      <div style={{ background: '#dcfce7', borderRadius: 12, padding: '16px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Lance mínimo (2ª praça)</div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#15803d' }}>{fmtBRL(p2.valor)}</div>
                        <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>
                          {imovel.valorAvaliacao > 0 && `${Math.round((1 - p2.valor / imovel.valorAvaliacao) * 100)}% abaixo da avaliação`}
                          {p2.data && ` · ${fmtData(p2.data, imovel.modalidade)}`}
                        </div>
                      </div>
                    </>
                  );
                })()}
                {imovel.valorAvaliacao && (
                  <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Avaliação</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#64748b' }}>{fmtBRL(imovel.valorAvaliacao)}</div>
                  </div>
                )}
                {economia && (
                  <div style={{ background: '#dcfce7', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Economia potencial</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#15803d' }}>{fmtBRL(economia)}</div>
                  </div>
                )}
                {precoM2 && (
                  <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Preço por m²</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#111111' }}>{fmtBRL(precoM2)}</div>
                  </div>
                )}
              </div>
              {imovel.pagamento?.filter(Boolean).length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Pagamento:</span>
                  {imovel.pagamento.filter(Boolean).map(p => (
                    <span key={p} style={{ fontSize: 12, background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>{p}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Ficha técnica, CEF vem da página oficial; demais lotes (judicial/
                extrajudicial) vêm da matrícula lida no laudo documental. */}
            <FichaTecnicaCEF ficha={imovel.fichaCef} />

            {/* Análise jurídica (raio-X): aparece após o laudo documental. */}
            <AnaliseJuridicaCard fj={imovel.fichaJuridica} />

            {/* Simulação rápida, estimativa pela avaliação do leilão (NÃO é a mercadológica) */}
            {imovel.valorMinimo > 0 && imovel.valorAvaliacao > 0 && (() => {
              // A simulação sai sobre a praça MAIS DESCONTADA ainda disponível, não sobre a mais
              // próxima no tempo (regra do dono, 07/08 — foi o que ele viu errado na apresentação).
              // Num lote com 2ª praça futura mais barata, projetar pela 1ª mostrava margem negativa
              // onde havia negócio: no acervo, −6,1% de desconto médio pela 1ª contra +23,5% pela 2ª.
              const praca = pracaMaisDescontada(imovel);
              const lance = praca.valor || imovel.valorMinimo;
              const custosAquisicao = lance * 0.095; // ITBI ~3% + registro ~1,5% + comissão leiloeiro 5%
              const revendaRef = imovel.valorAvaliacao;
              const comissaoVenda = revendaRef * 0.05;
              const lucro = revendaRef - lance - custosAquisicao - comissaoVenda;
              const margem = (lance + custosAquisicao) > 0 ? (lucro / (lance + custosAquisicao)) * 100 : 0;
              const linha = (rot, val, cor) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px dashed #f1f5f9' }}>
                  <span style={{ color: '#64748b' }}>{rot}</span><span style={{ fontWeight: 700, color: cor || '#111' }}>{val}</span>
                </div>
              );
              return (
                <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BarChart2 size={18} color="#0D63DB" /> Simulação rápida
                  </h2>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px', lineHeight: 1.5 }}>
                    Estimativa com base no <strong>valor de avaliação do leilão</strong> e custos médios. A <strong>avaliação mercadológica real</strong> e a viabilidade financeira completa são feitas no <strong>relatório</strong>.
                  </p>
                  {linha(praca.qual === '2a_praca' ? 'Lance mínimo (2ª praça)' : 'Lance mínimo', fmtBRL(lance))}
                  {linha('Custos de aquisição (est. ~9,5%)', '− ' + fmtBRL(custosAquisicao), '#b45309')}
                  {linha('Revenda de referência (avaliação)', fmtBRL(revendaRef))}
                  {linha('Comissão de venda (5%)', '− ' + fmtBRL(comissaoVenda), '#b45309')}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontSize: 15 }}>
                    <span style={{ fontWeight: 800, color: '#111' }}>Lucro estimado</span>
                    <span style={{ fontWeight: 900, color: lucro >= 0 ? '#15803d' : '#dc2626' }}>{fmtBRL(lucro)} <span style={{ fontSize: 12, fontWeight: 700 }}>({margem.toFixed(2)}%)</span></span>
                  </div>
                  <button onClick={() => nav('/calculadora', { state: { imovel } })}
                    style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#eff6ff', color: '#0D63DB', border: '1px solid #bfdbfe', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    <BarChart2 size={14} /> Simular na Calculadora
                  </button>
                </div>
              );
            })()}

            {/* Data do leilão */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={18} color="#0D63DB" /> Data do leilão
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Clock size={16} color="#64748b" />
                <span style={{ fontSize: 15, fontWeight: 600, color: '#334155' }}>{fmtData(imovel.dataLeilao, imovel.modalidade)}{imovel.dataLeilao2 ? (imovel.valorMinimo2 ? ' (1ª praça)' : ' (início)') : ''}</span>
              </div>
              {/* A SEGUNDA data aparece SEMPRE que existir — antes exigia também um segundo
                  lance (`valorMinimo2 && dataLeilao2`), então numa janela de alienação, que tem
                  encerramento mas um preço só, o PRAZO ficava escondido. Era metade do problema
                  do lote gl_28450: a tela mostrava só 03/08 num leilão aberto até 03/11. */}
              {imovel.dataLeilao2 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <Clock size={16} color="#15803d" />
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#15803d' }}>
                    {fmtData(imovel.dataLeilao2, imovel.modalidade)}
                    {imovel.valorMinimo2 ? ` (2ª praça · ${fmtBRL(imovel.valorMinimo2)})` : ' (encerramento — prazo para dar lance)'}
                  </span>
                </div>
              )}
              {!imovel.dataLeilao && (
                <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 8, lineHeight: 1.5, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                  ℹ️ {explicacaoData(imovel.modalidade)}
                </div>
              )}
            </div>

            {/* Descrição */}
            {imovel.descricao && (
              <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#0D63DB" /> Descrição
                </h2>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {formatarDescricaoImovel(imovel.descricao)}
                </p>
              </div>
            )}

            {/* Documentos */}
            {temCardDocumentos && (
              <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#0D63DB" /> Documentos
                </h2>

                {/* Números de referência */}
                {(imovel.numeroEdital || imovel.numeroMatricula || imovel.numeroProcesso) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {imovel.numeroEdital && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span className="kv-rot" style={{ color: '#94a3b8', minWidth: 110 }}>Nº Edital:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#eff6ff', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroEdital}</span>
                      </div>
                    )}
                    {imovel.numeroMatricula && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span className="kv-rot" style={{ color: '#94a3b8', minWidth: 110 }}>Nº Matrícula:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#f0fdf4', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroMatricula}</span>
                      </div>
                    )}
                    {imovel.numeroProcesso && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span className="kv-rot" style={{ color: '#94a3b8', minWidth: 110 }}>Nº Processo:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#faf5ff', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroProcesso}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Botões DIRETOS: Matrícula + Regras de venda online/Edital.
                    Montados na hora a partir dos dados, abrem direto o PDF/portal da
                    Caixa no navegador (sem captura/espera). */}
                {(matriculaUrl || regrasEditalUrl) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {matriculaUrl && (
                      <a href={matriculaUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#15803d', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        <FileText size={15} /> Matrícula
                      </a>
                    )}
                    {regrasEditalUrl && (
                      <a href={regrasEditalUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, color: '#c2410c', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        {regrasEhDocReal ? <ScrollText size={15} /> : <ExternalLink size={15} />} {regrasEditalLabel}
                      </a>
                    )}
                  </div>
                )}

                {/* Documentos CAPTURADOS por nós (edital/matrícula/laudo baixados do
                    leiloeiro e guardados no Storage — PDF assinado, alta qualidade).
                    Cobre leiloeiros de URL opaca (SUPERBID etc.), cujo edital/matrícula
                    entram como 'outro' — aqui abrem como arquivo, não como link do site. */}
                {anexosCapturados.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Documentos do lote</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {anexosCapturados.map((a, i) => (
                        <a key={`cap${i}`} href={a.url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#334155', fontSize: 13, textDecoration: 'none' }}>
                          <FileText size={14} color="#15803d" style={{ flexShrink: 0 }} />
                          <span style={{ flexShrink: 0, fontWeight: 700, fontSize: 11, color: '#15803d', background: '#dcfce7', padding: '1px 6px', borderRadius: 5 }}>{TIPO_DOC_LABEL[a.tipo] || 'Documento'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome || 'Documento'}</span>
                          <ExternalLink size={12} color="#94a3b8" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anexos do leiloeiro, documentos vasculhados na página do lote
                    (matrícula, edital, laudo, ônus, certidões…). Cada leiloeiro
                    guarda em lugar diferente; o servidor varre a página e lista aqui. */}
                {anexosLeiloeiro.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Documentos no leiloeiro</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {anexosLeiloeiro.map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, color: '#334155', fontSize: 13, textDecoration: 'none' }}>
                          <FileText size={14} color="#0D63DB" style={{ flexShrink: 0 }} />
                          <span style={{ flexShrink: 0, fontWeight: 700, fontSize: 11, color: '#0D63DB', background: '#eff6ff', padding: '1px 6px', borderRadius: 5 }}>{TIPO_DOC_LABEL[a.tipo] || 'Anexo'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome || 'Documento'}</span>
                          <ExternalLink size={12} color="#94a3b8" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── CONFIRMADO NA DOCUMENTAÇÃO ────────────────────────────────────────────
                Pedido do dono (06/08): "caso encontre nome de condomínio, despesas mensais,
                que também apareça na tela do imóvel — isso gera mais credibilidade ao
                visualizar a ficha". O que a leitura do edital/matrícula apurou fica aqui,
                fora do relatório: quem só está olhando o lote já vê que o documento foi
                lido, o que ele diz e de onde saiu. Só aparece com fato apurado — ficha sem
                leitura continua exatamente como era.
                Regra que não pode cair: DESPESA RECORRENTE (carrego) e DÉBITO EM ABERTO são
                blocos separados e rotulados. Misturar os dois faria a ficha prometer um
                custo mensal que na verdade é uma dívida a assumir. */}
            {(() => {
              const df = imovel.docFatos;
              if (!df) return null;
              const idt = df.identidade || {}, cst = df.custos || {}, pag = df.pagamento || {}, mat = df.matricula || {};
              const n = (v) => (Number(v) > 0 ? Number(v) : 0);
              const pct = (v) => String(v).replace('.', ',');
              const identidade = [
                idt.nomeCondominio && ['Condomínio/empreendimento', idt.nomeCondominio],
                idt.logradouro && ['Endereço na documentação', [idt.logradouro, idt.bairro].filter(Boolean).join(', ')],
                n(mat.areaPrivativaM2) && ['Área privativa (matrícula)', `${mat.areaPrivativaM2} m²`],
                n(mat.areaTerrenoM2) && ['Área do terreno (matrícula)', `${mat.areaTerrenoM2} m²`],
                mat.numeroMatricula && ['Nº da matrícula', mat.numeroMatricula],
              ].filter(Boolean);
              const mensais = [
                n(cst.condominioMensal) && ['Condomínio', `${fmtBRL(cst.condominioMensal)}/mês`],
                n(cst.iptuMensal) ? ['IPTU', `${fmtBRL(cst.iptuMensal)}/mês`]
                  : (n(cst.iptuAnual) && ['IPTU', `${fmtBRL(cst.iptuAnual)}/ano`]),
              ].filter(Boolean);
              const arremate = [
                n(pag.comissaoPct) && ['Comissão do leiloeiro', `${pct(pag.comissaoPct)}%`],
                n(cst.taxaAdmPct) && ['Taxa administrativa', `${pct(cst.taxaAdmPct)}%`],
                n(cst.despesasAdm) && ['Despesas administrativas', fmtBRL(cst.despesasAdm)],
                n(pag.parcelas) && ['Parcelamento previsto', `até ${pag.parcelas}x`],
                n(pag.sinalPct) && ['Sinal/entrada', `${pct(pag.sinalPct)}%`],
                n(pag.prazoDias) && ['Prazo de pagamento', `${pag.prazoDias} dia${pag.prazoDias > 1 ? 's' : ''}`],
              ].filter(Boolean);
              const debitos = [
                n(cst.condominioDebito) && ['Condomínio em aberto', fmtBRL(cst.condominioDebito)],
                n(cst.iptuDebito) && ['IPTU em aberto', fmtBRL(cst.iptuDebito)],
              ].filter(Boolean);
              if (!identidade.length && !mensais.length && !arremate.length && !debitos.length) return null;
              const fonte = df.fonteEdital || df.fonteMatricula || null;
              const Bloco = ({ titulo, itens, cor }) => (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', marginBottom: 8 }}>{titulo}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {itens.map(([r, v]) => (
                      <div key={r} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13, flexWrap: 'wrap' }}>
                        <span className="kv-rot" style={{ color: '#94a3b8', minWidth: 190 }}>{r}:</span>
                        <span style={{ fontWeight: 700, color: cor || '#334155' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
              return (
                <div style={{ background: 'white', borderRadius: 16, border: '1px solid #bbf7d0', padding: '24px' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldCheck size={18} color="#15803d" /> Confirmado na documentação
                  </h2>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                    Lido automaticamente do edital/matrícula deste lote. Confirme no documento antes de dar o lance.
                  </div>
                  {identidade.length > 0 && <Bloco titulo="O imóvel na documentação" itens={identidade} />}
                  {mensais.length > 0 && <Bloco titulo="Despesas mensais informadas" itens={mensais} />}
                  {arremate.length > 0 && <Bloco titulo="Custos e condições da arrematação" itens={arremate} />}
                  {debitos.length > 0 && (
                    <div style={{ marginTop: 14, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#9a3412', marginBottom: 6 }}>Débitos em aberto citados no documento</div>
                      {debitos.map(([r, v]) => (
                        <div key={r} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13, flexWrap: 'wrap' }}>
                          <span className="kv-rot" style={{ color: '#c2410c', minWidth: 190 }}>{r}:</span>
                          <span style={{ fontWeight: 800, color: '#9a3412' }}>{v}</span>
                        </div>
                      ))}
                      <div style={{ fontSize: 11.5, color: '#9a3412', marginTop: 6, lineHeight: 1.5 }}>
                        Não é despesa mensal: é dívida já existente. Quem a assume depois da arrematação depende de cláusula do edital, confirme antes do lance.
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 14 }}>
                    Leitura automática do documento{imovel.docFatosEm ? ` em ${fmtData(imovel.docFatosEm)}` : ''}
                    {fonte ? <> · <a href={fonte} target="_blank" rel="noreferrer" style={{ color: '#0D63DB' }}>abrir o documento</a></> : null}. Não substitui a conferência do edital e da matrícula.
                  </div>
                </div>
              );
            })()}

            {/* Aviso de risco */}
            <div style={{ background: '#fffbeb', borderRadius: 16, border: '1px solid #fbbf24', padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: 13, color: '#92400e', margin: 0, lineHeight: 1.6 }}>
                <strong>Atenção:</strong> Antes de arrematar, verifique o edital, a matrícula do imóvel e possíveis ônus ou ocupantes. Recomendamos solicitar uma análise completa com nossa equipe.
              </p>
            </div>

            {/* Imóveis semelhantes e próximos */}
            <ImoveisSimilares imovel={imovel} nav={nav} />

          </div>

          {/* Sidebar direita */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }} className="detalhe-sidebar">

            {/* Card de ação */}
            <div style={{ background: 'white', borderRadius: 16, border: '2px solid #e2e8f0', padding: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Lance mínimo</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#111111', marginBottom: 4 }}>{fmtBRL(imovel.valorMinimo)}</div>
              {desc > 0 && Number(imovel.valorAvaliacao) > 0 && (
                <div style={{ display: 'inline-block', background: descBg, color: descColor, fontWeight: 800, fontSize: 13, padding: '3px 10px', borderRadius: 8, marginBottom: 16 }}>
                  {descLabel}% abaixo da avaliação
                </div>
              )}
              {/* Score BidPro (0 a 10): potencial de oportunidade num relance */}
              {(() => {
                const sb = scoreBidPro({ desconto: imovel.descontoPercentual, modalidade: imovel.modalidade, tipo: imovel.tipo, scoreLocalizacao: imovel.scoreLocalizacao, scoreJuridico: imovel.scoreJuridico, scoreFinanceiro: imovel.scoreFinanceiro, valorMercado: imovel.valorMercado, valorMinimo: imovel.valorMinimo, analiseViavel: imovel.analiseViavel });
                if (!sb) return null;
                const corCamada = (n) => n >= 7 ? '#16a34a' : n >= 4 ? '#d97706' : '#dc2626';
                return (
                  <div style={{ padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 10, background: sb.cor, color: 'white', fontWeight: 900, fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{sb.nota.toFixed(1)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#111' }}>BidScore</div>
                        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.3 }}>{scoreLabel(sb.base)}</div>
                      </div>
                    </div>
                    {/* Sub-scores (camadas), transparência: cada camada e seu peso */}
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {sb.camadas.map(c => (
                        <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 78, fontSize: 11, fontWeight: 700, color: '#475569', flexShrink: 0 }}>{c.label}</div>
                          <div style={{ flex: 1, height: 7, background: '#e2e8f0', borderRadius: 20, overflow: 'hidden' }}>
                            <div style={{ width: `${c.nota * 10}%`, height: '100%', background: corCamada(c.nota), borderRadius: 20 }}/>
                          </div>
                          <div style={{ width: 58, textAlign: 'right', fontSize: 11, color: '#64748b', flexShrink: 0 }}>{c.nota.toFixed(1)} <span style={{ color: '#cbd5e1' }}>·{c.peso}%</span></div>
                        </div>
                      ))}
                    </div>
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#0D63DB' }}>Como funciona o Score?</summary>
                      <div style={{ marginTop: 8, fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
                        Nota de <strong>0 a 10</strong> = média <strong>ponderada das camadas presentes</strong> (re-normalizada), então já na busca a nota pode chegar a 10 e <strong>refina</strong> quando a análise chega:
                        <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                          <li><strong>Margem (40%)</strong>, desconto do lance vs. avaliação.</li>
                          <li><strong>Localização (25%)</strong>, proximidades (OSM); só p/ imóvel com coordenada precisa.</li>
                          <li><strong>Perfil (15%)</strong>, modalidade + tipo (liquidez da operação).</li>
                          <li><strong>Jurídico (10%)</strong> e <strong>Financeiro (10%)</strong>, entram após a análise.</li>
                        </ul>
                        <div style={{ marginTop: 6 }}>Cores: <span style={{ color: '#16a34a', fontWeight: 700 }}>verde ≥ 7</span> · <span style={{ color: '#d97706', fontWeight: 700 }}>âmbar 4 a 6,9</span> · <span style={{ color: '#dc2626', fontWeight: 700 }}>vermelho &lt; 4</span>.</div>
                        <div style={{ marginTop: 6, color: '#94a3b8' }}>É um indicador de <strong>triagem</strong>, não substitui a análise completa nem o parecer do analista.</div>
                      </div>
                    </details>
                  </div>
                );
              })()}

              {/* Ir ao leiloeiro */}
              {imovel.urlLote && (
                <div style={{ marginBottom: 10 }}>
                  <a href={imovel.urlLote} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#111111', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box' }}>
                    <ExternalLink size={15} /> Acessar leiloeiro
                  </a>
                </div>
              )}

              {/* Solicitar análise */}
              {user ? (
                encerrado.encerrado ? (
                  <div style={{ padding: '13px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, fontSize: 12.5, color: '#9a3412', lineHeight: 1.55 }}>
                    <strong>Leilão encerrado{encerrado.ultimaData ? ` em ${dataBR(encerrado.ultimaData)}` : ''}.</strong> Como não é mais possível dar lance, o relatório não é gerado para este lote.
                  </div>
                ) : podeFazerAnalise ? (
                  <button onClick={() => nav('/analise', { state: { imovel } })}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    <BarChart2 size={15} /> {rotuloAnalise}
                  </button>
                ) : (
                  <button onClick={() => nav('/planos')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    <BarChart2 size={15} /> Fazer upgrade para analisar
                  </button>
                )
              ) : (
                <button onClick={() => nav('/login')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  <BarChart2 size={15} /> Entrar para analisar
                </button>
              )}

              <div style={{ marginTop: 16, padding: '12px', background: '#f8fafc', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  <CheckCircle size={13} color="#22c55e" /> Análise gerada em minutos
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  <CheckCircle size={13} color="#22c55e" /> Laudo mercadológico e jurídico
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                  <CheckCircle size={13} color="#22c55e" /> Projeção de rentabilidade
                </div>
              </div>
            </div>

            {/* Info rápida */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Resumo</div>
              {[
                { label: 'Tipo', value: TIPO_LABEL[imovel.tipo] || imovel.tipo },
                { label: 'Modalidade', value: MODAL_LABEL[imovel.modalidade] || imovel.modalidade },
                { label: 'Cidade/UF', value: imovel.cidade ? `${imovel.cidade}/${imovel.estado}` : imovel.estado },
                { label: 'Área', value: imovel.areaM2 ? `${imovel.areaM2} m²` : null },
                { label: 'Fonte', value: imovel.fonte },
                { label: 'Leiloeiro', value: imovel.leiloeiro },
              ].filter(({ value }) => value).map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#94a3b8' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: '#334155', textAlign: 'right', maxWidth: 160 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Seção Arrematação removida desta tela, a arrematação é registrada no Caso. */}

      {/* Barra de ação FIXA no mobile — os CTAs principais ("Acessar leiloeiro" e
          "Solicitar Análise") ficam sempre à mão, sem o usuário precisar rolar até o
          fim. No desktop a sidebar sticky já resolve, então a barra fica oculta. */}
      <div className="acoes-mobile-bar">
        {imovel.urlLote && (
          <a href={imovel.urlLote} target="_blank" rel="noopener noreferrer"
            style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px 16px', background: '#111111', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            <ExternalLink size={16} /> Leiloeiro
          </a>
        )}
        {user ? (
          encerrado.encerrado ? (
            <div style={{ flex: 1, padding: '11px 13px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, fontSize: 12, color: '#9a3412', fontWeight: 700, textAlign: 'center' }}>
              Leilão encerrado{encerrado.ultimaData ? ` em ${dataBR(encerrado.ultimaData)}` : ''}
            </div>
          ) : podeFazerAnalise ? (
            <button onClick={() => nav('/analise', { state: { imovel } })}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              <BarChart2 size={16} /> {rotuloAnaliseCurto}
            </button>
          ) : (
            <button onClick={() => nav('/planos')}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              <BarChart2 size={16} /> Fazer upgrade
            </button>
          )
        ) : (
          <button onClick={() => nav('/login')}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            <BarChart2 size={16} /> Entrar para analisar
          </button>
        )}
      </div>

      <style>{`
        .acoes-mobile-bar { display: none; }
        @media (max-width: 900px) {
          /* ROLAGEM HORIZONTAL NO CELULAR (13/08, relato do dono: "tive que dar um zoom out
             na tela de imóvel"). Os rótulos das linhas rótulo/valor tinham largura MÍNIMA fixa
             (110 a 190 px). Num telefone sobram ~330 px úteis: rótulo de 190 + um valor longo
             não cabem, e como a linha não quebrava, a PÁGINA inteira ganhava rolagem lateral —
             o app parecia largo demais e só dava para usar com zoom out. No celular o rótulo
             passa a ter largura natural e a linha quebra. */
          .kv-rot { min-width: 0 !important; }
          .kv-linha { flex-wrap: wrap !important; }
          .detalhe-page { overflow-x: hidden; }
          .detalhe-grid { grid-template-columns: 1fr !important; }
          .detalhe-sidebar { position: static !important; }
          .detalhe-page { padding-bottom: 96px !important; }
          .acoes-mobile-bar {
            display: flex; gap: 10px; align-items: stretch;
            position: fixed; left: 0; right: 0; bottom: 0; z-index: 900;
            padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px));
            background: rgba(255,255,255,0.97); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
            border-top: 1px solid #e2e8f0; box-shadow: 0 -4px 20px rgba(0,0,0,0.10);
          }
        }
      `}</style>
    </div>
  );
}
