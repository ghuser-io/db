# source me

source "$(dirname $BASH_SOURCE)/utils.sh"

DATA_ON_EBS=~/data
DATA_ON_EFS=~/efs/data.git
BACKUP_ON_EFS=~/efs/data

function initData {
  if [[ ! -d "$DATA_ON_EFS" ]]; then
    git init --bare "$DATA_ON_EFS"
  fi
  if [[ ! -d "$DATA_ON_EBS" ]]; then
    git clone "$DATA_ON_EFS" "$DATA_ON_EBS"
  fi
}

function backupAndPublishToS3 {
  trace "Backing up on EFS..."
  if [[ ! -d "$BACKUP_ON_EFS" ]]; then
    git clone "$DATA_ON_EFS" "$BACKUP_ON_EFS"
  fi
  pushd "$BACKUP_ON_EFS"
  git pull
  popd

  publishToS3
  backupToS3
}

function publishToS3 {
  trace "Publishing to S3..."
  time aws s3 sync "$BACKUP_ON_EFS" s3://ghuser/data --exclude ".git/*"
}

function backupToS3 {
  trace "Backing up on S3..."
  rm -rf /tmp/backups
  mkdir /tmp/backups
  tar pczvf "/tmp/backups/$(date -u +%Y-%m-%d).tar.gz" --exclude .git -C "$BACKUP_ON_EFS" .
  time aws s3 sync /tmp/backups s3://ghuser/backups
}
