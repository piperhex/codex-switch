package mediarelay

import (
	"bytes"
	"testing"

	"github.com/pion/stun/v3"
)

func TestTCPFramingRetainsChannelPaddingAndSTUNBoundaries(t *testing.T) {
	channel := []byte{0x40, 1, 0, 3, 10, 20, 30, 0}
	binding := stun.MustBuild(stun.BindingRequest, stun.TransactionID).Raw
	stream := bytes.NewReader(append(append([]byte(nil), channel...), binding...))
	for _, expected := range [][]byte{channel, binding} {
		frame, err := readFrame(stream)
		if err != nil || !bytes.Equal(frame, expected) {
			t.Fatalf("frame mismatch: %v", err)
		}
		if _, _, err := decode(frame); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := readFrame(stream); err == nil {
		t.Fatal("accepted missing frame")
	}
}

func TestMalformedFramesAreRejected(t *testing.T) {
	for _, input := range [][]byte{nil, {0x40}, {0x40, 0, 0, 8, 1}, {0, 0, 0, 8}, make([]byte, 20)} {
		if _, _, err := decode(input); err == nil {
			t.Fatalf("accepted malformed frame: %x", input)
		}
	}
}
