package accounts

import (
	"context"
	"encoding/json"
	"github.com/redis/go-redis/v9"
	"time"
)

func (s *service) cached(owner, kind string) (object, error) {
	if s.deps.Redis == nil {
		return nil, nil
	}
	raw, err := s.deps.Redis.Get(context.Background(), "sync:"+kind+":"+owner).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	value := object{}
	if err = json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	return value, nil
}
func (s *service) cache(owner, kind string, value object) error {
	if s.deps.Redis == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.deps.Redis.Set(context.Background(), "sync:"+kind+":"+owner, string(raw), time.Minute).Err()
}
