# Cortes de vídeo locais (FFmpeg + faster-whisper) — substituto do OpusClip. Pendência 476.
# Roda em C:\Servidor. Pede confirmação antes de CADA instalação. Não mexe em energia, BIOS,
# antivírus, firewall nem BitLocker. Não usa nem grava segredo nenhum.
#
# Uso (PowerShell, na pasta onde estão este arquivo e transcrever.py):
#   powershell -ExecutionPolicy Bypass -File .\cortes-local.ps1            # tudo, em ordem
#   powershell -ExecutionPolicy Bypass -File .\cortes-local.ps1 -Etapa diag  # diag|instalar|teste|teste4k
# Resultado: C:\Servidor\relatorio.md (para ler) e C:\Servidor\resultado.json (para colar no Claude).

param([ValidateSet('tudo', 'diag', 'instalar', 'teste', 'teste4k')][string]$Etapa = 'tudo')
$ErrorActionPreference = 'Stop'
$Base = 'C:\Servidor'
$Venv = "$Base\venv"
$Py = "$Venv\Scripts\python.exe"
New-Item -ItemType Directory -Force $Base, "$Base\teste", "$Base\saida" | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'transcrever.py') "$Base\transcrever.py"
$Rel = "$Base\relatorio.md"
$ResFile = "$Base\resultado.json"
$R = if (Test-Path $ResFile) { Get-Content $ResFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'

function Set-R($k, $v) { $R | Add-Member -Force -NotePropertyName $k -NotePropertyValue $v; $R | ConvertTo-Json -Depth 8 | Set-Content $ResFile -Encoding UTF8 }
function Out-Rel($t) { Add-Content -Path $Rel -Value $t -Encoding UTF8; Write-Host $t }
function Confirma($msg) { (Read-Host "$msg`n  Confirmar instalação? (S/N)") -match '^[sS]' }
function Atualiza-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Tem($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
# Roda o ffmpeg e devolve sucesso + log (o PowerShell 5.1 trataria o stderr dele como erro).
function FF([string[]]$a) {
  $ErrorActionPreference = 'Continue'  # stderr do ffmpeg é log, não exceção
  $txt = & ffmpeg @a 2>&1 | Out-String
  [pscustomobject]@{ ok = ($LASTEXITCODE -eq 0); log = $txt }
}

# ============================== 1. DIAGNÓSTICO (só leitura) ==============================
function Diagnostico {
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $cs = Get-CimInstance Win32_ComputerSystem
  $os = Get-CimInstance Win32_OperatingSystem
  $part = Get-Partition -DriveLetter C
  $pd = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq "$($part.DiskNumber)" } | Select-Object -First 1
  $livre = [math]::Round((Get-PSDrive C).Free / 1GB, 0)
  $gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic Display|Remote|Virtual|Parsec' } | ForEach-Object { "$($_.Name) (driver $($_.DriverVersion))" })
  $nvidia = Tem 'nvidia-smi'
  $nvInfo = if ($nvidia) { (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null) -join '; ' } else { '' }

  # app Claude: instalador (registro), pacote MSIX ou CLI
  $claude = @()
  $chaves = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  $claude += Get-ItemProperty $chaves -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^Claude' } | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" }
  $claude += Get-AppxPackage -Name '*Claude*' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) $($_.Version)" }
  if (Tem 'claude') { $claude += "Claude Code CLI $((& claude --version 2>$null) -join ' ')" }
  if (-not $claude) { $claude = @('não encontrado') }

  $d = [ordered]@{
    processador = "$($cpu.Name.Trim()) — $($cpu.NumberOfCores) núcleos / $($cpu.NumberOfLogicalProcessors) threads"
    nucleos = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors
    ram_gb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 0)
    disco_c = "$($pd.FriendlyName) — $($pd.MediaType) ($($pd.BusType))"
    livre_c_gb = $livre
    windows = "$($os.Caption) $($os.Version) (build $($os.BuildNumber))"
    placas_video = ($gpus -join ' | ')
    nvidia = $nvidia; nvidia_info = $nvInfo
    app_claude = ($claude -join ' | ')
  }
  Set-R 'diagnostico' $d
  Out-Rel "`n## 1. Diagnóstico — $(Get-Date -Format 'dd/MM/yyyy HH:mm')`n"
  Out-Rel '| Item | Valor |'; Out-Rel '|---|---|'
  foreach ($k in 'processador', 'ram_gb', 'disco_c', 'livre_c_gb', 'windows', 'placas_video', 'nvidia_info', 'app_claude') { Out-Rel "| $k | $($d[$k]) |" }
  if ($livre -lt 30) { Out-Rel "`n**ATENÇÃO:** só $livre GB livres no C:. Um 4K de 15 min + modelos pedem ~15 GB." }
  if (Tem 'ffmpeg') { Teste-Hardware } else { Out-Rel "`n(Aceleração por hardware: testada depois que o FFmpeg for instalado.)" }
}

