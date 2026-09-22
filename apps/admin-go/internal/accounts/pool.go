package accounts

import (
	"errors"
	"strconv"
	"strings"

	"github.com/codex-switch/admin-go/internal/platform"
	"gorm.io/gorm"
)

func scope(actor *platform.Principal, permissionCode string) string {
	if platform.HasPermissions(actor, []string{permissionCode}, false) {
		return ""
	}
	return actor.ID
}

func (s *service) system(id, owner string) (*systemAccount, error) {
	row := systemAccount{}
	query := s.deps.DB.Where("id = ?", id)
	if owner != "" {
		query = query.Where(`"addedByUserId" = ?`, owner)
	}
	if err := query.First(&row).Error; err != nil {
		return nil, notFound(err, "Official account not found")
	}
	return &row, nil
}

func (s *service) presentSystem(row systemAccount) (object, error) {
	var count int64
	if err := s.deps.DB.Model(&binding{}).Where(`"systemAccountId" = ?`, row.ID).Count(&count).Error; err != nil {
		return nil, err
	}
	dto := encodeMap(row)
	delete(dto, "auth")
	dto["accountId"] = dto["codexAccountId"]
	delete(dto, "codexAccountId")
	dto["lastModifiedAt"] = iso(row.LastModifiedAt)
	dto["createdAt"] = iso(row.CreatedAt)
	dto["updatedAt"] = iso(row.UpdatedAt)
	dto["boundUserCount"] = count
	return dto, nil
}

func (s *service) createSystem(actor *platform.Principal, in object, origin object) (object, error) {
	auth, err := normalizeAuth(obj(in["auth"]))
	if err != nil {
		return nil, err
	}
	identity, err := authIdentity(auth)
	if err != nil {
		return nil, err
	}
	var count int64
	err = s.deps.DB.Model(&systemAccount{}).Where(`"syncAccountId" = ?`, identity["syncAccountId"]).Count(&count).Error
	if err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, platform.NewError(409, "Official account already exists in the system pool")
	}
	values := copyObject(identity)
	values["id"] = newID()
	values["auth"] = auth
	values["note"] = strings.TrimSpace(str(in["note"]))
	values["expiresAt"] = strings.TrimSpace(str(in["expiresAt"]))
	values["usage"] = obj(in["usage"])
	values["source"] = valueOr(origin["source"], "admin")
	values["addedByUserId"] = actor.ID
	values["addedByEmail"] = actor.Email
	values["sourceAccountId"] = origin["sourceAccountId"]
	values["lastModifiedAt"] = iso(now())
	row := systemAccount{}
	if err = decodeMap(values, &row); err != nil {
		return nil, err
	}
	if err = s.deps.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	return s.presentSystem(row)
}

func (s *service) updateSystem(id string, patch object, owner string) (object, error) {
	row, err := s.system(id, owner)
	if err != nil {
		return nil, err
	}
	for _, key := range []string{"auth", "note", "expiresAt", "usage"} {
		if has(patch, key) && patch[key] == nil {
			return nil, errors.New("official account required field cannot be null")
		}
	}
	if has(patch, "auth") {
		row, err = s.replaceSystemAuth(row, obj(patch["auth"]))
		if err != nil {
			return nil, err
		}
	}
	if has(patch, "note") {
		row.Note = strings.TrimSpace(str(patch["note"]))
	}
	if has(patch, "expiresAt") {
		row.ExpiresAt = strings.TrimSpace(str(patch["expiresAt"]))
	}
	if has(patch, "usage") {
		row.Usage = obj(patch["usage"])
	}
	row.LastModifiedAt = now()
	if err = s.deps.DB.Save(row).Error; err != nil {
		return nil, err
	}
	if err = s.invalidateSystem(id); err != nil {
		return nil, err
	}
	return s.presentSystem(*row)
}

func (s *service) replaceSystemAuth(row *systemAccount, raw object) (*systemAccount, error) {
	auth, err := normalizeAuth(raw)
	if err != nil {
		return nil, err
	}
	identity, err := authIdentity(auth)
	if err != nil {
		return nil, err
	}
	var count int64
	err = s.deps.DB.Model(&systemAccount{}).
		Where(`"syncAccountId" = ? AND id <> ?`, identity["syncAccountId"], row.ID).Count(&count).Error
	if err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, platform.NewError(409, "Official account already exists in the system pool")
	}
	values := encodeMap(row)
	for key, value := range identity {
		values[key] = value
	}
	values["auth"] = auth
	updated := systemAccount{}
	if err = decodeMap(values, &updated); err != nil {
		return nil, err
	}
	return &updated, nil
}

