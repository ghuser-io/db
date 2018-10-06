# source me

function assertEquals {
  if [[ "$1" != "$2" ]]; then
    echo "Assertion failed: $1 != $2"
    exit 1
  fi
}

function now {
  echo "$(date +%s)"
}

function trace {
  echo "[$(date)] $1"
}
