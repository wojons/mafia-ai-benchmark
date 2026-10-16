#!/bin/bash
# Cron wrapper for deploy-refresh: runs every 15 minutes via the project's scheduler.
# This file is the cron task entry point. The scheduler calls this script.
# Exit 0 = success (no-op is success).
cd /home/kara/wojons/mafia-ai-benchmark
exec bash scripts/deploy-refresh.sh
