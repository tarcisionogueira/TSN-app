# ✅ Pendências que dependem do DONO (fazer no computador / painéis)

> Itens que o Claude **não consegue fazer sozinho** (ação em painel, assinatura de plano,
> variável de ambiente). Cada um traz o **porquê**, o **passo a passo** e **o que o Claude
> faz depois** que você concluir. Quando estiver no computador, é só ir por aqui.
>
> _Última atualização: 03/08/2026 (tarde — sessão ao vivo com o dono nos painéis)._

---

## ✅ RESOLVIDO EM 03/08 — não precisa mais fazer

O dono sentou no computador e fechamos, item a item:

| Item | Como ficou |
|---|---|
| **-5 Capa do eBook** | ✅ as **duas** trocadas (a do "Lucre Antes de Arrematar" tinha o mesmo defeito latente). Original veio do `capa livro.pdf` no Drive |
| **-4 Search Console** | ✅ propriedade de **Domínio** verificada por DNS · `sitemap.xml` Processado · `sitemap-leiloes.xml` reenviado (o índice responde certo no navegador — falha foi do Google) |
| **-3 Cloudflare R2** | ✅ bucket `bidpro-backup` região **ENAM** + token restrita + 5 variáveis + redeploy. **1ª execução real: 04/08 às 04:40 UTC** |
| **-2 Resend** | ✅ dois webhooks com `www` e Enabled + secret **rotacionado** (estava vazado no repo público). 🔶 falta só a prova de ponta a ponta no cron das 8h |
| **1 Asaas** | ✅ **Ativado / 0 penalizados**. A trava era a **"Fila de sincronização"** — segundo interruptor, separado do "webhook ativo" |
| **2 Upstash Redis** | ✅ `bidpro-ratelimit` criado + REST URL/TOKEN na Vercel + redeploy |

**Ainda abertos:** **-1.5 MX do domínio** (o `suporte@` e o `privacidade@` são publicados no site
e não recebem nada — o código do inbound já está pronto, falta só o MX) ·
**-1 Google Ads** (verificação até **02/09**, anúncios pausam se não fizer) ·
**0 Teste da compra avulsa** (a visualização do eBook já foi validada; falta o fluxo de
pagamento — dá para usar a conta `teste@teste.com.br`) · **3 PECINI**.

> 🔑 **Duas armadilhas que custaram tempo e vão se repetir — leia antes de mexer em painel:**
> 1. **Vercel `Sensitive`**: variável marcada assim é *write-only* — não dá para ler nem
>    desmarcar, só apagar e recriar. E **variável nova só vale depois de um REDEPLOY**.
>    ⚠️ `ASAAS_API_KEY` é Sensitive e **não deve ser trocada** — é a credencial que o Asaas nos
>    deu (diferente de `ASAAS_WEBHOOK_TOKEN`, que é senha nossa e pode rotacionar à vontade).
> 2. **Registro.br**: no formulário de DNS o campo *Nome* CONCATENA `.bidprobrasil.com.br`.
>    Para o domínio-raiz ele fica **VAZIO**. E o Registro.br só grava depois do **segundo**
>    clique (ADICIONAR → publicar a zona).

---

## 🟢 Fazer agora — grátis e rápido

### -5. 🖼️ RE-ENVIAR A CAPA DO eBOOK "Leilões caixa" — ~2 min, grátis (a capa está cortada nas 3 telas)

- **Por quê:** o arquivo da capa (`membros-capas/capas/1785075416388-0i1y4q.jpg`) chegou ao
  bucket com os **dados JPEG corrompidos no meio** — o navegador decodifica só o topo e
  abandona o resto, por isso a capa aparece "cortada" no card de Membros, na tela do livro e
  no cabeçalho do leitor. O Claude **não consegue substituir o arquivo daqui** (o proxy do
  ambiente nega acesso ao Storage); só um upload novo resolve.
- **Onde está o original:** no **Google Drive, na mesma pasta do manuscrito**. Para achar:
  a capa subiu ao app em **26/07 às 14:17** (JPG de ~545 KB) e o PDF do manuscrito 13 min
  antes — procure a imagem de capa com data próxima a essa na pasta. *(O Claude tentou
  verificar o arquivo direto no Drive em 03/08, mas o conector Google pede uma aprovação de
  permissão que não aparece no celular — se o cartão "Permitir" do Google Drive aparecer numa
  sessão no computador, aprove que ele confere a integridade do original antes do re-envio.)*
- **Passos:**
  1. **Admin → Área de Membros → eBooks** → editar o **"Leilões caixa - Mais facil do que
     você imagina"**.
  2. Clicar em **"Enviar imagem (PNG/JPG)"** no campo da capa e escolher a imagem do Drive
     (a original — não um print).
  3. Salvar. Nada mais: o upload novo já **decodifica e re-codifica** a imagem antes de subir
     (correção de 03/08) — **ele mesmo faz a verificação**: se o arquivo do Drive estiver bom,
     sobe limpo e a capa conserta; se estiver corrompido na fonte, o erro aparece na hora e a
     saída é exportar a capa de novo do editor onde ela foi criada.
- **Depois que fizer:** abra o card em Membros — a capa conserta nas três telas de uma vez.
  O corte DENTRO do leitor (topo da página embaixo da barra, no iPhone) era outro bug e **já
  foi corrigido em código**, não depende de você.

### -4. 🔴 GOOGLE SEARCH CONSOLE + PERFIL DA EMPRESA — ~20 min, grátis (o site não aparece no Google)

