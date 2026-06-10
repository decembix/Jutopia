param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = "asia-northeast3",
  [string]$Service = "jutopia",
  [string]$EnvFile = "cloud-run.env.yaml"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw "gcloud CLI가 설치되어 있지 않습니다. Google Cloud SDK를 설치하거나 Cloud Shell에서 실행하세요."
}

if (-not (Test-Path $EnvFile)) {
  throw "$EnvFile 파일이 없습니다. cloud-run.env.yaml.example을 복사해서 실제 값을 채워주세요."
}

gcloud config set project $ProjectId
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy $Service `
  --source . `
  --region $Region `
  --allow-unauthenticated `
  --env-vars-file $EnvFile
