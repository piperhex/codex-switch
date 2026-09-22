package identity

import (
	"bytes"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"github.com/codex-switch/admin-go/internal/platform"
)

// MailOptions describes a notification sent using a configured SMTP service.
type MailOptions struct {
	ServiceID               *string
	To, Subject, Text, HTML string
}
type smtpOptions struct {
	Host                     string
	Port                     int
	Secure                   bool
	Username, Password, From string
}

func (s *service) defaultMailConfigured() bool {
	c := s.deps.Config
	return strings.ToUpper(c.Get("mail__transport", "")) == "SMTP" && c.Get("mail__options__host", "") != "" &&
		c.Get(
			"mail__options__auth__user",
			"",
		) != "" && c.Get("mail__options__auth__pass", "") != "" && c.Get("mail__from", "") != ""
}
func (s *service) defaultSMTP() smtpOptions {
	c := s.deps.Config
	port, _ := strconv.Atoi(c.Get("mail__options__port", "465"))
	return smtpOptions{Host: c.Get("mail__options__host", ""), Port: port,
		Secure: strings.EqualFold(strings.TrimSpace(c.Get("mail__options__secure", "true")), "true"),
		Username: c.Get(
			"mail__options__auth__user",
			"",
		), Password: c.Get("mail__options__auth__pass", ""), From: c.Get("mail__from", "")}
}
func (s *service) resolveSMTP(id *string) (smtpOptions, error) {
	if id == nil || *id == "" {
		if !s.defaultMailConfigured() {
			return smtpOptions{}, platform.NewError(503, "Default email service is not configured")
		}
		return s.defaultSMTP(), nil
	}
	var row mailService
	if err := s.deps.DB.First(&row, "id = ?", *id).Error; err != nil {
		return smtpOptions{}, dbNotFound(err, "Mail service does not exist")
	}
	if !row.Enabled {
		return smtpOptions{}, platform.NewError(503, "Selected email service is disabled")
	}
	password, err := s.decryptMailPassword(row.EncryptedPassword)
	if err != nil {
		return smtpOptions{}, err
	}
	return smtpOptions{row.Host, row.Port, row.Secure, row.Username, password, row.FromAddress}, nil
}

// SendMail sends through the same default/custom SMTP configuration as the legacy backend.
func SendMail(deps *platform.Dependencies, message MailOptions) error {
	s := &service{deps}
	options, err := s.resolveSMTP(message.ServiceID)
	if err != nil {
		return err
	}
	if err = sendSMTP(options, message); err != nil {
		return platform.NewError(503, "Email could not be sent")
	}
	return nil
}
func sendSMTP(options smtpOptions, message MailOptions) error {
	client, err := connectSMTP(options)
	if err != nil {
		return err
	}
	defer client.Close()
	if _, supported := client.Extension("AUTH"); supported != "" {
		auth := &smtpAuth{username: options.Username, password: options.Password}
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	from, err := mail.ParseAddress(options.From)
	if err != nil {
		return err
	}
	to, err := mail.ParseAddress(message.To)
	if err != nil {
		return err
	}
	if err = client.Mail(from.Address); err != nil {
		return err
	}
	if err = client.Rcpt(to.Address); err != nil {
		return err
	}
	payload, err := mailPayload(options.From, message)
	if err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err = writer.Write(payload); err != nil {
		writer.Close()
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
func connectSMTP(options smtpOptions) (*smtp.Client, error) {
	address := net.JoinHostPort(options.Host, strconv.Itoa(options.Port))
	dialer := &net.Dialer{Timeout: 30 * time.Second}
	var connection net.Conn
	var err error
	tlsConfig := &tls.Config{ServerName: options.Host, MinVersion: tls.VersionTLS12}
	if options.Secure {
		connection, err = tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
	} else {
		connection, err = dialer.Dial("tcp", address)
	}
	if err != nil {
		return nil, err
	}
	if err = connection.SetDeadline(time.Now().Add(2 * time.Minute)); err != nil {
		connection.Close()
		return nil, err
	}
	client, err := smtp.NewClient(connection, options.Host)
	if err != nil {
		connection.Close()
		return nil, err
	}
	if !options.Secure {
		if supported, _ := client.Extension("STARTTLS"); supported {
			if err = client.StartTLS(tlsConfig); err != nil {
				client.Close()
				return nil, err
			}
		}
	}
	return client, nil
}

type smtpAuth struct {
	username, password, method string
	step                       int
}

func (a *smtpAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	for _, method := range server.Auth {
		if method == "PLAIN" {
			a.method = method
			return method, []byte("\x00" + a.username + "\x00" + a.password), nil
		}
	}
	a.method = "LOGIN"
	return "LOGIN", nil, nil
}
func (a *smtpAuth) Next(_ []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	if a.method == "PLAIN" {
		return nil, fmt.Errorf("unexpected SMTP authentication challenge")
	}
	a.step++
	if a.step == 1 {
		return []byte(a.username), nil
	}
	if a.step == 2 {
		return []byte(a.password), nil
	}
	return nil, fmt.Errorf("too many SMTP challenges")
}
func mailPayload(from string, message MailOptions) ([]byte, error) {
	var output bytes.Buffer
	for _, value := range []string{from, message.To, message.Subject} {
		if strings.ContainsAny(value, "\r\n") {
			return nil, fmt.Errorf("invalid mail header")
		}
	}
	fmt.Fprintf(
		&output,
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\n",
		from,
		message.To,
		mime.QEncoding.Encode("utf-8", message.Subject),
	)
	if message.HTML == "" {
		output.WriteString(
			"Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n",
		)
		if err := writeQuotedPrintable(&output, message.Text); err != nil {
			return nil, err
		}
		return output.Bytes(), nil
	}
	multipartWriter := multipart.NewWriter(&output)
	fmt.Fprintf(&output, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", multipartWriter.Boundary())
	for _, part := range []struct{ kind, body string }{{"text/plain", message.Text}, {"text/html", message.HTML}} {
		header := textproto.MIMEHeader{
			"Content-Type":              {part.kind + "; charset=utf-8"},
			"Content-Transfer-Encoding": {"quoted-printable"},
		}
		partWriter, err := multipartWriter.CreatePart(header)
		if err != nil {
			return nil, err
		}
		if err = writeQuotedPrintable(partWriter, part.body); err != nil {
			return nil, err
		}
	}
	if err := multipartWriter.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
func writeQuotedPrintable(output io.Writer, body string) error {
	writer := quotedprintable.NewWriter(output)
	if _, err := writer.Write([]byte(body)); err != nil {
		return err
	}
	return writer.Close()
}
