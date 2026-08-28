import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, Check, ArrowRight, Share2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

// ── Termo de ADESÃO ao Programa de Parceiros (FONTE ÚNICA) ────────────────────
// Definido aqui e reutilizado por HomeCliente, Atendimento (equipe) e LeiloeiroPortal.
// Só indica/recebe quem aceitar. (Sem revelar percentuais: estrutura comercial reservada.)
// v7 (15/08/2026) — ALINHA O TERMO À REGRA QUE JÁ VALE NO SERVIDOR.
//
// Os itens 2 e 4 ainda descreviam o desenho ANTERIOR a 08/08: exigiam assinatura ativa para
// PARTICIPAR e diziam que a comissão só era devida se, na data da cobrança do indicado, a
// assinatura do parceiro estivesse em dia. `regra_negocio.comissao.gratis_ganha`, aplicada por
// `pode_ganhar_comissao()`, diz o contrário desde 08/08: o parceiro gratuito GANHA em todos os
// fluxos, sem teto de ganho — a exigência de plano pago (mais nota fiscal) só aparece no SAQUE,
// acima do teto mensal. Conferido no banco: `pode_ganhar_comissao('explorador')` = true.
//
// Era um termo que prometia menos do que o sistema entrega, na cara de quem está decidindo
// entrar. Decisão do dono (15/08): "qualquer um pode ser parceiro e qualquer um pode indicar e
// ganhar; a partir de R$ 2.500 por mês precisa ser pagante e carregar a nota fiscal".
//
// A VERSÃO SOBE, MAS NINGUÉM É OBRIGADO A RE-ACEITAR — e isso é proposital. `aceitar_parceria()`
// devolve a data existente sem tocar em `parceiro_aceite_versao` quando já houve aceite, e o
// gate de saque olha os TERMOS DE USO da plataforma (`saque.exige_termos_vigentes`), não este
// termo. Então subir aqui registra a versão nova para quem aceitar de agora em diante, preserva
// a versão de quem já aceitou (que é o correto para auditoria) e não trava saque de ninguém.
export const TERMO_PARCEIRO_VERSAO = 'v8-2026-08';