func (s *service) invalidateSystem(id string) error {
	rows := []binding{}
	if err := s.deps.DB.Where(`"systemAccountId" = ?`, id).Find(&rows).Error; err != nil {
		return err
	}
	for _, r := range rows {
		if err := s.invalidate(r.UserID, false); err != nil {
			return err
		}
	}
	return nil
}

func (s *service) requireSystems(ids []string, owner string) ([]systemAccount, error) {
	rows := []systemAccount{}
	query := s.deps.DB.Where("id IN ?", ids)
	if owner != "" {
		query = query.Where(`"addedByUserId" = ?`, owner)
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) != len(ids) {
		return nil, platform.NewError(404, "Official account not found")
	}
	return rows, nil
}

func (s *service) deleteSystems(ids []string, owner string) (interface{}, error) {
	ids = unique(ids)
	if _, err := s.requireSystems(ids, owner); err != nil {
		return nil, err
	}
	for _, id := range ids {
		if err := s.invalidateSystem(id); err != nil {
			return nil, err
		}
	}
	if err := s.deps.DB.Where("id IN ?", ids).Delete(&systemAccount{}).Error; err != nil {
		return nil, err
	}
	return object{"ids": ids, "count": len(ids)}, nil
}

func (s *service) systemBindings(id, owner string) (interface{}, error) {
	if _, err := s.system(id, owner); err != nil {
		return nil, err
	}
	rows := []binding{}
	err := s.deps.DB.Where(`"systemAccountId" = ?`, id).Order(`"createdAt" ASC`).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, row := range rows {
		ids = append(ids, row.UserID)
	}
	return object{"userIds": ids}, nil
}

func (s *service) listSystems(actor *platform.Principal, query map[string]string) (interface{}, error) {
	page, size := 1, 20
	if n, e := strconv.Atoi(query["page"]); e == nil && n > 0 {
		page = n
	}
	if n, e := strconv.Atoi(query["pageSize"]); e == nil && n > 0 {
		size = min(100, n)
	}
	base := s.deps.DB.Model(&systemAccount{}).Table("system_accounts a")
	owner := scope(actor, "admin.official-accounts.read")
	if owner != "" {
		base = base.Where(`a."addedByUserId" = ?`, owner)
	}
	base = systemFilters(base, query)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}
	order := `a."createdAt" DESC`
	if query["sortOrder"] == "asc" {
		order = `a."createdAt" ASC`
	}
	if query["sortBy"] == "boundUserCount" {
		direction := "DESC"
		if query["sortOrder"] == "asc" {
			direction = "ASC"
		}
		order = `(SELECT COUNT(*) FROM system_account_bindings b WHERE b."systemAccountId" = a.id) ` +
			direction + `, a."createdAt" DESC`
	}
	rows := []systemAccount{}
	if err := base.Select("a.*").Order(order).Offset((page - 1) * size).Limit(size).Find(&rows).Error; err != nil {
		return nil, err
	}
	items := []object{}
	for _, row := range rows {
		dto, err := s.presentSystem(row)
		if err != nil {
			return nil, err
		}
		items = append(items, dto)
	}
	return object{"items": items, "total": total, "page": page, "pageSize": size}, nil
}

func systemFilters(query *gorm.DB, filters map[string]string) *gorm.DB {
	countSQL := `(SELECT COUNT(*) FROM system_account_bindings b WHERE b."systemAccountId" = a.id)`
	if search := strings.TrimSpace(filters["search"]); search != "" {
		condition := `(a.email ILIKE ? OR a.note ILIKE ? OR a.plan ILIKE ? OR a."addedByEmail" ILIKE ?`
		pattern := "%" + search + "%"
		args := []interface{}{pattern, pattern, pattern, pattern}
		if n, e := strconv.ParseUint(search, 10, 53); e == nil {
			condition += " OR " + countSQL + " = ?"
			args = append(args, n)
		}
		query = query.Where(condition+")", args...)
	}
	for _, key := range []string{"email", "plan", "note", "addedByEmail"} {
		if value := strings.TrimSpace(filters[key]); value != "" {
			query = query.Where(`a."`+key+`" ILIKE ?`, "%"+value+"%")
		}
	}
	if value, ok := filters["boundUserCount"]; ok {
		if n, e := strconv.Atoi(value); e == nil {
			query = query.Where(countSQL+" = ?", n)
		}
	}
	return query
}
