#!/bin/bash
if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit 1
fi
cd "$(dirname "$(realpath "$0")")";
node -r esm bin/server "$@"
