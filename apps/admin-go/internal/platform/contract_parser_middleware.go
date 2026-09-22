package platform

import "github.com/gin-gonic/gin"

// RequestBodyParser runs before CORS, matching the legacy Express middleware order.
func RequestBodyParser() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !prepareBody(c) {
			return
		}
		c.Next()
	}
}
