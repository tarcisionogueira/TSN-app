import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const wrap = { maxWidth: 820, margin: '0 auto', padding: '40px 20px 80px', color: '#334155', lineHeight: 1.7, fontSize: 15 };
const h2 = { fontSize: 20, fontWeight: 800, color: '#111111', margin: '32px 0 10px' };

export default function Termos() {
  const nav = useNavigate();
  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
      <div style={wrap}>
        <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 20 }}>
          <ArrowLeft size={16} /> Voltar
        </button>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: '#111111', margin: '0 0 6px' }}>Termos de Uso</h1>
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Última atualização: junho de 2026</p>

        <h2 style={h2}>1. Sobre a plataforma</h2>
        <p>A BidPro Brasil é uma plataforma de análise de imóveis em leilão, operada por Nogueira Empreendimentos LTDA (CNPJ 02.311.492/0001-61). Os relatórios, análises de viabilidade e pareceres têm caráter informativo e de apoio à decisão, não constituindo garantia de resultado, recomendação de investimento ou parecer jurídico definitivo.</p>

        <h2 style={h2}>2. Cadastro e conta</h2>
        <p>É permitido apenas um cadastro por pessoa, identificado por e-mail e CPF únicos. O usuário é responsável pela veracidade dos dados informados e pela guarda de suas credenciais de acesso. A assinatura é pessoal e intransferível.</p>

        <h2 style={h2}>3. Planos e pagamentos</h2>
        <p>Os planos pagos são cobrados de forma recorrente via Asaas (PIX, boleto ou cartão). O usuário pode solicitar upgrade (cobrança proporcional da diferença) ou downgrade (ajuste de valor na próxima cobrança, mantendo os benefícios até lá) a qualquer momento. Planos com fidelidade têm o prazo mínimo informado no momento da contratação.</p>

        <h2 style={h2}>4. Responsabilidades</h2>
        <p>As decisões de arrematação são de exclusiva responsabilidade do usuário. A BidPro Brasil não se responsabiliza por prejuízos decorrentes de informações de terceiros (editais, leiloeiros, órgãos públicos) ou por alterações nas condições do bem após a análise.</p>

        <h2 style={h2}>5. Cancelamento</h2>
        <p>O usuário pode cancelar a assinatura a qualquer momento, respeitada eventual fidelidade contratada. O acesso permanece ativo até o fim do ciclo já pago.</p>

        <h2 style={h2}>6. Contato</h2>
        <p>Dúvidas sobre estes termos podem ser enviadas para <a href="mailto:privacidade@bidprobrasil.com.br" style={{ color: '#0D63DB', fontWeight: 700 }}>privacidade@bidprobrasil.com.br</a>.</p>
      </div>
    </div>
  );
}
