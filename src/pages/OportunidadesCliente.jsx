import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Target, Home } from 'lucide-react';
import OportunidadesPerfil from '../components/OportunidadesPerfil';

// Tela interna da equipe (02/10, pedido do dono): oportunidades no perfil de UM assessorado.
// Chega-se por dois caminhos — o botão "Oportunidades" na lista de Assessorados (seção
// Contratadas) e o botão de mesmo nome na tela de operações do cliente (/arrematados?cliente_id).
// O acesso é decidido no servidor (api/oportunidades-cliente.js: admin ou equipe designada).
export default function OportunidadesCliente() {
  const nav = useNavigate();
  const { clienteId } = useParams();
  const [params] = useSearchParams();
  const nome = params.get('nome') || 'cliente';
  const valido = /^[0-9a-f-]{36}$/i.test(clienteId || '');
  const operacoes = `/arrematados?cliente_id=${clienteId}&nome=${encodeURIComponent(nome)}`;
  const link = { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', padding: 0, fontSize: 12.5, fontWeight: 700, color: '#0D63DB', cursor: 'pointer' };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 60px' }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={() => nav('/assessorados')} style={link}><ChevronLeft size={14} /> Assessorados</button>
        {valido && <button onClick={() => nav(operacoes)} style={link}><Home size={13} /> Operações de {nome}</button>}
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 9 }}>
        <Target size={22} color="#7c3aed" /> Oportunidades para {nome}
      </h1>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        Lotes que cabem no perfil de investidor que o cliente preencheu, ordenados pelo encaixe. Abra o lote para conferir e enviar a ele.
      </div>
      {valido
        ? <OportunidadesPerfil cliente={{ id: clienteId, nome }} />
        : <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 14, borderRadius: 10, fontSize: 14 }}>Cliente inválido.</div>}
    </div>
  );
}
