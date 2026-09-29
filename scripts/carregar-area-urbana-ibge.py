"""
Carrega a ÁREA URBANA de cada município (setores censitários do IBGE, Censo 2022) no banco,
para classificar imóvel urbano × rural PELA LOCALIZAÇÃO (tabela area_urbana_municipio,
função situacao_geo, migração 20260929_area_urbana_ibge.sql).

Roda no runner do GitHub (a nuvem do Claude não alcança o IBGE). Custo: zero — arquivo público.

Modos (env MODO):
  seco   (padrão) — baixa, processa e IMPRIME: arquivos achados, colunas, contagem urbano/rural,
                    tamanho do que seria gravado e a situação de pontos conhecidos. Não grava.
                    É o "rodar em seco sobre dado real antes de gravar" da forma #10 do CLAUDE.md.
  gravar           — grava por UF, registra a carga e reclassifica os imóveis ativos da UF.
Env: UFS (opcional, ex. "SP,MG") · VITE_SUPABASE_URL · SUPABASE_SERVICE_KEY.
"""
import json, os, re, sys, time, urllib.request, zipfile, tempfile
from html.parser import HTMLParser

import geopandas as gpd
import shapely
from shapely.geometry import Point, mapping

BASE = ('https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/'
        'malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/')
UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE',
       'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
MODO = os.environ.get('MODO', 'seco')
SO_UFS = [u.strip().upper() for u in os.environ.get('UFS', '').split(',') if u.strip()]
SB_URL = os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL')
SB_KEY = os.environ.get('SUPABASE_SERVICE_KEY')
TOLERANCIA = 0.0001   # ~11 m: bem abaixo da margem mínima da divisa (150 m) em situacao_geo()
LOTE_BYTES = 3_000_000

# Pontos de conferência: a situação deles é conhecida de cabeça (forma nº 8 — validar contra o
# que se sabe, não contar preenchidos). None = só imprimir.
PONTOS = [
    ('SP', 'Praça da Sé, São Paulo', -23.5503, -46.6339, 'urbana'),
    ('SP', 'Centro de Araraquara', -21.7945, -48.1756, 'urbana'),
    ('SP', 'Lote Araraquara (webleiloes_2083)', -21.7165947, -48.1521427, None),
    ('SP', 'Lote Embu-Guaçu (leilaobrasil_449)', -23.8314512, -46.811523, None),
    ('MG', 'Parque Nacional da Serra da Canastra', -20.2500, -46.6000, 'rural'),
    ('AM', 'Floresta no meio do Amazonas', -5.0000, -63.0000, 'rural'),
]


class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.hrefs = []
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            for k, v in attrs:
                if k == 'href' and v and not v.startswith(('?', '/', 'http', '../')):
                    self.hrefs.append(v)


def listar(url, prof=0):
    """Zips do diretório do IBGE (profundidade limitada)."""
    with urllib.request.urlopen(url, timeout=60) as r:
        p = Links(); p.feed(r.read().decode('utf-8', 'replace'))
    achados = []
    for h in p.hrefs:
        if h.lower().endswith('.zip'):
            achados.append(url + h)
        elif h.endswith('/') and prof < 3:
            achados += listar(url + h, prof + 1)
    return achados


def arquivo_da_uf(zips, uf):
    """Prefere GeoPackage; aceita shapefile. Nome do IBGE começa pela sigla (SP_setores_CD2022...)."""
    cands = [z for z in zips if re.match(rf'^{uf}_', z.rsplit('/', 1)[1], re.I)]
    cands.sort(key=lambda z: (0 if 'gpkg' in z.lower() else 1, len(z)))
    return cands[0] if cands else None


def coluna(df, nomes):
    for n in nomes:
        for c in df.columns:
            if c.upper() == n:
                return c
    return None


def eh_urbano(df):
    """Máscara de setor urbano. Falha ALTO se não achar a coluna — sem ela, tudo sairia rural."""
    c_sit = coluna(df, ['SITUACAO', 'NM_SIT', 'SITUACAO_SETOR'])
    if c_sit is not None:
        v = df[c_sit].astype(str).str.strip().str.lower()
        return v.str.startswith('urban'), c_sit
    c_cd = coluna(df, ['CD_SIT', 'CD_SITUACAO'])
    if c_cd is not None:   # Censo 2022: 1, 2 e 3 = urbano; 5 a 8 = rural; 9 = massa d'água
        return df[c_cd].astype(str).str.strip().isin(['1', '2', '3']), c_cd
    raise SystemExit(f'Coluna de situação não encontrada. Colunas: {list(df.columns)}')


def rpc(nome, corpo):
    req = urllib.request.Request(f'{SB_URL}/rest/v1/rpc/{nome}', data=json.dumps(corpo).encode(),
                                 method='POST', headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}',
                                                         'Content-Type': 'application/json'})
    for tentativa in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                txt = r.read().decode()
                return json.loads(txt) if txt else None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code < 500 or tentativa == 3:
                raise SystemExit(f'RPC {nome} falhou: HTTP {e.code} {msg}')
        except urllib.error.URLError as e:
            if tentativa == 3:
                raise SystemExit(f'RPC {nome} falhou: {e}')
        time.sleep(2 ** (tentativa + 1))


