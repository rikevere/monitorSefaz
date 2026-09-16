$hosts = @(
  'nfe.svrs.rs.gov.br',
  'nfe.fazenda.sp.gov.br',
  'nfe.sefazrs.rs.gov.br'
)

$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$certs = New-Object 'System.Collections.Generic.List[string]'

foreach ($serverName in $hosts) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.Connect($serverName, 443)

  $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, {
    param($sender, $cert, $chain, $sslPolicyErrors)
    return $true
  })

  $ssl.AuthenticateAsClient($serverName)
  $remoteCert = $ssl.RemoteCertificate
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
  $chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
  $chain.Build($remoteCert) | Out-Null

  foreach ($element in $chain.ChainElements) {
    $der = $element.Certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $base64 = [Convert]::ToBase64String($der)
    $lines = @()
    for ($i = 0; $i -lt $base64.Length; $i += 64) {
      $chunk = $base64.Substring($i, [Math]::Min(64, $base64.Length - $i))
      $lines += $chunk
    }

    $pem = @('-----BEGIN CERTIFICATE-----') + $lines + @('-----END CERTIFICATE-----')
    $pemText = ($pem -join [Environment]::NewLine)

    if (-not $seen.Contains($pemText)) {
      $seen.Add($pemText) | Out-Null
      $certs.Add($pemText)
    }
  }

  $ssl.Dispose()
  $tcp.Dispose()
}

$folder = Join-Path $PSScriptRoot '..\certs'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$target = Join-Path $folder 'sefaz-ca-bundle.pem'

($certs.ToArray() -join ([Environment]::NewLine + [Environment]::NewLine)) | Set-Content -Path $target -Encoding Ascii

Write-Host "Bundle escrito em: $target"
Write-Host "Certificados no bundle: $($certs.Count)"
