package content

import "time"

type AnnouncementLinkClick struct {
	Id                    string     `gorm:"column:id;primaryKey"            json:"id"`
	DeviceId              string     `gorm:"column:deviceId"                 json:"deviceId"`
	Platform              string     `gorm:"column:platform"                 json:"platform"`
	Email                 *string    `gorm:"column:email"                    json:"email"`
	Link                  string     `gorm:"column:link"                     json:"link"`
	AnnouncementUpdatedAt *time.Time `gorm:"column:announcementUpdatedAt"    json:"announcementUpdatedAt"`
	CreatedAt             time.Time  `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
}

func (AnnouncementLinkClick) TableName() string { return "announcement_link_clicks" }

type AppAnnouncement struct {
	Id                    string    `gorm:"column:id;primaryKey"            json:"id"`
	ContentZh             string    `gorm:"column:content"                  json:"contentZh"`
	ContentEn             string    `gorm:"column:contentEn"                json:"contentEn"`
	Link                  string    `gorm:"column:link"                     json:"link"`
	Enabled               bool      `gorm:"column:enabled"                  json:"enabled"`
	TextColor             string    `gorm:"column:textColor"                json:"textColor"`
	BackgroundColor       string    `gorm:"column:backgroundColor"          json:"backgroundColor"`
	DarkTextColor         string    `gorm:"column:darkTextColor"            json:"darkTextColor"`
	DarkBackgroundColor   string    `gorm:"column:darkBackgroundColor"      json:"darkBackgroundColor"`
	ScrollDurationSeconds int64     `gorm:"column:scrollDurationSeconds"    json:"scrollDurationSeconds"`
	UpdatedById           *string   `gorm:"column:updatedById"              json:"updatedById"`
	UpdatedByEmail        string    `gorm:"column:updatedByEmail"           json:"updatedByEmail"`
	CreatedAt             time.Time `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
	UpdatedAt             time.Time `gorm:"column:updatedAt;autoUpdateTime" json:"updatedAt"`
}

func (AppAnnouncement) TableName() string { return "app_announcements" }

type AppFaq struct {
	Id             string    `gorm:"column:id;primaryKey"            json:"id"`
	QuestionZh     string    `gorm:"column:questionZh"               json:"questionZh"`
	QuestionEn     string    `gorm:"column:questionEn"               json:"questionEn"`
	AnswerZh       string    `gorm:"column:answerZh"                 json:"answerZh"`
	AnswerEn       string    `gorm:"column:answerEn"                 json:"answerEn"`
	Enabled        bool      `gorm:"column:enabled"                  json:"enabled"`
	SortOrder      int64     `gorm:"column:sortOrder"                json:"sortOrder"`
	UpdatedById    *string   `gorm:"column:updatedById"              json:"updatedById"`
	UpdatedByEmail string    `gorm:"column:updatedByEmail"           json:"updatedByEmail"`
	CreatedAt      time.Time `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
	UpdatedAt      time.Time `gorm:"column:updatedAt;autoUpdateTime" json:"updatedAt"`
}

func (AppFaq) TableName() string { return "app_faqs" }

type AppNotification struct {
	Id             string    `gorm:"column:id;primaryKey"            json:"id"`
	TitleZh        string    `gorm:"column:titleZh"                  json:"titleZh"`
	TitleEn        string    `gorm:"column:titleEn"                  json:"titleEn"`
	ContentZh      string    `gorm:"column:contentZh"                json:"contentZh"`
	ContentEn      string    `gorm:"column:contentEn"                json:"contentEn"`
	Link           string    `gorm:"column:link"                     json:"link"`
	LinkLabelZh    string    `gorm:"column:linkLabelZh"              json:"linkLabelZh"`
	LinkLabelEn    string    `gorm:"column:linkLabelEn"              json:"linkLabelEn"`
	Enabled        bool      `gorm:"column:enabled"                  json:"enabled"`
	PublishedAt    time.Time `gorm:"column:publishedAt"              json:"publishedAt"`
	UpdatedById    *string   `gorm:"column:updatedById"              json:"updatedById"`
	UpdatedByEmail string    `gorm:"column:updatedByEmail"           json:"updatedByEmail"`
	CreatedAt      time.Time `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
	UpdatedAt      time.Time `gorm:"column:updatedAt;autoUpdateTime" json:"updatedAt"`
}

func (AppNotification) TableName() string { return "app_notifications" }
