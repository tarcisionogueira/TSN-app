# Triagem das pendências do HANDOFF — 03/10/2026

**Para o dono revisar.** Responda com os números que devem ENTRAR na lista oficial (`pendencias_projeto`),
os que pode DESCARTAR, ou "todos os P2 de captura" etc. Nada daqui está na lista ainda.

## Como foi feito

- 608 menções de "pendente/pendência" em 370 seções do `docs/HANDOFF.md`, lidas em 4 lotes com 3 linhas de contexto.
- Classificação: **218** não eram ação (narrativa/termo do domínio) · **181** resolvidas (com evidência no HANDOFF ou código) · **45** obsoletas · **113** abertas · **51** incertas (só o banco responde) → agrupadas em **120 itens**.
- Conferido no banco antes de entrar: o P0 "contratos assinados cortados" era **falso** (teste interno, invariante = 0); Índice, fila do Mercado Pago e reuniões paradas já estavam **resolvidos**.
- **14 itens P1 já entraram** na lista oficial (decisões/ações suas: segurança, jurídico, Meta, analista, GRUPOLANCE 236 lotes, venda Top2 presa…).
- Restam **102 itens P2/P3** abaixo. Classe: **A** = aberta (sem evidência de conclusão) · **I** = incerta (precisa conferir no banco). Responsável: dono ou claude.

⚠️ A triagem por agente erra (o P0 era falso). Item aprovado aqui ainda passa pela consulta de prova antes de entrar.

## Cliente

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 37 | P2 | I | claude | Testar o ímã 'avise-me' ponta a ponta em produção | Confirmar e-mail de confirmação (duplo opt-in) e 1º disparo do alertas-publicos-cron (14h UTC); estava com 0 inscritos e sem teste por bloqueio de proxy. | 18003, 18056 |
| 38 | P2 | I | dono | Regerar o mercadológico do lote 1d117f3c (Vila Velha/ES) | Único lote por trás dos alertas analise_sem_mercadologico e laudo_sem_base; o cron de regeração só olha 72h e o lote é de 31/07. Um clique em Gerar resolve. | 19847 |
| 39 | P2 | I | claude | Parceiros com KYC incompleto (Kaique, Álvaro, Jaqueline) | Popup cobra selfie/documento no próximo acesso; sem confirmação de que concluíram. | 26400 |
| 40 | P2 | A | claude | Anexos pendurados no imóvel real invisíveis ao cliente (âncora) | Tela do cliente lê pelo imóvel âncora; documentos ligados ao imóvel real ficam invisíveis. Decisão registrada como pendente. | 30320 |
| 101 | P3 | I | dono | Ebook 'Lucre Antes de Arrematar': reenviar capa pelo Admin | Capa em branco; reenviar via Admin gera path novo. Não confirmado se o dono fez. | 7270 |
| 102 | P3 | A | claude | Instrumentar mais eventos de negócio no Cliente 360 | Promoção manual de role, edição de imóvel pela equipe etc. ficaram fora; fazer sob demanda. | 31877 |
| 103 | P3 | A | dono | Cadastro duplicado Fabrício Rodriguez/Rodrigues | Decidir manter ou remover o 1º cadastro (30/08). | 35627, 35696 |

