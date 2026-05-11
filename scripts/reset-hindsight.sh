#!/bin/bash
echo "Stopping hindsight and pg0..."
pkill -f hindsight-api
pkill -f "postgres -D /home/poop/data/hindsight"
sleep 2
echo "Clearing data..."
rm -rf /home/poop/data/hindsight/*
echo "Done. Hindsight will start fresh on next run."
