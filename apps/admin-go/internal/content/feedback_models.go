package content

import "time"

type FeedbackAttachment struct {
	Id         string    `gorm:"column:id;primaryKey"            json:"id"`
	FeedbackId string    `gorm:"column:feedbackId"               json:"feedbackId"`
	FileName   string    `gorm:"column:fileName"                 json:"fileName"`
	MimeType   string    `gorm:"column:mimeType"                 json:"mimeType"`
	Size       int64     `gorm:"column:size"                     json:"size"`
	Data       []byte    `gorm:"column:data"                     json:"data"`
	CreatedAt  time.Time `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
}

func (FeedbackAttachment) TableName() string { return "user_feedback_attachments" }

type Feedback struct {
	Id                 string     `gorm:"column:id;primaryKey"            json:"id"`
	Content            string     `gorm:"column:content"                  json:"content"`
	Version            string     `gorm:"column:version"                  json:"version"`
	Platform           string     `gorm:"column:platform"                 json:"platform"`
	UserId             *string    `gorm:"column:userId"                   json:"userId"`
	Email              *string    `gorm:"column:email"                    json:"email"`
	LastRepliedAt      *time.Time `gorm:"column:lastRepliedAt"            json:"lastRepliedAt"`
	LastRepliedById    *string    `gorm:"column:lastRepliedById"          json:"lastRepliedById"`
	LastRepliedByEmail *string    `gorm:"column:lastRepliedByEmail"       json:"lastRepliedByEmail"`
	CreatedAt          time.Time  `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
}

func (Feedback) TableName() string { return "user_feedback" }
