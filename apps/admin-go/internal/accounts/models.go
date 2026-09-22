// Package accounts implements desktop synchronization and the official account pool.
package accounts

import "time"

type object = map[string]interface{}

type account struct {
	ID                  string     `gorm:"column:id;primaryKey"                   json:"id"`
	OwnerID             string     `gorm:"column:ownerId"                         json:"ownerId"`
	AccountID           string     `gorm:"column:accountId"                       json:"accountId"`
	Email               string     `gorm:"column:email"                           json:"email"`
	Note                string     `gorm:"column:note"                            json:"note"`
	ExpiresAt           string     `gorm:"column:expiresAt"                       json:"expiresAt"`
	PrivateDetails      object     `gorm:"column:privateDetails;serializer:json"  json:"privateDetails"`
	Plan                string     `gorm:"column:plan"                            json:"plan"`
	CodexAccountID      *string    `gorm:"column:codexAccountId"                  json:"codexAccountId"`
	Active              bool       `gorm:"column:active"                          json:"active"`
	AutoSwitchPriority  int32      `gorm:"column:autoSwitchPriority"              json:"autoSwitchPriority"`
	AutoSwitchThreshold float64    `gorm:"column:autoSwitchThreshold"             json:"autoSwitchThreshold"`
	Usage               object     `gorm:"column:usage;serializer:json"           json:"usage"`
	Auth                object     `gorm:"column:auth;serializer:json"            json:"auth"`
	FieldModifiedAt     object     `gorm:"column:fieldModifiedAt;serializer:json" json:"fieldModifiedAt"`
	LastModifiedAt      time.Time  `gorm:"column:lastModifiedAt"                  json:"lastModifiedAt"`
	DeletedAt           *time.Time `gorm:"column:deletedAt"                       json:"deletedAt"`
	CreatedAt           time.Time  `gorm:"column:createdAt"                       json:"createdAt"`
	UpdatedAt           time.Time  `gorm:"column:updatedAt"                       json:"updatedAt"`
}

func (account) TableName() string { return "synced_accounts" }

type provider struct {
	ID                    string   `gorm:"column:id;primaryKey"                         json:"id"`
	OwnerID               string   `gorm:"column:ownerId"                               json:"ownerId"`
	ProviderID            string   `gorm:"column:providerId"                            json:"providerId"`
	Kind                  string   `gorm:"column:kind"                                  json:"kind"`
	Name                  string   `gorm:"column:name"                                  json:"name"`
	Group                 string   `gorm:"column:group"                                 json:"group"`
	BaseURL               string   `gorm:"column:baseUrl"                               json:"baseUrl"`
	APIKey                string   `gorm:"column:apiKey"                                json:"apiKey"`
	Model                 string   `gorm:"column:model"                                 json:"model"`
	Models                []string `gorm:"column:models;serializer:json"                json:"models"`
	ModelReasoningEfforts object   `gorm:"column:modelReasoningEfforts;serializer:json" json:"modelReasoningEfforts"`
	ModelContextWindows   object   `gorm:"column:modelContextWindows;serializer:json"   json:"modelContextWindows"`
	ModelAPIFormats       object   `gorm:"column:modelApiFormats;serializer:json"       json:"modelApiFormats"`
	ImageInputModels      []string `gorm:"column:imageInputModels;serializer:json"      json:"imageInputModels"`
	ContextWindow         *int64   `gorm:"column:contextWindow"                         json:"contextWindow"`

	CodexControlsModel bool `gorm:"column:modelSelectionControlledByCodex" json:"modelSelectionControlledByCodex"`

	FastModeEnabled   bool       `gorm:"column:fastModeEnabled"                 json:"fastModeEnabled"`
	APIFormat         string     `gorm:"column:apiFormat"                       json:"apiFormat"`
	BalancePlatform   *string    `gorm:"column:balancePlatform"                 json:"balancePlatform"`
	BalanceQueryURL   *string    `gorm:"column:balanceQueryUrl"                 json:"balanceQueryUrl"`
	BalanceQueryToken *string    `gorm:"column:balanceQueryToken"               json:"balanceQueryToken"`
	WalletQueryURL    *string    `gorm:"column:walletQueryUrl"                  json:"walletQueryUrl"`
	WalletQueryToken  *string    `gorm:"column:walletQueryToken"                json:"walletQueryToken"`
	WalletUsername    *string    `gorm:"column:walletUsername"                  json:"walletUsername"`
	WalletPassword    *string    `gorm:"column:walletPassword"                  json:"walletPassword"`
	LastModifiedAt    time.Time  `gorm:"column:lastModifiedAt"                  json:"lastModifiedAt"`
	FieldModifiedAt   object     `gorm:"column:fieldModifiedAt;serializer:json" json:"fieldModifiedAt"`
	DeletedAt         *time.Time `gorm:"column:deletedAt"                       json:"deletedAt"`
	CreatedAt         time.Time  `gorm:"column:createdAt"                       json:"createdAt"`
	UpdatedAt         time.Time  `gorm:"column:updatedAt"                       json:"updatedAt"`
}

func (provider) TableName() string { return "synced_providers" }

type systemAccount struct {
	ID              string    `gorm:"column:id;primaryKey"         json:"id"`
	SyncAccountID   string    `gorm:"column:syncAccountId"         json:"syncAccountId"`
	Email           string    `gorm:"column:email"                 json:"email"`
	Note            string    `gorm:"column:note"                  json:"note"`
	ExpiresAt       string    `gorm:"column:expiresAt"             json:"expiresAt"`
	Plan            string    `gorm:"column:plan"                  json:"plan"`
	CodexAccountID  *string   `gorm:"column:codexAccountId"        json:"codexAccountId"`
	Usage           object    `gorm:"column:usage;serializer:json" json:"usage"`
	Auth            object    `gorm:"column:auth;serializer:json"  json:"auth"`
	Source          string    `gorm:"column:source"                json:"source"`
	AddedByUserID   *string   `gorm:"column:addedByUserId"         json:"addedByUserId"`
	AddedByEmail    *string   `gorm:"column:addedByEmail"          json:"addedByEmail"`
	SourceAccountID *string   `gorm:"column:sourceAccountId"       json:"sourceAccountId"`
	LastModifiedAt  time.Time `gorm:"column:lastModifiedAt"        json:"lastModifiedAt"`
	CreatedAt       time.Time `gorm:"column:createdAt"             json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updatedAt"             json:"updatedAt"`
}

func (systemAccount) TableName() string { return "system_accounts" }

type binding struct {
	SystemAccountID string    `gorm:"column:systemAccountId;primaryKey" json:"systemAccountId"`
	UserID          string    `gorm:"column:userId;primaryKey"          json:"userId"`
	CreatedAt       time.Time `gorm:"column:createdAt"                  json:"createdAt"`
}

func (binding) TableName() string { return "system_account_bindings" }

type vault struct {
	ID         string    `gorm:"column:id;primaryKey"`
	OwnerID    string    `gorm:"column:ownerId"`
	Entries    []object  `gorm:"column:entries;serializer:json"`
	Tombstones []object  `gorm:"column:tombstones;serializer:json"`
	ModifiedAt time.Time `gorm:"column:modifiedAt"`
	CreatedAt  time.Time `gorm:"column:createdAt"`
	UpdatedAt  time.Time `gorm:"column:updatedAt"`
}

func (vault) TableName() string { return "synced_totp_vaults" }