- **Por quê:** em 02/08 o site ganhou **33 mil páginas indexáveis** (`/leiloes`, por estado, por
  cidade e por imóvel) — antes ele tinha UMA só, porque tudo morava depois do `#` e o Google
  descarta o fragmento. As páginas existem e estão no ar, mas o Google **ainda não sabe disso**.
  Descobrir sozinho leva semanas; avisando, leva dias. E o Search Console é o único lugar onde dá
  para ver o que ele indexou e o que rejeitou.
- **Passos — Search Console:**
  1. `search.google.com/search-console`, logado com a **mesma conta Google do Google Analytics**
     do site (é o que destrava o atalho do passo 3).
  2. **Adicionar propriedade** → coluna da direita, **Prefixo do URL** → cole
     `https://www.bidprobrasil.com.br` (com `www` — o domínio sem `www` redireciona 308 para ele,
     então o `www` é o endereço oficial).
  3. **Verificar a propriedade.** O Google oferece vários métodos; use o primeiro que funcionar:
     - **① Google Analytics** *(o mais rápido — provavelmente resolve em 1 clique)*: o site já tem
       o GA4 `G-5YNHQB5F81` instalado. Se a sua conta tem permissão de **editar** essa propriedade,
       basta escolher "Google Analytics" e clicar em Verificar. **Nada a fazer no site.**
     - **② Tag HTML**: o Google mostra uma linha
       `<meta name="google-site-verification" content="XXXXXXXX" />`.
       **Me mande essa linha** (pode ser só o `content`) que eu publico no site em minutos e você
       clica em Verificar.
     - **③ Registro DNS (TXT)**: se preferir, dá para verificar no painel onde o domínio está
       hospedado. Esse método permite a propriedade do tipo **Domínio**, que cobre `www`, sem
       `www` e qualquer subdomínio de uma vez — é a melhor no longo prazo, mas exige mexer no DNS.
  4. Verificado, vá em **Sitemaps** (menu esquerdo) e adicione os dois, um de cada vez —
     digite só o nome, o Google já preenche o domínio:
     - `sitemap.xml`
     - `sitemap-leiloes.xml`
     Os dois já estão no ar e conferidos em 02/08.
  5. **Inspeção de URL** (barra de busca do topo) → cole
     `https://www.bidprobrasil.com.br/leiloes` → **Solicitar indexação**.
     Repita para 2 ou 3 cidades importantes, ex.:
     `https://www.bidprobrasil.com.br/leiloes/sp/campinas`
     (a cota é de ~10 pedidos por dia — não precisa pedir para as 33 mil, o sitemap cuida do resto).
  6. **Não se assuste** nos primeiros dias: "Páginas não indexadas" vai ficar alto enquanto o
     Google processa. O que importa é o número de indexadas **subindo** semana a semana.
- **Passos — Perfil da Empresa no Google** (é o que faz o Google parar de trocar "bid" por "byd"):
  5. `business.google.com` → criar o perfil da **BidPro Brasil**, categoria "Corretor de imóveis"
     ou "Serviço imobiliário", com o site `https://www.bidprobrasil.com.br`.
  6. Concluir a verificação que o Google pedir (costuma ser por telefone ou vídeo).
- **Depois que fizer:** me avisa que eu acompanho a cobertura pelo Search Console (quantas páginas
  entraram, quais deram erro) e ajusto o que ele reclamar.
- **Expectativa honesta:** aparecer para "leilão de imóveis em <cidade>" leva **semanas**, não
  dias — é indexação + reputação. O que estava impedindo era estrutural e foi corrigido; daqui
  para frente é tempo e volume.

### -3. 🔴 CLOUDFLARE R2 — ligar o 2º servidor (backup fora da região) — ~15 min, **custo R$ 0**

- **Por quê (o que está em risco HOJE):** o Supabase Pro faz backup do **banco** (7 dias) —
  mas na **mesma região** (`sa-east-1`, São Paulo) — e **não faz backup nenhum do Storage**.
  Ou seja: os **documentos que o próprio cliente enviou** (matrícula, KYC, contrato assinado,
  comprovantes) não têm cópia em lugar nenhum. Se essa região tiver um incidente sério, esses
  arquivos não voltam. O código do espelhamento (`/api/backup-r2-cron`) **já está pronto e
  rodando todo dia às 04:40** — mas está **DORMENTE**, porque faltam as chaves. É só isto:
  criar o bucket e colar 5 variáveis.
- **Quanto vai custar:** o backup copia só o que é **irrecuperável** — hoje **45 arquivos,
  15 MB** (as ~14 GB de matrícula/edital raspados dos leiloeiros ficam de fora de propósito:
  a captura recria tudo). O nível gratuito do R2 dá **10 GB**. Ou seja: **R$ 0**, com muita
  folga, e sem taxa de saída (o R2 não cobra egress).

**Passo 1 — criar a conta e o bucket (Cloudflare)**
1. Entre em `dash.cloudflare.com` (cria conta grátis se não tiver). No menu lateral, o R2 **não
   aparece com esse nome sozinho**: ele fica dentro de **“Storage & databases”** (grupo *Build*).
   Caminho exato: **Storage & databases → R2 Object Storage → Overview**.
   (“Data migration” é para trazer arquivos de outro provedor; “R2 Data Catalog” não tem relação.
   O botão **Create bucket** e o link **Manage R2 API Tokens** estão os dois na tela *Overview*.)
