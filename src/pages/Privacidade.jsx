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

        <h2 style={h2}>4. Seus direitos (LGPD Art. 18)</h2>
        <p>Em conformidade com o Art. 18 da LGPD, você tem os seguintes direitos em relação aos seus dados pessoais, exercíveis a qualquer momento:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li style={{ marginBottom: 8 }}><strong>Acesso e portabilidade:</strong> Você pode baixar uma cópia completa de todos os seus dados pessoais diretamente na página <strong>Meu Perfil</strong>, clicando em "Baixar meus dados". O arquivo é gerado instantaneamente no formato JSON.</li>
          <li style={{ marginBottom: 8 }}><strong>Retificação:</strong> Você pode corrigir seu nome a qualquer momento na página Meu Perfil. Para alteração de e-mail, entre em contato com o DPO.</li>
          <li style={{ marginBottom: 8 }}><strong>Exclusão (direito ao esquecimento):</strong> Você pode solicitar a exclusão da sua conta diretamente na página <strong>Meu Perfil</strong>, na seção "Seus Dados (LGPD)". Seus dados pessoais (nome, CPF, telefone) serão anonimizados imediatamente. Registros financeiros são mantidos pelo prazo legal (veja seção 5). Sua sessão será encerrada automaticamente.</li>
          <li style={{ marginBottom: 8 }}><strong>Revogação do consentimento:</strong> Você pode revogar o consentimento a qualquer momento, o que implicará na impossibilidade de uso dos serviços que dele dependem.</li>
          <li style={{ marginBottom: 8 }}><strong>Oposição:</strong> Você pode se opor ao tratamento de dados realizado com fundamento em legítimo interesse.</li>
        </ul>
        <p style={{ marginTop: 12 }}>Respondemos a solicitações de direitos no prazo de <strong>até 15 dias úteis</strong>, conforme previsto no Art. 18 da LGPD.</p>

        <h2 style={h2}>5. Segurança e retenção de dados</h2>
        <p>Adotamos medidas técnicas e organizacionais para proteger seus dados contra acesso não autorizado, perda ou destruição, incluindo criptografia em trânsito (TLS) e autenticação segura.</p>
        <p style={{ marginTop: 10 }}>Prazos de retenção:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li style={{ marginBottom: 6 }}><strong>Dados financeiros e registros de compras:</strong> mantidos por <strong>5 anos</strong> após o encerramento da conta, em cumprimento às obrigações legais e fiscais (Lei nº 9.613/98 e legislação tributária aplicável).</li>
          <li style={{ marginBottom: 6 }}><strong>Dados pessoais, histórico de buscas, alertas e filtros salvos:</strong> excluídos ou anonimizados imediatamente no encerramento da conta.</li>
          <li style={{ marginBottom: 6 }}><strong>Dados de suporte (chamados):</strong> mantidos por até 2 anos para fins de auditoria.</li>
        </ul>

        <h2 style={h2}>6. Encarregado pelo Tratamento de Dados (DPO)</h2>
        <p>Em cumprimento ao Art. 41 da LGPD, designamos um Encarregado pelo Tratamento de Dados Pessoais (Data Protection Officer — DPO). Para exercer seus direitos, esclarecer dúvidas sobre privacidade ou registrar reclamações, entre em contato:</p>
        <p style={{ marginTop: 10 }}>
          <strong>E-mail:</strong> <a href="mailto:tarcisioaraujo@reimob.com.br" style={{ color: '#0D63DB', fontWeight: 700 }}>tarcisioaraujo@reimob.com.br</a><br />
          <strong>Prazo de resposta:</strong> até 15 dias úteis (LGPD Art. 18, §5º)
        </p>
      </div>
    </div>
  );
}
