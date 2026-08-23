import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import './index.css'
import { registrarServiceWorker } from './utils/push.js'
import { vigiarAtualizacaoDoApp } from './utils/swAtualizacao.js'
import { reportarErroCliente, instalarCapturaErros, ehErroDeChunk, recarregarPorChunkStale, recarregarComGuarda, houveChunkRecente } from './utils/reportarErro.js'
import { instalarTracker } from './utils/tracker.js'
import { initMetaPixel, capturarMarketing } from './utils/marketing.js'

// Registra o service worker em produção e VIGIA atualização: sem isso o PWA instalado
// segue rodando a versão que baixou (fechar e reabrir NÃO busca versão nova — ver
// utils/swAtualizacao.js). Foi o que fez uma tela nova não aparecer no app em 23/08.
if (import.meta.env.PROD) {
  registrarServiceWorker()
    .then(reg => { if (reg) vigiarAtualizacaoDoApp(reg); })
    .catch(() => {});
}

// Captura erros de runtime ASSÍNCRONOS (window.onerror / unhandledrejection) que o
// ErrorBoundary de render não pega — para a saúde do sistema enxergar QUALQUER quebra
// que atinja o usuário, não só a de RLS.
instalarCapturaErros();

// Rastreamento de atividade (navegação + cliques) para o Cliente 360 — diagnóstico de falhas.
instalarTracker();

// Marketing: liga o Meta Pixel (se VITE_META_PIXEL_ID existir) e captura a atribuição do anúncio
// (gclid/fbclid/utm) que trouxe o visitante — consumida no cadastro p/ medir a captação por origem.
initMetaPixel();
capturarMarketing();

class RootErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, chunk: false }; }
  static getDerivedStateFromError(e) {
    // Erro de CHUNK velho (pós-deploy, comum no PWA): não é bug — o index em cache aponta p/
    // um chunk que sumiu. Marca p/ mostrar "Atualizando…" (neutro) e recarregar sozinho, em
    // vez da tela vermelha "Algo deu errado" que pisca e assusta.
    // chunk = mensagem clássica de chunk OU erro DERIVADO logo após um preloadError
    // (React.lazy com módulo undefined → "reading 'default'"/"destructure of undefined").
    return { error: e, chunk: ehErroDeChunk(e?.message) || houveChunkRecente() };
  }
  componentDidMount() {
    // Recupera-se ao navegar: sem isto, um erro numa tela deixa o usuário PRESO no
    // fallback (nem "voltar" sai). Ao mudar de rota (voltar/avançar/hash), zera o erro
    // para a nova tela tentar renderizar.
    this._reset = () => { if (this.state.error) this.setState({ error: null }); };
    window.addEventListener('popstate', this._reset);
    window.addEventListener('hashchange', this._reset);
  }
  componentWillUnmount() {
    window.removeEventListener('popstate', this._reset);
    window.removeEventListener('hashchange', this._reset);
  }
  componentDidCatch(error, info) {
    // Chunk velho → recarrega sozinho (pega o index novo); anti-loop de 10s no helper.
    if (ehErroDeChunk(error?.message)) { recarregarPorChunkStale(error?.message); return; }
    // Erro DERIVADO de um chunk velho (React.lazy undefined) logo após o preloadError:
    // recarrega e NÃO loga (não é bug acionável, é o mesmo chunk stale).
    if (houveChunkRecente()) { recarregarComGuarda(); return; }
    // Registra o erro no servidor (persiste em erros_cliente + Runtime Logs) p/ a saúde
    // enxergar — em produção o boundary não mostra o stack ao usuário, então sem isso
    // ficamos cegos. Centralizado em reportarErroCliente (dedup/teto/token do usuário).
    reportarErroCliente({
      msg: String(error?.message || error),
      stack: `${error?.stack || ''}\n--- componentStack ---${info?.componentStack || ''}`,
      url: typeof location !== 'undefined' ? location.href : '',
    });
  }
  render() {
    if (this.state.error) {
      const dev = import.meta.env.DEV;
      // Chunk stale: tela NEUTRA de "atualizando" enquanto o reload automático acontece —
      // nada de "Algo deu errado". (Se o anti-loop bloquear o reload, some por navegação.)
      if (this.state.chunk) {
        return (
          <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', fontFamily: "'Inter', sans-serif", color: '#64748b', fontSize: 14, gap: 10 }}>
            <div style={{ width: 18, height: 18, border: '2px solid #cbd5e1', borderTopColor: '#0D63DB', borderRadius: '50%', animation: 'bp-spin 0.8s linear infinite' }} />
            Atualizando…
            <style>{'@keyframes bp-spin{to{transform:rotate(360deg)}}'}</style>
          </div>
        );
      }
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 24, fontFamily: "'Inter', sans-serif" }}>
          <div style={{ background: 'white', borderRadius: 16, padding: '36px 32px', maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ color: '#111111', fontWeight: 900, margin: '0 0 8px' }}>Algo deu errado</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
              Tivemos um problema ao carregar esta página. Tente recarregar — se persistir, fale com o suporte.
            </p>
            <button onClick={() => window.location.reload()}
              style={{ padding: '12px 28px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
              Recarregar página
            </button>
            {dev && (
              <pre style={{ marginTop: 20, textAlign: 'left', color: '#991b1b', whiteSpace: 'pre-wrap', fontSize: 11, background: '#fff1f2', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 240 }}>{String(this.state.error)}{'\n'}{this.state.error?.stack}</pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
)
