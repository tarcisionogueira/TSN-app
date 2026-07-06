import { getUser, getUserRole } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { anthropicFetch } from './_claude.js';
import { sanitizeText, sanitizeName } from './_sanitize.js';
import { alertarErro } from './_error-alert.js';
import { enviarEmail } from './_email.js';
import { randomUUID } from 'node:crypto';

// Dados fixos da empresa contratante
const EMPRESA = {
  razao_social: 'NOGUEIRA EMPREENDIMENTOS LTDA',
  cnpj: '02.311.492/0001-61',
  cidade: 'Feira de Santana',
  estado: 'BA',
  foro: 'Feira de Santana/BA',
};

// Padrões legais brasileiros por tipo de contrato — evita perguntas desnecessárias
const PADROES = {
  nda: {
    prazo_sigilo: '5 (cinco) anos a contar da data de assinatura',
    valor: null, // NDA geralmente não tem valor
    rescisao_aviso: null,
    legislacao: 'Lei nº 9.609/1998 (Software), Lei nº 13.709/2018 (LGPD), Código Civil Brasileiro',
  },
  servico: {
    prazo_padrao: 'indeterminado, podendo ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias',
    pagamento_padrao: 'mensalmente, até o dia 10 do mês subsequente ao da prestação',
    multa_rescisao: '10% (dez por cento) sobre o valor total do contrato',
    legislacao: 'Código Civil Brasileiro (Arts. 593-609)',
  },
  prestacao: {
    prazo_padrao: 'indeterminado, podendo ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias',
    pagamento_padrao: 'mensalmente, até o dia 10 do mês subsequente ao da prestação',
    multa_rescisao: '10% (dez por cento) sobre o valor total do contrato',
    legislacao: 'Código Civil Brasileiro (Arts. 593-609)',
  },
  locacao: {
    prazo_padrao: '12 (doze) meses',
    reajuste: 'anualmente pelo IGP-M/FGV ou IPCA/IBGE, o que for menor',
    multa_rescisao: '3 (três) aluguéis vigentes, proporcionais ao tempo restante',
    legislacao: 'Lei nº 8.245/1991 (Lei do Inquilinato)',
  },
  compra: {
    prazo_escritura: '30 (trinta) dias após a quitação total do preço',
    multa_rescisao: '10% (dez por cento) sobre o valor do negócio',
    legislacao: 'Código Civil Brasileiro (Arts. 481-532)',
  },
};

