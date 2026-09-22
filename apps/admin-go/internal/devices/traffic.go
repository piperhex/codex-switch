package devices

import (
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type trafficCounter struct {
	db          *gorm.DB
	reporter    string
	mu, flushMu sync.Mutex
	totals      map[time.Time]int64
	pending     map[time.Time]bool
}

func newTrafficCounter(db *gorm.DB) *trafficCounter {
	return &trafficCounter{
		db:       db,
		reporter: uuid.NewString(),
		totals:   map[time.Time]int64{},
		pending:  map[time.Time]bool{},
	}
}

func (counter *trafficCounter) record(bytes int) {
	if bytes <= 0 {
		return
	}
	hour := time.Now().UTC().Truncate(time.Hour)
	counter.mu.Lock()
	defer counter.mu.Unlock()
	counter.totals[hour] += int64(bytes)
	counter.pending[hour] = true
}

func (counter *trafficCounter) flush() error {
	counter.flushMu.Lock()
	defer counter.flushMu.Unlock()
	counter.mu.Lock()
	snapshot := map[time.Time]int64{}
	for hour := range counter.pending {
		snapshot[hour] = counter.totals[hour]
	}
	counter.mu.Unlock()
	if len(snapshot) == 0 {
		return nil
	}
	err := counter.db.Transaction(func(tx *gorm.DB) error {
		for hour, bytes := range snapshot {
			if err := tx.Exec(`INSERT INTO chat_relay_traffic (reporter_id, hour_start, bytes) VALUES (?, ?, ?)
				ON CONFLICT (hour_start, reporter_id) DO UPDATE SET bytes = GREATEST(chat_relay_traffic.bytes, EXCLUDED.bytes)`,
				counter.reporter, hour, bytes).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	counter.mu.Lock()
	defer counter.mu.Unlock()
	for hour, bytes := range snapshot {
		if counter.totals[hour] == bytes {
			delete(counter.pending, hour)
		}
	}
	return nil
}
