#!/usr/bin/env bash

while true; do
  response=$(curl -s -o /dev/null -w "%{http_code}" "$1")

  if [ "$response" -ne 200 ]; then
    echo "Request failed with HTTP code $response at $(date)"
  else
    echo "Request succeeded at $(date)"
  fi
  sleep 1
done