## Financeiro

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 44 | P2 | A | dono | Decisão de comissão: advogado no Leilão Club e remuneração do analista | Comissão de 10% do advogado cobre só assessoria (Leilão Club ficou fora por ser R$6.000/venda) e analista está com percentual 0 e sem termo; ambos dependem de decisão do dono. | 15222, 15416 |
| 45 | P2 | A | claude | Double-click sem ref-guard síncrono em saque (Comissoes.jsx/MinhaRede.jsx) e cadastro grátis do Checkout | Risco baixo de solicitação duplicada de saque; backend usa advisory lock, mas a UI não trava com ref. | 26988 |
| 46 | P2 | I | dono | Asaas: reativar o webhook (gateway de backup) | Item do dono desde 18/07; confirmar que PAYMENT_CONFIRMED chega e o plano ativa pelo Asaas. | 27831, 27837 |
| 47 | P2 | I | dono | Testar a compra avulsa (ebook) ponta a ponta | Checkout avulso via Asaas e webhook foram construídos, mas o teste real pelo dono consta em PENDENCIAS_DONO e na lista de 31/08. | 27092 |
| 48 | P2 | A | dono | Plano Consultor Comercial §9: % de comissão, SLA do invariante de 2d, carteira | Decisões do dono: percentual de comissão (estrutura pronta em comissoes), SLA definitivo e se o consultor vê a carteira que indicou. | 29130 |
| 49 | P2 | I | dono | Antecipação Asaas: conferir recebido/taxas/a receber no Financeiro | Confirmar após uma antecipação real que fees, totalReceivable e extrato batem; custo ~2,7%. | 31363, 31824 |
| 50 | P2 | A | dono | Mercado Pago qualidade: pagamento real + 'Medir novamente' | Nota 47/100 (meta 73); precisa 1 pagamento real com pagador completo e o dono clicar Medir novamente. | 35236, 34667 |
| 51 | P2 | A | dono | Boleto Itaú pendente | Pendência financeira do dono citada sem detalhe. | 35490 |
| 106 | P3 | A | dono | Pluggy: confirmar se CNPJ cabe no Meu Pluggy gratuito | Conciliação bancária (Inter, C6, Bradesco, Caixa): se o plano gratuito aceitar CNPJ, custo zero; senão R$ 2.500/mês não se justifica e cai para API direta do banco ou OFX. | 23695, 23696, 23820 |
| 107 | P3 | A | claude | Pagamento em split no mp.js criarPreferencia não ativa o plano (dormente) | Cada parte cai em processarConfirmado com mapearPlano(valorParcial)=null. Nenhum front usa split hoje; exige desenho antes de ser ligado. | 26636 |