2. Se pedir cartão para habilitar o R2, é só cadastro — o consumo fica dentro do gratuito.
3. **Create bucket**:
   - **Bucket name:** `bidpro-backup` (se usar outro nome, é esse que vai na variável `R2_BUCKET`).
   - **Location / Location hint:** **⚠️ o ponto mais importante desta tarefa.** Escolha uma
     região **FORA da América do Sul** — se a cópia ficar na mesma região do banco, ela cai
     junto no dia do incidente e o backup não serviu para nada. Recomendo
     **`Eastern North America (enam)`** (é a mais próxima do Brasil entre as opções válidas).
     Alternativa: `Western Europe (weur)`.
   - Criar.

**Passo 2 — gerar as chaves de acesso**
1. Ainda em **R2** → **Manage R2 API Tokens** (canto direito) → **Create API token**.
2. **Permissions:** `Object Read & Write` (NÃO precisa Admin).
3. **Specify bucket:** aponte só para `bidpro-backup` (princípio do menor privilégio — se essa
   chave vazar, ela não alcança mais nada da conta).
4. Criar e **copiar agora** (o segredo só aparece uma vez):
   - **Access Key ID**
   - **Secret Access Key**
5. **Account ID:** está na página inicial do R2, na barra lateral direita (é também o código
   que aparece na URL do painel). Copie também.

**Passo 3 — colar as 5 variáveis na Vercel**
Painel Vercel → projeto **tsn-app** → **Settings → Environment Variables → Add New**.
Para **cada** uma, marque **Production + Preview + Development**:

| Variável | O que colar |
|---|---|
| `R2_ACCOUNT_ID` | o Account ID do passo 2.5 |
| `R2_ACCESS_KEY_ID` | o Access Key ID |
| `R2_SECRET_ACCESS_KEY` | o Secret Access Key |
| `R2_BUCKET` | `bidpro-backup` (ou o nome que você deu) |
| `R2_LOCATION` | **`enam`** (ou `weur` — exatamente a região que você escolheu no passo 1) |

> ⚠️ `R2_LOCATION` é o que o check-up de saúde lê para confirmar que a cópia está longe do
> banco. Ele **não muda** onde o bucket está — só **declara**. Se você criar em `enam` e
> escrever `weur`, o painel vai dizer que está tudo certo quando não está. Tem que bater com
> a região real.

**Passo 4 — publicar**
Abra no navegador o link de deploy que já está no `CLAUDE.md`:
`https://api.vercel.com/v1/integrations/deploy/prj_E0tUYhPJN9IteuNI8spS0CEgZuxo/saLCcQwzMK`
(variável de ambiente nova só passa a valer depois de um novo deploy).

**Passo 5 — conferir (no dia seguinte)**
No painel Admin → **Check-up de saúde**, o item **“Infra — backup off-region (2º servidor)”**
deve sair de 🔴 **erro** para 🟢 **ok**, mostrando algo como
`Último: há 3h · 45/45 arquivo(s) novos · 7 tabela(s) · destino r2:<conta>/bidpro-backup (enam)`.
Se aparecer 🟡 avisando *“região não declarada ou na América do Sul”*, o `R2_LOCATION` está
vazio ou com valor sul-americano — reveja o passo 3.

- **O que o Claude faz depois:** confirmo pelos logs e pelo `backup_execucoes` que a primeira
  cópia subiu inteira, e a partir daí o check-up cobra sozinho todo dia (sem backup há 48h,
  falha de cópia ou região errada viram **erro** no painel).
- **Uma coisa para você decidir com consciência:** esse backup leva documentos pessoais de
  clientes (KYC, contratos) para fora do país. A LGPD permite transferência internacional com
  salvaguardas contratuais — a Cloudflare disponibiliza DPA/cláusulas-padrão na própria conta.
  Se preferir manter tudo em território nacional, o preço é abrir mão da proteção contra uma
  falha regional; dá para conversar sobre um meio-termo (ex.: outro provedor com região no
  Brasil, aceitando o risco correlacionado). **Me avisa se quiser mudar essa escolha.**

### -2.5 🔴 EMPRESA_CNPJ no painel (1 min; hoje TODA nota fiscal cai em conferência manual)
- **Por quê:** `api/saque-nf.js` compara o TOMADOR da nota com o CNPJ da BidPro para afirmar
  que a nota foi emitida contra nós. Sem a variável, essa comparação não acontece e o veredito
  cai em `revisao_manual` mesmo quando a nota está perfeita — vira fila da equipe.
- **Passo:** Vercel → Settings → Environment Variables → `EMPRESA_CNPJ` (só dígitos) →
  marcar Production + Preview + Development.
- **Retorno:** é o item de maior retorno por menor esforço da conferência de NF. Custo zero.

### -2. 🟠 RESEND — subdomínio de rastreio (a ENTREGA já volta; ABERTURA e CLIQUE ainda não)
- **Estado em 09/08:** o webhook do `www` foi corrigido e **funciona** — 26 linhas de
  `emails_log` já têm `entregue_em`. Mas `aberto_em` e `clicado_em` seguem em **ZERO nas 120
  linhas da base inteira**, desde 24/06. Não é bug nosso: `api/resend-webhook.js` já trata
  `email.opened` e `email.clicked` (linhas 41–42) — esses eventos simplesmente nunca são
  emitidos, porque no Resend o rastreio é **opt-in por domínio** e exige um subdomínio próprio.
- **Efeito:** não dá para saber se e-mail nenhum é lido. Isso trava a medição do nudge de
  ativação (`ativacao-nudge-cron`) e de qualquer campanha.
