set -e

rm -rf octicons/
curl -o octicons.tgz https://registry.npmjs.org/octicons/-/octicons-7.3.0.tgz
tar xvzf octicons.tgz
rm octicons.tgz
mv package/build/svg/ octicons/
rm -rf package/

mkdir -p aws-sqs/
pushd aws-sqs/
curl -O https://raw.githubusercontent.com/ghuser-io/ghuser.io/master/aws/sqs/utils.sh
popd
