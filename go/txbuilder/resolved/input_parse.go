package resolved

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func parseRoutePlan(raw json.RawMessage) (RoutePlan, error) {
	var routePlan RoutePlan
	if len(raw) == 0 {
		return RoutePlan{}, fmt.Errorf("routePlan is required")
	}
	if err := json.Unmarshal(raw, &routePlan); err != nil {
		return RoutePlan{}, fmt.Errorf("parse routePlan: %w", err)
	}
	return routePlan, nil
}

func parseResolvedLegs(rawLegs []json.RawMessage) ([]ResolvedLeg, error) {
	resolvedLegs := make([]ResolvedLeg, 0, len(rawLegs))
	for index, raw := range rawLegs {
		var resolvedLeg ResolvedLeg
		if err := json.Unmarshal(raw, &resolvedLeg); err != nil {
			return nil, fmt.Errorf("parse resolvedLegs[%d]: %w", index, err)
		}
		resolvedLegs = append(resolvedLegs, resolvedLeg)
	}
	return resolvedLegs, nil
}

func parseWethPlan(raw *json.RawMessage) (*WethPlan, error) {
	if raw == nil {
		return nil, nil
	}
	if bytes.Equal(bytes.TrimSpace(*raw), []byte("null")) {
		return nil, nil
	}

	var wethPlan WethPlan
	if err := json.Unmarshal(*raw, &wethPlan); err != nil {
		return nil, fmt.Errorf("parse wethPlan: %w", err)
	}
	return &wethPlan, nil
}