- **Passos:** Resend → Domains → `bidprobrasil.com.br` → aba **Configuration** → *Enable
  tracking metrics* → **Configure**:
  1. No campo **Subdomain** digite **apenas `links`** — o Resend concatena o Domain sozinho.
     (Digitar `links.bidprobrasil.com.br` inteiro produz
     `links.bidprobrasil.com.br.bidprobrasil.com.br`, que é o erro que o campo acusa em
     vermelho.) A prévia à direita tem de ler `links.bidprobrasil.com.br/your-link`.
     Não use `send` — já é do SPF/MX.
  2. Marque **Enable click tracking** e **Enable open tracking** → **Add domain**.
  3. Ele devolve **CNAME(s)**: adicione no MESMO lugar onde vivem hoje o `resend._domainkey`
     e o `send`, e espere ficar **Verified**.
  4. Resend → **Webhooks** → abrir o endpoint existente → marcar **`email.opened`** e
     **`email.clicked`**. Sem isso o rastreio liga e nada chega até nós.
- **Ressalva honesta:** abertura é medida por pixel invisível — Apple Mail e Gmail distorcem
  (iPhone abre sozinho; imagem bloqueada não conta). **Clique é o número confiável**; ligue os
  dois e decida pelo clique.
- **Depois:** o Claude confere `emails_log.aberto_em/clicado_em` preenchendo nos envios seguintes.
- **✅ DNS FEITO (11/08, print do painel):** `CNAME links → links1.resend-dns.com` **Verified**,
  junto com SPF/MX/DKIM. A parte que dependia de DNS está encerrada.
- **🔶 FALTA CONFERIR O PASSO 4** (inscrição do webhook nos eventos): `emails_log` continua com
  **0 aberturas e 0 cliques**, inclusive nos 3 e-mails de hoje (todos entregues). `email.delivered`
  CHEGA — o que prova que o endpoint e o `RESEND_WEBHOOK_SECRET` estão certos e que o problema,
  se existir, é só a lista de eventos marcados. Resend → **Webhooks** → abrir o endpoint →
  marcar **`email.opened`** e **`email.clicked`**.
  Desde 11/08 o handler registra **todo evento recebido** em `webhook_eventos_processados`
  (`gateway='resend'`), então o próximo envio responde sozinho: se `email.opened` nunca aparecer
  ali, é a inscrição; se aparecer e a coluna seguir nula, é comportamento real de quem recebeu.
- **🔴 SUBIU DE PRIORIDADE EM 11/08 — agora ele bloqueia uma medição que NÃO se repete.** Nova
  medição: **136 e-mails em 30 dias, 55 entregues, 0 aberturas, 0 cliques** — o retrato de um canal
  sem instrumento. E o **backlog do nudge de ativação** (26 pessoas que passaram da janela D+2/D+7)
  é de **uso único**: cada pessoa recebe uma vez e sai da fila para sempre. Se ele disparar antes do
  rastreio estar ligado, a única amostra grande que temos vira 26 envios sem nenhum dado — e
  nenhuma medição futura recupera isso. O disparo já está pronto e **parado de propósito**,
  esperando este item: Actions → **"Nudge de ativação — backlog (manual)"** (comece com `limite=2`).
  Ordem certa: **(1) este item → (2) o workflow**. Ele não roda sozinho.

### -1.2 🟠 GOOGLE ADS — fechar o ciclo de medição (o site já faz a parte dele)

Em 12/08 o site passou a capturar o **clique**: `gclid`/`gbraid`/`wbraid` e todos os `utm_*`
entram em `visita_origem` no **primeiro toque** e ficam amarrados ao `anon_id` — o mesmo do
Cliente 360. Quando a pessoa cria conta, dá para dizer de qual campanha ela veio. O painel
"Funil de quem ainda não é cliente" já mostra **origem → viraram conta**.

Faltam três coisas, e todas dependem de você. **Faça a 1 hoje** (5 min, grátis, destrava todo o
resto). A 2 é opcional. A 3 só depois que a verificação do anunciante sair.

---

#### PASSO 1 — ✅ **JÁ ESTAVA FEITO** (conferido na tela de configurações em 12/08)

**Codificação automática: Sim** — é o auto-tagging (a posição na lista bate com o padrão do Google:
depois de Fuso horário, antes de Acompanhamento). E as duas armadilhas **não existem** nesta conta:
**Acompanhamento: "Nenhuma opção definida"** (sem template que engula o `gclid`) e **Medição
terceirizada: "Nenhuma"** (sem ferramenta concorrente reescrevendo a URL).

> **A conclusão incômoda:** o `gclid` **já vinha chegando** em toda visita de anúncio, esse tempo
> todo. Era o NOSSO lado que descartava — o tracker mandava só o `pathname`. O dado estava na
> porta e era jogado fora. Corrigido em 12/08; do próximo clique em diante é medido.

Passos abaixo mantidos para referência (e para o caso de a conta ser recriada ou o interruptor
ser desligado por engano):

1. Entre em **ads.google.com** com a conta **475-979-5747**.
2. Abra o menu de **administração da conta** (ícone de engrenagem/ferramentas no topo; conforme a
   versão do painel aparece como **Admin** ou **Configurações**) → **Configurações da conta**.
3. Abra a seção **Marcação automática** (*Auto-tagging*).
4. Marque **"Marcar o URL que as pessoas clicam no meu anúncio"** e **salve**.

