package health

type Probe interface {
	Ready() bool
}

type StaticProbe struct {
	Healthy bool
}

func (probe StaticProbe) Ready() bool {
	return probe.Healthy
}
