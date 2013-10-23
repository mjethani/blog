#!/bin/bash

# usage: ./start.sh <mode>

mode=production

if [ ! -f config.ini ]; then
  touch config.ini
fi

if [ $# -gt 0 ]; then
  mode=$1
else
  mode=production
fi

export PORT=3310
NODE_ENV=$mode node app 2>&1 \
  | awk '{gsub(/\x1b\[[0-9]+m/,"");print;fflush();}' > log &
echo `jobs -p` > .pid

