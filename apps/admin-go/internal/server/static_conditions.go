package server

import (
	"fmt"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Express send accepts weak If-Match tags and ignores malformed or disjoint ranges.
// Normalize those cases before ServeFile, whose standard HTTP behavior differs.
func prepareStaticRequest(c *gin.Context, info os.FileInfo) bool {
	if staticPreconditionFailed(c, info.ModTime()) {
		c.JSON(http.StatusPreconditionFailed, gin.H{"statusCode": 412, "message": "Precondition Failed"})
		return false
	}
	c.Request.Header.Del("If-Match")
	c.Request.Header.Del("If-Unmodified-Since")
	unchanged := staticNotModified(c, info.ModTime())
	c.Request.Header.Del("If-None-Match")
	c.Request.Header.Del("If-Modified-Since")
	if unchanged {
		c.Status(http.StatusNotModified)
		return false
	}
	rangeHeader := strings.TrimLeft(c.GetHeader("Range"), " ")
	if !strings.HasPrefix(rangeHeader, "bytes=") || !staticRangeFresh(c, info.ModTime()) {
		c.Request.Header.Del("Range")
		return true
	}
	c.Request.Header.Del("If-Range")
	ranges, valid := parseStaticRanges(strings.TrimPrefix(rangeHeader, "bytes="), info.Size())
	if !valid {
		c.Request.Header.Del("Range")
		return true
	}
	if len(ranges) == 0 {
		c.Header("Content-Range", fmt.Sprintf("bytes */%d", info.Size()))
		c.JSON(http.StatusRequestedRangeNotSatisfiable, gin.H{"statusCode": 416, "message": "Range Not Satisfiable"})
		return false
	}
	if normalized := combinedStaticRange(ranges); normalized != "" {
		c.Request.Header.Set("Range", normalized)
	} else {
		c.Request.Header.Del("Range")
	}
	return true
}

func staticNotModified(c *gin.Context, modified time.Time) bool {
	if c.GetHeader("If-None-Match") != "" {
		return freshResponse(c, http.StatusOK, c.Writer.Header().Get("ETag"))
	}
	if strings.Contains(c.GetHeader("Cache-Control"), "no-cache") {
		return false
	}
	since, err := http.ParseTime(c.GetHeader("If-Modified-Since"))
	return err == nil && !modified.Truncate(time.Second).After(since)
}

func staticPreconditionFailed(c *gin.Context, modified time.Time) bool {
	if match := c.GetHeader("If-Match"); match != "" {
		etag := strings.TrimPrefix(c.Writer.Header().Get("ETag"), "W/")
		for _, candidate := range strings.Split(match, ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
				return false
			}
		}
		return true
	}
	unmodified, err := http.ParseTime(c.GetHeader("If-Unmodified-Since"))
	return err == nil && modified.Truncate(time.Second).After(unmodified)
}

func staticRangeFresh(c *gin.Context, modified time.Time) bool {
	condition := c.GetHeader("If-Range")
	if condition == "" {
		return true
	}
	if strings.Contains(condition, `"`) {
		return strings.Contains(condition, c.Writer.Header().Get("ETag"))
	}
	since, err := http.ParseTime(condition)
	return err == nil && !modified.Truncate(time.Second).After(since)
}

type staticRange struct{ start, end int64 }

func parseStaticRanges(value string, size int64) ([]staticRange, bool) {
	ranges := []staticRange{}
	for _, part := range strings.Split(value, ",") {
		item, valid := parseStaticRange(strings.TrimSpace(part), size)
		if !valid {
			return nil, false
		}
		if item.start >= 0 && item.start <= item.end {
			ranges = append(ranges, item)
		}
	}
	return ranges, true
}

func parseStaticRange(value string, size int64) (staticRange, bool) {
	first, last, found := strings.Cut(value, "-")
	first, last = strings.TrimSpace(first), strings.TrimSpace(last)
	if !found || (first == "" && last == "") {
		return staticRange{}, false
	}
	start, firstValid := rangePosition(first)
	end, lastValid := rangePosition(last)
	if first == "" {
		start, end, firstValid = size-end, size-1, true
	} else if last == "" {
		end, lastValid = size-1, true
	}
	return staticRange{start, min(end, size-1)}, firstValid && lastValid
}

func rangePosition(value string) (int64, bool) {
	if value == "" {
		return 0, false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return 0, false
		}
	}
	position, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return math.MaxInt64, true
	}
	return position, true
}

func combinedStaticRange(ranges []staticRange) string {
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].start < ranges[j].start })
	combined := ranges[0]
	for _, item := range ranges[1:] {
		if item.start > combined.end+1 {
			return ""
		}
		combined.end = max(combined.end, item.end)
	}
	return fmt.Sprintf("bytes=%d-%d", combined.start, combined.end)
}