// ⚠️ O "R$ 2.500,00" do item 5 é uma CÓPIA de `regra_negocio.saque.teto_sem_nf` (campo `valor`).
// Aqui a cópia é inevitável e correta: termo jurídico precisa do número por extenso, não de um
// ponteiro. Mas é cópia, e cópia envelhece — então quem mudar o teto no banco tem de subir a
// versão deste termo no MESMO commit, como se faz com migração e função. Consulta para conferir:
//   select valor->>'valor' from regra_negocio where chave = 'saque.teto_sem_nf';
//
// ⚠️ MESMA REGRA para os PERCENTUAIS do item 3, escritos em 28/08 a pedido do dono. Até a v7 o
// termo não citava número nenhum — e dizia, por escrito, que NÃO havia recompensa sobre
// honorários de êxito, o que passou a ser falso quando o parceiro entrou no split (1% do
// arremate). Termo que contradiz o que o sistema paga é pior que termo omisso: é promessa
// escrita valendo contra a empresa. As duas fontes de verdade a conferir antes de mexer:
//   select tipo, nivel, pct from comissao_regras where ativo order by tipo, nivel;  -- assinatura / venda_direta
//   select titulo, comissao_pct from cursos_admin union all select titulo, comissao_pct from ebooks_admin;
//   select total_pct, advogado_pct, analista_pct, consultor_pct from config_honorarios where id = 1;
export const TERMO_PARCEIRO_PREAMBULO = 'Este Termo de Adesão rege sua participação no Programa de Parceiros da BidPro Brasil (indicação/afiliação) e complementa os Termos de Uso e a Política de Privacidade da plataforma. Ao aceitar, você concorda com as condições abaixo.';
export const TERMO_PARCEIRO = [
  { t: '1. Natureza da relação', d: 'O Programa é de indicação/afiliação. Você atua de forma autônoma, por conta e risco próprios e sem exclusividade. Este Termo NÃO cria vínculo empregatício, societário, de representação comercial ou de sociedade com a BidPro Brasil.' },
  { t: '2. Elegibilidade', d: 'QUALQUER pessoa cadastrada pode ser parceira, inclusive no plano gratuito: não é preciso ter assinatura para participar, indicar nem para ganhar comissão. Para participar você deve ser maior de 18 anos e ter um cadastro completo e verídico (nome, CPF, telefone). Para RECEBER, é necessário cadastrar uma empresa (pessoa jurídica) da qual você seja sócio — ver item 5. Você é INTEGRAL e exclusivamente responsável pela veracidade e autenticidade das informações e documentos que fornecer. Para a sua segurança e a da plataforma, a verificação de identidade (selfie + documento) pode ser exigida; ao enviá-la, você autoriza a coleta e o armazenamento dessas imagens para prevenção à fraude e auditoria. Dados falsos impedem o pagamento e podem encerrar a participação.' },
  { t: '3. Como você é recompensado', d: 'A recompensa incide sobre pagamentos efetivamente realizados e não estornados por pessoas que você indicar. Sobre o valor pago, os percentuais da sua indicação DIRETA são: (a) ASSINATURAS da plataforma — 25%, a cada cobrança paga, enquanto a assinatura durar; (b) CURSOS e E-BOOKS — 25%; (c) ASSESSORIA e LEILÃO CLUB — 10%; (d) ÊXITO DE ARREMATAÇÃO — 10% do honorário de êxito recebido pela BidPro Brasil, o que hoje corresponde a 1% do valor arrematado, já que o honorário é de 10% sobre a arrematação. Em ASSINATURAS e em ASSESSORIA/LEILÃO CLUB você também recebe pelas indicações feitas pela sua REDE abaixo, em percentuais menores por nível, exibidos na tela "Indicações"; em CURSOS/E-BOOKS e no ÊXITO a recompensa é apenas da indicação direta. NÃO há recompensa sobre recarga de créditos. Os percentuais podem ser alterados na forma do item 9.' },
  { t: '4. Condições e estorno', d: 'A comissão é devida pelas cobranças efetivamente pagas pelos seus indicados (e pela rede abaixo), INDEPENDENTEMENTE de você ter ou não uma assinatura: o parceiro no plano gratuito ganha do mesmo modo, e não há teto para o quanto se pode GANHAR. A condição de plano pago aparece apenas no SAQUE, e só acima do teto mensal — ver item 5. O vínculo do indicado com você permanece. Valores relativos a pagamentos posteriormente cancelados, estornados (chargeback) ou identificados como fraude são estornados do seu saldo e podem ser descontados de pagamentos seguintes.' },
  { t: '5. Pagamento (modelo B2B / pessoa jurídica)', d: 'Os repasses são pagos por PIX, semanalmente (às sextas-feiras), após conferência, para a conta de uma EMPRESA (pessoa jurídica) da qual você é sócio, mediante as condições abaixo. ATÉ R$ 2.500,00 por mês-calendário, o saque NÃO exige nota fiscal nem plano pago — vale para o parceiro gratuito. ACIMA desse valor no mesmo mês, passam a ser exigidos (a) assinatura paga ativa e (b) nota fiscal do VALOR INTEGRAL já sacado no mês somado ao pedido atual, e não apenas do excedente. Para liberar o saque, você cadastra o CNPJ, a razão social e a chave PIX da empresa, ANEXA o contrato social (ou documento equivalente) e DECLARA ser sócio da empresa informada — o que é conferido junto ao quadro societário da Receita Federal. O primeiro saque pode ser liberado automaticamente quando essa conferência confirmar que você é sócio; os saques seguintes passam por conferência manual da nossa equipe. Se a titularidade não for comprovada, o saque é bloqueado até o envio da documentação correta. Caso ainda não tenha empresa, é possível abrir um MEI. Enquanto a empresa não estiver cadastrada e validada, o saldo apurado fica retido e disponível para saque assim que a validação for concluída.' },
  { t: '6. Tributos', d: 'Os valores são pagos à sua empresa contra nota fiscal; os tributos incidentes são de responsabilidade exclusiva do parceiro/da sua empresa, conforme a legislação aplicável.' },
  { t: '7. Conduta e anti-fraude', d: 'Você se compromete a indicar de forma honesta e lícita, sendo VEDADO: spam, autoindicação, contas falsas, informações enganosas, uso indevido da marca e captação em canais não autorizados. A violação acarreta o cancelamento das comissões relacionadas e a exclusão do Programa.' },
  { t: '8. Proteção de dados (LGPD)', d: 'O tratamento segue a Lei nº 13.709/2018 (LGPD) e a Política de Privacidade da BidPro Brasil. Na tela "Indicações" você visualiza: (a) dos seus INDICADOS DIRETOS — pessoas que você mesmo trouxe (sua venda direta) — nome, cidade/UF e CONTATO (telefone e e-mail), para o relacionamento comercial legítimo com quem você indicou; (b) da REDE ABAIXO deles (indicações feitas pelos seus próprios indicados) — apenas NOME e CIDADE/UF, nunca contato. Esses dados são disponibilizados só para você conduzir e acompanhar o Programa: ao acessá-los você atua como CORRESPONSÁVEL pelo tratamento e se compromete a usá-los exclusivamente para esse fim, respeitando a LGPD, não os repassando a terceiros nem os usando para outra finalidade. Para prevenção a fraudes, registramos metadados do seu aceite e transações (data/hora, IP e dispositivo).' },
  { t: '9. Alterações do Programa', d: 'A BidPro Brasil pode alterar regras, condições e percentuais do Programa mediante aviso prévio razoável pelos canais oficiais. A continuidade da participação após o aviso implica concordância.' },
  { t: '10. Vigência e encerramento', d: 'A adesão vigora por prazo indeterminado. Qualquer das partes pode encerrar a participação a qualquer tempo; o encerramento não prejudica comissões já apuradas de boa-fé até a data.' },
  { t: '11. Legislação e foro', d: 'Aplica-se a legislação brasileira. Fica eleito o foro do domicílio do parceiro para dirimir controvérsias, sem prejuízo das normas de proteção ao consumidor, quando aplicáveis.' },
  { t: '12. Verificação, responsabilidade e auditoria', d: 'Você declara serem verdadeiros e autênticos todos os dados e documentos enviados (identidade, contrato social, nota fiscal e dados da empresa), assumindo integral responsabilidade civil e penal por eles. As imagens e documentos são armazenados de forma segura para prevenção à fraude, cumprimento de obrigações legais e eventual auditoria ou questionamento posterior. A prestação de informação falsa, ou a interposição de pessoa/empresa da qual você não seja efetivamente sócio, acarreta o bloqueio dos valores, o cancelamento da participação e as medidas legais cabíveis.' },
];

