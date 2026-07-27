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
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Última atualização: julho de 2026</p>

        <h2 style={h2}>1. Sobre a plataforma</h2>
        <p>A BidPro Brasil é uma plataforma de análise de imóveis em leilão, operada por Nogueira Empreendimentos LTDA (CNPJ 02.311.492/0001-61). Os relatórios, análises de viabilidade e pareceres têm caráter informativo e de apoio à decisão, não constituindo garantia de resultado, recomendação de investimento ou parecer jurídico definitivo.</p>

        <h2 style={h2}>2. Análises geradas por inteligência artificial</h2>
        <p>Parte das análises (mercadológica, documental e jurídica preliminar) é gerada com apoio de inteligência artificial, que processa dados públicos do leilão e documentos que você fornece. A IA pode conter imprecisões ou omissões e não substitui a avaliação de um profissional. Nos planos com assessoria, a análise jurídica é conduzida e validada pela nossa equipe e por advogado parceiro. Você deve conferir as informações antes de qualquer decisão de arrematação.</p>

        <h2 style={h2}>3. Cadastro e conta</h2>
        <p>É permitido apenas um cadastro por pessoa, identificado por e-mail e CPF únicos. O usuário é responsável pela veracidade dos dados informados e pela guarda de suas credenciais de acesso. A assinatura é pessoal e intransferível.</p>

        <h2 style={h2}>4. Planos e pagamentos</h2>
        <p>Os planos pagos são cobrados de forma recorrente por meio dos nossos processadores de pagamento (Asaas e Mercado Pago), com PIX, boleto ou cartão. O usuário pode solicitar upgrade (cobrança proporcional da diferença) ou downgrade (ajuste de valor na próxima cobrança, mantendo os benefícios até lá) a qualquer momento. Planos com fidelidade têm o prazo mínimo informado no momento da contratação. A assessoria contratada rege-se também pelo contrato de prestação de serviços assinado no ato da contratação.</p>

        <h2 style={h2}>5. Responsabilidades</h2>
        <p>As decisões de arrematação são de exclusiva responsabilidade do usuário. A BidPro Brasil não se responsabiliza por prejuízos decorrentes de informações de terceiros (editais, leiloeiros, órgãos públicos) ou por alterações nas condições do bem após a análise.</p>

        <h2 style={h2}>6. Cancelamento</h2>
        <p>O usuário pode cancelar a assinatura a qualquer momento, respeitada eventual fidelidade contratada. O acesso permanece ativo até o fim do ciclo já pago.</p>

        <h2 style={h2}>7. Propriedade intelectual e uso aceitável</h2>
        <p>Os relatórios, análises, cursos e materiais disponibilizados são de propriedade da BidPro Brasil e destinam-se ao uso pessoal do assinante — é vedada a revenda, redistribuição ou uso comercial sem autorização. O usuário compromete-se a não realizar coleta automatizada (scraping), engenharia reversa, uso indevido de credenciais ou qualquer atividade que comprometa a segurança e o funcionamento da plataforma. Ao enviar documentos (editais, matrículas, certidões), o usuário declara ter direito de fazê-lo e autoriza seu processamento para gerar as análises contratadas.</p>

        <h2 style={h2}>8. Programa de Parceiros (indicação)</h2>
        <p>Assinantes ativos podem aderir ao Programa de Parceiros da BidPro Brasil para indicar novas pessoas e ser recompensados por indicações efetivamente pagas e não estornadas, nas condições do <strong>Termo de Adesão do Programa</strong> (aceito à parte) e da Política de Privacidade. A recompensa não incide sobre honorários de êxito nem sobre recarga de créditos. Os pagamentos ao parceiro são realizados a uma <strong>pessoa jurídica (PJ)</strong> da qual ele seja sócio, mediante nota fiscal — o parceiro é o único responsável pelos tributos sobre os valores que receber. Ao visualizar dados de seus indicados, o parceiro atua como <strong>corresponsável</strong> pelo tratamento (LGPD), utilizando-os apenas para o relacionamento comercial legítimo com o próprio indicado.</p>
        <p><strong>8.1. Crédito condicionado e caducidade por inatividade.</strong> As comissões creditadas ao parceiro constituem <strong>crédito condicionado</strong> ao cumprimento das condições de recebimento: manutenção da empresa (PJ) regular, dados cadastrais atualizados e compatíveis com o quadro societário do CNPJ, e solicitação de saque. Identificada divergência cadastral — por exemplo, o CPF do parceiro deixar de constar no quadro societário, ou o CNPJ tornar-se irregular —, o repasse fica retido e o parceiro é <strong>notificado imediatamente</strong> para atualizar os dados, com <strong>novas notificações ao longo do período</strong>. Persistindo a pendência por <strong>90 (noventa) dias corridos</strong> sem atualização dos dados nem solicitação de saque, e após os avisos, os valores serão considerados em <strong>abandono</strong> e <strong>caducarão em favor da BidPro Brasil</strong>. Qualquer atualização cadastral, revalidação ou saque <strong>interrompe</strong> a contagem. Em caso de comprovado equívoco, o parceiro pode solicitar a reanálise pelo suporte.</p>

        <h2 style={h2}>9. Contato</h2>
        <p>Dúvidas sobre estes termos podem ser enviadas para <a href="mailto:privacidade@bidprobrasil.com.br" style={{ color: '#0D63DB', fontWeight: 700 }}>privacidade@bidprobrasil.com.br</a>.</p>
      </div>
    </div>
  );
}
