// Integração Homio (11/11): leitura do corpo do webhook, segredo, token de ativação e decisão do link.
// Sem rede e sem banco — só as regras de api/_homio.js.
import { lerLeadHomio, campanhaDe, segredoConfere, tokenAtivacao, hashToken, decidirAtivacao, corpoAvisoHomio } from '../../api/_homio.js';

let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const passou = JSON.stringify(a) === JSON.stringify(b); passou ? ok++ : falhas++; if (!passou) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

// 1. Formato "webhook padrão" (contato inteiro, nomes em inglês, atribuição aninhada)
const padrao = lerLeadHomio({
  contact_id: 'abc123', first_name: 'Maria', last_name: 'da Silva', email: ' Maria@Exemplo.com.BR ', phone: '+55 71 99876-5432',
  contact: { attributionSource: { utmSource: 'instagram', utmCampaign: 'lancamento-26-11', fbclid: 'XYZ' } },
});
eq('padrão: e-mail minúsculo e sem espaço', padrao.email, 'maria@exemplo.com.br');
eq('padrão: nome = first + last', padrao.nome, 'Maria da Silva');
eq('padrão: telefone cru (a régua do cadastro normaliza na rota)', padrao.telefone, '+55 71 99876-5432');
eq('padrão: contact_id', padrao.contactId, 'abc123');
eq('padrão: utm da atribuição aninhada', padrao.utm, { utm_source: 'instagram', utm_campaign: 'lancamento-26-11', fbclid: 'XYZ' });
eq('padrão: nada faltando', padrao.faltando, []);

// 2. Formato "webhook personalizado" em português, dentro de `contact`
const pt = lerLeadHomio({ contact: { id: 'c9', nome: 'João   Souza', email: 'joao@x.com', whatsapp: '71988887777' }, utm_source: 'google' });
eq('pt: nome com espaço duplo limpo', pt.nome, 'João Souza');
eq('pt: whatsapp vira telefone', pt.telefone, '71988887777');
eq('pt: contact.id como contact_id', pt.contactId, 'c9');
eq('pt: utm solta no nível de cima', pt.utm, { utm_source: 'google' });

// 2b. Cidade e UF (opcionais)
const base = { name: 'Ana Lima', phone: '71988887777' };
const comCidade = lerLeadHomio({ ...base, email: 'a@b.com', city: 'Feira de Santana', state: 'ba' });
eq('cidade + UF minúscula viram sigla', [comCidade.cidade, comCidade.uf], ['Feira de Santana', 'BA']);
const ufRuim = lerLeadHomio({ ...base, email: 'a@b.com', cidade: 'Salvador', estado: 'Bahia' });
eq('UF por extenso não vale: cidade descartada junto', [ufRuim.cidade, ufRuim.uf], ['', '']);
const soUf = lerLeadHomio({ ...base, email: 'a@b.com', uf: 'SP' });
eq('UF sem cidade não grava UF solta', [soUf.cidade, soUf.uf], ['', '']);
eq('sem cidade não é obrigatório', soUf.faltando, []);

// 3. Obrigatórios: nome, e-mail e telefone (presença; formato o popup corrige)
eq('sem e-mail', lerLeadHomio({ ...base }).faltando, ['email']);
eq('e-mail sem domínio', lerLeadHomio({ ...base, email: 'ana@' }).faltando, ['email']);
eq('sem nome', lerLeadHomio({ email: 'a@b.com', phone: '71988887777' }).faltando, ['nome']);
eq('sem telefone', lerLeadHomio({ email: 'a@b.com', name: 'Ana Lima' }).faltando, ['telefone']);
eq('telefone só com lixo', lerLeadHomio({ email: 'a@b.com', name: 'Ana Lima', phone: '---' }).faltando, ['telefone']);
eq('só o primeiro nome passa (o popup pede o sobrenome)', lerLeadHomio({ email: 'a@b.com', name: 'Ana', phone: '71988887777' }).faltando, []);
eq('corpo nulo lista os três', lerLeadHomio(null).faltando, ['nome', 'email', 'telefone']);

// 4. Campanha vem da URL e é saneada
eq('campanha padrão', campanhaDe(''), 'lancamento');
eq('campanha saneada', campanhaDe('Lancamento 26/11!'), 'lancamento2611');

// 5. Segredo: igual passa; diferente, vazio ou não configurado recusa (falha fechada)
eq('segredo igual', segredoConfere('s3gr3d0-longo', 's3gr3d0-longo'), true);
eq('segredo diferente', segredoConfere('s3gr3d0-longX', 's3gr3d0-longo'), false);
eq('segredo vazio recebido', segredoConfere('', 's3gr3d0-longo'), false);
eq('segredo não configurado', segredoConfere('qualquer', ''), false);

// 6. Token: determinístico por lead, muda com lead e com segredo, hash bate
const t1 = tokenAtivacao('lead-1', 'seg');
eq('token determinístico', tokenAtivacao('lead-1', 'seg').token, t1.token);
eq('token muda com o lead', tokenAtivacao('lead-2', 'seg').token === t1.token, false);
eq('token muda com o segredo', tokenAtivacao('lead-1', 'outro').token === t1.token, false);
eq('hash do token', hashToken(t1.token), t1.hash);
eq('token cabe no filtro da rota de ativação', /^[A-Za-z0-9_-]{30,100}$/.test(t1.token), true);
eq('sem segredo não gera token', tokenAtivacao('lead-1', ''), null);

// 7. Decisão do link de ativação
const agora = Date.parse('2026-11-20T12:00:00Z');
const lead = { user_id: 'u1', token_expira_em: '2026-12-10T00:00:00Z' };
eq('pendente e no prazo → gera link', decidirAtivacao(lead, agora, true), 'gerar_link');
eq('senha já definida → login', decidirAtivacao(lead, agora, false), 'login');
eq('vencido → expirado', decidirAtivacao({ ...lead, token_expira_em: '2026-11-01T00:00:00Z' }, agora, true), 'expirado');
eq('senha definida vale mesmo vencido', decidirAtivacao({ ...lead, token_expira_em: '2026-11-01T00:00:00Z' }, agora, false), 'login');
eq('sem lead → inválido', decidirAtivacao(null, agora, true), 'invalido');
eq('lead sem conta → inválido', decidirAtivacao({ token_expira_em: null }, agora, true), 'invalido');

// 8. Aviso à Homio: link só no conta_criada
const l = { campanha: 'lancamento', email: 'a@b.com', nome: 'A B', telefone: null, homio_contact_id: 'h1' };
eq('conta_criada leva o link', corpoAvisoHomio('conta_criada', l, 'https://x/ativar').link_ativacao, 'https://x/ativar');
eq('conta_ativada não leva link', 'link_ativacao' in corpoAvisoHomio('conta_ativada', l, 'https://x/ativar'), false);
eq('aviso leva o contact_id da Homio', corpoAvisoHomio('ja_tinha_conta', l).contact_id, 'h1');

console.log(`homio-lead: ${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
