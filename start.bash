#!/usr/bin/env bash
export THIS_SCRIPT=`realpath $0`
cd $(dirname $THIS_SCRIPT);
yarn start $@