> ⚠️ **Duas armadilhas que anulam o passo:**
> - Se a campanha usa **template de acompanhamento** (*tracking template*) próprio, confira que ele
>   repassa a query string — um template mal montado engole o `gclid`. Onde ver: Campanha →
>   Configurações → *Opções de URL da campanha*.
> - Se você usa outra ferramenta de rastreio que já reescreve a URL, teste antes de ligar as duas.

**Como saber que funcionou (não confie no interruptor, confie no dado):** depois do primeiro clique
real num anúncio, me avise. Eu rodo:
```sql
select origem, pessoas, viraram_conta from jsonb_to_recordset(
  (select (public.funil_publico(7))->'origens')) as t(origem text, pessoas int, viraram_conta int);
```
Verde = aparecer uma linha **`Google Ads · …`**. Enquanto só existir `(não medido)`, o `gclid` não
está chegando — e aí o problema é uma das duas armadilhas acima.

---

#### PASSO 1b — 🔴 PALAVRAS-CHAVE NEGATIVAS (achado da mesma tela, 12/08) · gasto direto

A tela de configurações mostra **"Palavras-chave negativas: Nenhuma"**. Sem negativas, a campanha
paga por busca que nunca compra. Duas ressalvas antes de agir: essa linha é a lista **da CONTA**
(pode haver negativas no nível da campanha, que não aparecem ali), e a lista genérica abaixo é só
o ponto de partida.

**A lista boa sai do seu próprio relatório:** Campanha → **Insights → Termos de pesquisa**. Ele
mostra o que as pessoas realmente digitaram antes de clicar — é onde o desperdício aparece com
nome e sobrenome.

Ponto de partida para leilão de imóveis:
`curso` · `como funciona` · `o que é` · `grátis` · `gratuito` · `emprego` · `vaga` · `salário` ·
`carro` · `veículo` · `moto` · `leiloeiro oficial` · `concurso` · `apostila` · `pdf` · `simulador`

> **Também na mesma tela:** *"Termos dos anúncios de formulário de lead: não aceitos"* — vale
> considerar. O formulário de lead capta o contato DENTRO do anúncio, sem a pessoa passar pelo
> cadastro do site, que é justamente onde perdemos gente em 12/08. E *"Aplicação automática:
> Desativado"* — **manter assim**: com verificação pendente e orçamento pequeno, você quer
> controle, não o Google mexendo sozinho na campanha.

#### PASSO 2 — UTM nos anúncios · 🟡 PARCIALMENTE FEITO (12/08)

**Já chegando:** `utm_source=google`, `utm_medium=cpc` e `utm_campaign=pesquisa-leilao-imoveis`
(confirmado nos dois primeiros cliques, 21:49 e 21:53 de 12/08).
**Faltando:** `utm_term` e `utm_content` — sem eles não se sabe QUAL palavra-chave trouxe a pessoa,
e as negativas continuam saindo de lista genérica em vez do dado próprio.

Cole em Campanha → **Configurações** → **Opções de URL da campanha** → **Sufixo do URL final**:
```
utm_source=google&utm_medium=cpc&utm_campaign=pesquisa-leilao-imoveis&utm_term={keyword}&utm_content={creative}
```

> ⚠️ Troque **onde já está definido**. Como o `utm_campaign` chega com nome legível (e não com
> `{campaignid}`), o sufixo atual está no nível da CAMPANHA. Criar outro no nível da conta faz os
> dois coexistirem — e o mais específico vence, o que só confunde na hora de ler o relatório.

**Opcional, três sinais no mesmo campo e sem mudar nada do nosso lado:**
`utm_content={creative}-{matchtype}-{device}` — revela se o desperdício vem de correspondência
ampla (`b`) e se celular (`m`) converte pior que desktop (`c`), as duas maiores fontes de gasto
ruim numa campanha de pesquisa.

O site já lê os cinco parâmetros e grava no primeiro toque (`visita_origem`).

---

#### PASSO 3 — Google Ads API · ~1–2 h suas + dias de espera · R$ 0 · **faça depois do item -1**

É o que traz **custo, cliques, impressões e CTR** para dentro do painel, e o que permite devolver a
conversão ao Google (*Offline Conversion Import*) para ele otimizar por **valor de venda**, não por
clique. Ordem certa:

**3a. Conta de gerente (MCC)** — o *developer token* só é emitido para conta de gerente, e a
`475-979-5747` **não é** uma. Crie uma em **ads.google.com/home/tools/manager-accounts** (grátis) e
**vincule** a conta 475-979-5747 a ela (a conta filha precisa aceitar o convite).

**3b. Developer token** — na conta de gerente: **Admin → Central de API** (*API Center*). Solicite o
token. Ele nasce com acesso **de teste** (só conta de teste); peça a elevação para **Basic access**
descrevendo o uso (relatório interno de campanha e importação de conversões). **A aprovação leva
dias** — é o item de maior espera, comece por ele.

**3c. Credencial OAuth no Google Cloud** — em **console.cloud.google.com**:
   1. crie um projeto (ou use um existente);
   2. **APIs e serviços → Biblioteca** → ative **Google Ads API**;
   3. **Tela de permissão OAuth** → configure (modo Externo serve; pode ficar em "Teste" com o seu
      e-mail como usuário de teste);
   4. **Credenciais → Criar credenciais → ID do cliente OAuth** → tipo **App para computador**
      (é o mais simples para gerar o refresh token);
   5. guarde **Client ID** e **Client Secret**;
   6. gere o **refresh token** autorizando com o e-mail que tem acesso ao Ads (o fluxo do
      `oauth2l`/playground do Google, escopo `https://www.googleapis.com/auth/adwords`).

