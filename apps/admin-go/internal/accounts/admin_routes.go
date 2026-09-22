package accounts

import (
	"github.com/codex-switch/admin-go/internal/platform"
	"github.com/gin-gonic/gin"
	"strings"
)

func (s *service) registerAdmin(r *gin.RouterGroup) {
	r.GET(
		"/profile/accounts",
		s.deps.RequirePermissions("self.accounts.read"),
		endpoint(func(c *gin.Context) (interface{}, error) {
			return s.listAdmin(platform.User(c).ID, true, permission(c, metadataPermission))
		}),
	)
	for _, kind := range []string{"accounts", "providers"} {
		providers := kind == "providers"
		r.GET(
			"/profile/"+kind+"/deleted",
			s.deps.RequirePermissions("self."+kind+".read"),
			endpoint(func(c *gin.Context) (interface{}, error) { return s.deleted(platform.User(c).ID, providers) }),
		)
		idParam := "accountId"
		if providers {
			idParam = "providerId"
		}
		r.POST(
			"/profile/"+kind+"/deleted/:"+idParam+"/restore",
			s.deps.RequirePermissions("self."+kind+".write"),
			endpoint(s.restoreHandler(providers)),
		)
	}
	r.PATCH(
		"/profile/accounts/:accountId",
		s.deps.RequireAnyPermission("self.accounts.write", metadataPermission),
		endpoint(s.patchPersonal),
	)
	manage := s.deps.RequireAnyPermission("admin.official-accounts.manage", "admin.official-accounts.manage-own")
	r.POST("/profile/accounts/add-to-pool", manage, endpoint(s.addManyPersonal))
	r.POST("/profile/accounts/:accountId/add-to-pool", manage, endpoint(func(c *gin.Context) (interface{}, error) {
		return s.addPersonal(
			platform.User(c),
			addPersonalOptions{Owner: platform.User(c).ID, ID: c.Param("accountId"), Own: true},
		)
	}))
	s.registerUserAccounts(r, manage)
	s.registerPool(r)
}

func (s *service) registerUserAccounts(r *gin.RouterGroup, manage gin.HandlerFunc) {
	users := r.Group("/users/:id", s.deps.RequirePermissions("admin.users.read"))
	view := s.deps.RequireAnyPermission(
		"admin.users.manage",
		"admin.official-accounts.manage",
		"admin.official-accounts.manage-own",
	)
	users.GET("/accounts", view, endpoint(func(c *gin.Context) (interface{}, error) {
		if _, e := s.ensureUser(c.Param("id")); e != nil {
			return nil, e
		}
		return s.listAdmin(c.Param("id"), false, false)
	}))
	users.GET("/providers", view, endpoint(s.adminProviders))
	users.POST("/accounts/:accountId/add-to-pool", manage, endpoint(func(c *gin.Context) (interface{}, error) {
		return s.addPersonal(platform.User(c), addPersonalOptions{Owner: c.Param("id"), ID: c.Param("accountId")})
	}))
	r.PATCH(
		"/users/:id/accounts/:accountId",
		s.deps.RequirePermissions("admin.users.manage"),
		endpoint(s.patchPersonal),
	)
	r.DELETE(
		"/users/:id/accounts/:accountId",
		s.deps.RequirePermissions("admin.users.manage"),
		endpoint(s.deletePersonal),
	)
}

func (s *service) restoreHandler(providers bool) handler {
	return func(c *gin.Context) (interface{}, error) {
		id := c.Param("accountId")
		kind, label := "sync-account", "email"
		if providers {
			id = c.Param("providerId")
			kind = "sync-provider"
			label = "name"
		}
		actor := platform.User(c)
		row, err := s.restore(actor.ID, id, providers)
		if err != nil {
			return nil, err
		}
		return object{
				"id": id,
			}, s.record(
				actor,
				auditOptions{
					Action:      kind + ".restore",
					TargetID:    id,
					TargetEmail: str(row[label]),
					Metadata:    object{"ownerId": actor.ID},
				},
			)
	}
}

func (s *service) patchPersonal(c *gin.Context) (interface{}, error) {
	actor := platform.User(c)
	owner := c.Param("id")
	editable := false
	fields := []string{"email", "note", "expiresAt", "plan", "accountId", "active", "usage", "lastModifiedAt", "auth"}
	if owner == "" {
		owner = actor.ID
		editable = permission(c, metadataPermission)
		fields = []string{"note", "expiresAt"}
	} else if _, err := s.ensureUser(owner); err != nil {
		return nil, err
	}
	in, err := body(c)
	if err != nil {
		return nil, err
	}
	result, err := s.updateAdmin(owner, c.Param("accountId"), in, editable)
	if err != nil {
		return nil, err
	}
	return result, s.record(
		actor,
		auditOptions{
			Action:      "sync-account.update",
			TargetID:    c.Param("accountId"),
			TargetEmail: str(result["email"]),
			Metadata:    object{"ownerId": owner, "fields": fields},
		},
	)
}

func (s *service) deletePersonal(c *gin.Context) (interface{}, error) {
	owner, id := c.Param("id"), c.Param("accountId")
	if _, err := s.ensureUser(owner); err != nil {
		return nil, err
	}
	result, err := s.deleteAccount(owner, id)
	if err != nil {
		return nil, err
	}
	return result, s.record(
		platform.User(c),
		auditOptions{Action: "sync-account.delete", TargetID: id, Metadata: object{"ownerId": owner}},
	)
}

