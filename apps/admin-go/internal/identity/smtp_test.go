package identity

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"
)

func TestSMTPMessageDeliversPlainAndHTML(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	received := make(chan []byte, 1)
	serverError := make(chan error, 1)
	go receiveSMTPFixture(listener, received, serverError)
	address := listener.Addr().(*net.TCPAddr)
	message := MailOptions{
		To:      "recipient@example.com",
		Subject: "测试通知",
		Text:    "Plain message",
		HTML:    "<p>HTML message</p>",
	}
	err = sendSMTP(
		smtpOptions{
			Host:     "127.0.0.1",
			Port:     address.Port,
			Username: "fixture",
			Password: "secret",
			From:     "sender@example.com",
		},
		message,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err = <-serverError; err != nil {
		t.Fatal(err)
	}
	select {
	case payload := <-received:
		verifyMIME(t, payload)
	case <-time.After(time.Second):
		t.Fatal("SMTP payload missing")
	}
}
func receiveSMTPFixture(listener net.Listener, received chan<- []byte, result chan<- error) {
	conn, err := listener.Accept()
	if err != nil {
		result <- err
		return
	}
	defer conn.Close()
	if err = conn.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		result <- err
		return
	}
	result <- smtpFixture(conn, received)
}
func smtpFixture(conn net.Conn, received chan<- []byte) error {
	reader := bufio.NewReader(conn)
	if _, err := fmt.Fprint(conn, "220 fixture ESMTP\r\n"); err != nil {
		return err
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return err
		}
		command := strings.ToUpper(strings.TrimSpace(line))
		response := "250 OK\r\n"
		switch {
		case strings.HasPrefix(command, "EHLO"):
			response = "250-fixture\r\n250 AUTH PLAIN LOGIN\r\n"
		case strings.HasPrefix(command, "AUTH PLAIN"):
			response = "235 Authentication successful\r\n"
		case command == "DATA":
			if _, err = fmt.Fprint(conn, "354 Send data\r\n"); err != nil {
				return err
			}
			var data bytes.Buffer
			for {
				line, err = reader.ReadString('\n')
				if err != nil {
					return err
				}
				if line == ".\r\n" {
					break
				}
				data.WriteString(line)
			}
			received <- data.Bytes()
		case command == "QUIT":
			_, err = fmt.Fprint(conn, "221 Goodbye\r\n")
			return err
		}
		if _, err = fmt.Fprint(conn, response); err != nil {
			return err
		}
	}
}
func verifyMIME(t *testing.T, payload []byte) {
	t.Helper()
	message, err := mail.ReadMessage(bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(message.Header.Get("Subject"))
	if err != nil || subject != "测试通知" {
		t.Fatal(subject, err)
	}
	_, parameters, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
	if err != nil {
		t.Fatal(err)
	}
	reader := multipart.NewReader(message.Body, parameters["boundary"])
	contents := []string{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(part)
		if err != nil {
			t.Fatal(err)
		}
		contents = append(contents, string(content))
	}
	if len(contents) != 2 || contents[0] != "Plain message" || contents[1] != "<p>HTML message</p>" {
		t.Fatalf("unexpected MIME alternatives: %v", contents)
	}
}
func TestSMTPHeaderInjectionRejected(t *testing.T) {
	message := MailOptions{To: "recipient@example.com", Subject: "Hello\r\nBcc: victim@example.com"}
	if _, err := mailPayload("sender@example.com", message); err == nil {
		t.Fatal("header injection accepted")
	}
}
