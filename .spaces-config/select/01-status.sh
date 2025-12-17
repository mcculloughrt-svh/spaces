#!/bin/bash
# Show workspace status when switching
#
# This runs every time you switch to an existing workspace.

WORKSPACE_NAME=$1
REPOSITORY=$2

echo ""
echo "=== Workspace: $WORKSPACE_NAME ==="
echo ""

# Show git status summary
echo "Git Status:"
git status --short

# Show branch info
echo ""
echo "Branch:"
git branch --show-current

echo ""
