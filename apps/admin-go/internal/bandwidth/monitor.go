// Package bandwidth measures successfully forwarded relay bytes in memory.
package bandwidth

import (
	"sync"
	"time"
)

const historySeconds = 60
const rateSeconds = 2

type bucket struct {
	second int64
	bytes  int64
}

// Sample describes one complete second of relay traffic, including idle seconds.
type Sample struct {
	Time           time.Time `json:"time"`
	BytesPerSecond int64     `json:"bytesPerSecond"`
}

// Snapshot is local to this server process; historical totals remain in the database.
type Snapshot struct {
	SampledAt          time.Time `json:"sampledAt"`
	StartedAt          time.Time `json:"startedAt"`
	BytesPerSecond     float64   `json:"bytesPerSecond"`
	PeakBytesPerSecond int64     `json:"peakBytesPerSecond"`
	RecentBytes        int64     `json:"recentBytes"`
	TotalBytes         int64     `json:"totalBytes"`
	History            []Sample  `json:"history"`
}

// Monitor uses bounded storage and never performs I/O on the forwarding path.
type Monitor struct {
	mu        sync.Mutex
	now       func() time.Time
	startedAt time.Time
	total     int64
	// Keep the current partial second as well as the last 60 complete seconds.
	buckets [historySeconds + 1]bucket
}

func New() *Monitor {
	return &Monitor{now: time.Now, startedAt: time.Now()}
}

// Record counts a successful transfer once, using its forwarded message size.
func (m *Monitor) Record(bytes int) {
	if bytes <= 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	second := m.now().Unix()
	entry := &m.buckets[second%int64(len(m.buckets))]
	if entry.second != second {
		*entry = bucket{second: second}
	}
	entry.bytes += int64(bytes)
	m.total += int64(bytes)
}

// Snapshot reports the last two complete seconds' mean and a one-minute history.
// Reading it neither resets counters nor depends on the dashboard polling interval.
func (m *Monitor) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	second := now.Unix()
	result := Snapshot{SampledAt: now.UTC(), StartedAt: m.startedAt.UTC(), TotalBytes: m.total,
		History: make([]Sample, 0, historySeconds)}
	for offset := int64(historySeconds); offset > 0; offset-- {
		stamp := second - offset
		entry := m.buckets[stamp%int64(len(m.buckets))]
		var bytes int64
		if entry.second == stamp {
			bytes = entry.bytes
		}
		result.History = append(result.History, Sample{Time: time.Unix(stamp, 0).UTC(), BytesPerSecond: bytes})
		result.RecentBytes += bytes
		result.PeakBytesPerSecond = max(result.PeakBytesPerSecond, bytes)
		if offset <= rateSeconds {
			result.BytesPerSecond += float64(bytes) / rateSeconds
		}
	}
	return result
}
