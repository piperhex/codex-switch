package chattraffic

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

type accountBudget struct {
	mu    sync.Mutex
	value budget
	epoch string
}

const settlementBatchSize = 256
const settlementTimeout = 10 * time.Second

// Settled metadata only needs to outlive pending socket writes and their recovery grace.
const budgetRetention = 10 * time.Minute

// Meter reserves bounded SQL budgets, spends them atomically in Redis and settles in batches.
// No accounting lock is held across a network write. Unknown crash outcomes consume reserved credit.
type Meter struct {
	db       *gorm.DB
	redis    *redis.Client
	accounts sync.Map
	flushMu  sync.Mutex
}

func NewMeter(db *gorm.DB, client *redis.Client) *Meter { return &Meter{db: db, redis: client} }

func (meter *Meter) Transmit(ctx context.Context, owner string, bytes int, write func() error) error {
	if bytes <= 0 || int64(bytes) > budgetBytes || meter.redis == nil {
		return ErrState
	}
	value, ticket, err := meter.reserve(ctx, owner, bytes)
	if err != nil {
		return err
	}
	writeErr := write()
	return errors.Join(writeErr, finishReservation(meter.redis, value, ticket, writeErr == nil))
}

func (meter *Meter) reserve(ctx context.Context, owner string, bytes int) (budget, string, error) {
	entry, _ := meter.accounts.LoadOrStore(owner, &accountBudget{})
	account := entry.(*accountBudget)
	account.mu.Lock()
	defer account.mu.Unlock()
	ticket := "ticket:" + uuid.NewString()
	if account.value.ID != "" {
		ok, err := meter.take(ctx, account, bytes, ticket)
		if err != nil || ok {
			return account.value, ticket, err
		}
		if err := meter.retire(ctx, account.value); err != nil {
			return budget{}, "", err
		}
		account.value = budget{}
	}
	value, epoch, err := meter.openBudget(ctx, owner, bytes)
	if err != nil {
		return budget{}, "", err
	}
	account.value, account.epoch = value, epoch
	ok, err := meter.take(ctx, account, bytes, ticket)
	if err == nil && !ok {
		err = ErrState
	}
	return value, ticket, err
}

func (meter *Meter) openBudget(ctx context.Context, owner string, bytes int) (budget, string, error) {
	epoch, err := readEpoch(ctx, meter.redis, owner)
	if err != nil {
		return budget{}, "", err
	}
	value, err := allocate(meter.db.WithContext(ctx), owner, bytes)
	if err != nil {
		return budget{}, "", err
	}
	return value, epoch, initializeBudget(ctx, meter.redis, value)
}

func (meter *Meter) take(ctx context.Context, account *accountBudget, bytes int, ticket string) (bool, error) {
	value, err := takeScript.Run(ctx, meter.redis,
		[]string{budgetKey(account.value), epochKey(account.value.UserID)}, account.epoch, bytes, ticket).Int()
	return value == 1, err
}

func (meter *Meter) retire(ctx context.Context, value budget) error {
	state, err := sealScript.Run(ctx, meter.redis, []string{budgetKey(value)}).Int64Slice()
	if err != nil {
		return err
	}
	if len(state) != 2 {
		return ErrState
	}
	spent, pending := state[0], state[1]
	if pending > 0 && time.Now().Before(value.ExpiresAt.Add(abandonedWriteGrace)) {
		return nil
	}
	if spent < 0 {
		spent = value.Bytes
	} else {
		spent += pending
	}
	if err := settle(meter.db.WithContext(ctx), value, spent); err != nil {
		return err
	}
	// Keep a tombstone so a delayed completion cannot recreate credit after SQL settlement.
	return meter.redis.Expire(ctx, budgetKey(value), abandonedWriteGrace).Err()
}

// Flush also recovers allocations from stopped processes. Only expired grants are touched.
func (meter *Meter) Flush() error {
	if meter.redis == nil {
		return ErrState
	}
	meter.flushMu.Lock()
	defer meter.flushMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), settlementTimeout)
	defer cancel()
	var values []budget
	if err := meter.db.WithContext(ctx).Table("chat_relay_budgets").
		Where("NOT closed AND expires_at <= ?", time.Now()).Order("expires_at").
		Limit(settlementBatchSize).Find(&values).Error; err != nil {
		return err
	}
	for _, value := range values {
		if err := meter.retire(ctx, value); err != nil {
			return err
		}
	}
	meter.forgetIdle()
	return meter.db.WithContext(ctx).Exec(`DELETE FROM chat_relay_budgets
 WHERE closed AND expires_at < ?`, time.Now().Add(-budgetRetention)).Error
}

func (meter *Meter) forgetIdle() {
	meter.accounts.Range(func(owner, entry interface{}) bool {
		account := entry.(*accountBudget)
		account.mu.Lock()
		defer account.mu.Unlock()
		if time.Now().After(account.value.ExpiresAt.Add(abandonedWriteGrace)) {
			// Every grant is durable; an in-flight caller retaining this entry is still recoverable.
			meter.accounts.CompareAndDelete(owner, entry)
		}
		return true
	})
}

// Close retires this process's grants; unfinished writes are recovered by the next maintenance pass.
func (meter *Meter) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), settlementTimeout)
	defer cancel()
	var result error
	meter.accounts.Range(func(_, entry interface{}) bool {
		account := entry.(*accountBudget)
		account.mu.Lock()
		defer account.mu.Unlock()
		if account.value.ID != "" {
			result = errors.Join(result, meter.retire(ctx, account.value))
		}
		return true
	})
	return result
}
