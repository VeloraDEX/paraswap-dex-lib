package tessera

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
)

func TestDefaultConfigMatchesTypeScriptSources(t *testing.T) {
	root, err := reporoot.Find()
	if err != nil {
		t.Fatal(err)
	}

	tesseraConfig, err := os.ReadFile(filepath.Join(root, "src", "dex", "tessera", "config.ts"))
	if err != nil {
		t.Fatal(err)
	}
	globalConfig, err := os.ReadFile(filepath.Join(root, "src", "config.ts"))
	if err != nil {
		t.Fatal(err)
	}

	config := DefaultConfig()
	assertTSConfigField(t, string(tesseraConfig), "BASE", "routerAddress", string(config.RouterByNetwork[NetworkBase]))
	assertTSConfigField(t, string(tesseraConfig), "BSC", "routerAddress", string(config.RouterByNetwork[NetworkBSC]))
	assertTSConfigField(t, string(globalConfig), "BASE", "wrappedNativeTokenAddress", string(config.WrappedNativeByNetwork[NetworkBase]))
	assertTSConfigField(t, string(globalConfig), "BSC", "wrappedNativeTokenAddress", string(config.WrappedNativeByNetwork[NetworkBSC]))
}

func assertTSConfigField(t *testing.T, source, network, field, want string) {
	t.Helper()

	block, ok := tsNetworkBlock(source, network)
	if !ok {
		t.Fatalf("TS config does not contain Network.%s block", network)
	}

	expected := strings.ToLower(fmt.Sprintf("%s: '%s'", field, want))
	if !strings.Contains(strings.ToLower(block), expected) {
		t.Fatalf("Network.%s %s mismatch: block does not contain %s", network, field, expected)
	}
}

func tsNetworkBlock(source, network string) (string, bool) {
	marker := fmt.Sprintf("[Network.%s]: {", network)
	start := strings.Index(source, marker)
	if start == -1 {
		return "", false
	}

	rest := source[start:]
	next := strings.Index(rest[len(marker):], "\n  [Network.")
	if next == -1 {
		return rest, true
	}
	return rest[:len(marker)+next], true
}
