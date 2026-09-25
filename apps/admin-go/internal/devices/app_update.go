package devices

import (
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/google/uuid"
)

const appUpdateTimeout = 40 * time.Second

type pendingAppUpdate struct {
	owner, device, request string
	client, desktop        *peer
	timer                  *time.Timer
}

func (g *ControlGateway) requestAppUpdate(client *peer, session controlSession, message platform.JSON) {
	request, _ := message["requestId"].(string)
	id, _ := message["deviceId"].(string)
	action, _ := message["action"].(string)
	version, _ := message["version"].(string)
	fail := func(text string) { sendAppUpdateResult(client, request, nil, text) }
	if request == "" || len(request) > 80 || !deviceIDPattern.MatchString(id) ||
		(action != "status" && action != "check" && action != "install") ||
		(action == "install" && (version == "" || len(version) > 80)) {
		fail("更新请求无效，请重新打开电脑端版本。")
		return
	}
	device, err := g.service.owned(session.owner, id)
	if err != nil {
		fail("无法访问这台电脑。")
		return
	}
	if checkCapability(device, commandSpec{capability: "app-update"}) != nil {
		fail("请先在电脑上更新 Codex Switch，再使用远程更新。")
		return
	}
	g.forwardAppUpdate(client, session.owner, message)
}

func (g *ControlGateway) forwardAppUpdate(client *peer, owner string, message platform.JSON) {
	id := message["deviceId"].(string)
	request := message["requestId"].(string)
	g.mu.Lock()
	defer g.mu.Unlock()
	desktop := g.sockets[owner+":"+id]
	if desktop == nil || desktop.closed.Load() {
		sendAppUpdateResult(client, request, nil, "电脑已离线，请打开电脑端后重试。")
		return
	}
	count := 0
	for _, pending := range g.updates {
		if pending.client == client {
			sendAppUpdateResult(client, request, nil, "正在处理上一个请求，请稍候。")
			return
		}
		if pending.desktop == desktop {
			count++
		}
	}
	if count >= 4 {
		sendAppUpdateResult(client, request, nil, "电脑正在处理其他请求，请稍后重试。")
		return
	}
	command := uuid.NewString()
	timer := time.AfterFunc(appUpdateTimeout, func() { g.expireAppUpdate(command) })
	g.updates[command] = pendingAppUpdate{owner, id, request, client, desktop, timer}
	desktop.send(platform.JSON{"type": "app-update", "commandId": command,
		"action": message["action"], "version": message["version"]}, nil)
}

func (g *ControlGateway) receiveAppUpdate(client *peer, session controlSession, message platform.JSON) {
	command, _ := message["commandId"].(string)
	g.mu.Lock()
	defer g.mu.Unlock()
	pending, ok := g.updates[command]
	if !ok || pending.owner != session.owner || pending.device != session.device || pending.desktop != client {
		return
	}
	delete(g.updates, command)
	pending.timer.Stop()
	detail, _ := message["error"].(string)
	if detail != "" {
		detail = "操作未完成，请稍后重试。"
	}
	sendAppUpdateResult(pending.client, pending.request, message["data"], detail)
}

func (g *ControlGateway) expireAppUpdate(command string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	pending, ok := g.updates[command]
	if !ok {
		return
	}
	delete(g.updates, command)
	sendAppUpdateResult(pending.client, pending.request, nil,
		"电脑暂未响应，请重试；已发送的安装指令可能仍在执行。")
}

// Called with the gateway lock held; replies are tied to the exact authenticated socket.
func (g *ControlGateway) disconnectAppUpdates(client *peer) {
	for command, pending := range g.updates {
		if pending.client != client && pending.desktop != client {
			continue
		}
		delete(g.updates, command)
		pending.timer.Stop()
		if pending.client != client {
			sendAppUpdateResult(pending.client, pending.request, nil, "连接已断开，请重新连接后查看结果。")
		}
	}
}

func sendAppUpdateResult(client *peer, request string, data interface{}, detail string) {
	client.send(platform.JSON{"type": "app-update-result", "requestId": request, "data": data, "error": detail}, nil)
}