**3d. Ação de conversão para importação** — no Ads: **Metas → Conversões → Nova ação de conversão
→ Importar → Rastreamento manual de conversões via upload**. Crie duas: **"Cadastro"** (valor 0) e
**"Assinatura"** (valor variável). São elas que vão receber o `gclid` de volta.

**3e. Variáveis no painel da Vercel** (Settings → Environment Variables, marcar Production +
Preview + Development). **Cole só no painel — nunca em arquivo do repositório, que é público:**
```
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN
GOOGLE_ADS_CUSTOMER_ID          → 4759795747 (sem traços)
GOOGLE_ADS_LOGIN_CUSTOMER_ID    → o ID da conta de GERENTE (sem traços)
```

**3f. Me avisar.** Com as variáveis no ar eu construo, do nosso lado:
- cron diário que puxa **custo, cliques, impressões e CTR por campanha** e grava em tabela;
- card no painel cruzando **custo × visitantes × cadastros × receita** → custo por cadastro e por
  cliente pagante, por campanha;
- envio das conversões pelo `gclid` (cadastro na hora; assinatura com o **valor real**, inclusive
  retroativo quando o pagamento confirma dias depois).

> **Por que a ordem importa:** conta com verificação do anunciante pendente (item **-1**) tem
> entrega restrita. Otimizar em cima de dado restrito ensina a máquina errado, e o aprendizado
> ruim demora a sair. Primeiro a verificação, depois a API.

> **LGPD:** `gclid` e `utm_*` são dados de navegação de visitante anônimo. Confirmar com o jurídico
> se a Política de Privacidade atual já cobre "identificadores de campanha publicitária" — se não
> cobrir, é uma frase a acrescentar.

### -1.5 🔴 MX do `bidprobrasil.com.br` → inbound do Resend (o `suporte@` não recebe nada)

- **Por quê, e não é "faltava uma feature":** a home publica `suporte@bidprobrasil.com.br`, os
  Termos e a Política publicam `privacidade@bidprobrasil.com.br`, e o e-mail que a equipe manda
  ao cliente termina com **"é só responder este e-mail"**, com `reply-to` para o `suporte@`.
  **Nenhum desses endereços recebe.** Até 12/08 o único inbound descartava, com HTTP 200 e sem
  log, tudo que não fosse devolutiva de advogado. Cliente que respondia falava com o vazio —
  inclusive pedido de titular de dados no `privacidade@`, que a LGPD (Art. 18) obriga a atender.
- **O código já está pronto e em produção** (12/08): e-mail vira **chamado** na tela de
  Atendimento, com badge "✉ por e-mail", a resposta sai por e-mail com `reply-to` tokenizado
  (`suporte+<token>@`) para o cliente continuar na mesma conversa, e dedup por Message-ID.
  Testado no banco. **Só falta o MX** — sem ele, nada chega.
- **O que fazer:** no painel de DNS do domínio, apontar o **MX** para o inbound do Resend
  (Resend → *Domains* → `bidprobrasil.com.br` → *Receiving/Inbound*), e confirmar que o webhook
  `email.received` aponta para `/api/inbound-juridico` com o segredo em `INBOUND_WEBHOOK_SECRET`.
  ⚠️ Mexer no MX afeta o recebimento do domínio inteiro — se hoje há caixa de e-mail nesse
  domínio em outro provedor, decidir antes quem fica com o MX.
- **Como saber que funcionou:** mande uma mensagem de fora para `suporte@bidprobrasil.com.br` e
  ela tem que aparecer em **Atendimento** como chamado novo, marcado "por e-mail".
- **Efeito colateral bom:** com o MX no ar, dá para usar `suporte@bidprobrasil.com.br` como
  e-mail de contato na G2RS/Google, que é o que aquelas regras pedem (domínio do e-mail = domínio
  do site). Hoje, sem isso, o contato precisa ser o `@reimob.com.br`.

### -1. 🔴 VERIFICAÇÃO DO ANUNCIANTE Google Ads (prazo: **02/09/2026** — anúncios PAUSAM se não fizer)

> ⏰ **Correção da data (12/08):** o prazo **não é 31/08**. O e-mail do Google de 03/08
> (`ads-account-noreply`) já traz **02 de setembro de 2026**. O de 01/08 dizia 31/08; foi
> reemitido. Vale a data mais recente.
- **Por quê:** e-mail oficial do Google (01/08) — a conta **475-979-5747** exige a "verificação
  do anunciante" (identidade do responsável/empresa; exigência padrão do Google, não é golpe).
  Sem concluir até **31/08**, a campanha "Pesquisa — Leilão de Imóveis (BR)" é pausada. O
  processo pode levar **até 7 dias úteis** — não deixar para a última semana.
- **Passos:** Google Ads → Faturamento/Central "Verificação do anunciante" (ou o botão
  "Iniciar a verificação" do próprio e-mail, conferindo que o link leva a ads.google.com) →
  enviar os dados/documentos da empresa (CNPJ) ou pessoais.
- **Depois:** nada muda no código; o rastreamento segue igual. Se pausar por atraso, o funil
  pago para de gerar cadastros (o 1º lead real chegou dia 01/08 — vale proteger).

#### 🔁 SEGUNDA REPROVA (11/08) — e o motivo agora é OUTRO

E-mail da **G2 Risk Solutions** (`g2no-reply@g2risksolutions.com`), que é a empresa por onde o
Google conduz esta verificação — o mesmo canal da reprova de 03/08, então **não é golpe novo**.
Ainda assim, a regra de sempre: **não clique no link do e-mail**; entre pelo site da G2RS ou pelo
painel do Google Ads e siga de lá.

