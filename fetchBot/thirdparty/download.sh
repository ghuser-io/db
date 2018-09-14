#!/usr/bin/env bash

set -e

mkdir -p aws-sqs/
cd aws-sqs/
curl -O https://raw.githubusercontent.com/ghuser-io/ghuser.io/master/aws/sqs/utils.sh