## Marketing

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 59 | P2 | A | dono | WhatsApp oficial: faltam envs e conexão do número | Código pronto (webhook, respondedor, cron). Falta o dono: coexistência do número, token permanente, WA_TOKEN/WA_PHONE_NUMBER_ID/WA_VERIFY_TOKEN na Vercel, webhook com www; depois WA_BOT_ATIVO=1 e modelos D+1/D+3. | 493 |
| 60 | P2 | A | dono | Backfill de ~54 cadastros históricos com gclid ao Google Ads | Fix de 18/09 vale só para cadastro novo; decisão do dono sobre enviar retroativamente via enviarCadastroOffline. | 1613, 1948 |
| 61 | P2 | A | dono | Google Ads: publicar app OAuth (refresh token de 7 dias em modo Teste) | Token expira a cada 7 dias em Teste; decidir publicar o app (verificação Google) ou regenerar. Também confirmar conversão de venda chegando ao Ads. | 2972, 2973, 3715 |
| 62 | P2 | A | dono | Instagram: Verificação de Negócio / Análise do app Meta e renovação do token | Automação de resposta depende de burocracia Meta (dono); vídeo de demonstração e 'Ir para Análise do app'; token expira em ~60 dias sem aviso nem renovação automática. | 3067, 6727, 6783 |
| 63 | P2 | A | claude | live_inscricoes.compareceu nunca é escrito | Presença na aula sem medição; sem rota /live nos eventos. Coluna existe mas nenhum código grava. | 7163 |
| 64 | P2 | I | claude | Instagram: nenhum evento real recebido; remover IG_APP_SECRET depois | ig_webhook_recebido tinha só 2 linhas de teste do console (02/09). Quando chegar DM/comentário real e a assinatura validar com IG_APP_SECRET_INSTAGRAM, remover IG_APP_SECRET de api/instagram-webhook.js (ainda aceita as d | 9738, 11676 |
| 65 | P2 | I | dono | Meta: confirmar encerramento das 4 contas de anúncio inativas | Encerramento é assíncrono e falhou na 1ª tentativa; a Central de Segurança ainda mostrava '4 contas inativas' e '5 sem aprovação'. Ler STATUS em Configurações do Negócio > Contas de anúncios; se reapareceram, é caso de s | 10229, 10236, 10291 |
| 66 | P2 | A | dono | Tag do Google no painel ainda 'Clube Conselheiro' e endereço no rodapé do anunciante | A tag está marcada URGENTE no Google Ads (renomear/abrir Gerenciar); o rodapé identifica razão social/CNPJ/contato mas falta o endereço (não existe no repo, não inventar). | 18613 |
| 111 | P3 | A | dono | SEO: título do lote, JSON-LD Product×RealEstateListing, SITEMAP_LOTES | Três decisões do dono não aplicadas por risco (33 mil páginas): sufixo 'lote xxxx', tipo do JSON-LD, sitemap de lotes desligado. | 7041, 7049 |
| 112 | P3 | A | dono | Google Merchant Center: escopo (e-books/cursos) e ManyChat/WhatsApp | Decidir escopo do Merchant Center antes de prometer prazo; retomar ManyChat próprio/WhatsApp Business. | 7652 |
| 113 | P3 | I | claude | Medir inscrições vindas do widget de convite em /leiloes | Widget de convite (Nome+WhatsApp+E-mail) do acervo aberto grava origem=acervo_aberto_leiloes. Decidir, com dado, se o bloco vai também para as páginas de UF/cidade. | 8435 |
| 114 | P3 | I | dono | Link da bio do Instagram sem UTM e OpenAI Ads sem evento de conversão | O link da live na bio não tinha UTM (inscrições entram como origem desconhecida); OpenAI Ads precisa registrar lead_created como conversão e crédito de US$100. | 15080 |
| 115 | P3 | A | dono | Cobertura comercial: Santana de Parnaíba, Barueri e Arujá (alta demanda, baixo estoque) | Priorizar fontes para essas cidades e avaliar alerta automático nas buscas de zero resultado. | 27837 |

## Jurídico

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 55 | P2 | I | claude | Documentais com consulta CNJ pendente (marcas cnj_nao_consultado) | 3 documentais ficaram marcados com CNJ não consultado em 01/10; juridico-retry deve completar. Confirmar que as marcas foram limpas. | 411 |
| 56 | P2 | A | dono | Telefone público da Nogueira/Reimob na Receita é o da contabilidade | Todo desafio de identidade externo (Meta, Google, banco, cartório) cai no telefone da contabilidade; atualizar o telefone cadastral da empresa. | 10332 |
| 57 | P2 | I | dono | Contratos: multa/rescisão de Assessoria e Leilão Club em planos_config divergem do texto | Texto da Assessoria dizia multa 10% com config=0; Leilão Club dizia 'integral' com config=30%. Falta definir o termo jurídico e contrato definitivo do Leilão Club (upgrade do TEMPLATE_CLUBE). | 27652, 27268, 27285 |
| 58 | P2 | A | claude | Jurídico: reatribuição grava antes do e-mail e pode perder a pasta | api/juridico-lembretes-cron.js (~L148) faz sbPatch da reatribuição antes de enviar o e-mail. Plano: gravar em dois tempos (reatribuicao_pendente -> envia -> efetiva), retomar pendências >30 min e usar o webhook do Resend | 21744, 21745 |
| 109 | P3 | A | claude | Contrato: imagens vão também na redação (custo 2x) - reavaliar | Decisão deliberada de 01/10 de mandar imagens à transcrição e à redação; ficou de reavaliar o custo. | 455 |
| 110 | P3 | A | dono | Junta Comercial: nome fantasia e objeto social ainda refletem CLUBE CONSELHEIRO | Cartão CNPJ ainda mostra Clube Conselheiro e o objeto social não menciona análise de imóveis. Ação com o contador. | 21642, 21994, 22159 |

## Segurança

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 68 | P2 | A | claude | npm audit: 1 vulnerabilidade high (sharp / libvips) | Em 10/09 eram 7; hoje npm audit acusa 1 high (sharp, CVEs libvips). Upgrade pede teste próprio. | 5602, 5603 |
| 69 | P2 | A | claude | Dívida de user.id cru no modo suporte (~151 leituras) e roteamento on-behalf | Só cota e escritas sinalizadas foram tratadas; solicitacoes/arremate pelo servidor com paraUserId segue bloqueado. | 28701 |
| 70 | P2 | I | claude | Reconferir falhas de login após Turnstile | Conferir eventos_atividade alvo=login_falha e last_sign_in_at depois de tráfego normal. | 31100 |
| 118 | P3 | A | claude | Trigger arrematacoes_protege_honorarios não protege honorarios_pago_em | Endurecer se código novo tocar arrematacoes fora do webhook/honorario-recebimento (service key). Hoje não é alcançável. | 2103 |
| 119 | P3 | A | claude | Fase autz: role do staff virar tier de plano (eh_funcao) | Migrar ~230 checagens de role (82 RLS + 33 funções + api + front) para eh_funcao(); sem impacto enquanto só o admin existe. | 18104 |

## Captura (leiloeiros, coleta)

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 22 | P2 | A | dono | data_leilao ausente: FERREIRALEIL (2%), PECINI, CEF | Recon esgotou rotas grátis; FERREIRALEIL só resolve com teste de IP residencial rodado pelo dono; PECINI exige OCR/IA paga por lote. Decisão/ação do dono. | 2207, 2209, 2445 |
| 23 | P2 | I | claude | Superbid: conferir galeria de fotos após rodada residencial (~05/10) | SUPERBID_GALERIA só roda no runner residencial semanal; conferir fotos>1 e contatos por tenant após a rodada. | 3606 |
| 24 | P2 | A | claude | EMILIOMATOS suspenso: falta filtro por leiloeiro no white-label Superbid | Cron do scraper-emiliomatos segue comentado (só workflow_dispatch) porque o catálogo multi-tenant devolve os mesmos lotes para 4 leiloeiros; precisa de filtro por leiloeiro antes de reativar. | 8589 |
| 25 | P2 | I | claude | 3 fontes publicando lote vencido: LEILOTECH, SBID21, VEGAS | Em 08/08: LEILOTECH 132/189, SBID21 37/39, VEGAS 41/62 com data passada. Entraria na ofensiva seguinte; sweep de stale foi criado depois, mas não há prova de que esses casos fecharam. | 23695, 23696, 23825 |
| 26 | P2 | A | claude | 2ª praça (valor_minimo_2/data_leilao_2) só capturada no MEGA e CEF; demais scrapers colapsam as praças | Replicar a captura aditiva em scraper-core, RJ, Soleon, Pecini e Gestão exige recon vivo de cada site (regra anti-regressão BIASI). | 26901 |
| 27 | P2 | A | claude | Backlog de integração de leiloeiros (TRT-15, SUPORTE white-label, picelli/shiokawa, motor DOM) | Sequência: confirmar cobertura SUPORTE (leilaobrasil 1.786 lotes, vecchi 463), cluster GESTAO (vip/milan/centraljudicial), 16 scrapers independentes e motor DOM passo 2 (alfa/hasta em ajuste, nordeste validado). Exige go | 26495, 27441, 28072 |
| 28 | P2 | I | claude | Possíveis leituras erradas: imóveis ativos com desconto >= 90% (avaliação > 10x o lance) | Eram 18 em 20/07; sugerido detector no health-check. | 27795 |
| 29 | P2 | I | claude | LEILOTECH: capturar cidade/UF da página do leiloeiro | White-label (vmleiloes/spencer/bringel) ficou com lotes sem UF, impedindo geocodificação e filtro regional. | 27831 |
| 30 | P2 | A | claude | Parser de 'Hastas Realizadas: d1 - d2 - d3' (LJUD) | Extrator de praças ignora o formato do LJUD; cards ficam sem datas. Parser dedicado não foi implementado (grep em api/scripts/src = 0). | 29505, 29587, 29733 |
| 31 | P2 | A | claude | GESTAOLEILOES/VLANCE nunca entram no espelho de documentos | Precisa recon por fonte (GESTAOLEILOES: seguir link e extrair PDF; VLANCE: render de browser). | 30513 |
| 32 | P2 | A | claude | Integrar SAULOJULIOLEILOEIRO e NAKAKOGUELEILOES | Recon: SAULOJULIO é SPA com API app/lotes que só responde dentro da SPA; NAKAKOGUE tem HTML viável, falta parser. Sem scraper no repo. | 31684, 31621 |
| 33 | P2 | A | claude | SUPERBID: mover offer-query para Node com backoff em 429 | Coleta segue parcial em dia ruim porque o fetch roda no navegador e não enxerga o status real. | 33543, 34252 |
| 34 | P2 | A | claude | FIPE enriquecida em só 178 de 7.580 veículos | fipe_status nulo na maioria; filtros de avaliação/desconto cobrem ~2%. | 34965 |
| 35 | P2 | A | claude | Resultado pós-leilão: ZUK/FRAZAO/KRON/VIP/PESTANA/SODRE indeterminados | Regex de _resultado-leilao.js não reconhece 'sem lance' de ZUK/FRAZAO; KRON (403/JS) e VIP (recusada) a conferir; PESTANA/SODRE URL é agenda. | 35022, 35095 |
| 36 | P2 | A | dono | Bright Data: remover 54.20.63.0/24 da blacklist da zona? | Faixa bloqueada em 25/09; decisão do dono. | 35490, 35689 |
| 82 | P3 | A | dono | 7 leiloeiros sem e-mail publicado (contato LGPD) | MILAN, PECINI, BIASI, INFINITY, TOTALLEILOES, FRAZAO (e outros) sem e-mail em site/lote/DJEN; precisa do dono obter. | 1002 |
| 83 | P3 | A | claude | Coletores próprios: ALEXANDREPEDROSA (34 imóveis) e sites sem conteúdo | Independentes em backlog; Uberlândia e LGCORRETOR já foram tratados depois; ALEXANDREPEDROSA (/lotes/imovel) segue sem coletor. | 1860 |
| 84 | P3 | I | claude | Cobertura de veículos: leiloeiros sem checagem (403/Cloudflare) | Lista de ~20 leiloeiros não checados para veículo; cobertura cresceu (662→1.312 itens) mas a lista não foi revisitada. | 3210, 2213 |
| 85 | P3 | A | claude | endereço vazio hardcoded (PESTANA/LEILAOBRASIL/FERREIRALEIL/HASTAPUBLICA/BIASI/GRUPOLANCE) | Scrapers nunca visitam o detalhe; GRUPOLANCE cobertura parcial; falta marcador de template confiável. | 2470, 2619 |
| 86 | P3 | I | claude | Lotes sem valor mínimo: CEF 75% e outros | Pode ser praça não marcada ou parser perdendo campo; registrado como pendência 7 em 11/09 sem decisão. | 4162 |
| 87 | P3 | I | dono | PESTANA: recon de data_leilao rodado na máquina residencial | recon-pestana-data.mjs bate em ERR_TUNNEL no sandbox; precisa rodar da máquina do dono. | 5597 |
| 88 | P3 | A | dono | Leiloeiros Cloudflare: FERNANDOLEILOEIRO, JONASLEILOEIRO, KRONLEILOES (decisão do dono) e SUEDPETER | Sem scraper; decisão de custo/integração do dono reconfirmada várias vezes. | 6865, 6917, 7163 |
| 89 | P3 | A | dono | Candidatos DJEN sem scraper: Thais Teixeira (42 editais), Jorge Vitório Espolador | Decisão do dono sobre qual abrir recon primeiro; sem registro de escolha. | 7611 |
| 90 | P3 | A | claude | Parser da família suaplataformadeleilao (andraleiloes, jinkings) | Família confirmada (menus idênticos) mas precisa de parser renderizado (dom) para /busca/#Engine=Start...; item 9 (endereço do documento com âncora no bem) também ficou bloqueado por evidência. | 14742, 14821, 14823 |
| 91 | P3 | I | claude | Lote de Guarulhos e7bd0637 sem data de leilão | Primeiro da fila de enriquecimento por edital; seguia sem data em 08/08. | 23695, 23696, 23825 |
| 92 | P3 | I | claude | 4 lotes CEF com matrícula em HTTP 404 (2 SP, 2 BA) | A rota alternativa da página devolve HTML; investigar se a Caixa mudou o caminho estático. | 25330 |
| 93 | P3 | A | claude | Redesenho do coletor: separar motor de FETCH do PARSE por fonte | Brief de 20/08: toda fonte é produto de motor de fetch (grátis/BD/residencial/Puppeteer) x parser; refatorar para reduzir custo e fragilidade. | 28326, 28342 |
| 94 | P3 | A | dono | Camada 2 do endereço: extrair logradouro do edital/matrícula sob demanda (~343 lotes sem logradouro) | Desenho recomendado: on-demand na geração do relatório, nunca em massa. Dono ainda decide. | 25163 |
| 95 | P3 | I | claude | PECINI: conferir descrição completa do lote 10645 após coleta | Fix de painel de descrição foi feito sobre estrutura estimada a olho; confirmar na coleta real. | 30897 |
| 96 | P3 | A | dono | Bright Data Residential completo (KYB com LinkedIn) | Verificação Residential pendente por exigir LinkedIn; proxy ISP funciona. Retomar só se necessário. | 31929 |
| 97 | P3 | A | dono | Decisão: scraper dedicado para lucasleiloeiro / leiloesuberlandia / leilaobrasil (Cloudflare) | Bloqueio Cloudflare; exigiria Bright Data ou puppeteer stealth. crleiloes já foi integrado depois. | 32267, 32270, 32343 |
| 98 | P3 | A | dono | Decidir consertar ou aposentar crons suspensos EMILIOMATOS/SATO | Crons suspensos sem decisão formal do dono. | 32997 |
| 99 | P3 | A | claude | LJUD: 1.161 veículos 'indefinido' (resultado/origem) | Análise de origem como feita para SUPERBID, se o dono quiser. | 34485 |
| 100 | P3 | I | claude | PESTANA: confirmar que a coleta gravou 'vendido' | 0 até 25/09 noite; conferir resultado_origem='api_pestana'. | 35696 |

## Documental

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 41 | P2 | I | claude | Download de matrícula/edital com HTTP 403 em lotes CEF (BH, Betim) | Alcance não medido: do fornecedor ou do nosso caminho de saída (api/_edital-extrato.js)? | 5715 |
| 42 | P2 | I | claude | Fontes com 0% de documento (GESTAOLEILOES, SBID9, VLANCE e outra) | Inventário de 08/08 apontou 4 fontes sem nada para o documental ler; pipeline de captura listado como pendente. Parte pode ser por desenho (GESTAO/PECINI não publicam PDF de matrícula avulso). | 23695, 23696, 23820 |
| 43 | P2 | A | claude | Auditar outros leiloeiros com editais multi-lote | Defeito de contaminação entre lotes do mesmo edital foi corrigido para LJUD/TORRES3; não foi auditado se outros leiloeiros publicam editais multi-lote. | 29505, 29733 |
| 104 | P3 | A | claude | SUPERBID doc 74% (enrichCap) e SATO detalhe sem documento | Subir enrichCap ou backfill dedicado no SUPERBID; SATO nunca visita o detalhe (TODO). | 6549 |
| 105 | P3 | A | claude | Prompt do mercadológico: nunca duplicar comparável entre níveis | Só existe rede de segurança determinística; não há instrução na raiz do prompt. | 29733 |

## App

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 18 | P2 | A | dono | Decidir qual valor é 'o preço' do lote com 2 ou 3 praças | Define filtro da busca, ordenação, BidScore e projeção do relatório vendido de uma vez; decisão do dono. | 19613 |
| 19 | P2 | A | claude | Fluxo de arremate: estados declarado→confirmado→recusado, comprovante e um arrematante por lote | Desenho aprovado em linhas gerais: botão só para assessorado/clube, valor + comprovante, índice único parcial por imóvel. Hoje api/sinalizar-arremate.js só exige valor; sem coluna de estado e sem exigência de comprovante | 21744 |
| 20 | P2 | I | claude | Reset de senha (HashRouter + implicit flow) pode dar 'link inválido' | Precisa teste em runtime; se reproduzir, migrar para flowType pkce. src/ não define flowType. | 27542 |
| 21 | P2 | I | dono | Verificações ao vivo do atendimento no celular | Lista de checagens (Chamados/E-mail, fila→conversa→voltar, link canaldireto) nunca vistas em produção. | 34667 |
| 71 | P3 | A | claude | Tela do CASO: listar e-mails/anexos vinculados | Pendência opcional da retenção da caixa: hoje o vínculo só aparece na caixa. | 1830 |
| 72 | P3 | A | claude | calcular-score: verificar se o resto assume 1ª praça | calcular-score usa desconto_percentual (2ª praça, peso 0,6/ponto); nunca verificado se o resto do score assume a 1ª. | 5715 |
| 73 | P3 | A | claude | Testes de scripts/testes fora do CI | Há ~115 arquivos em scripts/testes e só um workflow (testar-analise-amostras.yml) roda testes; os que não têm dependência poderiam rodar em verificar-padroes.yml. Também: lembrete de aula não sai se oferta_fecha_em for m | 9499 |
| 74 | P3 | A | claude | cursos_admin/ebooks_admin sem preco_vista e anexo 'proposta' do ZUK | Tela de preço de curso/ebook grava % com erro de centavos por falta da coluna preco_vista; anexo tipo='proposta' do ZUK é link de navegação capturado como documento. | 9694 |
| 75 | P3 | A | dono | Decisão: coluna 'uso ocasional' ao lado de domicilios_vagos (Censo) | Item F de 12/08, decisão do dono sobre acrescentar 'uso ocasional' como coluna nova da ingestão IBGE. | 21994, 22159, 22806 |
| 76 | P3 | A | claude | Consolidar definições conflitantes de limite_ia e registrar_preco_contratado nas migrações | Vários .sql redefinem limite_ia (cota_10_10_3, cotas_derivam_do_real, etc.); o banco está correto, mas o repo diverge. registrar_preco_contratado v2 ignora assessorado/_anual. | 26540 |
| 77 | P3 | A | claude | Emitir evento quando relatório rebaixa de gerando para erro por stale | Baixa prioridade; hoje o rebaixamento não deixa rastro no Cliente 360. | 26580 |
| 78 | P3 | A | dono | Ideia: identificação por CPF na tela da Assessoria/Investidor Pro | Popup de bundle funcionando pré-login, com rate-limit e retorno mínimo (LGPD). Dono ainda decide em qual tela fica o campo. | 26760 |
| 79 | P3 | A | claude | Assistente de onboarding do parceiro passo a passo (dados, termos, selfie, CNH) | Pedido do dono de 27/07: fluxo um passo por vez. Peças existem soltas (HomeCliente, Perfil/KycParceiroModal). Aceite hoje redireciona para /minha-rede. | 27057 |
| 80 | P3 | A | claude | Roteamento on-behalf real no modo suporte | Feature adiada: telas Painel/Analise usam portfólio localStorage/user.id do logado, não do cliente atendido pelo suporte. | 28763 |
| 81 | P3 | A | claude | Fusão dos cartões financeiros | Pendência herdada de 12/09 (parte 3) sem detalhe no lote; tela financeira com cartões redundantes. | 29733 |

## Infra

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 52 | P2 | I | claude | Workflow 'Enriquecer Localização OSM' falhou com curl 47 (50 redirects) | Falhou 30/09 10h54 após dias verdes; ficou de conferir a rodada de 01/10 antes de mexer. | 801 |
| 53 | P2 | I | dono | Envs na Vercel: CONTABILIDADE_EMAIL, AUDITORIA_EMAIL_DESTINO, GITHUB_ACTIONS_TOKEN | Pendentes desde 07-08/08. GITHUB_ACTIONS_TOKEN é lida por api/trigger-scraper.js, trigger-puppeteer.js e coleta-oportunista.js (sem ela devolvem 500/infra ausente). Nenhuma das três consta em docs/ENVS_VERCEL.md. | 23695, 23696, 23817 |
| 54 | P2 | A | dono | Gemini créditos, projeto-sombra Google Cloud e Instagram/Meta Business | Pendências de conta que só o dono resolve; freio de custo do Gemini bloqueia retentativas. | 34163, 32201, 31157 |
| 108 | P3 | A | claude | ~8 workflows recon-*.yml sem autorização de orçamento Bright Data | Só recon-francoleiloes e recon-hasta foram corrigidos; os demais recon-*.yml têm a mesma lacuna e falham silenciosos. | 2924 |

## Processo

| # | P | Classe | Resp. | Item | Contexto | Linhas |
|---|---|---|---|---|---|---|
| 67 | P2 | I | dono | Calibrar o limite do invariante proximidades_vazio_falso (limite 300, chegou a 987) | Os vazios eram corroborados (drenagem prevista), mas a decisão de recalibrar o limite ficou com o dono e não há registro de fechamento. Em 03/10 só houve otimização de desempenho da consulta. | 21598 |
| 116 | P3 | A | claude | Botão Aprovar/Reprovar PJ também dentro do Atendimento | Follow-up não bloqueante do fluxo de saque PJ; hoje só existe em Admin.jsx (Financeiro > Prestação de contas). | 27108, 27115 |
| 117 | P3 | I | claude | Marcar erros_cliente do null.id e rodar anomalias_revisadas_21_08.sql | Checklist de 21/08: marcar resolvidas as 2 linhas de erros_cliente (rotas / e /imovel/:id) e rodar o SQL de 17 anomalias revisadas. | 28796, 28821 |
