package tessera

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/paraswap/paraswap-dex-lib/go/txbuilder/internal/reporoot"
)

func TestEmbeddedTesseraSwapABIMatchesCanonicalFile(t *testing.T) {
	root, err := reporoot.Find()
	if err != nil {
		t.Fatal(err)
	}

	canonical, err := os.ReadFile(filepath.Join(root, "src", "abi", "tessera", "TesseraSwap.json"))
	if err != nil {
		t.Fatal(err)
	}

	if !bytes.Equal(TesseraSwapABIBytes(), canonical) {
		t.Fatal("embedded Tessera swap ABI differs from src/abi/tessera/TesseraSwap.json")
	}
}

func TestLoadTesseraSwapABI(t *testing.T) {
	parsed, err := LoadTesseraSwapABI()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := parsed.Methods[swapMethodName]; !ok {
		t.Fatalf("expected %s method", swapMethodName)
	}
}