func (s *service) addManyPersonal(c *gin.Context) (interface{}, error) {
	in, err := body(c)
	if err != nil {
		return nil, err
	}
	items := []interface{}{}
	actor := platform.User(c)
	for _, id := range stringsOf(in["accountIds"]) {
		row, e := s.addPersonal(actor, addPersonalOptions{Owner: actor.ID, ID: id, Own: true})
		if e != nil {
			return nil, e
		}
		items = append(items, row)
	}
	return object{"accounts": items, "count": len(items)}, nil
}

func (s *service) adminProviders(c *gin.Context) (interface{}, error) {
	if _, err := s.ensureUser(c.Param("id")); err != nil {
		return nil, err
	}
	result, err := s.providers(c.Param("id"))
	if err != nil {
		return nil, err
	}
	items := result["providers"].([]object)
	for _, row := range items {
		row["hasApiKey"] = strings.TrimSpace(str(row["apiKey"])) != ""
		row["hasBalanceQueryToken"] = strings.TrimSpace(str(row["balanceQueryToken"])) != ""
		row["hasWalletQueryToken"] = strings.TrimSpace(str(row["walletQueryToken"])) != ""
		row["hasWalletLoginCredentials"] = strings.TrimSpace(str(row["walletUsername"])) != "" &&
			str(row["walletPassword"]) != ""
		for _, key := range []string{"apiKey", "balanceQueryToken", "walletQueryToken", "walletUsername", "walletPassword"} {
			delete(row, key)
		}
	}
	return object{"providers": items}, nil
}

func (s *service) registerPool(r *gin.RouterGroup) {
	read := s.deps.RequireAnyPermission("admin.official-accounts.read", "admin.official-accounts.read-own")
	manage := s.deps.RequireAnyPermission("admin.official-accounts.manage", "admin.official-accounts.manage-own")
	r.GET("/official-accounts", read, endpoint(func(c *gin.Context) (interface{}, error) {
		query := map[string]string{}
		for k, values := range c.Request.URL.Query() {
			if len(values) > 0 {
				query[k] = values[0]
			}
		}
		return s.listSystems(platform.User(c), query)
	}))
	r.POST("/official-accounts", manage, endpoint(func(c *gin.Context) (interface{}, error) {
		in, e := body(c)
		if e != nil {
			return nil, e
		}
		return s.createOfficial(platform.User(c), in)
	}))
	r.PATCH("/official-accounts/:id", manage, endpoint(s.patchOfficial))
	r.DELETE("/official-accounts/:id", manage, endpoint(s.deleteOfficial))
	r.POST("/official-accounts/batch-delete", manage, endpoint(s.batchDeleteOfficial))
	r.GET("/official-accounts/:id/bindings", read, endpoint(func(c *gin.Context) (interface{}, error) {
		return s.systemBindings(c.Param("id"), scope(platform.User(c), "admin.official-accounts.read"))
	}))
	r.POST(
		"/official-accounts/bind",
		manage,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.changeBindings(c, true) }),
	)
	r.POST(
		"/official-accounts/unbind",
		manage,
		endpoint(func(c *gin.Context) (interface{}, error) { return s.changeBindings(c, false) }),
	)
	s.registerOfficialNetwork(r, manage)
}

func (s *service) patchOfficial(c *gin.Context) (interface{}, error) {
	in, err := body(c)
	if err != nil {
		return nil, err
	}
	if (has(in, "note") || has(in, "expiresAt")) && !permission(c, metadataPermission) {
		return nil, platform.NewError(403, "You cannot edit official account notes or expiration dates")
	}
	actor := platform.User(c)
	id := c.Param("id")
	result, err := s.updateSystem(id, in, scope(actor, "admin.official-accounts.manage"))
	if err != nil {
		return nil, err
	}
	return result, s.record(
		actor,
		auditOptions{
			Action:      "official-account.update",
			TargetID:    id,
			TargetEmail: str(result["email"]),
			Metadata: object{
				"fields":      []string{"auth", "note", "expiresAt", "usage"},
				"authChanged": has(in, "auth"),
			},
		},
	)
}
func (s *service) deleteOfficial(c *gin.Context) (interface{}, error) {
	actor, id := platform.User(c), c.Param("id")
	if _, err := s.deleteSystems([]string{id}, scope(actor, "admin.official-accounts.manage")); err != nil {
		return nil, err
	}
	return object{"id": id}, s.record(actor, auditOptions{Action: "official-account.delete", TargetID: id})
}
func (s *service) batchDeleteOfficial(c *gin.Context) (interface{}, error) {
	in, err := body(c)
	if err != nil {
		return nil, err
	}
	actor := platform.User(c)
	result, err := s.deleteSystems(stringsOf(in["systemAccountIds"]), scope(actor, "admin.official-accounts.manage"))
	if err != nil {
		return nil, err
	}
	dto := obj(result)
	return result, s.record(
		actor,
		auditOptions{
			Action:   "official-account.batch-delete",
			Metadata: object{"systemAccountIds": dto["ids"], "deletedAccounts": dto["count"]},
		},
	)
}
