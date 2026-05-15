package reporoot

import (
	"fmt"
	"os"
	"path/filepath"
)

func Find() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	return FindFrom(wd)
}

func FindFrom(start string) (string, error) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}

	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("repository root not found from %s", start)
		}
		dir = parent
	}
}