# Testa de VERDADE (codifica/decodifica 1 s), em vez de confiar na lista de encoders do build.
function Teste-Hardware {
  $t = "$Base\teste\_hw"; New-Item -ItemType Directory -Force $t | Out-Null
  $hw = [ordered]@{}
  foreach ($e in 'hevc_nvenc', 'hevc_qsv', 'hevc_amf') {
    $hw["codifica_4K_$e"] = (FF @('-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30', '-t', '1', '-c:v', $e, '-f', 'null', '-')).ok
  }
  foreach ($e in 'h264_nvenc', 'h264_qsv', 'h264_amf') {
    $hw["codifica_9x16_$e"] = (FF @('-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30', '-t', '1', '-pix_fmt', 'nv12', '-c:v', $e, '-f', 'null', '-')).ok
  }
  # amostra HEVC 4K para testar a DECODIFICAÇÃO (com encoder de hardware se houver; senão x265)
  $encAmostra = @('hevc_nvenc', 'hevc_qsv', 'hevc_amf') | Where-Object { $hw["codifica_4K_$_"] } | Select-Object -First 1
  if (-not $encAmostra) { $encAmostra = 'libx265' }
  $null = FF @('-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30', '-t', '3', '-c:v', $encAmostra, '-preset', 'fast', "$t\hevc4k.mp4")
  # hwdownload falha se o quadro NÃO veio da GPU: o teste não aceita a queda silenciosa para CPU
  $hw['decodifica_HEVC_4K_d3d11va'] = (FF @('-hide_banner', '-hwaccel', 'd3d11va', '-hwaccel_output_format', 'd3d11', '-i', "$t\hevc4k.mp4", '-vf', 'hwdownload,format=nv12', '-f', 'null', '-')).ok
  $sw = [Diagnostics.Stopwatch]::StartNew(); $null = FF @('-hide_banner', '-hwaccel', 'd3d11va', '-i', "$t\hevc4k.mp4", '-f', 'null', '-'); $sw.Stop()
  $hw['decodifica_HEVC_4K_fps'] = [math]::Round(90 / [math]::Max($sw.Elapsed.TotalSeconds, 0.01), 0)
  $enc = @('h264_nvenc', 'h264_qsv', 'h264_amf') | Where-Object { $hw["codifica_9x16_$_"] } | Select-Object -First 1
  $hw['encoder_escolhido'] = if ($enc) { $enc } else { 'libx264 (CPU)' }
  Set-R 'hardware' $hw
  Out-Rel "`n**Aceleração de vídeo (testada de verdade):**`n"
  Out-Rel '| Teste | Resultado |'; Out-Rel '|---|---|'
  $hw.GetEnumerator() | ForEach-Object { Out-Rel "| $($_.Key) | $(if ($_.Value -is [bool]) { if ($_.Value) { 'SIM' } else { 'não' } } else { $_.Value }) |" }
}

# ============================== 2. INSTALAÇÃO ==============================
function Modelo {
  $d = $R.diagnostico
  if ($d.nvidia) { return @{ m = 'large-v3'; dev = 'cuda'; c = 'int8_float16' } }
  if ($d.nucleos -ge 6 -and $d.threads -ge 8 -and $d.ram_gb -ge 12) { return @{ m = 'medium'; dev = 'cpu'; c = 'int8' } }
  return @{ m = 'small'; dev = 'cpu'; c = 'int8' }
}

