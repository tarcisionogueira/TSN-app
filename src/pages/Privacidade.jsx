import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const wrap = { maxWidth: 820, margin: '0 auto', padding: '40px 20px 80px', color: '#334155', lineHeight: 1.7, fontSize: 15 };
const h2 = { fontSize: 20, fontWeight: 800, color: '#111111', margin: '32px 0 10px' };

export default function Privacidade() {
  const nav = useNavigate();
  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
      <div style={wrap}>
        <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 20 }}>
          <ArrowLeft size={16} /> Voltar
        </button>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: '#111111', margin: '0 0 6px' }}>Política de Privacidade (LGPD)</h1>
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Última atualização: junho de 2026</p>

        <p style={{ marginTop: 20 }}>Esta política descreve como a TSN Ativos (Nogueira Empreendimentos LTDA) coleta, usa e protege os dados pessoais dos seus usuários, em conformidade com a Lei nº 13.709/2018 (LGPD).</p>

        <h2 style={h2}>1. Dados que coletamos</h2>
        <p>Nome, e-mail, CPF, telefone e endereço informados no cadastro; dados de uso da plataforma; e informações dos imóveis que você analisa. Não coletamos dados sensíveis.</p>

        <h2 style={h2}>2. Finalidade do tratamento</h2>
        <p>Utilizamos seus dados para: criar e manter sua conta; processar assinaturas e emitir documentos fiscais; gerar análises e relatórios; e prestar suporte. A base legal é a execução do contrato e o seu consentimento, fornecido no momento do cadastro.</p>

        <h2 style={h2}>3. Compartilhamento</h2>
        <p>Compartilhamos dados apenas com prestadores essenciais à operação — processador de pagamentos (Asaas), infraestrutura (Supabase) e, quando aplicável, escritório jurídico parceiro para a assessoria contratada. Não vendemos seus dados.</p>

        <h2 style={h2}>4. Seus direitos</h2>
        <p>Você pode, a qualquer momento, solicitar acesso, correção, portabilidade ou exclusão dos seus dados, bem como revogar o consentimento. Basta enviar um pedido para o contato abaixo.</p>

        <h2 style={h2}>5. Segurança e retenção</h2>
        <p>Adotamos medidas técnicas para proteger seus dados. Eles são mantidos enquanto a conta estiver ativa e pelo prazo exigido por obrigações legais e fiscais.</p>

        <h2 style={h2}>6. Encarregado (DPO) / Contato</h2>
        <p>Para exercer seus direitos ou tirar dúvidas sobre privacidade, contate <a href="mailto:tarcisioaraujo@reimob.com.br" style={{ color: '#0D63DB', fontWeight: 700 }}>tarcisioaraujo@reimob.com.br</a>.</p>
      </div>
    </div>
  );
}
