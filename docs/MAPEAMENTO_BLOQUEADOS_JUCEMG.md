# 🗺️ Mapeamento dos 53 bloqueados da JUCEMG — dá para trazer pelo residencial?

**53 sites · 57 leiloeiros.** É o resíduo da triagem de 29/08 (141 sites): os que recusaram o
acesso grátis da CI. Hoje eles entram na conta como *"custa Bright Data"* — e em **51 deles a
coluna `plataforma` está NULA**, o que **não** quer dizer "não roda plataforma conhecida": quer
dizer que o HTML **nunca foi lido**.

Este documento responde à pergunta do dono — *"conseguimos rodar esses 53 pelo residencial?"* — com
o que dá para afirmar hoje, e diz explicitamente o que **não** dá.

---

## A resposta curta

| Grupo | Sites | Leiloeiros | Mecanismo | Prognóstico pelo residencial |
|---|---|---|---|---|
| **A — Cloudflare** | **47** | **51** | `server: cloudflare` + título *"Just a moment..."*, HTTP 403 | ✅ **Alta confiança** |
| **B — AWS ELB** | 5 | 5 | `server: awselb/2.0`, 403 **sem** desafio do Cloudflare | ⚠️ **Incerto** — é outro mecanismo |
| **C — Wordfence** | 1 | 1 | 503, *"Seu acesso a este site foi limitado pelo…"* | ⚠️ Bloqueio por reputação de IP |

### Por que o grupo A é alta confiança, e não chute

**Não é hipótese: é o mesmo bloqueio que já vencemos.** `GESTAOLEILOES` e `RJ Leilões` estavam
exatamente neste estado — Cloudflare recusando a CI — e hoje **rodam pelo runner residencial**
com `GESTAO_HEADLESS=1` / `RJ_HEADLESS=1`, usando o **mesmo** `fetch-residencial.mjs` que a
triagem passou a usar. O mecanismo de bloqueio é idêntico, o código que o vence é o mesmo, e a
diferença é só o IP de origem.

O `fetchHeadless` já trata o caso específico: espera o desafio resolver, e o cookie `cf_clearance`
persiste entre páginas — da segunda em diante quase não há desafio.

### Por que o grupo B é incerto

`awselb/2.0` devolvendo 403 **sem** o desafio do Cloudflare é recusa de outra natureza — WAF,
regra por ASN/geografia, ou rate-limit no load balancer. IP residencial brasileiro **pode**
resolver (se a regra for por ASN de datacenter) ou **não** (se for allowlist). Só medindo.

---

## ⚠️ O que NÃO foi possível confirmar, e por quê

**A viabilidade não pôde ser testada nesta sessão** — e a limitação é do ambiente, não do código:

```
curl  → CONNECT tunnel failed, response 403   (para os 53 domínios)
Chromium (puppeteer) → net::ERR_TUNNEL_CONNECTION_FAILED   (até para example.com)
```

O proxy do ambiente de agente recusa o túnel para praticamente todo host externo. **É a mesma razão
pela qual o runner residencial existe:** IP de datacenter (CI, Vercel, este container) é justamente
o que o Cloudflare recusa.

**O que ficou provado aqui:**
- ✅ `puppeteer` instalado e **Chromium sobe** (boot real, navegação tentada);
- ✅ quando o headless não consegue, `fetchHeadless` devolve **`null`**, e `pegar()` **mantém o site
  como bloqueado** em vez de fabricar um 200 vazio — a garantia que impede um site de sair da lista
  **sem nunca ter sido lido**.

**O que só o dono pode provar:** rodar `scripts/runner-residencial.sh` de casa. O passo já está lá,
e imprime `DESTRAVADOS pelo residencial: N de 53`.

---

## O que já se sabe antes mesmo de rodar

- **2 sites já têm parser pronto** — `adrianoleiloeiro.com.br` e `angelabecharaleiloes.com.br`,
  ambos **Superbid** (`scripts/lib/motor/fontes/emiliomatos.mjs`). Se destravarem, entram por
  **configuração de tenant**, sem parser novo. São o primeiro lugar para olhar no log.
- **2 já têm lote no acervo** — `mozarmirandaleiloes.com.br` e `topoleiloes.com.br` aparecem em
  `imoveis_leilao.url_lote`. Ou seja: o conteúdo deles **já chega até nós por outra via**. Isso é
  evidência de que o acervo é alcançável, e um bom controle para conferir se a triagem residencial
  classifica certo.
- **45 dos 47 do grupo A** têm `server: cloudflare` explícito; os outros 2 expõem host interno da
  AWS (`ip-10-124-4-x.us-west-2.compute.internal`) mas com o mesmo *"Just a moment..."*.

---

## Como ler o resultado quando rodar

```
[triagem] BLOQUEADOS do banco · 53 domínio(s) · via Chromium residencial
[triagem] DESTRAVADOS pelo residencial: N de 53
[triagem] …e M JÁ TÊM PARSER (entram por configuração):
[triagem] seguem exigindo Bright Data: K
```

**A conta que interessa** não é quantos destravaram, é **quantos destravaram COM parser pronto** —
essa é a diferença entre *configurar um tenant* (minutos) e *escrever parser novo* (dias).

> ⚠️ **Plataforma descoberta NÃO é lote coletado.** Em 29/08, **11 sites** classificados como
> Superbid enumeraram **ZERO** lotes no dry-run: a assinatura de HTML provava que o site
> *menciona* a plataforma, não que *roda* o catálogo dela. **Dry-run antes de subir tenant** — sem
> exceção. Subir 11 tenants estéreis polui log e saúde com vazio permanente.

## Custo

**R$ 0.** A triagem nunca chama Bright Data — nem antes, nem agora. O que mudou é que o "de graça"
passou a alcançar quem está atrás do Cloudflare. O custo é tempo de Chromium na máquina de casa:
~53 páginas, uma por vez, com jitter — ordem de poucos minutos.

Para efeito de comparação, se estes 53 fossem pelo caminho pago: o consumo medido é de **~45
requisições/semana por fonte** (`soleon` 112 para 3 tenants, `rj` 60, `pecini` 63, `gestao` 60) —
contra um teto semanal que em 29/08 estava **saturado em 550/550**. Não caberia.
