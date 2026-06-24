import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registrarServiceWorker } from './utils/push.js'

// Registra o service worker em produção
if (import.meta.env.PROD) {
  registrarServiceWorker().catch(() => {});
}

class RootErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
          <h2 style={{ color: '#dc2626' }}>Erro ao carregar o app</h2>
          <pre style={{ color: '#7f1d1d', whiteSpace: 'pre-wrap', fontSize: 13 }}>{String(this.state.error)}</pre>
          <pre style={{ color: '#991b1b', whiteSpace: 'pre-wrap', fontSize: 11 }}>{this.state.error?.stack}</pre>
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
