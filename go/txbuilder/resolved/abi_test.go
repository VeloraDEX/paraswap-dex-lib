package resolved

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
)

func TestEmbeddedAugustusV6ABIMatchesCanonicalFile(t *testing.T) {
	root, err := reporoot.Find()
	if err != nil {
		t.Fatal(err)
	}

	canonical, err := os.ReadFile(filepath.Join(root, "src", "abi", "augustus-v6", "ABI.json"))
	if err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(AugustusV6ABIBytes(), canonical) {
		t.Fatal("embedded Augustus V6 ABI differs from src/abi/augustus-v6/ABI.json")
	}
}

func TestLoadAugustusV6ABI(t *testing.T) {
	parsed, err := LoadAugustusV6ABI()
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Methods) == 0 {
		t.Fatal("expected Augustus V6 ABI methods")
	}
}
