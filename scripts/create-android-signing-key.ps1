# Creates DataChat's permanent Android signing key (run ONCE, from the
# Data-chat folder, in PowerShell). Uses Docker so Java is not needed.
#
#   powershell -ExecutionPolicy Bypass -File scripts\create-android-signing-key.ps1
#
# KEEP android-keys\datachat-upload.jks AND ITS PASSWORD SAFE FOREVER.
# Every future app update must be signed with this exact key; if it is lost,
# installed apps can no longer be updated and passkeys tied to it stop working.
# Back it up somewhere private (not in git, not in chat).

$ErrorActionPreference = "Stop"
$keyDir = Join-Path (Get-Location) "android-keys"
$keyFile = Join-Path $keyDir "datachat-upload.jks"
$image = "eclipse-temurin:21-jdk"

if (Test-Path $keyFile) {
    Write-Host "A key already exists at $keyFile. Not overwriting it." -ForegroundColor Yellow
    Write-Host "Delete it only if you are sure no released app uses it."
    exit 1
}
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null

Write-Host ""
Write-Host "Step 1/2: creating the key. Choose a strong password (at least 12 characters)" -ForegroundColor Cyan
Write-Host "and use the SAME password when asked for the key password." -ForegroundColor Cyan
docker run -it --rm -v "${keyDir}:/keys" $image keytool -genkeypair -v `
    -keystore /keys/datachat-upload.jks -alias datachat `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -dname "CN=DataChat, O=DataChat"
if (-not (Test-Path $keyFile)) { throw "The key was not created." }

Write-Host ""
Write-Host "Step 2/2: reading the key's public fingerprint (enter the password again)" -ForegroundColor Cyan
$listing = docker run -it --rm -v "${keyDir}:/keys" $image keytool -list -v `
    -keystore /keys/datachat-upload.jks -alias datachat
$sha256 = ($listing | Select-String -Pattern "SHA256:\s*([0-9A-F:]{95})").Matches | Select-Object -First 1
if (-not $sha256) { throw "Could not read the SHA-256 fingerprint. Run the script again to see keytool's output." }
$fingerprint = $sha256.Groups[1].Value

$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keyFile))
$base64File = Join-Path $keyDir "datachat-upload.jks.base64.txt"
Set-Content -Path $base64File -Value $base64 -NoNewline

Write-Host ""
Write-Host "Done. Next steps:" -ForegroundColor Green
Write-Host ""
Write-Host "1) GitHub > lamek-star/Data-chat > Settings > Secrets and variables > Actions > New repository secret:"
Write-Host "     ANDROID_KEYSTORE_BASE64   = the contents of $base64File"
Write-Host "     ANDROID_KEYSTORE_PASSWORD = the password you chose"
Write-Host "     ANDROID_KEY_ALIAS         = datachat"
Write-Host "     ANDROID_KEY_PASSWORD      = the password you chose"
Write-Host ""
Write-Host "2) In wrangler.toml under [vars], add (this fingerprint is public, not a secret):"
Write-Host "     ANDROID_SIGNING_SHA256 = `"$fingerprint`""
Write-Host "   then deploy:  npm run deploy:cloudflare"
Write-Host ""
Write-Host "3) Push any change (or run the 'Android APK' workflow) to get a release-signed APK."
Write-Host ""
Write-Host "Back up $keyFile and your password somewhere private. Then delete $base64File." -ForegroundColor Yellow