function Instalar {
  if (-not $R.diagnostico) { Diagnostico }
  if (-not (Tem 'winget')) { throw 'winget não encontrado (instale o "Instalador de Aplicativo" pela Microsoft Store) e rode de novo.' }
  if (Tem 'ffmpeg') { Out-Rel "`n- FFmpeg já instalado." }
  elseif (Confirma 'Instalar FFmpeg (winget Gyan.FFmpeg, ~100 MB)?') {
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements; Atualiza-Path
    Out-Rel "`n- FFmpeg instalado via winget."
  }
  else { Out-Rel '- FFmpeg: instalação recusada.'; return }

  $tem311 = $false; try { $tem311 = ((& py -3.11 --version 2>$null) -match '3\.11') } catch {}
  if ($tem311) { Out-Rel '- Python 3.11 já instalado.' }
  elseif (Confirma 'Instalar Python 3.11 (winget Python.Python.3.11, ~30 MB)?') {
    winget install -e --id Python.Python.3.11 --accept-source-agreements --accept-package-agreements; Atualiza-Path
    Out-Rel '- Python 3.11 instalado via winget.'
  }
  else { Out-Rel '- Python 3.11: instalação recusada.'; return }

  $mod = Modelo
  $tam = @{ 'small' = '~0,5 GB'; 'medium' = '~1,5 GB'; 'large-v3' = '~3 GB' }[$mod.m]
  if (Test-Path $Py) { Out-Rel "- venv já existe em $Venv." }
  $extra = if ($mod.dev -eq 'cuda') { ' + bibliotecas CUDA da NVIDIA (cuBLAS/cuDNN, ~1 GB)' } else { '' }
  if (Confirma "Criar $Venv e instalar faster-whisper$extra? O modelo '$($mod.m)' ($tam) baixa no 1º uso.") {
    if (-not (Test-Path $Py)) { & py -3.11 -m venv $Venv }
    & $Py -m pip install --upgrade pip --quiet
    & $Py -m pip install faster-whisper --quiet
    if ($mod.dev -eq 'cuda') { & $Py -m pip install nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*' --quiet }
    Out-Rel "- faster-whisper instalado em $Venv ($((& $Py -m pip show faster-whisper | Select-String '^Version').ToString()))."
  }
  else { Out-Rel '- faster-whisper: instalação recusada.'; return }
  Set-R 'modelo' $mod
  Out-Rel "- Modelo escolhido pelo hardware: **$($mod.m)** ($($mod.dev), $($mod.c))."
  if (-not $R.hardware) { Teste-Hardware }
}

# CUDA no Windows: as DLLs pip da NVIDIA precisam estar no PATH do processo
function Prepara-Cuda {
  $sp = "$Venv\Lib\site-packages\nvidia"
  foreach ($b in "$sp\cublas\bin", "$sp\cudnn\bin") { if (Test-Path $b) { $env:Path = "$b;$env:Path" } }
}

function Transcreve($entrada, $saida, [int]$cortes = 0) {
  $mod = $R.modelo; if (-not $mod) { $mod = Modelo }
  if ($mod.dev -eq 'cuda') { Prepara-Cuda }
  $a = @("$Base\transcrever.py", $entrada, $saida, '--modelo', $mod.m, '--device', $mod.dev, '--compute', $mod.c)
  if ($cortes) { $a += @('--cortes', "$cortes", '--pasta-srt', "$Base\saida") }
  $ErrorActionPreference = 'Continue'
  & $Py @a | Write-Host  # só o JSON do arquivo volta como resultado da função
  if ($LASTEXITCODE -ne 0 -and $mod.dev -eq 'cuda') {
    Out-Rel '- GPU falhou na transcrição; repetindo em CPU (medium int8).'
    $R.modelo = @{ m = 'medium'; dev = 'cpu'; c = 'int8' }; Set-R 'modelo' $R.modelo
    return Transcreve $entrada $saida $cortes
  }
  if ($LASTEXITCODE -ne 0) { throw "transcrição falhou (código $LASTEXITCODE)" }
  Get-Content $saida -Raw -Encoding UTF8 | ConvertFrom-Json
}

# ============================== 3. TESTE RÁPIDO ==============================
function Teste-Rapido {
  $wav = "$Base\teste\fala_pt.wav"
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voz = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
  if ($voz) { $s.SelectVoice($voz.VoiceInfo.Name) } else { Out-Rel '- AVISO: sem voz pt-BR no Windows; a fala sai com sotaque (a velocidade medida continua válida, a precisão não).' }
  $txt = 'Eu arrematei um apartamento da Caixa por cento e oitenta mil reais, quarenta por cento abaixo do valor de mercado. ' +
         'Antes de dar o lance, li o edital inteiro e a matrícula do imóvel. Conferi a dívida de IPTU e de condomínio, ' +
         'e vi que o imóvel estava ocupado. A desocupação levou quatro meses. No leilão, você lucra antes de arrematar. '
  $s.SetOutputToWaveFile($wav); $s.Speak($txt + $txt); $s.Dispose()
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Transcreve $wav "$Base\teste\fala_pt.json"
  $sw.Stop()
  $t = [ordered]@{ duracao_audio_s = $r.duracao_audio_s; carga_modelo_s = $r.carga_modelo_s; transcricao_s = $r.transcricao_s
    x_tempo_real = $r.x_tempo_real; total_s = [math]::Round($sw.Elapsed.TotalSeconds, 1); modelo = $r.modelo; device = $r.device
    trecho = (($r.segmentos | Select-Object -First 2 | ForEach-Object { $_.texto }) -join ' ') }
  Set-R 'teste_rapido' $t
  Out-Rel "`n## 3. Teste rápido (áudio sintético pt-BR de $($t.duracao_audio_s) s)`n"
  Out-Rel "- Modelo $($t.modelo) ($($t.device)): transcreveu em $($t.transcricao_s) s = **$($t.x_tempo_real)x o tempo real** (carga do modelo: $($t.carga_modelo_s) s)."
  Out-Rel "- Amostra do texto: _$($t.trecho)_"
}

# ============================== 4. TESTE 4K ==============================
function Teste-4K {
  $v = Get-ChildItem "$Base\teste" -File -Include *.mp4, *.mov, *.mkv, *.m4v -Recurse | Where-Object { $_.FullName -notmatch '\\_hw\\' } | Sort-Object Length -Descending | Select-Object -First 1
  if (-not $v) { Out-Rel "`n## 4. Teste 4K: PULADO — nenhum vídeo em $Base\teste (copie o arquivo para lá e rode -Etapa teste4k)."; return }
  $total = [Diagnostics.Stopwatch]::StartNew()
  $p = (& ffprobe -v error -show_entries 'stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,sample_rate,channels:format=duration,bit_rate' -of json $v.FullName) -join '' | ConvertFrom-Json
  $vid = $p.streams | Where-Object codec_type -eq 'video' | Select-Object -First 1
  $aud = $p.streams | Where-Object codec_type -eq 'audio' | Select-Object -First 1
  $dur = [double]$p.format.duration
  $fonte = [ordered]@{ arquivo = $v.Name; gb = [math]::Round($v.Length / 1GB, 2); duracao_min = [math]::Round($dur / 60, 1)
    video = "$($vid.codec_name) $($vid.profile) $($vid.width)x$($vid.height) $($vid.r_frame_rate) fps $($vid.pix_fmt)"
    mbps = [math]::Round([double]$p.format.bit_rate / 1e6, 1); audio = "$($aud.codec_name) $($aud.sample_rate) Hz $($aud.channels) canais" }
  $qualidade = if ([int]$vid.height -lt 1080 -and [int]$vid.width -lt 1080) { 'REPROVADO: abaixo de 1080p' } elseif ([int]$aud.sample_rate -lt 44100) { 'REPROVADO: áudio abaixo de 44,1 kHz' } else { 'aprovado' }
  $tempos = [ordered]@{}

  $sw = [Diagnostics.Stopwatch]::StartNew()
  $wav = "$Base\saida\audio16k.wav"
  if (-not (FF @('-hide_banner', '-y', '-i', $v.FullName, '-vn', '-ac', '1', '-ar', '16000', $wav)).ok) { throw 'falha ao extrair o áudio' }
  $tempos.extrair_audio_s = [math]::Round($sw.Elapsed.TotalSeconds, 1)

  $sw.Restart(); $r = Transcreve $wav "$Base\saida\transcricao.json" 3
  $tempos.transcricao_s = [math]::Round($sw.Elapsed.TotalSeconds, 1)

  $enc = $R.hardware.encoder_escolhido
  $encArgs = switch -Wildcard ($enc) {
    'h264_nvenc' { @('-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M', '-pix_fmt', 'nv12') }
    'h264_qsv' { @('-c:v', 'h264_qsv', '-preset', 'slow', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M', '-pix_fmt', 'nv12') }
    'h264_amf' { @('-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'vbr_peak', '-b:v', '8M', '-maxrate', '12M', '-pix_fmt', 'nv12') }
    default { @('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p') }
  }
  # vídeo deitado: corta o meio em 9:16; vídeo já vertical: só redimensiona
  $vf = if ([int]$vid.width -gt [int]$vid.height) { 'crop=trunc(ih*9/16/2)*2:ih,' } else { '' }
  $estilo = "FontName=Arial,FontSize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=70"
  $cortes = @(); $k = 0
  Push-Location "$Base\saida"  # o filtro subtitles recebe o .srt por nome relativo (evita escapar C:\ no filtro)
  try {
    foreach ($c in $r.cortes) {
      $k++; $sw.Restart()
      $a = @('-hide_banner', '-y', '-hwaccel', 'd3d11va', '-ss', "$($c.ini)", '-t', "$([math]::Round($c.fim - $c.ini, 2))", '-i', $v.FullName,
        '-vf', "${vf}scale=1080:1920:flags=lanczos,subtitles=corte$k.srt:force_style='$estilo'") + $encArgs +
        @('-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', "corte$k.mp4")
      $o = FF $a
      if (-not $o.ok) { Out-Rel "- corte $k FALHOU: $(($o.log -split "`n" | Select-Object -Last 3) -join ' ')"; continue }
      $cortes += [ordered]@{ n = $k; ini_s = $c.ini; fim_s = $c.fim; seg = [math]::Round($c.fim - $c.ini, 0); nota = $c.nota
        abertura = $c.abertura; render_s = [math]::Round($sw.Elapsed.TotalSeconds, 1); arquivo = "$Base\saida\corte$k.mp4" }
    }
  } finally { Pop-Location }
  $tempos.cortes_s = [math]::Round((($cortes | ForEach-Object { $_.render_s }) | Measure-Object -Sum).Sum, 1)
  $total.Stop(); $tempos.total_s = [math]::Round($total.Elapsed.TotalSeconds, 1)
  $tempos.x_tempo_real_transcricao = [math]::Round($dur / [math]::Max($tempos.transcricao_s, 0.1), 2)
  # projeção para 15 min: transcrição escala com a duração; os 3 cortes não
  $proj15 = [math]::Round((900 / $dur) * ($tempos.extrair_audio_s + $tempos.transcricao_s) / 60 + $tempos.cortes_s / 60, 1)
  $veredito = if ($qualidade -ne 'aprovado') { "INCONCLUSIVO — fonte $qualidade" }
  elseif ($cortes.Count -lt 3) { 'NÃO ATENDE AINDA — algum corte falhou (ver acima)' }
  elseif ($proj15 -le 30) { "ATENDE — 15 min de 4K viram 3 cortes em ~$proj15 min, sem OpusClip" }
  elseif ($proj15 -le 60) { "ATENDE COM ESPERA — ~$proj15 min por vídeo de 15 min (deixar rodando)" }
  else { "NÃO ATENDE BEM — ~$proj15 min por vídeo de 15 min; manter OpusClip no plano mínimo" }
  Set-R 'teste_4k' ([ordered]@{ fonte = $fonte; qualidade = $qualidade; tempos = $tempos; projecao_15min_min = $proj15; cortes = $cortes; veredito = $veredito })

  Out-Rel "`n## 4. Teste 4K — $($fonte.arquivo)`n"
  Out-Rel "- Fonte: $($fonte.video), $($fonte.mbps) Mbps, $($fonte.audio), $($fonte.duracao_min) min, $($fonte.gb) GB → **$qualidade**"
  Out-Rel "- Tempos: extrair áudio $($tempos.extrair_audio_s) s · transcrição $($tempos.transcricao_s) s ($($tempos.x_tempo_real_transcricao)x tempo real) · 3 cortes $($tempos.cortes_s) s ($enc) · **total $([math]::Round($tempos.total_s/60,1)) min**"
  Out-Rel "`n| # | Trecho | Duração | Render | Abertura |"; Out-Rel '|---|---|---|---|---|'
  foreach ($c in $cortes) { Out-Rel "| $($c.n) | $([TimeSpan]::FromSeconds($c.ini_s).ToString('mm\:ss'))–$([TimeSpan]::FromSeconds($c.fim_s).ToString('mm\:ss')) | $($c.seg) s | $($c.render_s) s | $($c.abertura) |" }
  Out-Rel "`n## 5. Veredito: **$veredito**"
  Out-Rel "`nOs trechos foram escolhidos por regra local (números, casos, alertas, sem abrir com muleta). Transcrição completa em $Base\saida\transcricao.json — cole-a no Claude para ele revisar a escolha como editor."
}

# ============================== execução ==============================
if ($Etapa -in 'tudo', 'diag') { Diagnostico }
if ($Etapa -in 'tudo', 'instalar') { Instalar }
if ($Etapa -in 'tudo', 'teste') { if (-not (Test-Path $Py)) { throw 'faster-whisper não instalado (rode -Etapa instalar).' }; Teste-Rapido }
if ($Etapa -in 'tudo', 'teste4k') { if (-not (Test-Path $Py)) { throw 'faster-whisper não instalado (rode -Etapa instalar).' }; Teste-4K }
Write-Host "`nPronto. Relatório: $Rel · Resultado para colar no Claude: $ResFile"
