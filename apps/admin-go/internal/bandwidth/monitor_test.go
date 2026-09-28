package bandwidth

import (
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestRateHistoryAndIdleExpiry(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	m := &Monitor{now: func() time.Time { return now }, startedAt: now}
	m.Record(1024)
	m.Record(512)
	m.Record(0)
	m.Record(-100)
	if got := m.Snapshot(); got.BytesPerSecond != 0 || got.TotalBytes != 1536 {
		t.Fatalf("partial second must not affect the rate: %+v", got)
	}
	now = now.Add(time.Second)
	m.Record(2560)
	now = now.Add(time.Second)
	got := m.Snapshot()
	if got.BytesPerSecond != 2048 || got.PeakBytesPerSecond != 2560 || got.RecentBytes != 4096 {
		t.Fatalf("incorrect rate or total: %+v", got)
	}
	if len(got.History) != historySeconds || got.History[58].BytesPerSecond != 1536 ||
		got.History[59].BytesPerSecond != 2560 {
		t.Fatalf("incorrect history: %+v", got.History)
	}
	if !reflect.DeepEqual(got, m.Snapshot()) {
		t.Fatal("a second reader changed the snapshot")
	}
	now = now.Add(2 * time.Second)
	if got = m.Snapshot(); got.BytesPerSecond != 0 || got.RecentBytes != 4096 {
		t.Fatalf("idle rate did not fall to zero: %+v", got)
	}
	now = now.Add(time.Minute)
	if got = m.Snapshot(); got.RecentBytes != 0 || got.PeakBytesPerSecond != 0 || got.TotalBytes != 4096 {
		t.Fatalf("expired samples remained visible: %+v", got)
	}
}

func TestRingRetainsOldestCompleteSecondAndReplacesStaleBuckets(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC)
	m := &Monitor{now: func() time.Time { return now }, startedAt: now}
	m.Record(100)
	now = now.Add(time.Minute)
	m.Record(200)
	if got := m.Snapshot(); got.History[0].BytesPerSecond != 100 || got.RecentBytes != 100 {
		t.Fatalf("partial second overwrote oldest complete sample: %+v", got)
	}
	now = now.Add(time.Second)
	m.Record(300)
	if got := m.Snapshot(); got.RecentBytes != 200 || got.BytesPerSecond != 100 {
		t.Fatalf("ring wrap reused stale bytes: %+v", got)
	}
	now = now.Add(3 * time.Minute)
	m.Record(400)
	now = now.Add(time.Second)
	if got := m.Snapshot(); got.RecentBytes != 400 || got.TotalBytes != 1000 {
		t.Fatalf("sparse traffic reused stale samples: %+v", got)
	}
}

func TestConcurrentRecordAndSnapshot(t *testing.T) {
	m := New()
	var workers sync.WaitGroup
	for range 16 {
		workers.Go(func() {
			for range 1000 {
				m.Record(64)
				m.Snapshot()
			}
		})
	}
	workers.Wait()
	if got := m.Snapshot().TotalBytes; got != 16*1000*64 {
		t.Fatalf("lost concurrent transfers: %d", got)
	}
}
