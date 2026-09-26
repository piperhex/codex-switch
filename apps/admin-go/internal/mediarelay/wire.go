package mediarelay

import (
	"encoding/binary"
	"io"

	"github.com/pion/stun/v3"
)

const stunHeaderBytes = 20
const channelHeaderBytes = 4
const maxFrameBytes = 65556

func channelData(frame []byte) bool {
	return len(frame) >= channelHeaderBytes && frame[0]&0xc0 == 0x40
}

func decode(frame []byte) (*stun.Message, bool, error) {
	if channelData(frame) {
		length := channelHeaderBytes + int(binary.BigEndian.Uint16(frame[2:4]))
		if length > len(frame) || len(frame) > (length+3)&^3 {
			return nil, false, errProtocol
		}
		return nil, true, nil
	}
	if len(frame) < stunHeaderBytes || len(frame) != stunHeaderBytes+int(binary.BigEndian.Uint16(frame[2:4])) {
		return nil, false, errProtocol
	}
	message := &stun.Message{Raw: frame}
	if message.Decode() != nil {
		return nil, false, errProtocol
	}
	media := message.Type.Class == stun.ClassIndication &&
		(message.Type.Method == stun.MethodSend || message.Type.Method == stun.MethodData)
	return message, media, nil
}

// TURN over TCP/TLS pads ChannelData to four bytes; STUN already carries a padded length.
func readFrame(reader io.Reader) ([]byte, error) {
	header := make([]byte, channelHeaderBytes)
	if _, err := io.ReadFull(reader, header); err != nil {
		return nil, err
	}
	length := int(binary.BigEndian.Uint16(header[2:4]))
	if channelData(header) {
		length = (length+3)&^3 + channelHeaderBytes
	} else {
		length += stunHeaderBytes
	}
	if length > maxFrameBytes {
		return nil, errProtocol
	}
	frame := make([]byte, length)
	copy(frame, header)
	_, err := io.ReadFull(reader, frame[channelHeaderBytes:])
	return frame, err
}

func writeFrame(writer io.Writer, frame []byte) error {
	n, err := writer.Write(frame)
	if err == nil && n != len(frame) {
		return io.ErrShortWrite
	}
	return err
}
