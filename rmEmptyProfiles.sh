usersToRemove="$(./findUsersToRemove.js | tail -n +6)"

for user in $usersToRemove; do
  ./rmUser.js "$user" "of https://github.com/ghuser-io/ghuser.io/issues/190"
done
