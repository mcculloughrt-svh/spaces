#!/bin/bash
# Install dependencies for spaces-cli development
#
# This runs once when the workspace is first created.

WORKSPACE_NAME=$1
REPOSITORY=$2

echo "Installing dependencies for $WORKSPACE_NAME..."
bun install

echo "Dependencies installed!"