export default async function handler(req, res) {
  const ip = getIP(req);
  const rl = checkRateLimit(`gerar-contrato:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const {
    descricao: descricaoRaw, tipo, titulo: tituloRaw, arquivos = [], respostas,
    // Novo fluxo CriarContrato
    conteudo: conteudoDireto, emailAssinante, verificacaoIdentidade, arquivosReferencia, geradoPorIA,
    // Reformulação: multi-signatário + atribuição a plano/produto + testemunha + partes
    signatarios, planoKey, produtoTipo, produtoId, partes, requerTestemunha,
  } = req.body || {};

  // Normaliza a lista de signatários: um LINK POR ASSINANTE (cada um assina o seu).
  // Aceita o formato novo (signatarios: [{nome,email}]) e o antigo (emailAssinante).
  const listaSign = (Array.isArray(signatarios) && signatarios.length
    ? signatarios
    : (emailAssinante ? [{ email: emailAssinante }] : []))
    .map(s => ({ nome: sanitizeText(s?.nome || '', 120) || null, email: sanitizeText(s?.email || '', 200) }))
    .filter(s => /\S+@\S+\.\S+/.test(s.email))
    .slice(0, 10);

  // Fluxo direto: conteúdo já pronto (assinar documento existente ou contrato gerado pela IA no frontend)
  if (conteudoDireto && listaSign.length) {
    try {
      const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const tituloFinal = sanitizeText(tituloRaw, 200) || 'Contrato';
      const { arquivoUrl, arquivoNome, docsExtrasExigidos } = req.body || {};
      const grupoId = randomUUID();
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const partesLimpa = Array.isArray(partes)
        ? partes.map(p => ({ nome: sanitizeText(p?.nome || '', 160), qualificacao: sanitizeText(p?.qualificacao || '', 200) })).filter(p => p.nome).slice(0, 10)
        : null;

      const base = {
        titulo: tituloFinal,
        conteudo: conteudoDireto ? sanitizeText(conteudoDireto, 20000) : null,
        arquivo_url: arquivoUrl || null,
        arquivo_nome: arquivoNome ? sanitizeText(arquivoNome, 200) : null,
        tipo_contrato: tipo || 'servico',
        status: 'aguardando_assinatura',
        requer_assinatura: true,
        criado_por: user.id,
        verificacao_identidade: verificacaoIdentidade || 'nenhuma',
        docs_extras_exigidos: docsExtrasExigidos || [],
        arquivos_referencia: arquivosReferencia || [],
        gerado_por_ia: !!geradoPorIA,
        // Atribuição a um plano/produto (por CHAVE, não mais por título).
        plano_key: planoKey ? sanitizeText(planoKey, 60) : null,
        produto_tipo: produtoTipo ? sanitizeText(produtoTipo, 20) : null,
        produto_id: produtoId ? sanitizeText(produtoId, 60) : null,
        partes: partesLimpa,
        contrato_grupo_id: grupoId,
      };

      // Uma linha (token/link) por signatário.
      const rows = listaSign.map(s => ({ ...base, assinante_email: s.email }));
      const { data, error } = await supabase.from('contratos_link').insert(rows).select('token, assinante_email');
      if (error || !data?.length) return res.status(500).json({ error: 'Erro ao salvar contrato' });

      // Casa cada token com o nome/email e envia o link por e-mail a cada parte.
      const links = data.map(row => {
        const nome = listaSign.find(s => s.email === row.assinante_email)?.nome || null;
        return { nome, email: row.assinante_email, token: row.token, url: `${origin}#/c/${row.token}` };
      });
      await Promise.all(links.map(l =>
        enviarEmail({
          to: l.email,
          subject: `Contrato para assinatura: ${tituloFinal}`,
          html: `<p>Olá${l.nome ? ' ' + l.nome : ''}!</p><p>Você tem um contrato para revisar e assinar: <strong>${tituloFinal}</strong>.</p>
                 <p><a href="${l.url}" style="display:inline-block;padding:11px 20px;background:#0D63DB;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Abrir e assinar</a></p>
                 <p>Ou copie o link: ${l.url}</p><p>BidPro Brasil</p>`,
        }).catch(() => {})
      ));

      await auditLog({ acao: 'contrato_criado', user_id: user.id, ip, detalhes: { titulo: tituloFinal, signatarios: links.length, plano: planoKey || null, verificacao: verificacaoIdentidade }, sucesso: true });
      // Compat: mantém `token` (1º) e adiciona `links` (todos os assinantes).
      return res.status(200).json({ ok: true, token: links[0]?.token, grupo_id: grupoId, links });
    } catch (e) {
      console.error('[gerar-contrato direto]', e.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }

  if (!descricaoRaw) return res.status(400).json({ error: 'descricao obrigatória' });

  const descricao = sanitizeText(descricaoRaw, 5000);
  const titulo = sanitizeText(tituloRaw, 200);

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Chave de API não configurada' });

  // Busca últimos 3 contratos assinados como referência de estilo
  let ctxContratosAnteriores = '';
  try {
    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: anteriores } = await supabase
      .from('contratos_link')
      .select('titulo, conteudo')
      .eq('status', 'assinado')
      .order('assinado_em', { ascending: false })
      .limit(3);
    if (anteriores && anteriores.length > 0) {
      // Só o TÍTULO como referência de estilo — não injeta o corpo de contratos
      // anteriores no prompt (evita prompt-injection via dado salvo no banco).
      ctxContratosAnteriores = '\n\nTítulos de contratos anteriores aprovados (referência de estilo):\n' +
        anteriores.map((c, i) => `${i + 1}. ${String(c.titulo || '').slice(0, 120)}`).join('\n');
    }
  } catch (_) {}

  const tipoLabel = {
    servico: 'Prestação de Serviços',
    prestacao: 'Prestação de Serviços',
    locacao: 'Locação de Imóvel',
    compra: 'Compra e Venda de Imóvel',
    nda: 'Acordo de Confidencialidade e Não Divulgação (NDA)',
    outro: 'Contrato',
  }[tipo] || 'Prestação de Serviços';

  const padrao = PADROES[tipo] || {};

  const ctxArquivos = arquivos.length > 0
    ? '\n\nDocumentos de referência:\n' +
      arquivos.map(a => a.conteudo
        ? `--- ${a.nome} ---\n${a.conteudo}`
        : `• Referência: ${a.nome}`
      ).join('\n\n')
    : '';

  const ctxRespostas = respostas && Object.keys(respostas).length > 0
    ? '\n\nRespostas fornecidas pelo contratante:\n' + Object.values(respostas).map((r, i) => `${i+1}. ${r}`).join('\n')
    : '';

  const ctxPadroes = Object.keys(padrao).length > 0
    ? `\nParâmetros legais padrão para este tipo de contrato (use diretamente se não conflitar com a descrição):\n` +
      Object.entries(padrao).filter(([k]) => k !== 'legislacao').map(([k, v]) => v ? `• ${k}: ${v}` : null).filter(Boolean).join('\n')
    : '';

  const prompt = `Tipo de contrato: ${tipoLabel}
Título: ${titulo || tipoLabel}
Descrição: ${descricao}
${ctxArquivos}
${ctxRespostas}
${ctxPadroes}
${ctxContratosAnteriores}`;

  try {
    const response = await anthropicFetch({
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2500,
        system: `Você é o advogado interno da NOGUEIRA EMPREENDIMENTOS LTDA (CNPJ 02.311.492/0001-61), sediada em Feira de Santana/BA.

SEU TRABALHO: Redigir contratos completos, profissionais e juridicamente seguros.

DADOS FIXOS — use sempre, sem perguntar:
- Contratante: NOGUEIRA EMPREENDIMENTOS LTDA, CNPJ 02.311.492/0001-61, Feira de Santana/BA
- Foro: Comarca de Feira de Santana/BA (sempre, salvo instrução explícita)
- Comunicações e notificações urgentes: utilizar os dados de contato da própria parte (email e telefone informados no momento da assinatura)

REGRAS DE OURO:
1. Use padrões legais brasileiros para preencher lacunas — não pergunte o que a lei ou a prática já definem (prazo de rescisão padrão, multas usuais, legislação aplicável, etc.)
2. NUNCA use placeholder como [A DEFINIR] ou [INSERIR] — exceto para os dados do signatário abaixo
3. Os ÚNICOS placeholders permitidos no corpo do contrato são:
   [NOME DO SIGNATÁRIO], [CPF/CNPJ DO SIGNATÁRIO], [RG DO SIGNATÁRIO], [ENDEREÇO DO SIGNATÁRIO], [EMAIL DO SIGNATÁRIO]
4. NUNCA pergunte sobre dados pessoais do CONTRATADO/SIGNATÁRIO (nome, CPF, e-mail, endereço, empresa, representante, cargo, CNPJ, etc.). Esses dados são coletados pelo próprio signatário no momento da assinatura digital. Use os placeholders acima no corpo do contrato.
5. Pergunte SOMENTE se o valor monetário específico não foi informado e não há como inferir. Para tudo mais, use os padrões legais brasileiros.
6. NUNCA inclua "carimbo" nos campos de assinatura — apenas "Assinatura"
7. Use linguagem jurídica formal, sem markdown (sem **, sem ##, sem ---)
8. Cláusula de LGPD obrigatória quando envolver dados pessoais
9. Encerre com: "Feira de Santana, _____ de _____________ de 20____." seguido dos campos de assinatura de ambas as partes
10. Quando houver contratos anteriores aprovados como referência no prompt, siga o mesmo estilo, estrutura e padrão de linguagem deles.

FORMATO DE SAÍDA:
- Texto corrido do contrato (máximo 1000 palavras)
- Ao final, seção de perguntas SOMENTE se houver informação crítica e não inferível:

<<<PERGUNTAS>>>
(uma por linha, numeradas — apenas o essencial)
<<<FIM_PERGUNTAS>>>`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return res.status(502).json({ error: 'Erro ao gerar contrato' });
    }

    const data = await response.json();
    const texto = data.content?.[0]?.text || '';

    // Extrai perguntas
    const matchP = texto.match(/<<<PERGUNTAS>>>([\s\S]*?)<<<FIM_PERGUNTAS>>>/);
    const blocoPerguntas = matchP ? matchP[1].trim() : '';
    const perguntas = blocoPerguntas
      ? blocoPerguntas.split('\n').map(l => l.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean)
      : [];

    // Limpa texto: remove bloco de perguntas e formatação markdown
    const conteudo = texto
      .replace(/<<<PERGUNTAS>>>[\s\S]*?<<<FIM_PERGUNTAS>>>/, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/^#{1,4}\s*/gm, '')
      .replace(/^---+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return res.status(200).json({ conteudo, perguntas });
  } catch (e) {
    console.error('gerar-contrato error:', e.message);
    alertarErro({ rota: '/api/gerar-contrato', erro: e.message });
    return res.status(500).json({ error: 'Erro interno' });
  }
}
