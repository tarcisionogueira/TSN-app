# Código da Marca — BidPro Brasil

Referência oficial para telas, logomarcas e materiais. **Toda tela nova deve seguir
este documento.** Fonte: brandbook oficial da BidPro Brasil.

> Tagline: **"O ecossistema completo para investidores em leilões."**
> Sub-linha da marca: **LEILÃO & INVESTIMENTOS**

---

## 1. Paleta de cores

| Uso | Nome | HEX |
|---|---|---|
| Azul principal (marca, botões, links) | Azul Principal | `#0D63DB` |
| Azul escuro (profundidade, hover, gradientes) | Azul Escuro | `#0B4BA6` |
| Preto (texto, navbar, fundos escuros) | Preto | `#111111` |
| Cinza claro (fundos, bordas, superfícies) | Cinza Claro | `#EAEAEA` |
| Branco | Branco | `#FFFFFF` |

Regra: o **ícone da marca** vive num quadrado **arredondado azul `#0D63DB`**; o "B"
é branco. Gradientes usam `#0D63DB → #0B4BA6`.

---

## 2. Tipografia

- **League Spartan** — títulos e destaques (pesos 700/800/900).
- **Open Sans** — textos e informações (400/600/700).

Já carregadas no `index.html` (Google Fonts). Não misturar outras famílias.

---

## 3. Conceito da marca

O "B" é a soma de três ideias:

```
B  =  Leilão (martelo)  +  Crescimento (seta/gráfico)  +  Letras B + P (BidPro)
```

Por isso o "B" oficial é **geométrico e em camadas**, com um **corte diagonal**
(a "seta" de crescimento) — NÃO é um "B" tipográfico comum. **Não recriar à mão:**
usar sempre o arquivo vetorial oficial (ver seção 6).

---

## 4. Versões da marca

- **Horizontal** — ícone + "BidPro Brasil" + sub-linha "BRASIL/LEILÃO & INVESTIMENTOS".
  Versão para fundo claro e versão para fundo escuro.
- **Ícone (app)** — só o "B" no quadrado azul arredondado.

Wordmark: "**Bid**" branco/preto + "**Pro**" em azul `#0D63DB` + "BRASIL" com traços.

---

## 5. Ícones do sistema (linha, azul `#0D63DB`)

| Função | Ícone |
|---|---|
| Busca | lupa |
| Análise | documento |
| Arremate | martelo |
| Oportunidades | alvo |
| Comunidade | pessoas |
| Segurança | escudo |

Pilares de comunicação: **Foco em oportunidades · Segurança e transparência ·
Inteligência e resultados · Comunidade de investidores.**

Redes: **@bidprobrasil** (Instagram, YouTube, Facebook, LinkedIn).

---

## 6. Arquivos da marca no projeto

O logo é aplicado por um único conjunto de arquivos — trocar o "B" aqui reflete em
TODAS as telas:

- `public/logo.svg` — lockup horizontal (ícone + wordmark "BidPro Brasil") usado no `Header`.
- `src/components/LogoB.jsx` — só o "B" (dentro do quadrado azul), usado em
  Checkout, Footer, Convite, Completar Cadastro, Redefinir Senha.
- `public/favicon.svg` + `favicon-*.png` — ícone da aba/app.

O "B" atual é **geométrico e limpo** (uma silhueta sólida + duas contra-formas),
reconstruído a partir do código da marca — não é mais o traçado "à mão". As três
peças usam exatamente a mesma geometria (viewBox `0 0 48 48`), então ficam nítidas
em qualquer tamanho, do favicon (16px) ao lockup do header.

### Se houver um vetor oficial isolado do "B"

Basta enviar o **`.svg` isolado do "B"** (só o "B", com as cores da marca — de
preferência o vetor original, não um traço preto do brandbook inteiro). Com ele eu:
1. Substituo a geometria do "B" em `LogoB.jsx`, `logo.svg` e `favicon.svg`.
2. Todas as telas passam a exibir o vetor oficial automaticamente.

> Observação: o arquivo `.svg` do brandbook que veio como **traço monocromático da
> página inteira** (mockups, swatches e wordmark fundidos em `fill="#000000"`) não
> serve como ícone — por isso o "B" foi reconstruído limpo seguindo este código.