def processar_uf(uf, url):
    with tempfile.TemporaryDirectory() as tmp:
        caminho = os.path.join(tmp, 'uf.zip')
        urllib.request.urlretrieve(url, caminho)
        nomes = zipfile.ZipFile(caminho).namelist()
        alvo = next((n for n in nomes if n.lower().endswith('.gpkg')), None) \
            or next((n for n in nomes if n.lower().endswith('.shp')), None)
        if not alvo:
            raise SystemExit(f'{uf}: zip sem .gpkg/.shp ({nomes[:5]})')
        df = gpd.read_file(f'zip://{caminho}!{alvo}')
    df = df.to_crs(4326)
    urb, c_sit = eh_urbano(df)
    c_mun = coluna(df, ['CD_MUN', 'CD_MUNICIPIO', 'CD_GEOCODM'])
    c_nome = coluna(df, ['NM_MUN', 'NM_MUNICIPIO'])
    if c_mun is None:
        raise SystemExit(f'{uf}: coluna de município não encontrada. Colunas: {list(df.columns)}')
    municipios = []
    for cd, grupo in df.groupby(c_mun):
        g_urb = grupo[urb.loc[grupo.index]]
        geom = None
        if len(g_urb):
            u = shapely.union_all(g_urb.geometry.values)
            u = shapely.set_precision(u.simplify(TOLERANCIA, preserve_topology=True), 1e-6)
            if not u.is_empty:
                geom = u
        municipios.append({'cd_mun': str(cd), 'nome': str(grupo[c_nome].iloc[0]) if c_nome else None,
                           'uf': uf, 'n': int(len(g_urb)), 'geom': geom})
    resumo = {'uf': uf, 'arquivo': url.rsplit('/', 1)[1], 'coluna_situacao': c_sit,
              'valores_situacao': df[c_sit].astype(str).value_counts().head(8).to_dict(),
              'setores': int(len(df)), 'setores_urbanos': int(urb.sum()), 'municipios': len(municipios),
              'municipios_sem_area_urbana': sum(1 for m in municipios if m['geom'] is None)}
    return municipios, resumo


def situacao_local(municipios, lat, lng):
    pt = Point(lng, lat)
    for m in municipios:
        if m['geom'] is not None and m['geom'].contains(pt):
            return 'urbana', m['nome']
    return 'rural', None


def gravar(uf, municipios, resumo):
    lote, tam, total = [], 0, 0
    for m in municipios:
        gj = json.dumps(mapping(m['geom'])) if m['geom'] is not None else None
        item = {'cd_mun': m['cd_mun'], 'nome': m['nome'], 'uf': uf, 'n': m['n'], 'geojson': gj}
        tam_item = len(gj or '') + 200
        if lote and tam + tam_item > LOTE_BYTES:
            total += rpc('carregar_area_urbana', {'p': lote}); lote, tam = [], 0
        lote.append(item); tam += tam_item
    if lote:
        total += rpc('carregar_area_urbana', {'p': lote})
    if total != len(municipios):
        raise SystemExit(f'{uf}: gravou {total} de {len(municipios)} municípios — carga NÃO registrada')
    # Só registra a carga (que libera o "rural") depois de TODOS os municípios gravados.
    rpc('registrar_carga_area_urbana', {'p_uf': uf, 'p_municipios': resumo['municipios'], 'p_setores': resumo['setores'],
                                        'p_urbanos': resumo['setores_urbanos'], 'p_arquivo': resumo['arquivo']})
    reclass = 0
    while True:
        n = rpc('reclassificar_situacao_geo', {'p_uf': uf, 'p_limite': 300})
        reclass += n or 0
        if not n:
            break
    return total, reclass


def main():
    if MODO == 'gravar' and not (SB_URL and SB_KEY):
        raise SystemExit('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY')
    zips = listar(BASE)
    print(f'{len(zips)} zip(s) no diretório do IBGE. Amostra: {[z.rsplit("/", 1)[1] for z in zips[:6]]}')
    ufs = SO_UFS or UFS
    faltando = [uf for uf in ufs if not arquivo_da_uf(zips, uf)]
    if faltando:
        raise SystemExit(f'Sem arquivo para: {faltando}. Nada gravado.')
    falhas_ponto = 0
    for uf in ufs:
        url = arquivo_da_uf(zips, uf)
        municipios, resumo = processar_uf(uf, url)
        tam = sum(len(json.dumps(mapping(m['geom']))) for m in municipios if m['geom'] is not None)
        print(json.dumps({**resumo, 'geojson_mb': round(tam / 1e6, 1)}, ensure_ascii=False))
        for (p_uf, nome, lat, lng, esperado) in PONTOS:
            if p_uf != uf:
                continue
            s, mun = situacao_local(municipios, lat, lng)
            ok = esperado is None or s == esperado
            falhas_ponto += 0 if ok else 1
            print(f'   ponto {nome}: {s}{f" ({mun})" if mun else ""}' + ('' if ok else f'  ✗ esperado {esperado}'))
        if MODO == 'gravar':
            if falhas_ponto:
                raise SystemExit('Ponto de conferência errado — carga interrompida antes de gravar esta UF.')
            total, reclass = gravar(uf, municipios, resumo)
            print(f'   ✅ {uf}: {total} municípios gravados · {reclass} imóveis reclassificados')
    if falhas_ponto:
        sys.exit(1)
    if MODO != 'gravar':
        print('\nSeco: nada gravado. Para gravar, rode com MODO=gravar.')


if __name__ == '__main__':
    main()
