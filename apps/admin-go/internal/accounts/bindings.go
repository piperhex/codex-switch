package accounts

import (
	"github.com/codex-switch/admin-go/internal/identity"
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"log/slog"
	"sync"
)

func (s *service) changeBindings(c *gin.Context, bind bool) (interface{}, error) {
	in, err := body(c)
	if err != nil {
		return nil, err
	}
	actor := platform.User(c)
	ids, users := unique(stringsOf(in["systemAccountIds"])), unique(stringsOf(in["userIds"]))
	emails, err := s.bindingRecipients(users)
	if err != nil {
		return nil, err
	}
	accounts, err := s.requireSystems(ids, scope(actor, "admin.official-accounts.manage"))
	if err != nil {
		return nil, err
	}
	if !bind {
		return s.unbind(actor, in, users)
	}
	rows := []binding{}
	err = s.deps.DB.Where(`"systemAccountId" IN ? AND "userId" IN ?`, ids, users).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	additions, notifications := newBindings(rows, accounts, ids, users)
	if len(additions) > 0 {
		if err = s.deps.DB.Create(&additions).Error; err != nil {
			return nil, err
		}
	}
	for _, id := range users {
		if err = s.invalidate(id, false); err != nil {
			return nil, err
		}
	}
	err = s.record(actor, auditOptions{
		Action: "official-account.bind",
		Metadata: object{
			"systemAccountIds": in["systemAccountIds"],
			"userIds":          in["userIds"],
			"createdBindings":  len(additions),
		},
	})
	if err != nil {
		return nil, err
	}
	s.notifyBindings(actor.Email, emails, notifications)
	return object{"count": len(additions)}, nil
}

func (s *service) bindingRecipients(users []string) (map[string]string, error) {
	emails := map[string]string{}
	for _, id := range users {
		user, err := s.ensureUser(id)
		if err != nil {
			return nil, err
		}
		emails[id] = str(user["email"])
	}
	return emails, nil
}

func newBindings(rows []binding, accounts []systemAccount, ids, users []string) ([]binding, map[string][]string) {
	existing := map[string]bool{}
	for _, row := range rows {
		existing[row.SystemAccountID+":"+row.UserID] = true
	}
	additions := []binding{}
	notifications := map[string][]string{}
	byID := map[string]systemAccount{}
	for _, account := range accounts {
		byID[account.ID] = account
	}
	for _, accountID := range ids {
		account := byID[accountID]
		for _, id := range users {
			if existing[account.ID+":"+id] {
				continue
			}
			additions = append(additions, binding{SystemAccountID: account.ID, UserID: id})
			notifications[id] = append(notifications[id], account.Email)
		}
	}
	return additions, notifications
}

func (s *service) notifyBindings(operator string, recipients map[string]string, accounts map[string][]string) {
	var pending sync.WaitGroup
	for id, accountEmails := range accounts {
		pending.Add(1)
		go func() {
			defer pending.Done()
			if err := identity.SendOfficialAccountBound(s.deps, recipients[id], accountEmails, operator); err != nil {
				slog.Warn("account binding notification could not be sent", "error", err)
			}
		}()
	}
	pending.Wait()
}

func (s *service) unbind(actor *platform.Principal, in object, users []string) (interface{}, error) {
	result := s.deps.DB.Where(`"systemAccountId" IN ? AND "userId" IN ?`, stringsOf(in["systemAccountIds"]), users).
		Delete(&binding{})
	if result.Error != nil {
		return nil, result.Error
	}
	for _, id := range users {
		if err := s.invalidate(id, false); err != nil {
			return nil, err
		}
	}
	return object{
			"count": result.RowsAffected,
		}, s.record(
			actor,
			auditOptions{
				Action: "official-account.unbind",
				Metadata: object{
					"systemAccountIds": in["systemAccountIds"],
					"userIds":          in["userIds"],
					"removedBindings":  result.RowsAffected,
				},
			},
		)
}
