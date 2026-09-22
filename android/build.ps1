# 手动打包安卓 APK（不需要 Gradle / Android Studio，只用 Android SDK 的 build-tools + JDK）
# 用法：powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Continue'   # 原生命令会把进度写到 stderr，这里用 $LASTEXITCODE 判错

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$jdk     = 'C:\Program Files\Java\jdk-21.0.11'
$sdk     = 'C:\Users\MPX\AppData\Local\Android\Sdk'
$bt      = Join-Path $sdk 'build-tools\36.0.0'   # 注意：d8 必须用 36 版，34 版处理 Java 内嵌类会报 NPE
$android = Join-Path $sdk 'platforms\android-34\android.jar'

$ks        = Join-Path $here 'android.keystore'   # 自签名密钥（保存在本目录，已加入 .gitignore）
$storePass = 'coupleschedule'
$alias     = 'coupleschedule'
$apkOut    = Join-Path ([Environment]::GetFolderPath('Desktop')) '情侣课表.apk'

# 0) 没有签名密钥就先造一个（10 年有效）
if (-not (Test-Path $ks)) {
    Write-Host '0/7 生成签名密钥 (keytool)...' -ForegroundColor Cyan
    & "$jdk\bin\keytool.exe" -genkeypair -keystore $ks -alias $alias -keyalg RSA -keysize 2048 `
        -validity 10950 -storepass $storePass -keypass $storePass `
        -dname "CN=Couple Schedule, O=Personal, L=Wuhan, ST=Hubei, C=CN" 2>&1 | Out-Null
}

$build = Join-Path $here 'build'
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$build\gen","$build\classes","$build\dex" | Out-Null

Write-Host '1/7 生成桌面图标...' -ForegroundColor Cyan
& node (Join-Path $here 'make-launcher-icons.mjs')

Write-Host '2/7 编译资源 (aapt2 compile)...' -ForegroundColor Cyan
& "$bt\aapt2.exe" compile --dir (Join-Path $here 'res') -o "$build\res.zip"
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile 失败' }

Write-Host '3/7 链接资源并生成 R.java (aapt2 link)...' -ForegroundColor Cyan
& "$bt\aapt2.exe" link -o "$build\app-unsigned.apk" -I $android `
    --manifest (Join-Path $here 'AndroidManifest.xml') `
    -R "$build\res.zip" --java "$build\gen" --auto-add-overlay `
    --min-sdk-version 21 --target-sdk-version 34 --version-code 1 --version-name 1.0
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link 失败' }

Write-Host '4/7 编译 Java (javac)...' -ForegroundColor Cyan
$sources  = @()
$sources += (Get-ChildItem "$build\gen" -Recurse -Filter *.java).FullName
$sources += (Get-ChildItem (Join-Path $here 'src') -Recurse -Filter *.java).FullName
& "$jdk\bin\javac.exe" -encoding UTF-8 -source 8 -target 8 -nowarn `
    -bootclasspath $android -cp $android -d "$build\classes" $sources
if ($LASTEXITCODE -ne 0) { throw 'javac 失败' }

Write-Host '5/7 转成 dex (d8)...' -ForegroundColor Cyan
$classes = (Get-ChildItem "$build\classes" -Recurse -Filter *.class).FullName
& "$bt\d8.bat" --release --lib $android --min-api 21 --output "$build\dex" $classes
if ($LASTEXITCODE -ne 0) { throw 'd8 失败' }

Write-Host '6/7 打包 + 对齐 (zip / zipalign)...' -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open("$build\app-unsigned.apk", 'Update')
$entry = $zip.GetEntry('classes.dex')
if ($entry) { $entry.Delete() }
[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$build\dex\classes.dex", 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
$zip.Dispose()
& "$bt\zipalign.exe" -f 4 "$build\app-unsigned.apk" "$build\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw 'zipalign 失败' }

Write-Host '7/7 签名 (apksigner)...' -ForegroundColor Cyan
& "$bt\apksigner.bat" sign --ks $ks --ks-key-alias $alias `
    --ks-pass "pass:$storePass" --key-pass "pass:$storePass" `
    --v1-signing-enabled true --v2-signing-enabled true `
    --out $apkOut "$build\app-aligned.apk"
if ($LASTEXITCODE -ne 0) { throw 'apksigner 失败' }

Write-Host "`n校验签名..." -ForegroundColor Cyan
& "$bt\apksigner.bat" verify --print-certs $apkOut | Select-Object -First 4
& "$bt\aapt2.exe" dump badging $apkOut 2>$null | Select-String -Pattern "^package|^application-label|^launchable-activity" | Select-Object -First 3
Write-Host "`n完成：$apkOut  ($([math]::Round((Get-Item $apkOut).Length/1KB,1)) KB)" -ForegroundColor Green
