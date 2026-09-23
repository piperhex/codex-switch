package chattraffic

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

var ErrState = errors.New("relay accounting unavailable")

// The SQL grant is durable. Missing Redis state never recreates spendable credit.
const takeBudget = `
local run = string.match(redis.call('INFO','server'),'run_id:([a-f0-9]+)')
if not run or redis.call('HGET',KEYS[1],'server') ~= run then return 0 end
if redis.call('HEXISTS',KEYS[1],ARGV[3]) == 1 then return 1 end
if redis.call('GET', KEYS[2]) ~= ARGV[1] or string.sub(ARGV[1],1,8) == 'blocked:' then return 0 end
local t = redis.call('TIME')
local now = tonumber(t[1])*1000 + math.floor(tonumber(t[2])/1000)
if redis.call('HGET',KEYS[1],'state') ~= 'open'
 or now >= tonumber(redis.call('HGET',KEYS[1],'expires') or '0') then return 0 end
local bytes = tonumber(ARGV[2])
if tonumber(redis.call('HGET',KEYS[1],'remaining') or '0') < bytes then return 0 end
redis.call('HINCRBY',KEYS[1],'remaining',-bytes)
redis.call('HINCRBY',KEYS[1],'pending',bytes)
redis.call('HSET',KEYS[1],ARGV[3],bytes)
return 1`

const finishBudget = `
local bytes = tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0')
if bytes == 0 then return 0 end
redis.call('HDEL',KEYS[1],ARGV[1])
redis.call('HINCRBY',KEYS[1],'pending',-bytes)
if ARGV[2] == '1' then redis.call('HINCRBY',KEYS[1],'spent',bytes)
else redis.call('HINCRBY',KEYS[1],'remaining',bytes) end
return 1`

const sealBudget = `
if redis.call('EXISTS',KEYS[1]) == 0 then return {-1,-1} end
local run = string.match(redis.call('INFO','server'),'run_id:([a-f0-9]+)')
if not run or redis.call('HGET',KEYS[1],'server') ~= run then return {-1,-1} end
redis.call('HSET',KEYS[1],'state','closed')
return {tonumber(redis.call('HGET',KEYS[1],'spent')),tonumber(redis.call('HGET',KEYS[1],'pending'))}`

const initializeGrant = `
local run = string.match(redis.call('INFO','server'),'run_id:([a-f0-9]+)')
if not run then return redis.error_reply('accounting identity unavailable') end
redis.call('HSET',KEYS[1],'server',run,'state','open','expires',ARGV[1],
 'remaining',ARGV[2],'spent',0,'pending',0)
return 1`

var takeScript = redis.NewScript(takeBudget)
var finishScript = redis.NewScript(finishBudget)
var sealScript = redis.NewScript(sealBudget)
var initializeScript = redis.NewScript(initializeGrant)

func epochKey(owner string) string  { return "chat:budget:{" + owner + "}:epoch" }
func budgetKey(value budget) string { return "chat:budget:{" + value.UserID + "}:" + value.ID }

func readEpoch(ctx context.Context, client *redis.Client, owner string) (string, error) {
	key := epochKey(owner)
	if err := client.SetNX(ctx, key, uuid.NewString(), 0).Err(); err != nil {
		return "", err
	}
	value, err := client.Get(ctx, key).Result()
	if strings.HasPrefix(value, "blocked:") {
		return "", ErrState
	}
	return value, err
}

// ChangeLimit fences all previous grants before changing SQL. A failed synchronization stays blocked.
func ChangeLimit(db *gorm.DB, client *redis.Client, owner string, save func(*gorm.DB) error) error {
	ctx := db.Statement.Context
	key, token := epochKey(owner), "blocked:"+uuid.NewString()
	err := db.Transaction(func(tx *gorm.DB) error {
		// Serialize quota edits across instances before fencing grants; an older editor cannot revive newer credit.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "chat-limit:"+owner).Error; err != nil {
			return err
		}
		if client != nil {
			if err := client.Set(ctx, key, token, 0).Err(); err != nil {
				return err
			}
		}
		return save(tx)
	})
	if err != nil || client == nil {
		return err
	}
	return client.Eval(ctx, `if redis.call('GET',KEYS[1]) == ARGV[1] then
redis.call('SET',KEYS[1],ARGV[2]) end; return 1`, []string{key}, token, uuid.NewString()).Err()
}

func initializeBudget(ctx context.Context, client *redis.Client, value budget) error {
	// A unique allocation ID is initialized only once; retries must allocate a new SQL grant.
	// Binding to the Redis process prevents an AOF rollback or replica promotion from reusing spent credit.
	return initializeScript.Run(ctx, client, []string{budgetKey(value)}, value.ExpiresAt.UnixMilli(), value.Bytes).Err()
}

func finishReservation(client *redis.Client, value budget, ticket string, success bool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	flag := 0
	if success {
		flag = 1
	}
	return finishScript.Run(ctx, client, []string{budgetKey(value)}, ticket, flag).Err()
}
