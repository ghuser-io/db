# source me

source "$(dirname $BASH_SOURCE)/utils.sh"

DATA_ON_EBS=~/data
DATA_ON_EFS=~/efs/data.git

function initData {
  if [[ ! -d "$DATA_ON_EFS" ]]; then
    git init --bare "$DATA_ON_EFS"
  fi
  if [[ ! -d "$DATA_ON_EBS" ]]; then
    git clone "$DATA_ON_EFS" "$DATA_ON_EBS"
  fi
}

function backupAndPublishToS3 {
  publishToS3
  backupToS3
}

function publishToS3 {
  trace "Publishing to S3..."
  time aws s3 sync "$DATA_ON_EBS" s3://ghuser/data --exclude ".git/*"
}

function backupToS3 {
  trace "Backing up on S3..."
  rm -rf /tmp/backups
  mkdir /tmp/backups
  tar pczvf "/tmp/backups/$(date -u +%Y-%m-%d).tar.gz" --exclude .git -C "$DATA_ON_EBS" .
  time aws s3 sync /tmp/backups s3://ghuser/backups
}