// Modal do termo — extraível p/ reuso. onAceitar recebe o clique de "Aceitar e ativar".
export function TermoParceiroModal({ onFechar, onAceitar, concordo, setConcordo, aceitando }) {
  return (
    <div onClick={() => !aceitando && onFechar()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 18, padding: 24, width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Gift size={20} color="#0D63DB" />
          <div style={{ fontSize: 18, fontWeight: 900, color: '#084BA6' }}>Programa de Parceiros</div>
        </div>
        <p style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>{TERMO_PARCEIRO_PREAMBULO}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {TERMO_PARCEIRO.map((c, i) => (
            <div key={i} style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.6 }}>
              <strong style={{ color: '#111' }}>{c.t}.</strong> {c.d}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.6, marginBottom: 14 }}>
          Este termo complementa os <a href="#/termos" target="_blank" rel="noreferrer" style={{ color: '#7c3aed', fontWeight: 700 }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" rel="noreferrer" style={{ color: '#7c3aed', fontWeight: 700 }}>Política de Privacidade</a>. Versão {TERMO_PARCEIRO_VERSAO}.
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
          <input type="checkbox" checked={concordo} onChange={e => setConcordo(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer' }} />
          <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>Li e concordo com o Termo de Adesão ao Programa de Parceiros.</span>
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => !aceitando && onFechar()} disabled={aceitando}
            style={{ flex: '0 0 auto', padding: '11px 18px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: aceitando ? 'default' : 'pointer' }}>
            Agora não
          </button>
          <button onClick={onAceitar} disabled={!concordo || aceitando}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: (!concordo || aceitando) ? '#93c5fd' : '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: (!concordo || aceitando) ? 'default' : 'pointer' }}>
            <Check size={15} /> {aceitando ? 'Ativando…' : 'Aceitar e ativar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Card compacto "Programa de Parceiros" p/ telas de equipe/leiloeiro: convida a virar
// parceiro (com o termo) ou, se já for, leva ao link de venda (Minha Rede).
export default function ConviteParceiro({ maxWidth = 1100, style }) {
  const nav = useNavigate();
  const { user, effectiveRole } = useAuth();
  const [aceite, setAceite] = useState(undefined); // undefined=carregando · null=não · ts=sim
  const [showTermo, setShowTermo] = useState(false);
  const [concordo, setConcordo] = useState(false);
  const [aceitando, setAceitando] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    supabase.from('perfis').select('parceiro_aceite_em').eq('id', user.id).maybeSingle()
      .then(({ data }) => { if (vivo) setAceite(data?.parceiro_aceite_em || null); })
      .catch(() => { if (vivo) setAceite(null); });
    return () => { vivo = false; };
  }, [user?.id]);

  const aceitar = async () => {
    if (!concordo || aceitando) return;
    setAceitando(true);
    try {
      const { data, error } = await supabase.rpc('aceitar_parceria', { p_versao: TERMO_PARCEIRO_VERSAO });
      if (!error) {
        setAceite(data || new Date().toISOString()); setShowTermo(false);
        // Avisa o Header (mostra "Indicações" na hora) e o modal de KYC do parceiro (pede
        // selfie+documento). Sem isto, o menu só atualizava no próximo login.
        window.dispatchEvent(new Event('tsn:parceiro-atualizado'));
        nav('/minha-rede');
      }
    } finally { setAceitando(false); }
  };

  // Admin já tem tudo; enquanto carrega o estado, não pisca nada.
  if (effectiveRole === 'admin' || aceite === undefined) return null;

  const jaParceiro = !!aceite;

  return (
    <div style={{ maxWidth, margin: '0 auto 16px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'linear-gradient(135deg, #eff6ff 0%, #e0ecff 100%)', border: '1px solid #bfdbfe', borderRadius: 14, padding: '14px 18px' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#0D63DB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Gift size={20} color="white" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14.5, fontWeight: 900, color: '#084BA6' }}>Programa de Parceiros</div>
          <div style={{ fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.5 }}>
            {jaParceiro
              ? 'Você já é parceiro. Pegue seu link de venda e acompanhe suas indicações.'
              : 'Indique investidores e ganhe comissões. Ative sua participação e libere seu link de venda.'}
          </div>
        </div>
        {jaParceiro ? (
          <button onClick={() => nav('/minha-rede')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
            <Share2 size={15} /> Meu link de venda <ArrowRight size={15} />
          </button>
        ) : (
          <button onClick={() => { setConcordo(false); setShowTermo(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
            <Gift size={15} /> Quero ser parceiro
          </button>
        )}
      </div>

      {showTermo && (
        <TermoParceiroModal
          onFechar={() => setShowTermo(false)}
          onAceitar={aceitar}
          concordo={concordo}
          setConcordo={setConcordo}
          aceitando={aceitando}
        />
      )}
    </div>
  );
}