| | 1ª reprova (03/08) | 2ª reprova (11/08) |
|---|---|---|
| Motivo | Nome divergente: preencheu como **pessoa física**, o Google leu o site e inferiu "Bid Pro Brasil" | **Categoria do negócio**: o formulário registrou **"Sou um mecanismo de busca"** |
| Correção | Refazer como **Organização** = `Nogueira Empreendimentos LTDA`, CNPJ **02.311.492/0001-61**, "BidPro Brasil" como nome fantasia + Cartão CNPJ | Refazer escolhendo a categoria que **descreve o produto**, não o formato do site |

**Por que essa categoria reprova, e por que é fácil errar:** o site *parece* um buscador — são 33
mil páginas de listagem (`/leiloes/sp/campinas` e afins) feitas justamente para o Google indexar.
Mas o que a BidPro vende não é busca: é **análise** — relatório de viabilidade, valor de mercado
da região, desconto real, custo de arrematação e retorno estimado. Buscar é o meio; o produto é o
laudo. A categoria deve refletir **serviços de informação / análise no setor imobiliário**, não
"mecanismo de busca".

**Passos:** site da G2RS → nova solicitação → escolher a opção de **"solicitação avaliada
anteriormente"** → informar o **código G2RS** que veio no envio original (está no e-mail da
primeira submissão) → revisar TODAS as opções do formulário e marcar as que descrevem o negócio.
Se você entender que a recusa foi engano, o caminho é **recurso** (mesmo código) — mas aqui não
parece engano: a categoria está mesmo errada.

⏰ **Prazo continua o mesmo (fim de agosto) e o processo leva até 7 dias úteis.** Já foram duas
rodadas; a terceira precisa sair esta semana para caber.

#### 📋 O FORMULÁRIO JÁ ESTÁ TODO DECIDIDO — só refazer com o radio certo (11/08, noite)

A submissão de 11/08 **não chegou a ser avaliada**: a tela devolveu *"Você não está qualificado
para enviar uma NOVA solicitação... a ID de cliente do Google já tem uma solicitação em
andamento"*. Ficou marcado **"Esta é uma nova solicitação"** na primeira pergunta. O certo é a
**segunda** — *"foi avaliada anteriormente… atualizar os campos de dados"* — que exige o
**código G2RS** do envio ORIGINAL (está no e-mail da primeira submissão, não no da recusa).
Sem o código: `FinancialServicesVerification@g2risksolutions.com`, citando a ID do Google Ads e o CNPJ.

Nada mais muda. Preencher assim:

| Campo | Valor |
|---|---|
| 1ª pergunta | **"foi avaliada anteriormente"** + código G2RS |
| Estado | Anunciante de **serviços não financeiros** |
| Modelo de negócios | **Outros** → `Análise e assessoria para arrematação de imóveis em leilão (relatórios de viabilidade e due diligence)` |
| Anexos (limite 2) | Contrato social + Cartão CNPJ |
| ID Google Ads | `4759795747` (sem traços; não é conta de gerente) |
| Nome fantasia | `BidPro Brasil` |
| Razão social | `Nogueira Empreendimentos LTDA` |
| Endereço | `Rua Barra Avenida, SN, Conj Barra do Mendes, Mangabeira, Feira de Santana – BA, CEP 44.056-536` |
| Telefone | `+55 71 99650-2234` (o Cartão CNPJ traz sem o 9º dígito — vale o que atende) |
| CNPJ / País | `02311492000161` / Brazil |
| Domínio | `bidprobrasil.com.br`, **só ele** |
| Campo do regulador (domínio e e-mail) | **em branco** — não somos regulados |
| E-mail de contato | `tarcisioaraujo@reimob.com.br` — é o que consta no **Cartão CNPJ anexado**, e recebe de verdade |
| Checkboxes | Garantia · Termos · Privacidade · Transferência p/ EUA e Vietnã |

**Texto de observações (736 de 750 caracteres), já validado:**
> Nova submissão após negativa anterior. A solicitação original marcou "sou um mecanismo de busca",
> o que não descreve a empresa: o site publica páginas de listagem por cidade para ser encontrado na
> busca, mas o que vendemos é o relatório de análise do imóvel, não a busca. Anexamos o Cartão CNPJ
> e o contrato social registrado na Junta Comercial da Bahia em 02/04/2025. A cláusula primeira do
> contrato altera o nome empresarial de CLUBE CONSELHEIRO para NOGUEIRA EMPREENDIMENTOS LTDA — o
> campo de nome fantasia do Cartão CNPJ ainda exibe o nome antigo. BidPro Brasil é a marca da
> plataforma, e os Termos de Uso em bidprobrasil.com.br/#/termos identificam a empresa como
> operadora. O objeto social não inclui nenhuma atividade financeira.

> 🔴 **O RISCO QUE SOBRA, e não se resolve neste formulário:** o perfil de pagamentos do Google
> mostra **TARCISIO DE SOUZA NOGUEIRA DE ARAUJO** (pessoa física) e a conta do Google Payments
> ainda se chama **"Clube Conselheiro"**. O formulário avisa que divergência com o nome verificado
> no Google causa atraso ou rejeição — foi o motivo da 1ª reprova. Abra o ajuste em
> `ads.google.com/aw/advertiserverification` em paralelo. Ressalva honesta: trocar perfil de
> pagamentos de pessoa física para empresa às vezes **não é editável** depois de criado.

