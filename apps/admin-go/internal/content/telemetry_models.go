package content

import "time"

type DeviceInstallation struct {
	DeviceId    string    `gorm:"column:deviceId;primaryKey"        json:"deviceId"`
	Platform    string    `gorm:"column:platform"                   json:"platform"`
	AppVersion  *string   `gorm:"column:appVersion"                 json:"appVersion"`
	FirstSeenAt time.Time `gorm:"column:firstSeenAt;autoCreateTime" json:"firstSeenAt"`
}

func (DeviceInstallation) TableName() string { return "device_installations" }

type DeviceTelemetryEvent struct {
	Id        string    `gorm:"column:id;primaryKey"            json:"id"`
	DeviceId  string    `gorm:"column:deviceId"                 json:"deviceId"`
	Platform  string    `gorm:"column:platform"                 json:"platform"`
	EventType string    `gorm:"column:eventType"                json:"eventType"`
	CreatedAt time.Time `gorm:"column:createdAt;autoCreateTime" json:"createdAt"`
}

func (DeviceTelemetryEvent) TableName() string { return "device_telemetry_events" }
