package content

import "time"

type SkillMarketItem struct {
	Id              string    `gorm:"column:id;primaryKey"            json:"id"`
	Title           string    `gorm:"column:title"                    json:"title"`
	Description     string    `gorm:"column:description"              json:"description"`
	Version         string    `gorm:"column:version"                  json:"version"`
	ArchiveFileName string    `gorm:"column:archiveFileName"          json:"archiveFileName"`
	ArchiveMimeType string    `gorm:"column:archiveMimeType"          json:"archiveMimeType"`
	ArchiveSize     int64     `gorm:"column:archiveSize"              json:"archiveSize"`
	ArchiveSha256   string    `gorm:"column:archiveSha256"            json:"archiveSha256"`
	ArchiveData     []byte    `gorm:"column:archiveData"              json:"archiveData"`
	PreviewMimeType *string   `gorm:"column:previewMimeType"          json:"previewMimeType"`
	PreviewSize     *int64    `gorm:"column:previewSize"              json:"previewSize"`
	PreviewData     []byte    `gorm:"column:previewData"              json:"previewData"`
	UploaderId      *string   `gorm:"column:uploaderId"               json:"uploaderId"`
	UploaderEmail   string    `gorm:"column:uploaderEmail"            json:"uploaderEmail"`
	Official        bool      `gorm:"column:official"                 json:"official"`
	InstallCount    int64     `gorm:"column:installCount"             json:"installCount"`
	CreatedAt       time.Time `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updatedAt;autoUpdateTime" json:"updatedAt"`
}

func (SkillMarketItem) TableName() string { return "skill_market_items" }

type PromptPluginItem struct {
	Id            string    `gorm:"column:id;primaryKey"            json:"id"`
	Name          string    `gorm:"column:name"                     json:"name"`
	Version       string    `gorm:"column:version"                  json:"version"`
	Type          string    `gorm:"column:type"                     json:"type"`
	Text          string    `gorm:"column:text"                     json:"text"`
	UploaderId    *string   `gorm:"column:uploaderId"               json:"uploaderId"`
	UploaderEmail string    `gorm:"column:uploaderEmail"            json:"uploaderEmail"`
	InstallCount  int64     `gorm:"column:installCount"             json:"installCount"`
	CreatedAt     time.Time `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
	UpdatedAt     time.Time `gorm:"column:updatedAt;autoUpdateTime" json:"updatedAt"`
}

func (PromptPluginItem) TableName() string { return "prompt_plugin_items" }
