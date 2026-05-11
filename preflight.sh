#!/bin/bash
# OTP Relay — preflight check
# Run this on the master node before applying manifests.
# Verifies that the cluster is ready for OTP Relay deployment.
#
# Usage: bash preflight.sh [worker-node-name]
# Example: bash preflight.sh srvk3wrk01

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

pass()  { echo -e "  ${GREEN}OK${NC}   $1"; }
fail()  { echo -e "  ${RED}FAIL${NC} $1"; ERRORS=$((ERRORS + 1)); }
warn()  { echo -e "  ${YELLOW}WARN${NC} $1"; WARNINGS=$((WARNINGS + 1)); }

KUBECTL="sudo k3s kubectl"
TARGET_NODE="${1:-}"

echo "=== OTP Relay Preflight Check ==="
echo ""

# ── 1. K3s running ───────────────────────────────────────────────────────────
echo "Cluster:"
if $KUBECTL get nodes &>/dev/null; then
    NODE_COUNT=$($KUBECTL get nodes --no-headers | wc -l)
    READY_COUNT=$($KUBECTL get nodes --no-headers | grep -c " Ready ")
    pass "K3s cluster reachable ($READY_COUNT/$NODE_COUNT nodes ready)"
else
    fail "Cannot reach K3s cluster"
    echo ""
    echo "Fix: Is k3s running? Try: sudo systemctl start k3s"
    exit 1
fi

# ── 2. servicelb disabled ────────────────────────────────────────────────────
echo ""
echo "Load balancer:"
SVCLB_PODS=$($KUBECTL get pods -A --no-headers 2>/dev/null | grep "svclb-" | wc -l)
if [ "$SVCLB_PODS" -gt 0 ]; then
    fail "Klipper servicelb is active ($SVCLB_PODS svclb pods found)"
    echo "       Fix: Add 'disable: [servicelb]' to /etc/rancher/k3s/config.yaml"
    echo "            then: sudo systemctl restart k3s"
else
    pass "Klipper servicelb is disabled"
fi

# ── 3. MetalLB installed ────────────────────────────────────────────────────
METALLB_PODS=$($KUBECTL get pods -n metallb-system --no-headers 2>/dev/null | grep -c "Running" || true)
if [ "$METALLB_PODS" -ge 2 ]; then
    pass "MetalLB is running ($METALLB_PODS pods)"
else
    fail "MetalLB is not running (found $METALLB_PODS running pods)"
    echo "       Fix: kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml"
fi

# ── 4. MetalLB IP pool configured ───────────────────────────────────────────
POOL_COUNT=$($KUBECTL get ipaddresspool -n metallb-system --no-headers 2>/dev/null | wc -l)
if [ "$POOL_COUNT" -gt 0 ]; then
    POOL_ADDRS=$($KUBECTL get ipaddresspool -n metallb-system -o jsonpath='{.items[0].spec.addresses[0]}' 2>/dev/null)
    pass "MetalLB IP pool configured ($POOL_ADDRS)"
else
    fail "No MetalLB IP pool configured"
    echo "       Fix: kubectl apply -f k8s/metallb-config.yaml"
fi

# ── 5. Node label ────────────────────────────────────────────────────────────
echo ""
echo "Node labels:"
LABELED_NODES=$($KUBECTL get nodes -l otp-relay/storage=true --no-headers 2>/dev/null | wc -l)
if [ "$LABELED_NODES" -gt 0 ]; then
    LABELED_NAME=$($KUBECTL get nodes -l otp-relay/storage=true --no-headers | awk '{print $1}')
    pass "Node labeled for storage: $LABELED_NAME"
    # Use the labeled node as target if not specified
    TARGET_NODE="${TARGET_NODE:-$LABELED_NAME}"
else
    fail "No node has label otp-relay/storage=true"
    echo "       Fix: kubectl label node <worker-node> otp-relay/storage=true"
fi

# ── 6. Images on target node ────────────────────────────────────────────────
echo ""
echo "Container images (checking node: ${TARGET_NODE:-unknown}):"
if [ -n "$TARGET_NODE" ]; then
    # We can only check images locally if we're on the target node
    HOSTNAME=$(hostname)
    if [ "$HOSTNAME" = "$TARGET_NODE" ]; then
        for IMG in otp-relay:latest otp-monitor:latest; do
            if sudo k3s ctr images list | grep -q "$IMG"; then
                pass "Image $IMG present locally"
            else
                fail "Image $IMG not found locally"
                echo "       Fix: sudo k3s ctr images import <tarfile>"
            fi
        done
    else
        warn "Cannot verify images remotely. SSH into $TARGET_NODE and run:"
        echo "         sudo k3s ctr images list | grep -E 'otp-relay|otp-monitor'"
    fi
else
    warn "No target node identified. Label a node first."
fi

# ── 7. Namespace ─────────────────────────────────────────────────────────────
echo ""
echo "Namespace:"
if $KUBECTL get namespace otp-relay &>/dev/null; then
    pass "Namespace otp-relay exists"
else
    warn "Namespace otp-relay does not exist yet (will be created by namespace.yaml)"
fi

# ── 8. Network interface on target node ──────────────────────────────────────
echo ""
echo "Network:"
if [ -n "$TARGET_NODE" ]; then
    HOSTNAME=$(hostname)
    if [ "$HOSTNAME" = "$TARGET_NODE" ]; then
        if [ -e "/sys/class/net/ens33" ]; then
            pass "Network interface ens33 exists on this node"
        else
            IFACES=$(ls /sys/class/net/ | grep -v "^lo$" | grep -v "^cni" | grep -v "^flannel" | grep -v "^veth" | head -5)
            fail "Network interface ens33 not found"
            echo "       Available interfaces: $IFACES"
            echo "       Fix: Update PHONE_INTERFACE in configmap.yaml to match"
        fi
    else
        warn "Cannot verify network interface remotely on $TARGET_NODE"
    fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
    echo -e "${GREEN}All checks passed. Ready to deploy.${NC}"
elif [ "$ERRORS" -eq 0 ]; then
    echo -e "${YELLOW}$WARNINGS warning(s), 0 errors. Review warnings before deploying.${NC}"
else
    echo -e "${RED}$ERRORS error(s), $WARNINGS warning(s). Fix errors before deploying.${NC}"
    exit 1
fi
