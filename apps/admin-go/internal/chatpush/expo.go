package chatpush

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

type ticket struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

func notification(entry delivery, token subscription) map[string]interface{} {
	titles := map[string]string{"completed": "Codex 回复完成", "failed": "Codex 回复未完成", "attention": "Codex 需要你确认"}
	return map[string]interface{}{"to": token.Token, "title": titles[entry.Kind],
		"body": "点按查看聊天。", "sound": "default", "ttl": 3600,
		"data": map[string]interface{}{"kind": "chat-completed", "source": "chat-push", "account": token.Account,
			"deviceId": entry.DeviceID, "threadId": entry.ThreadID, "turnId": entry.EventID}}
}

func (s *service) post(ctx context.Context, path string, payload, result interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if token := s.deps.Config.Get("EXPO_PUSH_ACCESS_TOKEN", ""); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("notification provider unavailable")
	}
	return json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(result)
}

func (s *service) deliver(ctx context.Context, entry delivery, token subscription) {
	if entry.Receipt != "" {
		s.receipt(ctx, entry, token)
		return
	}
	if time.Since(entry.CreatedAt) > time.Hour {
		s.finish(ctx, entry.ID)
		return
	}
	var result struct {
		Data ticket `json:"data"`
	}
	if s.post(ctx, "send", notification(entry, token), &result) != nil {
		return
	}
	if result.Data.Status != "ok" {
		s.reject(ctx, entry, token, result.Data)
		return
	}
	if result.Data.ID == "" {
		return
	}
	s.deps.DB.WithContext(ctx).Model(&delivery{}).Where("id = ?", entry.ID).
		Updates(map[string]interface{}{"receipt": result.Data.ID, "attempts": 0, "next_at": time.Now().UTC().Add(15 * time.Minute)})
}

func (s *service) receipt(ctx context.Context, entry delivery, token subscription) {
	var result struct {
		Data map[string]ticket `json:"data"`
	}
	if s.post(ctx, "getReceipts", map[string]interface{}{"ids": []string{entry.Receipt}}, &result) != nil {
		return
	}
	received, exists := result.Data[entry.Receipt]
	if !exists {
		return
	}
	if received.Status == "ok" {
		s.finish(ctx, entry.ID)
		return
	}
	s.reject(ctx, entry, token, received)
}

func (s *service) reject(ctx context.Context, entry delivery, token subscription, received ticket) {
	if received.Details.Error == "DeviceNotRegistered" {
		s.deps.DB.WithContext(ctx).Where("id = ? AND owner_id = ?", token.ID, token.OwnerID).Delete(&subscription{})
	}
	if received.Details.Error != "MessageRateExceeded" {
		s.finish(ctx, entry.ID)
	}
}
