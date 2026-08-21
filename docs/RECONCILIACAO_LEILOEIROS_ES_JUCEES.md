# Reconciliação — Leiloeiros JUCEES (Espírito Santo) · 21/08/2026

Lista pública da Junta Comercial do ES (36 cadastros; 18 com site informado). Reconciliada contra
`leiloeiro_conhecimento` e `imoveis_leilao`.

> ⚠️ **Recon de plataforma NÃO foi possível deste ambiente.** A política de rede do proxy de dev
> bloqueia CONNECT a hosts externos (403 — só npm/GitHub/Supabase/Anthropic passam). A detecção de
> plataforma e a construção/validação de scraper têm de rodar pela **engine de captura em produção
> (Bright Data)**, não daqui. Abaixo está o que dá para afirmar sem acessar os sites: reconciliação
> por nome/estado e o sinal de atividade que a própria JUCEES publica.

## Já cobertos (nenhuma ação)
| Leiloeiro | Site | Como já entra | Ativos hoje |
|---|---|---|---|
| **Hidirlene Duszeiko** | hdleiloes.com.br | agregador **LJUD** | 37 |
| **Alessandro de Assis Teixeira** | (sem site) | agregador **LJUD** | 11 |

O LJUD agrega ~40 leiloeiros; estes dois do ES já vêm por ele.

## Candidato prioritário (registrado como `candidato` em leiloeiro_conhecimento)
| Leiloeiro | Site | Histórico JUCEES | Ação |
|---|---|---|---|
| **Sued Peter Bastos Dyna** | suedpeterleiloes.com.br | **21 leilões** | fonte `SUEDPETER` criada (docs_status=`candidato`); recon+scraper em produção |

É o ÚNICO ainda-não-integrado com atividade relevante. Os demais têm **0** no histórico da JUCEES.

## Sem atividade (0 no histórico JUCEES) — não vale integrar agora
vixleiloes.com.br · esleiloes.com.br · leilofacil.lel.br (403) · colodeteleiloes.com.br ·
emleilao.com.br · renannerisleiloeiro.com.br · portoleiloes.com.br · gbleiloes.com.br ·
hoppeleiloes.com.br · maleiloesro.com.br (RO) · ruamgotardoleiloes.com.br ·
gustavomorettoleiloeiro.com.br · danielgarcialeiloes.com.br · lubreleiloes.leilao.br

Revisar se algum passar a ter leilões. Integrar site que não faz leilão é acervo vazio com custo
de manutenção.

## Portal à parte
**leilaobrasil.com.br** (Irani Flores) — portal nacional, não regional. Já avaliado antes: home
com poucos lotes SSR e catálogo atrás de SPA/Cloudflare (não é o SSR barato que o mapa sugeria).
Fica no backlog geral de captura, não neste lote do ES.

## Recon PRONTO para produção — `scripts/recon-leiloeiros-es.mjs`

Roda em produção (tem Bright Data; a rede de dev bloqueia host externo). Para cada um dos 15 sites
(Sued Peter primeiro), responde as DUAS perguntas do dono:

1. **Roda plataforma que já suportamos?** Mapeia a assinatura do HTML → scraper existente
   (Superbid/MBV→emiliomatos, Soleon→soleon, Zukerman→ZUK, LeilãoPro→leilaopro, Sato→sato,
   GestãoLeilões→gestao). Se sim, **registrar já** — quando o leiloeiro listar imóvel, o scraper
   puxa sozinho, custo ~zero.
2. **"0 leilão" é AGORA ou NUNCA?** Além das rotas de imóvel ativo, sonda `/encerrados`,
   `/realizados` etc. **Ativo=0 mas encerrados>0 = TEM histórico → registrar** (regra do dono:
   "quando houver imóveis o sistema puxa"). Ativo=0 e encerrados=0 → sem rastro, aguardar.

Como rodar (produção, com as envs Bright Data):
```
BRIGHTDATA_API_TOKEN=… BRIGHTDATA_ZONE=… node scripts/recon-leiloeiros-es.mjs
# só um: PROBE_DOMS=suedpeterleiloes.com.br node scripts/recon-leiloeiros-es.mjs
```
O RESUMO final classifica cada site: ✅ tem imóvel agora · 🟢 plataforma suportada (registrar) ·
🟡 0 agora mas com histórico (registrar) · ⚪ site no ar sem nada (aguardar) · ❌ inacessível.

**Regra de decisão (do dono):** plataforma suportada **OU** histórico>0 → registra o leiloeiro
mesmo com 0 lote agora. O sistema passa a puxar assim que ele listar imóvel. Só "site no ar sem
nada" fica em espera.

> Nota sobre os "0 do JUCEES": o número da JUCEES é o histórico DELES. Nenhum dos não-cobertos
> (fora Sued Peter) jamais apareceu no nosso acervo — mas isso só prova que não passam por
> plataforma que já raspamos. O recon acima é que decide, pelo site, se têm rastro próprio.