### 0. ⭐ TESTAR a compra AVULSA da loja (ebook/curso) — no computador
- **Por quê:** o checkout avulso (Mercado Pago + Asaas) foi para produção nesta sessão; falta um teste real de ponta a ponta (o dono pediu para testar mais tarde).
- **Passos:**
  1. Use uma conta **SEM acesso** (explorador — não admin nem assinante; senão o fluxo devolve "você já tem acesso" e **não cobra**).
  2. *(Opcional p/ gastar pouco)* baixe o preço do ebook de teste para ~R$ 1 na aba **Configurações**.
  3. Em **Membros** abra o ebook → **"Comprar por R$X"** (ou a página `/#/p/ebook/:id`) → pague no MP/Asaas.
  4. Confira que a tela **libera sozinha** e aparece **"Ler eBook"**.
- **Pré-req:** webhook do Asaas/MP apontando p/ `/api/asaas-webhook` e `/api/mp-webhook` (os mesmos das assinaturas).
- **Depois que fizer:** me avisa o resultado (ou cole `select status,gateway,pago_em from compras_produtos order by criado_em desc limit 1;`) que eu confirmo pelos logs/banco e ajusto se precisar. Se comprou por link `?ref=CÓDIGO`, a comissão do parceiro aparece em `saldo_lancamentos` (origem_tipo `produto`).

### 1. Asaas — terminar o webhook (gateway de backup do Mercado Pago)
- **Por quê:** a fila do Asaas está pausada; o token já está na Vercel, falta o lado do painel.
- **Passos (painel Asaas → Configurações → Integrações → Webhooks):**
  - URL: `https://www.bidprobrasil.com.br/api/asaas-webhook` (com `www`)
  - Token de autenticação: **o mesmo** valor do `ASAAS_WEBHOOK_TOKEN` da Vercel
  - Eventos: pagamento (`PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`) + chargeback
  - Salvar e clicar em **Reativar fila**
- **Depois que fizer:** me avisa que eu **disparo a reconciliação do Asaas** e confirmo pelos logs/banco que está processando.

### 2. Upstash Redis — rate-limit global (grátis pra começar)
- **Por quê:** sem ele, o limite de requisições não vale entre instâncias na escala. O código já lê as variáveis sozinho (`UPSTASH_REDIS_REST_URL`/`TOKEN` ou `KV_REST_API_URL`/`TOKEN`).
- **Passos (painel Vercel → projeto tsn-app):**
  - Storage (ou Integrations → Marketplace) → **Create Database → Upstash → Redis**
  - Região São Paulo (`sa-east-1`), plano **Free** (10 mil comandos/dia)
  - **Connect to Project → tsn-app** (Production + Preview) → **Redeploy**
- **Depois que fizer:** me avisa que eu **verifico pelos logs** se o L2 ligou de verdade.

### 3. PECINI — validar a captura de documentos (1 rodada, grátis)
- **Por quê:** o scraper do PECINI **já foi ensinado** a extrair os PDFs da página (matrícula/edital/laudo → `link_matricula`/`link_edital`/`anexos`), mas a página é **Cloudflare-gated** e só abre pelo Bright Data (token é segredo do GitHub) — **não dá para validar automaticamente daqui**. É a única fonte ainda com 0% de matrícula.
- **Passos (GitHub → Actions → workflow do PECINI):**
  - Rodar 1x com `PECINI_DRYRUN=1` (não grava) e conferir no log se os links `.pdf` vêm corretos (padrão `/arquivos/Leiloes/Docs/…`).
  - Se estiver certo, rodar com `PECINI_DRYRUN=0` para gravar.
- **Depois que fizer:** me avisa que eu **confirmo pelo banco** a cobertura de matrícula/edital e marco o PECINI como `docs_status='ok'` (sai do alerta semanal de cobertura). Se algum PDF cair no Cloudflare no download, aí sim aciono o Bright Data como suporte.

---

## 🟡 Fazer quando os usuários PAGOS crescerem — exigem assinar plano

### 3. Resend — sair do plano gratuito
- **Por quê:** o gratuito envia só **100 e-mails/dia**. O cron de alertas já processa em lotes encadeados (não perde ninguém), mas o teto de envio é do Resend.
- **Passo:** assinar um plano Resend que cubra o volume de e-mails/dia esperado.
- **Depois que fizer:** eu **ligo a API de lote** do Resend (`/emails/batch`, 100 msgs/chamada) — corte grande no tempo de envio.

### 4. Supabase — upgrade de compute
- **Por quê:** no gratuito, o banco satura na carga combinada de busca (contagem + raio + RLS) quando os usuários entram nas centenas/milhares.
- **Passo:** subir o tamanho do compute (e considerar read replica para a busca) antes do lançamento em massa.
- **Depois que fizer:** eu faço o **pente-fino de índices/consultas** (dedup de índices, composites, `count: estimated`) alinhado ao novo compute.

### 5. Supabase — proteção de senha vazada (HaveIBeenPwned)
- **Por quê:** bloqueia cadastro/login com senhas já vazadas. Recurso do plano pago do Supabase Auth.
- **Passo:** painel Supabase → Authentication → Policies/Settings → ativar **Leaked password protection** (toggle de 1 clique).
- **Depois que fizer:** nada no código — o auditor de segurança já considera isso na postura.

---

## ✔️ Já resolvidos (não precisa mais)
- **VAPID (push):** 3 variáveis na Vercel — **confirmado por você.**
